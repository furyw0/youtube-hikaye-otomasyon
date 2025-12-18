/**
 * Çeviri Servisi
 * Hikayeyi hedef dile çevirir (chunk-based stratejisi ile)
 */

import logger from '@/lib/logger';
import { OpenAIError } from '@/lib/errors';
import { retryOpenAI } from './retry.service';
import { 
  createCompletion,
  parseJSONResponse,
  chunkByTokenLimit,
  estimateTokens,
  type LLMProvider
} from './llm-router.service';

interface PromptScenario {
  translationSystemPrompt: string;
  translationUserPrompt: string;
  titleTranslationSystemPrompt?: string;
  titleTranslationUserPrompt?: string;
}

interface TranslationOptions {
  content: string;
  title: string;
  sourceLang: string;
  targetLang: string;
  model: string;
  provider?: LLMProvider;
  promptScenario?: PromptScenario | null;
}

interface TranslationResult {
  title: string;
  content: string;
  originalLength: number;
  translatedLength: number;
  chunksUsed: number;
  totalTokens: number;
}

/**
 * Varsayılan başlık çevirisi promptları
 */
const DEFAULT_TITLE_TRANSLATION_SYSTEM_PROMPT = `Sen profesyonel bir çevirmensin. Hikaye başlıklarını çeviriyorsun.

KURALLAR:
1. Başlığın anlamını ve duygusunu koru
2. Hedef dilde doğal ve çekici olsun
3. Uzunluğu benzer tut
4. Sadece çevrilmiş başlığı döndür (ek açıklama yok)

Kaynak Dil: {{SOURCE_LANG}}
Hedef Dil: {{TARGET_LANGUAGE}}`;

const DEFAULT_TITLE_TRANSLATION_USER_PROMPT = `Başlık: "{{TITLE}}"`;

/**
 * Hikaye başlığını çevirir
 */
