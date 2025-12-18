/**
 * Kültürel Uyarlama Servisi
 * Çevrilmiş hikayeyi hedef ülkenin kültürüne adapte eder
 */

import logger from '@/lib/logger';
import { OpenAIError } from '@/lib/errors';
import { retryOpenAI } from './retry.service';
import { 
  createCompletion, 
  chunkByTokenLimit, 
  estimateTokens, 
  type LLMProvider 
} from './llm-router.service';

interface PromptScenario {
  adaptationSystemPrompt: string;
  adaptationUserPrompt: string;
  titleAdaptationSystemPrompt?: string;
  titleAdaptationUserPrompt?: string;
}

interface AdaptationOptions {
  content: string;
  title: string;
  targetCountry: string;
  targetLanguage: string;
  model: string;
  provider?: LLMProvider;
  promptScenario?: PromptScenario | null;
}

interface AdaptationResult {
  title: string;
  content: string;
  adaptations: string[];
  originalLength: number;
  adaptedLength: number;
}

/**
 * Varsayılan adaptasyon system prompt'u
 */
const DEFAULT_ADAPTATION_SYSTEM_PROMPT = `Sen kültürel adaptasyon uzmanısın. Hikayeleri BİREBİR adapte ediyorsun - KISALTMA YOK!

🚨 KRİTİK KURAL: Bu bir ÇEVİRİ DEĞİL, KÜLTÜREL ADAPTASYON. Metin uzunluğu AYNI kalmalı!

⛔ YASAK - ASLA YAPMA:
- ❌ ASLA içeriği KISALTMA, ÖZETLEME veya KONDENSE ETME
- ❌ ASLA paragraf, cümle, kelime veya karakter ATLAMA
- ❌ ASLA sahne, olay, diyalog veya detay ÇIKARMA

🔄 SADECE BU DEĞİŞİKLİKLERİ YAP:
1. KİŞİ İSİMLERİ → {{TARGET_COUNTRY}}'de yaygın isimlerle değiştir
2. YER İSİMLERİ → {{TARGET_COUNTRY}}'deki yerlerle değiştir
3. KÜLTÜREL UNSURLAR → Yemek, bayram, para birimi yerelleştir
4. DİL STİLİ → {{TARGET_LANGUAGE}} dilinde doğal ifadeler kullan

🎙️ SESLENDİRME UYGUNLUĞU:
1. KISALTMALARI AÇ: "Dr." → "Doktor", "vb." → "ve benzeri"
2. SAYILARI YAZIYLA YAZ: "3" → "üç", "1990" → "bin dokuz yüz doksan"
3. PARANTEZLERİ KALDIR veya cümleye entegre et
4. UZUN CÜMLELERİ BÖL: 150 karakterden uzun cümleleri nokta ile ayır

{{VARIABLES}}

JSON FORMAT:
{"adapted": "TAM METİN", "notes": ["değişiklik1", "değişiklik2"]}`;

const DEFAULT_ADAPTATION_USER_PROMPT = `ADAPTE ET (BİREBİR - KISALTMA YOK!):

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
 * Varsayılan başlık adaptasyonu promptları
 */
const DEFAULT_TITLE_ADAPTATION_SYSTEM_PROMPT = `Sen kültürel adaptasyon uzmanısın. Hikaye başlıklarını hedef ülkenin kültürüne TAMAMEN adapte ediyorsun.

KURALLAR:
1. Başlıktaki İSİMLERİ {{TARGET_COUNTRY}}'de yaygın isimlerle DEĞİŞTİR
2. Başlıktaki YER İSİMLERİNİ {{TARGET_COUNTRY}}'deki yerlerle DEĞİŞTİR
3. Başlığın temel anlamını ve çekiciliğini koru
4. {{TARGET_COUNTRY}} kültürüne uygun yerel ifadeler kullan
5. Uzunluğu benzer tut
6. Çekici ve merak uyandırıcı olsun
7. Sadece adapte edilmiş başlığı döndür

🎙️ SESLENDİRME UYGUNLUĞU:
- Kısaltmaları aç (Dr. → Doktor)
- Sayıları yazıyla yaz (3 → üç)
- Özel karakterleri kullanma

