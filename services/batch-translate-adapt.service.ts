/**
 * Batch Translation & Adaptation Service
 * Zaman damgalı sahneler için toplu çeviri ve adaptasyon
 * Tek bir API çağrısında birden fazla sahneyi işler
 */

import logger from '@/lib/logger';
import { OpenAIError } from '@/lib/errors';
import { retryOpenAI } from './retry.service';
import { 
  createCompletion, 
  estimateTokens,
  type LLMProvider 
} from './llm-router.service';
import { type TimestampedScene } from './transcript-parser.service';

interface BatchTranslateOptions {
  scenes: TimestampedScene[];
  title: string;
  sourceLang: string;
  targetLang: string;
  model: string;
  provider?: LLMProvider;
}

interface BatchAdaptOptions {
  scenes: TimestampedScene[];
  title: string;
  targetCountry: string;
  targetLang: string;
  model: string;
  provider?: LLMProvider;
}

interface BatchResult {
  title: string;
  scenes: TimestampedScene[];
}

/**
 * Sahneleri batch'lere böler (token limitine göre)
 * Her batch maksimum ~6000 token olacak şekilde
 */
function splitIntoBatches(scenes: TimestampedScene[], maxTokensPerBatch: number = 6000, provider: LLMProvider = 'openai'): TimestampedScene[][] {
  const batches: TimestampedScene[][] = [];
  let currentBatch: TimestampedScene[] = [];
  let currentTokens = 0;

  for (const scene of scenes) {
    const sceneText = scene.textAdapted || scene.text;
    const sceneTokens = estimateTokens(sceneText, provider);

    // Sahne tek başına çok büyükse, tek başına bir batch oluştur
    if (sceneTokens > maxTokensPerBatch) {
      if (currentBatch.length > 0) {
        batches.push(currentBatch);
        currentBatch = [];
        currentTokens = 0;
      }
      batches.push([scene]);
      continue;
    }

    // Batch'e ekleyebilir miyiz?
    if (currentTokens + sceneTokens > maxTokensPerBatch) {
      // Mevcut batch'i kapat, yeni başlat
      batches.push(currentBatch);
      currentBatch = [scene];
      currentTokens = sceneTokens;
    } else {
      currentBatch.push(scene);
      currentTokens += sceneTokens;
    }
  }

  // Son batch'i ekle
  if (currentBatch.length > 0) {
    batches.push(currentBatch);
  }

  return batches;
}

/**
 * Tek bir batch'i çevirir
 */
async function translateBatch(
  batch: TimestampedScene[],
  sourceLang: string,
  targetLang: string,
  model: string,
  batchIndex: number,
  totalBatches: number,
  provider: LLMProvider = 'openai'
): Promise<TimestampedScene[]> {
  // Sahneleri JSON formatında hazırla
  const scenesInput = batch.map((scene, idx) => ({
    id: idx + 1,
    text: scene.text
  }));

  const systemPrompt = `Sen profesyonel bir edebi çevirmensin. Çoklu metin parçalarını çeviriyorsun.

KURALLAR:
1. Her metin parçasını BİREBİR çevir
2. ASLA kısaltma, atlama veya özetleme yapma
3. Karakter sayısı korunmalı (±%5 tolerans)
4. Sadece çevir, adaptasyon yapma (isimler, yerler aynı kalsın)
5. Yanıtı JSON formatında ver

Kaynak Dil: ${sourceLang}
Hedef Dil: ${targetLang}
Batch: ${batchIndex + 1}/${totalBatches}

JSON FORMAT (ZORUNLU):
{
  "translations": [
    {"id": 1, "text": "çevrilmiş metin 1"},
    {"id": 2, "text": "çevrilmiş metin 2"}
  ]
}`;

  const userPrompt = `ÇEVİR (${batch.length} parça):

${JSON.stringify(scenesInput, null, 2)}`;

  const response = await retryOpenAI(
    () => createCompletion({
      provider,
      model,
      systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
      temperature: 0.3,
      responseFormat: 'json_object'
    }),
    `Batch ${batchIndex + 1}/${totalBatches} çevirisi`
  );

  try {
    const parsed = JSON.parse(response);
    const translations = parsed.translations || [];

    // Çevirileri scene'lere uygula
    return batch.map((scene, idx) => {
      const translation = translations.find((t: { id: number; text: string }) => t.id === idx + 1);
      return {
        ...scene,
        textAdapted: translation?.text || scene.text
      };
    });
  } catch (error) {
    logger.error('Batch çeviri parse hatası', { batchIndex, error });
    // Fallback: orijinal metinleri kullan
    return batch.map(scene => ({
      ...scene,
      textAdapted: scene.text
    }));
  }
}

