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

interface TranslationOptions {
  content: string;
  title: string;
  sourceLang: string;
  targetLang: string;
  model: string;
  provider?: LLMProvider;
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
 * Hikaye başlığını çevirir
 */
async function translateTitle(
  title: string,
  sourceLang: string,
  targetLang: string,
  model: string,
  provider: LLMProvider = 'openai'
): Promise<string> {
  const systemPrompt = `Sen profesyonel bir çevirmensin. Hikaye başlıklarını çeviriyorsun.

KURALLAR:
1. Başlığın anlamını ve duygusunu koru
2. Hedef dilde doğal ve çekici olsun
3. Uzunluğu benzer tut
4. Sadece çevrilmiş başlığı döndür (ek açıklama yok)

Kaynak Dil: ${sourceLang}
Hedef Dil: ${targetLang}`;

  const response = await retryOpenAI(
    () => createCompletion({
      provider,
      model,
      systemPrompt,
      messages: [
        { role: 'user', content: `Başlık: "${title}"` }
      ],
      temperature: 0.5
    }),
    'Başlık çevirisi'
  );

  return response.trim().replace(/^["']|["']$/g, ''); // Tırnakları kaldır
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
  provider: LLMProvider = 'openai'
): Promise<string> {
  const originalLength = chunk.length;
  const MIN_LENGTH_RATIO = 0.75; // Çeviri en az orijinalin %75'i olmalı
  const MAX_RETRIES = 3;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const systemPrompt = `Sen profesyonel bir edebi çevirmensin. Hikayeleri hedef dile BİREBİR çeviriyorsun.

⛔ YASAK - ASLA YAPMA (YAPAN MODELİ SİLERİZ):
- ❌ ASLA içeriği KISALTMA veya ÖZETLEME
- ❌ ASLA paragraf, cümle veya kelime ATLAMA
- ❌ ASLA sahne, olay veya diyalog ÇIKARMA
- ❌ ASLA hikayeyi değiştirme veya yeniden yazma
- ❌ ASLA "..." ile kısaltma yapma
- ❌ ASLA "devamı..." gibi ifadeler kullanma

📏 UZUNLUK KONTROLÜ (ÇOK KRİTİK):
- Orijinal metin: ~${originalLength} karakter
- Çeviri EN AZ ${Math.round(originalLength * MIN_LENGTH_RATIO)} karakter OLMALI
- Çeviri orijinalin %75-%130 arasında olmalı
- Eğer çeviri çok kısa ise, EKSİK ÇEVİRDİN demektir!

✅ ZORUNLU KURALLAR:
1. HER PARAGRAF, HER CÜMLE, HER KELİME eksiksiz çevrilmeli
2. Paragraf sayısı AYNI kalmalı
3. Cümle sayısı yaklaşık AYNI kalmalı
4. Karakter ve yer isimleri AYNEN KALSIN (adaptasyonda değişecek)
5. SADECE çevrilmiş metni döndür

Kaynak Dil: ${sourceLang}
Hedef Dil: ${targetLang}
${previousContext ? `\n[Bağlam: ...${previousContext}]\n` : ''}
Parça: ${chunkIndex + 1}/${totalChunks}`;

    const response = await retryOpenAI(
      () => createCompletion({
        provider,
        model,
        systemPrompt,
        messages: [
          { role: 'user', content: `ÇEVİR (KISALTMADAN!):\n\n${chunk}` }
        ],
        temperature: 0.3
      }),
      `Chunk ${chunkIndex + 1}/${totalChunks} çevirisi (Deneme ${attempt})`
    );

    const translatedLength = response.length;
    const ratio = translatedLength / originalLength;

    // Uzunluk kontrolü
    if (ratio >= MIN_LENGTH_RATIO) {
      logger.debug(`Chunk ${chunkIndex + 1} çevirildi`, {
        originalLength,
        translatedLength,
        ratio: Math.round(ratio * 100) + '%'
      });
      return response;
    }

    // Çeviri çok kısa - tekrar dene
    logger.warn(`⚠️ Çeviri çok kısa! Tekrar deneniyor (${attempt}/${MAX_RETRIES})`, {
      chunkIndex: chunkIndex + 1,
      originalLength,
      translatedLength,
      ratio: Math.round(ratio * 100) + '%',
      minRequired: Math.round(originalLength * MIN_LENGTH_RATIO)
    });

    if (attempt === MAX_RETRIES) {
      logger.error(`❌ Çeviri ${MAX_RETRIES} denemede de kısa kaldı! Yine de kullanılıyor.`, {
        chunkIndex: chunkIndex + 1,
        ratio: Math.round(ratio * 100) + '%'
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
  const { content, title, sourceLang, targetLang, model, provider = 'openai' } = options;

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
    const translatedTitle = await translateTitle(title, sourceLang, targetLang, model, provider);
    
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
        provider
      );

      translatedChunks.push(translatedChunk);
      totalTokens += estimateTokens(chunk, provider) + estimateTokens(translatedChunk, provider);

      logger.debug(`Chunk ${i + 1}/${chunks.length} tamamlandı`);
    }

    // 4. Chunk'ları birleştir
    const translatedContent = translatedChunks.join('\n\n');

    // 5. Uzunluk kontrolü - hikaye kısaltılmış olabilir mi?
    const lengthRatio = translatedContent.length / content.length;
    if (lengthRatio < 0.7) {
      logger.warn('⚠️ UYARI: Çeviri orijinalden çok kısa! Hikaye kısaltılmış olabilir.', {
        originalLength: content.length,
        translatedLength: translatedContent.length,
        ratio: Math.round(lengthRatio * 100) + '%',
        expectedMinLength: Math.round(content.length * 0.7)
      });
    } else if (lengthRatio > 1.5) {
      logger.warn('⚠️ UYARI: Çeviri orijinalden çok uzun!', {
        originalLength: content.length,
        translatedLength: translatedContent.length,
        ratio: Math.round(lengthRatio * 100) + '%'
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

