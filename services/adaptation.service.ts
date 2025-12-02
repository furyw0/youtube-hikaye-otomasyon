/**
 * Kültürel Uyarlama Servisi
 * Çevrilmiş hikayeyi hedef ülkenin kültürüne adapte eder
 */

import logger from '@/lib/logger';
import { OpenAIError } from '@/lib/errors';
import { retryOpenAI } from './retry.service';
import { createChatCompletion, chunkByTokenLimit, estimateTokens } from './openai.service';

interface AdaptationOptions {
  content: string;
  title: string;
  targetCountry: string;
  targetLanguage: string;
  model: string;
}

interface AdaptationResult {
  title: string;
  content: string;
  adaptations: string[];
  originalLength: number;
  adaptedLength: number;
}

/**
 * Başlığı hedef ülkeye adapte eder
 */
async function adaptTitle(
  title: string,
  targetCountry: string,
  targetLanguage: string,
  model: string
): Promise<string> {
  const systemPrompt = `Sen kültürel adaptasyon uzmanısın. Hikaye başlıklarını hedef ülkenin kültürüne adapte ediyorsun.

KURALLAR:
1. Başlığın temel anlamını koru
2. ${targetCountry} kültürüne uygun yap
3. Yerel ifadeleri ve kültürel referansları kullan
4. Uzunluğu benzer tut
5. Çekici ve merak uyandırıcı olsun
6. Sadece adapte edilmiş başlığı döndür

Hedef Ülke: ${targetCountry}
Hedef Dil: ${targetLanguage}`;

  const response = await retryOpenAI(
    () => createChatCompletion({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Başlık: "${title}"` }
      ],
      temperature: 0.6 // Biraz daha yaratıcı
    }),
    'Başlık adaptasyonu'
  );

  return response.trim().replace(/^["']|["']$/g, '');
}

/**
 * Tek bir chunk'ı adapte eder
 */
async function adaptChunk(
  chunk: string,
  targetCountry: string,
  targetLanguage: string,
  model: string,
  chunkIndex: number,
  totalChunks: number
): Promise<{ adapted: string; notes: string[] }> {
  const systemPrompt = `Sen kültürel adaptasyon uzmanısın. Hikayeleri hedef ülkenin kültürüne adapte ediyorsun.

KURALLAR:
1. Hikaye içeriğini ve uzunluğunu AYNEN koru (hiçbir şey çıkarma veya kısaltma)
2. Kültürel referansları ${targetCountry} kültürüne uyarla
3. Yerel deyimler ve ifadeler kullan
4. İsimler ${targetCountry}'ye uygun olabilir (ama tutarlı olmalı)
5. Yemek, giysi, gelenekler gibi unsurları yerelleştir
6. Para birimi, ölçü birimleri vb. ${targetCountry} standardına uygun olsun
7. Hikayenin akışını ve atmosferini koru
8. Paragraf yapısını koru

Hedef Ülke: ${targetCountry}
Hedef Dil: ${targetLanguage}

JSON FORMAT (zorunlu):
{
  "adapted": "Adapte edilmiş metin",
  "notes": ["Yapılan değişiklik 1", "Yapılan değişiklik 2"]
}

Bu metin ${totalChunks} parçanın ${chunkIndex + 1}. parçası.`;

  const response = await retryOpenAI(
    () => createChatCompletion({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: chunk }
      ],
      temperature: 0.4,
      responseFormat: 'json_object'
    }),
    `Chunk ${chunkIndex + 1}/${totalChunks} adaptasyonu`
  );

  try {
    const parsed = JSON.parse(response);
    return {
      adapted: parsed.adapted || chunk,
      notes: parsed.notes || []
    };
  } catch (error) {
    logger.warn('Adaptasyon JSON parse hatası, ham metin kullanılıyor', {
      chunkIndex,
      error: error instanceof Error ? error.message : 'Bilinmeyen hata'
    });
    return {
      adapted: response, // Fallback: ham yanıtı kullan
      notes: []
    };
  }
}

/**
 * Tam hikayeyi adapte eder
 */
export async function adaptStory(options: AdaptationOptions): Promise<AdaptationResult> {
  const { content, title, targetCountry, targetLanguage, model } = options;

  logger.info('Kültürel adaptasyon başlatılıyor', {
    targetCountry,
    targetLanguage,
    model,
    contentLength: content.length,
    estimatedTokens: estimateTokens(content)
  });

  try {
    // 1. Başlık adaptasyonu
    logger.debug('Başlık adapte ediliyor...');
    const adaptedTitle = await adaptTitle(title, targetCountry, targetLanguage, model);
    
    logger.info('Başlık adapte edildi', { 
      original: title, 
      adapted: adaptedTitle 
    });

    // 2. İçeriği chunk'lara böl
    const chunks = chunkByTokenLimit(content, model, 2000);
    
    logger.info("İçerik chunk'lara bölündü", {
      totalChunks: chunks.length,
      avgChunkSize: Math.round(content.length / chunks.length)
    });

    // 3. Her chunk'ı adapte et
    const adaptedChunks: string[] = [];
    const allNotes: string[] = [];

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      
      logger.debug(`Chunk ${i + 1}/${chunks.length} adapte ediliyor...`, {
        chunkLength: chunk.length
      });

      const result = await adaptChunk(
        chunk,
        targetCountry,
        targetLanguage,
        model,
        i,
        chunks.length
      );

      adaptedChunks.push(result.adapted);
      allNotes.push(...result.notes);

      logger.debug(`Chunk ${i + 1}/${chunks.length} tamamlandı`, {
        notesCount: result.notes.length
      });
    }

    // 4. Chunk'ları birleştir
    const adaptedContent = adaptedChunks.join('\n\n');

    // 5. Uzunluk kontrolü (adaptasyon çok kısaltmış/uzatmışsa uyar)
    const lengthRatio = adaptedContent.length / content.length;
    if (lengthRatio < 0.8 || lengthRatio > 1.2) {
      logger.warn('Adaptasyon uzunluk oranı beklenenden farklı', {
        originalLength: content.length,
        adaptedLength: adaptedContent.length,
        ratio: lengthRatio
      });
    }

    logger.info('Kültürel adaptasyon tamamlandı', {
      originalLength: content.length,
      adaptedLength: adaptedContent.length,
      totalNotes: allNotes.length,
      lengthRatio
    });

    return {
      title: adaptedTitle,
      content: adaptedContent,
      adaptations: allNotes,
      originalLength: content.length,
      adaptedLength: adaptedContent.length
    };

  } catch (error) {
    logger.error('Adaptasyon hatası', {
      error: error instanceof Error ? error.message : 'Bilinmeyen hata',
      targetCountry,
      contentLength: content.length
    });

    throw new OpenAIError(
      `Kültürel adaptasyon başarısız: ${error instanceof Error ? error.message : 'Bilinmeyen hata'}`,
      { targetCountry, targetLanguage }
    );
  }
}

/**
 * Hızlı adaptasyon (kısa metinler için)
 */
export async function adaptText(
  text: string,
  targetCountry: string,
  targetLanguage: string,
  model: string = 'gpt-4o-mini'
): Promise<string> {
  if (estimateTokens(text) > 8000) {
    throw new OpenAIError('Metin çok uzun, adaptStory() kullanın');
  }

  const result = await adaptChunk(text, targetCountry, targetLanguage, model, 0, 1);
  return result.adapted;
}