Örnekler:
- "John's Secret Garden" → "El Jardín Secreto de Juan" (İspanya)
- "A Night in Paris" → "Madridde Bir Gece" (İspanya/Türkçe)

Hedef Ülke: {{TARGET_COUNTRY}}
Hedef Dil: {{TARGET_LANGUAGE}}`;

const DEFAULT_TITLE_ADAPTATION_USER_PROMPT = `Başlık: "{{TITLE}}"`;

/**
 * Başlığı hedef ülkeye adapte eder
 */
async function adaptTitle(
  title: string,
  targetCountry: string,
  targetLanguage: string,
  model: string,
  provider: LLMProvider = 'openai',
  promptScenario?: PromptScenario | null
): Promise<string> {
  // Değişkenler
  const variables: Record<string, string> = {
    TARGET_COUNTRY: targetCountry,
    TARGET_LANGUAGE: targetLanguage,
    TITLE: title
  };

  // Prompt şablonlarını al
  const systemPromptTemplate = promptScenario?.titleAdaptationSystemPrompt || DEFAULT_TITLE_ADAPTATION_SYSTEM_PROMPT;
  const userPromptTemplate = promptScenario?.titleAdaptationUserPrompt || DEFAULT_TITLE_ADAPTATION_USER_PROMPT;

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
  previousNotes?: string[],  // Önceki chunk'lardaki isim değişiklikleri
  provider: LLMProvider = 'openai',
  promptScenario?: PromptScenario | null
): Promise<{ adapted: string; notes: string[] }> {
  const originalLength = chunk.length;
  const MIN_LENGTH_RATIO = 0.90; // Adaptasyon en az orijinalin %90'ı olmalı
  const MAX_RETRIES = 3;

  // Metin istatistiklerini hesapla
  const paragraphCount = chunk.split(/\n\s*\n/).filter(p => p.trim().length > 0).length;
  const sentenceCount = chunk.split(/[.!?]+/).filter(s => s.trim().length > 0).length;
  const wordCount = chunk.split(/\s+/).filter(w => w.length > 0).length;

  // Önceki değişiklikleri formatla
  const previousChanges = previousNotes && previousNotes.length > 0
    ? `\n🔄 ÖNCEKİ DEĞİŞİKLİKLER (AYNI KULLAN!):\n${previousNotes.slice(-20).map(n => `- ${n}`).join('\n')}\n`
    : '';

  let lastAttemptLength = 0;
  let lastAttemptRatio = 0;

  // Değişkenler
  const variables: Record<string, string> = {
    VARIABLES: `📊 ORİJİNAL METİN İSTATİSTİKLERİ:
- Karakter sayısı: ${originalLength} karakter
- Kelime sayısı: ~${wordCount} kelime
- Cümle sayısı: ~${sentenceCount} cümle
- Paragraf sayısı: ~${paragraphCount} paragraf

📏 UZUNLUK KONTROLÜ:
- Adapte edilmiş metin EN AZ ${Math.round(originalLength * MIN_LENGTH_RATIO)} karakter OLMALI (%90 minimum)

