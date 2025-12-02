/**
 * Çeviri Servisi
 * Hikayeyi hedef dile çevirir (chunk-based stratejisi ile)
 */

import logger from '@/lib/logger';
import { OpenAIError } from '@/lib/errors';
import { retryOpenAI } from './retry.service';
import { 
  createChatCompletion, 
  parseJSONResponse, 
  chunkByTokenLimit, 
  estimateTokens 
} from './openai.service';

interface TranslationOptions {
  content: string;
  title: string;
  sourceLang: string;
  targetLang: string;
  model: string;
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
  model: string
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
    () => createChatCompletion({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
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
  previousContext?: string
): Promise<string> {
  const systemPrompt = `Sen profesyonel bir edebi çevirmensin. Hikayeleri çeviriyorsun.

KURALLAR:
1. Hikaye içeriğini AYNEN koru (hiçbir şey ekleme, çıkarma veya kısaltma)
2. Edebi değeri koru (dil, üslup, atmosfer)
3. Karakter isimleri ve özel isimler tutarlı olmalı
4. Diyalogları doğal çevir
5. Paragraf yapısını koru
6. SADECE çevrilmiş metni döndür (yorum veya açıklama ekleme)

Kaynak Dil: ${sourceLang}
Hedef Dil: ${targetLang}

${previousContext ? `\n[Önceki Bağlam]\n${previousContext}\n[/Önceki Bağlam]\n` : ''}

Bu metin ${totalChunks} parçanın ${chunkIndex + 1}. parçası.
${chunkIndex > 0 ? 'Önceki parçanın devamı, tutarlılığı koru.' : ''}`;

  const response = await retryOpenAI(
    () => createChatCompletion({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: chunk }
      ],
      temperature: 0.3 // Tutarlılık için düşük
    }),
    `Chunk ${chunkIndex + 1}/${totalChunks} çevirisi`
  );

  return response;
}

/**
 * Tam hikayeyi çevirir (chunk-based)
 */
export async function translateStory(options: TranslationOptions): Promise<TranslationResult> {
  const { content, title, sourceLang, targetLang, model } = options;

  logger.info('Hikaye çevirisi başlatılıyor', {
    sourceLang,
    targetLang,
    model,
    contentLength: content.length,
    estimatedTokens: estimateTokens(content)
  });

  try {
    // 1. Başlık çevirisi
    logger.debug('Başlık çevriliyor...');
    const translatedTitle = await translateTitle(title, sourceLang, targetLang, model);
    
    logger.info('Başlık çevirildi', { 
      original: title, 
      translated: translatedTitle 
    });

    // 2. İçeriği chunk'lara böl
    const chunks = chunkByTokenLimit(content, model, 2000); // 2000 token reserve (çeviri için)
    
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
        chunkTokens: estimateTokens(chunk)
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
        previousContext
      );

      translatedChunks.push(translatedChunk);
      totalTokens += estimateTokens(chunk) + estimateTokens(translatedChunk);

      logger.debug(`Chunk ${i + 1}/${chunks.length} tamamlandı`);
    }

    // 4. Chunk'ları birleştir
    const translatedContent = translatedChunks.join('\n\n');

    logger.info('Hikaye çevirisi tamamlandı', {
      originalLength: content.length,
      translatedLength: translatedContent.length,
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
      `Çeviri başarısız: ${error instanceof Error ? error.message : 'Bilinmeyen hata'}`,
      { sourceLang, targetLang }
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
  model: string = 'gpt-4o-mini'
): Promise<string> {
  if (estimateTokens(text) > 8000) {
    throw new OpenAIError('Metin çok uzun, translateStory() kullanın');
  }

  return await translateChunk(text, sourceLang, targetLang, model, 0, 1);
}