/**
 * Tek bir batch'i adapte eder
 */
async function adaptBatch(
  batch: TimestampedScene[],
  targetCountry: string,
  targetLang: string,
  model: string,
  batchIndex: number,
  totalBatches: number,
  provider: LLMProvider = 'openai'
): Promise<TimestampedScene[]> {
  // Sahneleri JSON formatında hazırla
  const scenesInput = batch.map((scene, idx) => ({
    id: idx + 1,
    text: scene.textAdapted || scene.text
  }));

  const systemPrompt = `Sen kültürel adaptasyon uzmanısın. Çoklu metin parçalarını hedef ülkeye adapte ediyorsun.

KURALLAR:
1. SIRADAN kişi isimlerini ${targetCountry}'de yaygın isimlerle değiştir
2. SIRADAN yer isimlerini ${targetCountry}'deki yerlerle değiştir
3. Para birimi, bayram, yemek gibi kültürel unsurları yerelleştir
4. YEREL KURUMLAR: Hikayenin geçtiği ülkenin kurumlarını ${targetCountry} karşılıklarıyla değiştir
5. Karakter sayısı korunmalı (±%5 tolerans)
6. ASLA kısaltma veya atlama yapma
7. Yanıtı JSON formatında ver

📍 YEREL KURUM ADAPTASYONU:
- ABD kurumları → ${targetCountry} karşılıkları: CIA→yerel istihbarat, FBI→yerel güvenlik
- Örnek: CIA→MİT(TR)/DGSE(FR)/BND(DE), FBI→Emniyet(TR)/DGSI(FR)/BKA(DE)

🚫 DEĞİŞTİRME - HİKAYENİN ANA KONUSU İSE:
- Hikaye Elon Musk/NASA/Google hakkındaysa → bu isimler değişmez
- Evrensel markalar: iPhone, Tesla, Ferrari
- Karar kriteri: "Bu kurum/kişi hikayenin ANA KONUSU mu?" Evet → Değiştirme

🎙️ SESLENDİRME UYGUNLUĞU:
- Kısaltmaları aç: "Dr." → "Doktor", "vb." → "ve benzeri"
- Sayıları yazıyla yaz: "3" → "üç"
- Parantezleri kaldır veya cümleye entegre et

Hedef Ülke: ${targetCountry}
Hedef Dil: ${targetLang}
Batch: ${batchIndex + 1}/${totalBatches}

JSON FORMAT (ZORUNLU):
{
  "adaptations": [
    {"id": 1, "text": "adapte edilmiş metin 1"},
    {"id": 2, "text": "adapte edilmiş metin 2"}
  ]
}`;

  const userPrompt = `ADAPTE ET (${batch.length} parça):

${JSON.stringify(scenesInput, null, 2)}`;

  const response = await retryOpenAI(
    () => createCompletion({
      provider,
      model,
      systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
      temperature: 0.3,
      responseFormat: 'json_object'
    }),
    `Batch ${batchIndex + 1}/${totalBatches} adaptasyonu`
  );

  try {
    const parsed = JSON.parse(response);
    const adaptations = parsed.adaptations || [];

    // Adaptasyonları scene'lere uygula
    return batch.map((scene, idx) => {
      const adaptation = adaptations.find((a: { id: number; text: string }) => a.id === idx + 1);
      return {
        ...scene,
        textAdapted: adaptation?.text || scene.textAdapted || scene.text
      };
    });
  } catch (error) {
    logger.error('Batch adaptasyon parse hatası', { batchIndex, error });
    // Fallback: mevcut metinleri kullan
    return batch;
  }
}

/**
 * Tüm sahneleri toplu olarak çevirir
 */