${previousChanges}
Hedef: ${targetCountry} / ${targetLanguage}
Parça: ${chunkIndex + 1}/${totalChunks}`,
    CONTENT: chunk,
    TARGET_COUNTRY: targetCountry,
    TARGET_LANGUAGE: targetLanguage
  };

  // Prompt şablonlarını al (senaryo varsa kullan, yoksa varsayılan)
  const systemPromptTemplate = promptScenario?.adaptationSystemPrompt || DEFAULT_ADAPTATION_SYSTEM_PROMPT;
  const userPromptTemplate = promptScenario?.adaptationUserPrompt || DEFAULT_ADAPTATION_USER_PROMPT;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    // Önceki deneme bilgisi (retry için)
    const retryWarning = attempt > 1 && lastAttemptLength > 0
      ? `\n🚨 ÖNCEKİ DENEME HATASI:\n- Önceki çıktı: ${lastAttemptLength} karakter (${Math.round(lastAttemptRatio * 100)}%)\n- Bu çok kısa! Bu sefer EN AZ ${Math.round(originalLength * MIN_LENGTH_RATIO)} karakter olmalı!\n- Her cümleyi, her paragrafı, her detayı koru!\n`
      : '';

    // Retry uyarısını variables'a ekle
    variables.RETRY_WARNING = retryWarning;
    
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
        temperature: 0.2, // Daha düşük temperature = daha tutarlı, daha az yaratıcılık
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
      const loss = originalLength - adaptedLength;
      const lossPercentage = Math.round((1 - ratio) * 100);
      
      // Önceki deneme sonuçlarını kaydet (retry için)
      lastAttemptLength = adaptedLength;
      lastAttemptRatio = ratio;
      
      logger.warn(`⚠️ Adaptasyon çok kısa! Tekrar deneniyor (${attempt}/${MAX_RETRIES})`, {
        chunkIndex: chunkIndex + 1,
        originalLength,
        adaptedLength,
        ratio: Math.round(ratio * 100) + '%',
        minRequired: Math.round(originalLength * MIN_LENGTH_RATIO),
        loss,
        lossPercentage: lossPercentage + '%'
      });

      // Son denemede bile kısa ise, orijinal chunk'ı kullan (kısaltmaktansa)
      if (attempt === MAX_RETRIES) {
        logger.error(`❌ Adaptasyon ${MAX_RETRIES} denemede de kısa kaldı! Orijinal chunk kullanılıyor.`, {
          chunkIndex: chunkIndex + 1,
          ratio: Math.round(ratio * 100) + '%',
          loss,
          lossPercentage: lossPercentage + '%'
        });
        // Orijinal chunk'ı kullan (kısaltmaktansa hiç adaptasyon yapmamak daha iyi)
        return {
          adapted: chunk,
          notes: []
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
  const { content, title, targetCountry, targetLanguage, model, provider = 'openai', promptScenario } = options;

  logger.info('Kültürel adaptasyon başlatılıyor', {
    targetCountry,
    targetLanguage,
    model,
    provider,
    contentLength: content.length,
    estimatedTokens: estimateTokens(content, provider)
  });

  try {
    // 1. Başlık adaptasyonu
    logger.debug('Başlık adapte ediliyor...');
    const adaptedTitle = await adaptTitle(title, targetCountry, targetLanguage, model, provider, promptScenario);
    
    logger.info('Başlık adapte edildi', { 
      original: title, 
      adapted: adaptedTitle 
    });

    // 2. İçeriği chunk'lara böl
    const chunks = chunkByTokenLimit(content, model, provider, 2000);
    
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
        i > 0 ? allNotes : undefined,  // İlk chunk hariç önceki notları geçir
        provider,
        promptScenario
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
    if (lengthRatio < 0.85) {
      logger.error('❌ HATA: Adaptasyon orijinalden çok kısa! Hikaye kısaltılmış olabilir.', {
        originalLength: content.length,
        adaptedLength: adaptedContent.length,
        ratio: Math.round(lengthRatio * 100) + '%',
        expectedMinLength: Math.round(content.length * 0.85),
        loss: content.length - adaptedContent.length,
        lossPercentage: Math.round((1 - lengthRatio) * 100) + '%'
      });
    } else if (lengthRatio < 0.90) {
      logger.warn('⚠️ UYARI: Adaptasyon orijinalden biraz kısa.', {
        originalLength: content.length,
        adaptedLength: adaptedContent.length,
        ratio: Math.round(lengthRatio * 100) + '%',
        expectedMinLength: Math.round(content.length * 0.90)
      });
    } else if (lengthRatio > 1.3) {
      logger.warn('⚠️ UYARI: Adaptasyon orijinalden çok uzun!', {
        originalLength: content.length,
        adaptedLength: adaptedContent.length,
        ratio: Math.round(lengthRatio * 100) + '%'
      });
    } else {
      logger.info('✅ Adaptasyon uzunluğu uygun', {
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
  model: string = 'gpt-4o-mini',
  provider: LLMProvider = 'openai'
): Promise<string> {
  if (estimateTokens(text, provider) > 8000) {
    throw new OpenAIError('Metin çok uzun, adaptStory() kullanın');
  }

  const result = await adaptChunk(text, targetCountry, targetLanguage, model, 0, 1, undefined, provider);
  return result.adapted;
}

