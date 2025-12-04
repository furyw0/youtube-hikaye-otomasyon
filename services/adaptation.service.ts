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
  const systemPrompt = `Sen kültürel adaptasyon uzmanısın. Hikaye başlıklarını hedef ülkenin kültürüne TAMAMEN adapte ediyorsun.

KURALLAR:
1. Başlıktaki İSİMLERİ ${targetCountry}'de yaygın isimlerle DEĞİŞTİR
2. Başlıktaki YER İSİMLERİNİ ${targetCountry}'deki yerlerle DEĞİŞTİR
3. Başlığın temel anlamını ve çekiciliğini koru
4. ${targetCountry} kültürüne uygun yerel ifadeler kullan
5. Uzunluğu benzer tut
6. Çekici ve merak uyandırıcı olsun
7. Sadece adapte edilmiş başlığı döndür

Örnekler:
- "John's Secret Garden" → "El Jardín Secreto de Juan" (İspanya)
- "A Night in Paris" → "Madridde Bir Gece" (İspanya/Türkçe)

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
  totalChunks: number,
  previousNotes?: string[]  // Önceki chunk'lardaki isim değişiklikleri
): Promise<{ adapted: string; notes: string[] }> {
  const originalLength = chunk.length;
  const MIN_LENGTH_RATIO = 0.80; // Adaptasyon en az orijinalin %80'i olmalı
  const MAX_RETRIES = 3;

  // Önceki değişiklikleri formatla
  const previousChanges = previousNotes && previousNotes.length > 0
    ? `\n🔄 ÖNCEKİ DEĞİŞİKLİKLER (AYNI KULLAN!):\n${previousNotes.slice(-20).map(n => `- ${n}`).join('\n')}\n`
    : '';

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const systemPrompt = `Sen kültürel adaptasyon uzmanısın. Hikayeleri KISALTMADAN adapte ediyorsun.

⛔ YASAK - ASLA YAPMA:
- ❌ ASLA içeriği KISALTMA veya ÖZETLEME
- ❌ ASLA paragraf, cümle veya kelime ATLAMA
- ❌ ASLA sahne, olay veya diyalog ÇIKARMA
- ❌ ASLA "..." ile kısaltma yapma

📏 UZUNLUK KONTROLÜ (ÇOK KRİTİK):
- Orijinal metin: ~${originalLength} karakter
- Adapte edilmiş metin EN AZ ${Math.round(originalLength * MIN_LENGTH_RATIO)} karakter OLMALI
- Eğer çıktı çok kısa ise, YANLIŞ YAPTIN demektir!

🔄 SADECE BU DEĞİŞİKLİKLERİ YAP:
1. KİŞİ İSİMLERİ → ${targetCountry}'de yaygın isimlerle değiştir
2. YER İSİMLERİ → ${targetCountry}'deki yerlerle değiştir  
3. KÜLTÜREL UNSURLAR → Yemek, bayram, para birimi yerelleştir

✅ KORU (DEĞİŞTİRME):
- Paragraf sayısı AYNI kalmalı
- Cümle sayısı AYNI kalmalı
- Hikaye uzunluğu AYNI kalmalı
${previousChanges}
Hedef: ${targetCountry} / ${targetLanguage}
Parça: ${chunkIndex + 1}/${totalChunks}

JSON FORMAT:
{"adapted": "TAM METİN (kısaltılmamış)", "notes": ["değişiklik1", "değişiklik2"]}`;

    const response = await retryOpenAI(
      () => createChatCompletion({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `ADAPTE ET (KISALTMADAN!):\n\n${chunk}` }
        ],
        temperature: 0.4,
        responseFormat: 'json_object'
      }),
      `Chunk ${chunkIndex + 1}/${totalChunks} adaptasyonu (Deneme ${attempt})`
    );

    try {
      const parsed = JSON.parse(response);
      const adaptedText = parsed.adapted || chunk;
      const adaptedLength = adaptedText.length;
      const ratio = adaptedLength / originalLength;

      // Uzunluk kontrolü
      if (ratio >= MIN_LENGTH_RATIO) {
        logger.debug(`Chunk ${chunkIndex + 1} adapte edildi`, {
          originalLength,
          adaptedLength,
          ratio: Math.round(ratio * 100) + '%'
        });
        return {
          adapted: adaptedText,
          notes: parsed.notes || []
        };
      }

      // Adaptasyon çok kısa - tekrar dene
      logger.warn(`⚠️ Adaptasyon çok kısa! Tekrar deneniyor (${attempt}/${MAX_RETRIES})`, {
        chunkIndex: chunkIndex + 1,
        originalLength,
        adaptedLength,
        ratio: Math.round(ratio * 100) + '%',
        minRequired: Math.round(originalLength * MIN_LENGTH_RATIO)
      });

      if (attempt === MAX_RETRIES) {
        logger.error(`❌ Adaptasyon ${MAX_RETRIES} denemede de kısa kaldı!`, {
          chunkIndex: chunkIndex + 1,
          ratio: Math.round(ratio * 100) + '%'
        });
        return {
          adapted: adaptedText,
          notes: parsed.notes || []
        };
      }

    } catch (error) {
      logger.warn('Adaptasyon JSON parse hatası', {
        chunkIndex,
        attempt,
        error: error instanceof Error ? error.message : 'Bilinmeyen hata'
      });
      
      if (attempt === MAX_RETRIES) {
        return {
          adapted: chunk, // Fallback: orijinal chunk'ı kullan (kısaltmaktansa)
          notes: []
        };
      }
    }
  }

  // Fallback (buraya ulaşmamalı)
  return { adapted: chunk, notes: [] };
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
        chunkLength: chunk.length,
        previousNotesCount: allNotes.length
      });

      // Önceki chunk'lardaki isim değişikliklerini geçir (tutarlılık için)
      const result = await adaptChunk(
        chunk,
        targetCountry,
        targetLanguage,
        model,
        i,
        chunks.length,
        i > 0 ? allNotes : undefined  // İlk chunk hariç önceki notları geçir
      );

      adaptedChunks.push(result.adapted);
      allNotes.push(...result.notes);

      logger.debug(`Chunk ${i + 1}/${chunks.length} tamamlandı`, {
        newNotesCount: result.notes.length,
        totalNotesCount: allNotes.length
      });
    }

    // 4. Chunk'ları birleştir
    const adaptedContent = adaptedChunks.join('\n\n');

    // 5. Uzunluk kontrolü - hikaye kısaltılmış olabilir mi?
    const lengthRatio = adaptedContent.length / content.length;
    if (lengthRatio < 0.7) {
      logger.warn('⚠️ UYARI: Adaptasyon orijinalden çok kısa! Hikaye kısaltılmış olabilir.', {
        originalLength: content.length,
        adaptedLength: adaptedContent.length,
        ratio: Math.round(lengthRatio * 100) + '%',
        expectedMinLength: Math.round(content.length * 0.7)
      });
    } else if (lengthRatio > 1.5) {
      logger.warn('⚠️ UYARI: Adaptasyon orijinalden çok uzun!', {
        originalLength: content.length,
        adaptedLength: adaptedContent.length,
        ratio: Math.round(lengthRatio * 100) + '%'
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
      `Kültürel adaptasyon başarısız (${targetCountry}/${targetLanguage}): ${error instanceof Error ? error.message : 'Bilinmeyen hata'}`
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

  const result = await adaptChunk(text, targetCountry, targetLanguage, model, 0, 1, undefined);
  return result.adapted;
}