export async function batchTranslateScenes(options: BatchTranslateOptions): Promise<BatchResult> {
  const { scenes, title, sourceLang, targetLang, model, provider = 'openai' } = options;

  logger.info('Batch çeviri başlatılıyor', {
    sceneCount: scenes.length,
    sourceLang,
    targetLang,
    model,
    provider
  });

  // 1. Başlığı çevir
  const titleResponse = await retryOpenAI(
    () => createCompletion({
      provider,
      model,
      systemPrompt: `Başlığı ${sourceLang} dilinden ${targetLang} diline çevir. Sadece çevrilmiş başlığı döndür.`,
      messages: [{ role: 'user', content: title }],
      temperature: 0.3
    }),
    'Başlık çevirisi'
  );
  const translatedTitle = titleResponse.trim().replace(/^["']|["']$/g, '');

  // 2. Sahneleri batch'lere böl
  const batches = splitIntoBatches(scenes, 6000, provider);
  
  logger.info('Sahneler batch\'lere bölündü', {
    totalScenes: scenes.length,
    totalBatches: batches.length,
    avgBatchSize: Math.round(scenes.length / batches.length)
  });

  // 3. Her batch'i çevir
  const translatedScenes: TimestampedScene[] = [];
  
  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    
    logger.debug(`Batch ${i + 1}/${batches.length} çevriliyor...`, {
      batchSize: batch.length
    });

    const translatedBatch = await translateBatch(
      batch,
      sourceLang,
      targetLang,
      model,
      i,
      batches.length,
      provider
    );

    translatedScenes.push(...translatedBatch);
  }

  logger.info('Batch çeviri tamamlandı', {
    totalScenes: translatedScenes.length,
    batchesUsed: batches.length
  });

  return {
    title: translatedTitle,
    scenes: translatedScenes
  };
}

/**
 * Tüm sahneleri toplu olarak adapte eder
 */
export async function batchAdaptScenes(options: BatchAdaptOptions): Promise<BatchResult> {
  const { scenes, title, targetCountry, targetLang, model, provider = 'openai' } = options;

  logger.info('Batch adaptasyon başlatılıyor', {
    sceneCount: scenes.length,
    targetCountry,
    targetLang,
    model,
    provider
  });

  // 1. Başlığı adapte et
  const titleResponse = await retryOpenAI(
    () => createCompletion({
      provider,
      model,
      systemPrompt: `Başlığı ${targetCountry} kültürüne adapte et. SIRADAN kişi/yer isimlerini ${targetCountry}'de yaygın olanlarla değiştir. Hikayenin ANA KONUSU olan ünlü kişiler/kurumlar (Elon Musk, NASA, Google vb.) DEĞİŞMEZ. Arka plandaki yerel kurumlar (CIA, FBI vb.) ${targetCountry} karşılıklarına dönüştürülebilir. Sadece adapte edilmiş başlığı döndür.`,
      messages: [{ role: 'user', content: title }],
      temperature: 0.4
    }),
    'Başlık adaptasyonu'
  );
  const adaptedTitle = titleResponse.trim().replace(/^["']|["']$/g, '');

  // 2. Sahneleri batch'lere böl
  const batches = splitIntoBatches(scenes, 6000, provider);
  
  logger.info('Sahneler batch\'lere bölündü', {
    totalScenes: scenes.length,
    totalBatches: batches.length,
    avgBatchSize: Math.round(scenes.length / batches.length)
  });

  // 3. Her batch'i adapte et
  const adaptedScenes: TimestampedScene[] = [];
  
  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    
    logger.debug(`Batch ${i + 1}/${batches.length} adapte ediliyor...`, {
      batchSize: batch.length
    });

    const adaptedBatch = await adaptBatch(
      batch,
      targetCountry,
      targetLang,
      model,
      i,
      batches.length,
      provider
    );

    adaptedScenes.push(...adaptedBatch);
  }

  logger.info('Batch adaptasyon tamamlandı', {
    totalScenes: adaptedScenes.length,
    batchesUsed: batches.length
  });

  return {
    title: adaptedTitle,
    scenes: adaptedScenes
  };
}

/**
 * Çeviri ve adaptasyonu tek adımda yapar (en hızlı yöntem)
 * Sahneleri hem çevirir hem adapte eder
 */
export async function batchTranslateAndAdaptScenes(
  scenes: TimestampedScene[],
  title: string,
  sourceLang: string,
  targetLang: string,
  targetCountry: string,
  model: string,
  provider: LLMProvider = 'openai',
  translationOnly: boolean = false
): Promise<BatchResult> {
  logger.info('Batch çeviri+adaptasyon başlatılıyor', {
    sceneCount: scenes.length,
    sourceLang,
    targetLang,
    targetCountry,
    model,
    provider,
    translationOnly
  });

  // Sahneleri batch'lere böl
  const batches = splitIntoBatches(scenes, 5000, provider);
  
  logger.info('Batch\'ler oluşturuldu', {
    totalScenes: scenes.length,
    totalBatches: batches.length
  });

  // Başlık işlemi
  const titleSystemPrompt = translationOnly
    ? `Başlığı ${sourceLang} dilinden ${targetLang} diline çevir. Sadece çevrilmiş başlığı döndür.`
    : `Başlığı ${sourceLang} dilinden ${targetLang} diline çevir ve ${targetCountry} kültürüne adapte et. SIRADAN kişi/yer isimlerini yerelleştir. Hikayenin ANA KONUSU olan ünlü kişi/kurumlar DEĞİŞMEZ. Arka plandaki yerel kurumlar (CIA→MİT/DGSE vb.) adapte edilebilir. Sadece sonucu döndür.`;

  const titleResponse = await retryOpenAI(
    () => createCompletion({
      provider,
      model,
      systemPrompt: titleSystemPrompt,
      messages: [{ role: 'user', content: title }],
      temperature: 0.4
    }),
    'Başlık çeviri+adaptasyon'
  );
  const processedTitle = titleResponse.trim().replace(/^["']|["']$/g, '');

  // Her batch'i işle
  const processedScenes: TimestampedScene[] = [];

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    
    const scenesInput = batch.map((scene, idx) => ({
      id: idx + 1,
      text: scene.text
    }));

    const systemPrompt = translationOnly
      ? `Sen profesyonel bir çevirmensin. Metin parçalarını ${sourceLang} dilinden ${targetLang} diline çevir.

KURALLAR:
1. Her metni BİREBİR çevir
2. ASLA kısaltma yapma
3. Karakter sayısı ±%5 toleransında kalmalı

JSON FORMAT:
{"results": [{"id": 1, "text": "çevrilmiş metin"}]}`
      : `Sen profesyonel bir çevirmen ve kültürel adaptasyon uzmanısın. Metin parçalarını ${sourceLang} dilinden ${targetLang} diline çevir ve ${targetCountry} kültürüne adapte et.

KURALLAR:
1. Her metni BİREBİR çevir
2. SIRADAN kişi isimlerini ${targetCountry}'de yaygın isimlerle değiştir
3. SIRADAN yer isimlerini ${targetCountry}'deki yerlerle değiştir
4. Kültürel unsurları (para, bayram, yemek) yerelleştir
5. YEREL KURUMLAR: Arka plandaki kurumları ${targetCountry} karşılıklarıyla değiştir (CIA→MİT/DGSE/BND, FBI→Emniyet/DGSI/BKA)
6. ASLA kısaltma yapma
7. Karakter sayısı ±%5 toleransında kalmalı

⚠️ BAĞLAMSAL KARAR:
- Hikayenin ANA KONUSU olan kişi/kurumlar → DEĞİŞTİRME (Elon Musk hikayesi → Elon Musk kalır)
- Arka plandaki yerel kurumlar → ${targetCountry}'e ADAPTE ET (ABD'de geçen hikaye ${targetCountry}'e: CIA→yerel istihbarat)
- Evrensel markalar (iPhone, Tesla, Coca-Cola) → Genelde değişmez

🎙️ SESLENDİRME İÇİN:
- "Dr." → "Doktor", "vb." → "ve benzeri"
- "3" → "üç"

JSON FORMAT:
{"results": [{"id": 1, "text": "çevrilmiş+adapte metin"}]}`;

    const response = await retryOpenAI(
      () => createCompletion({
        provider,
        model,
        systemPrompt,
        messages: [{ role: 'user', content: JSON.stringify(scenesInput, null, 2) }],
        temperature: 0.3,
        responseFormat: 'json_object'
      }),
      `Batch ${i + 1}/${batches.length} çeviri+adaptasyon`
    );

    try {
      const parsed = JSON.parse(response);
      const results = parsed.results || [];

      const processedBatch = batch.map((scene, idx) => {
        const result = results.find((r: { id: number; text: string }) => r.id === idx + 1);
        return {
          ...scene,
          textAdapted: result?.text || scene.text
        };
      });

      processedScenes.push(...processedBatch);
    } catch (error) {
      logger.error('Batch parse hatası, orijinal metinler kullanılıyor', { batchIndex: i });
      processedScenes.push(...batch.map(s => ({ ...s, textAdapted: s.text })));
    }

    logger.debug(`Batch ${i + 1}/${batches.length} tamamlandı`);
  }

  logger.info('Batch çeviri+adaptasyon tamamlandı', {
    totalScenes: processedScenes.length
  });

  return {
    title: processedTitle,
    scenes: processedScenes
  };
}