async function translateTitle(
  title: string,
  sourceLang: string,
  targetLang: string,
  model: string,
  provider: LLMProvider = 'openai',
  promptScenario?: PromptScenario | null
): Promise<string> {
  // Değişkenler
  const variables: Record<string, string> = {
    SOURCE_LANG: sourceLang,
    TARGET_LANGUAGE: targetLang,
    TITLE: title
  };

  // Prompt şablonlarını al
  const systemPromptTemplate = promptScenario?.titleTranslationSystemPrompt || DEFAULT_TITLE_TRANSLATION_SYSTEM_PROMPT;
  const userPromptTemplate = promptScenario?.titleTranslationUserPrompt || DEFAULT_TITLE_TRANSLATION_USER_PROMPT;

  const systemPrompt = fillPromptTemplate(systemPromptTemplate, variables);
  const userPrompt = fillPromptTemplate(userPromptTemplate, variables);

  const response = await retryOpenAI(
    () => createCompletion({
      provider,
      model,
      systemPrompt,
      messages: [
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.5
    }),
    'Başlık çevirisi'
  );

  return response.trim().replace(/^["']|["']$/g, ''); // Tırnakları kaldır
}

/**
 * Varsayılan çeviri system prompt'u
 */
const DEFAULT_TRANSLATION_SYSTEM_PROMPT = `Sen profesyonel bir edebi çevirmensin. Hikayeleri hedef dile BİREBİR çeviriyorsun.

🎯 KRİTİK HEDEF - KARAKTER SAYISI KONTROLÜ:
- Çeviri orijinalin EN AZ %95'i ve EN FAZLA %105'i olmalı
- SADECE %5 fark toleransı var!
- Bu hedefe ulaşmak için her kelimeyi dikkatle çevir

⛔ YASAK - ASLA YAPMA (YAPAN MODELİ SİLERİZ):
- ❌ ASLA içeriği KISALTMA veya ÖZETLEME
- ❌ ASLA paragraf, cümle veya kelime ATLAMA
- ❌ ASLA sahne, olay veya diyalog ÇIKARMA
- ❌ ASLA hikayeyi değiştirme veya yeniden yazma
- ❌ ASLA "..." ile kısaltma yapma
- ❌ ASLA "devamı..." gibi ifadeler kullanma
- ❌ ASLA gereksiz açıklama veya ekleme yapma

✅ ZORUNLU KURALLAR:
1. HER PARAGRAF, HER CÜMLE, HER KELİME eksiksiz çevrilmeli
2. Paragraf sayısı AYNI kalmalı
3. Karakter ve yer isimleri AYNEN KALSIN (adaptasyonda değişecek)
4. SADECE çevrilmiş metni döndür

{{VARIABLES}}`;

const DEFAULT_TRANSLATION_USER_PROMPT = `ÇEVİR (KISALTMADAN!):

{{CONTENT}}`;

/**
 * Prompt şablonunu değişkenlerle doldurur
 */
function fillPromptTemplate(
  template: string,
  variables: Record<string, string>
): string {
  let result = template;
  for (const [key, value] of Object.entries(variables)) {
    result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
  }
  return result;
}

/**
 * Tek bir metin parçasını çevirir
 */
async function translateChunk(
  chunk: string,
  sourceLang: string,
  targetLang: string,
  model: string,
  chunkIndex: number,
  totalChunks: number,
  previousContext?: string,
  provider: LLMProvider = 'openai',
  promptScenario?: PromptScenario | null
): Promise<string> {
  const originalLength = chunk.length;
  const MIN_LENGTH_RATIO = 0.95; // Çeviri en az orijinalin %95'i olmalı (max %5 kısalma)
  const MAX_LENGTH_RATIO = 1.05; // Çeviri en fazla orijinalin %105'i olmalı (max %5 uzama)
  const MAX_RETRIES = 3;

  // Değişkenler
  const minChars = Math.round(originalLength * MIN_LENGTH_RATIO);
  const maxChars = Math.round(originalLength * MAX_LENGTH_RATIO);
  const variables: Record<string, string> = {
    VARIABLES: `Kaynak Dil: ${sourceLang}
Hedef Dil: ${targetLang}
Orijinal metin: ${originalLength} karakter

🎯 KARAKTER SAYISI HEDEFİ (KRİTİK!):
- Minimum: ${minChars} karakter (%95)
- Maksimum: ${maxChars} karakter (%105)
- Tolerans: SADECE %5 fark kabul edilir!

${previousContext ? `[Bağlam: ...${previousContext}]` : ''}
Parça: ${chunkIndex + 1}/${totalChunks}`,
    CONTENT: chunk,
    SOURCE_LANG: sourceLang,
    TARGET_LANG: targetLang
  };

  // Prompt şablonlarını al (senaryo varsa kullan, yoksa varsayılan)
  const systemPromptTemplate = promptScenario?.translationSystemPrompt || DEFAULT_TRANSLATION_SYSTEM_PROMPT;
  const userPromptTemplate = promptScenario?.translationUserPrompt || DEFAULT_TRANSLATION_USER_PROMPT;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const systemPrompt = fillPromptTemplate(systemPromptTemplate, variables);

    const userPrompt = fillPromptTemplate(userPromptTemplate, variables);
    
    const response = await retryOpenAI(
      () => createCompletion({
        provider,
        model,
        systemPrompt,
        messages: [
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.3
      }),
      `Chunk ${chunkIndex + 1}/${totalChunks} çevirisi (Deneme ${attempt})`
    );

    const translatedLength = response.length;
    const ratio = translatedLength / originalLength;
    const differencePercent = Math.abs(ratio - 1) * 100;

    // Uzunluk kontrolü - %5 tolerans içinde mi?
    if (ratio >= MIN_LENGTH_RATIO && ratio <= MAX_LENGTH_RATIO) {
      logger.debug(`Chunk ${chunkIndex + 1} çevirildi ✅`, {
        originalLength,
        translatedLength,
        ratio: Math.round(ratio * 100) + '%',
        difference: `${differencePercent.toFixed(1)}%`
      });
      return response;
    }

    // Çeviri tolerans dışında - tekrar dene
    const isShort = ratio < MIN_LENGTH_RATIO;
    logger.warn(`⚠️ Çeviri ${isShort ? 'çok kısa' : 'çok uzun'}! Tekrar deneniyor (${attempt}/${MAX_RETRIES})`, {
      chunkIndex: chunkIndex + 1,
      originalLength,
      translatedLength,
      ratio: Math.round(ratio * 100) + '%',
      difference: `${differencePercent.toFixed(1)}%`,
      target: `${minChars}-${maxChars} karakter`
    });

    if (attempt === MAX_RETRIES) {
      logger.error(`❌ Çeviri ${MAX_RETRIES} denemede de %5 tolerans dışında kaldı! Yine de kullanılıyor.`, {
        chunkIndex: chunkIndex + 1,
        ratio: Math.round(ratio * 100) + '%',
        difference: `${differencePercent.toFixed(1)}%`
      });
      return response;
    }
  }

  // Fallback (buraya ulaşmamalı)
  throw new OpenAIError(`Chunk ${chunkIndex + 1} çevirilemedi`);
}

/**
 * Tam hikayeyi çevirir (chunk-based)
 */
export async function translateStory(options: TranslationOptions): Promise<TranslationResult> {
  const { content, title, sourceLang, targetLang, model, provider = 'openai', promptScenario } = options;

  logger.info('Hikaye çevirisi başlatılıyor', {
    sourceLang,
    targetLang,
    model,
    provider,
    contentLength: content.length,
    estimatedTokens: estimateTokens(content, provider)
  });

  try {
    // 1. Başlık çevirisi
    logger.debug('Başlık çevriliyor...');
    const translatedTitle = await translateTitle(title, sourceLang, targetLang, model, provider, promptScenario);
    
    logger.info('Başlık çevirildi', { 
      original: title, 
      translated: translatedTitle 
    });

    // 2. İçeriği chunk'lara böl
    const chunks = chunkByTokenLimit(content, model, provider, 2000); // 2000 token reserve (çeviri için)
    
    logger.info("İçerik chunk'lara bölündü", {
      totalChunks: chunks.length,
      avgChunkSize: Math.round(content.length / chunks.length)
    });

    // 3. Her chunk'ı çevir (sıralı olarak - tutarlılık için)
    const translatedChunks: string[] = [];
    let totalTokens = 0;

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      
      logger.debug(`Chunk ${i + 1}/${chunks.length} çevriliyor...`, {
        chunkLength: chunk.length,
        chunkTokens: estimateTokens(chunk, provider)
      });

      // Son chunk'ın son 200 karakterini context olarak kullan (tutarlılık için)
      const previousContext = i > 0 
        ? translatedChunks[i - 1].slice(-200) 
        : undefined;

      const translatedChunk = await translateChunk(
        chunk,
        sourceLang,
        targetLang,
        model,
        i,
        chunks.length,
        previousContext,
        provider,
        promptScenario
      );

      translatedChunks.push(translatedChunk);
      totalTokens += estimateTokens(chunk, provider) + estimateTokens(translatedChunk, provider);

      logger.debug(`Chunk ${i + 1}/${chunks.length} tamamlandı`);
    }

    // 4. Chunk'ları birleştir
    const translatedContent = translatedChunks.join('\n\n');

    // 5. Uzunluk kontrolü - %5 tolerans içinde mi?
    const lengthRatio = translatedContent.length / content.length;
    const differencePercent = Math.abs(lengthRatio - 1) * 100;
    
    if (differencePercent > 5) {
      const isShort = lengthRatio < 1;
      logger.warn(`⚠️ UYARI: Çeviri ${isShort ? 'kısa' : 'uzun'}! %5 tolerans aşıldı.`, {
        originalLength: content.length,
        translatedLength: translatedContent.length,
        ratio: Math.round(lengthRatio * 100) + '%',
        difference: `${differencePercent.toFixed(1)}%`,
        target: `${Math.round(content.length * 0.95)}-${Math.round(content.length * 1.05)} karakter`
      });
    } else {
      logger.info('✅ Çeviri uzunluğu %5 tolerans içinde', {
        originalLength: content.length,
        translatedLength: translatedContent.length,
        ratio: Math.round(lengthRatio * 100) + '%',
        difference: `${differencePercent.toFixed(1)}%`
      });
    }

    logger.info('Hikaye çevirisi tamamlandı', {
      originalLength: content.length,
      translatedLength: translatedContent.length,
      lengthRatio: Math.round(lengthRatio * 100) + '%',
      chunksUsed: chunks.length,
      totalTokens
    });

    return {
      title: translatedTitle,
      content: translatedContent,
      originalLength: content.length,
      translatedLength: translatedContent.length,
      chunksUsed: chunks.length,
      totalTokens
    };

  } catch (error) {
    logger.error('Çeviri hatası', {
      error: error instanceof Error ? error.message : 'Bilinmeyen hata',
      sourceLang,
      targetLang,
      contentLength: content.length
    });

    throw new OpenAIError(
      `Çeviri başarısız (${sourceLang} -> ${targetLang}): ${error instanceof Error ? error.message : 'Bilinmeyen hata'}`
    );
  }
}

/**
 * Hızlı çeviri (kısa metinler için - chunk'sız)
 */
export async function translateText(
  text: string,
  sourceLang: string,
  targetLang: string,
  model: string = 'gpt-4o-mini',
  provider: LLMProvider = 'openai'
): Promise<string> {
  if (estimateTokens(text, provider) > 8000) {
    throw new OpenAIError('Metin çok uzun, translateStory() kullanın');
  }

  return await translateChunk(text, sourceLang, targetLang, model, 0, 1, undefined, provider);
}

