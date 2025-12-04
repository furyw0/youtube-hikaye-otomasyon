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
  totalChunks: number
): Promise<{ adapted: string; notes: string[] }> {
  const systemPrompt = `Sen kültürel adaptasyon uzmanısın. Hikayeleri hedef ülkenin kültürüne TAMAMEN adapte ediyorsun.

⚠️ KRİTİK - ASLA YAPMA:
- ASLA içeriği kısaltma veya özetleme
- ASLA paragraf, cümle veya kelime atlama
- ASLA sahne, olay veya diyalog çıkarma
- ASLA hikayenin uzunluğunu değiştirme

🔄 ZORUNLU DEĞİŞİKLİKLER (MUTLAKA YAP):

1. **KİŞİ İSİMLERİ** - TÜM karakter isimlerini ${targetCountry}'de yaygın isimlerle DEĞİŞTİR:
   - Örnek: "John" → "Juan" (İspanya için), "Ahmet" (Türkiye için), "Hans" (Almanya için)
   - Ana karakterler ve yan karakterler dahil
   - İsimler hikaye boyunca TUTARLI olmalı

2. **YER İSİMLERİ** - Şehir, mahalle, sokak isimlerini ${targetCountry}'deki yerlerle DEĞİŞTİR:
   - Örnek: "New York" → "Madrid" (İspanya için), "İstanbul" (Türkiye için)
   - Okul, hastane, restoran isimleri de yerelleştirilmeli

3. **KÜLTÜREL UNSURLAR** - Tamamen yerelleştir:
   - Yemekler: Yerel mutfaktan yemekler kullan
   - Bayramlar/Tatiller: Yerel bayramlarla değiştir
   - Gelenekler: Yerel gelenekleri yansıt
   - Giyim: Yerel kıyafet tanımları

4. **PARA BİRİMİ & ÖLÇÜLER**:
   - Para: ${targetCountry} para birimine çevir
   - Uzunluk/Ağırlık: Metrik/İmperial sisteme göre ayarla

5. **DİL & İFADELER**:
   - Yerel deyimler ve atasözleri kullan
   - Selamlaşma şekilleri yerel olmalı
   - Hitap şekilleri kültüre uygun olmalı

✅ KORUMASI GEREKENLER:
- Hikayenin OLAY ÖRGÜSÜ aynı kalmalı
- Karakter KİŞİLİKLERİ aynı kalmalı
- Duygusal ton ve atmosfer korunmalı
- Metin uzunluğu AYNI kalmalı
- Paragraf yapısı AYNEN korunmalı

Hedef Ülke: ${targetCountry}
Hedef Dil: ${targetLanguage}

JSON FORMAT (zorunlu):
{
  "adapted": "TAMAMEN adapte edilmiş metin (isimler, yerler değişmiş)",
  "notes": ["John → Juan olarak değiştirildi", "New York → Madrid olarak değiştirildi", ...]
}

Bu metin ${totalChunks} parçanın ${chunkIndex + 1}. parçası.
${chunkIndex > 0 ? 'ÖNCEKİ CHUNK\'LARDA DEĞİŞTİRİLEN İSİMLERİ AYNI KULLAN!' : ''}`;

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

  const result = await adaptChunk(text, targetCountry, targetLanguage, model, 0, 1);
  return result.adapted;
}

