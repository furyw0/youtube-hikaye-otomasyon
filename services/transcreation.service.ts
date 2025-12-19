/**
 * Transcreation (Yeniden Yazım) Servisi
 * 
 * İçerikleri hedef dilde daha akıcı ve çekici hale getirmek için kullanılır.
 * Video süreleri kaynak ile en fazla %5 fark olmalıdır.
 */

import logger from '@/lib/logger';
import { retryOpenAI } from './retry.service';
import {
  createCompletion,
  estimateTokens,
  type LLMProvider
} from './llm-router.service';
import { type TimestampedScene } from './transcript-parser.service';
import {
  type TranscreationPreset,
  type TranscreationStyle,
  type TranscreationPresetId,
  type TranscreationStyleId,
  type TranscreationResult,
  type BatchTranscreationResult,
  type BatchTranscreationStats,
  type LengthValidation,
  LENGTH_CONSTRAINTS
} from '@/types/transcreation.types';

// ============================================
// PRESET TANIMLARI
// ============================================

export const TRANSCREATION_PRESETS: TranscreationPreset[] = [
  {
    id: 'light',
    name: 'Hafif',
    description: 'Minimal değişiklik, ana yapı korunur',
    settings: {
      preserveStructure: 0.9,
      creativeFreedom: 0.2,
      rhetoricalQuestions: false,
      directAddress: false,
      dramaticPauses: false
    }
  },
  {
    id: 'medium',
    name: 'Orta',
    description: 'Dengeli akıcılaştırma',
    settings: {
      preserveStructure: 0.7,
      creativeFreedom: 0.5,
      rhetoricalQuestions: true,
      directAddress: true,
      dramaticPauses: false
    }
  },
  {
    id: 'strong',
    name: 'Güçlü',
    description: 'Maksimum akıcılık, serbest yeniden yazım',
    settings: {
      preserveStructure: 0.5,
      creativeFreedom: 0.8,
      rhetoricalQuestions: true,
      directAddress: true,
      dramaticPauses: true
    }
  }
];

// ============================================
// STİL TANIMLARI
// ============================================

export const TRANSCREATION_STYLES: TranscreationStyle[] = [
  {
    id: 'philosophical',
    name: 'Felsefi/Derin',
    description: 'Derin düşündüren, felsefi anlatım',
    instructions: `- Derin ve düşündürücü bir ton kullan
- Varoluşsal ve felsefi sorular sor
- Metaforlar ve sembolik anlatım kullan
- İzleyiciyi düşünmeye davet et
- Evrensel gerçeklere referans ver`,
    systemPromptAddition: `Anlatım tarzı: Felsefi ve derin düşündüren. İzleyiciyi varoluşsal sorularla yüzleştir. "Peki ya sen?" gibi sorularla içe dönük bir yolculuğa çıkar.`
  },
  {
    id: 'storyteller',
    name: 'Hikaye Anlatıcısı',
    description: 'Sürükleyici hikaye anlatımı',
    instructions: `- Sürükleyici bir hikaye anlatıcısı gibi yaz
- Gerilim ve merak unsurları ekle
- "Ve işte o an..." gibi geçişler kullan
- Duygusal bağ kur
- Dramatik anlarda vurgu yap`,
    systemPromptAddition: `Anlatım tarzı: Sürükleyici hikaye anlatıcısı. Dinleyiciyi hikayenin içine çek. "Bir düşünün..." "Ve sonra beklenmedik bir şey oldu..." gibi geçişler kullan.`
  },
  {
    id: 'documentary',
    name: 'Belgesel',
    description: 'Bilgilendirici, profesyonel anlatım',
    instructions: `- Nesnel ve bilgilendirici ton kullan
- Gerçekleri akıcı bir şekilde sun
- Profesyonel belgesel dili kullan
- Detayları açık ve anlaşılır yap
- Güvenilir bir anlatıcı ol`,
    systemPromptAddition: `Anlatım tarzı: Profesyonel belgesel anlatıcısı. David Attenborough tarzında akıcı, bilgilendirici ve güvenilir. Gerçekleri ilgi çekici şekilde sun.`
  },
  {
    id: 'entertaining',
    name: 'Eğlenceli',
    description: 'Hafif, eğlenceli anlatım',
    instructions: `- Enerjik ve eğlenceli ton kullan
- Hafif espri ve ironi ekle
- Günlük konuşma dili kullan
- İzleyiciyle samimi ol
- Şaşırtıcı ifadeler kullan`,
    systemPromptAddition: `Anlatım tarzı: Eğlenceli ve samimi. Sanki bir arkadaşına anlatıyor gibi. "İnanmayacaksın ama..." "Şimdi dur, bu kısım çok iyi..." gibi ifadeler kullan.`
  }
];

// ============================================
// YARDIMCI FONKSİYONLAR
// ============================================

/**
 * Preset'i ID'ye göre bul
 */
export function getPresetById(id: TranscreationPresetId): TranscreationPreset {
  return TRANSCREATION_PRESETS.find(p => p.id === id) || TRANSCREATION_PRESETS[1]; // default: medium
}

/**
 * Stili ID'ye göre bul
 */
export function getStyleById(id: TranscreationStyleId): TranscreationStyle {
  return TRANSCREATION_STYLES.find(s => s.id === id) || TRANSCREATION_STYLES[1]; // default: storyteller
}

/**
 * Uzunluk doğrulaması yap
 */
export function validateLength(originalText: string, newText: string): LengthValidation {
  const originalLength = originalText.length;
  const newLength = newText.length;
  const ratio = newLength / originalLength;
  const isWithinTolerance = ratio >= LENGTH_CONSTRAINTS.MIN_RATIO && ratio <= LENGTH_CONSTRAINTS.MAX_RATIO;
  const differencePercent = `${((ratio - 1) * 100).toFixed(1)}%`;

  return {
    isValid: isWithinTolerance,
    originalLength,
    newLength,
    ratio,
    differencePercent,
    withinTolerance: isWithinTolerance
  };
}

/**
 * System prompt oluştur
 */
function buildSystemPrompt(
  preset: TranscreationPreset,
  style: TranscreationStyle,
  sourceLang: string,
  targetLang: string,
  lengthConstraints: { originalLength: number; minChars: number; maxChars: number }
): string {
  const presetInstructions = [];
  
  if (preset.settings.rhetoricalQuestions) {
    presetInstructions.push('- Retorik sorular ekleyebilirsin');
  }
  if (preset.settings.directAddress) {
    presetInstructions.push('- Doğrudan hitap kullan (sen/siz formunda)');
  }
  if (preset.settings.dramaticPauses) {
    presetInstructions.push('- Dramatik duraklamalar için "..." kullan');
  }

  return `Sen profesyonel bir içerik yazarı ve çevirmensin. Verilen metni ${sourceLang} dilinden ${targetLang} diline çevirirken, anlatımı daha akıcı ve çekici hale getiriyorsun.

🎯 KRİTİK KISITLAMA - SÜRE KONTROLÜ:
- Orijinal metin: ${lengthConstraints.originalLength} karakter
- Minimum: ${lengthConstraints.minChars} karakter (%95)
- Maksimum: ${lengthConstraints.maxChars} karakter (%105)
- SADECE %5 FARK TOLERANSI VAR!

⛔ YASAK:
- ❌ Metni KISALTMA veya ÖZETLEME
- ❌ Paragraf, cümle veya kelime ATLAMA
- ❌ Gereksiz ekleme yaparak UZATMA
- ❌ İçeriği değiştirme veya yeni bilgi ekleme

✅ YAPILACAKLAR (${preset.name} - ${style.name}):
${style.instructions}
${presetInstructions.join('\n')}

📝 STİL DETAYI:
${style.systemPromptAddition}

🎙️ SESLENDİRME İÇİN:
- Kısaltmaları aç: "Dr." → "Doktor", "vb." → "ve benzeri"
- Sayıları yazıyla yaz: "3" → "üç"
- Parantezleri cümleye entegre et
- Doğal konuşma akışı sağla

⚡ YARATICILIK SEVİYESİ: ${preset.name} (${Math.round(preset.settings.creativeFreedom * 100)}%)
- Yapı koruma: %${Math.round(preset.settings.preserveStructure * 100)}

SADECE yeniden yazılmış metni döndür, açıklama ekleme.`;
}

// ============================================
// TEK SAHNE TRANSCREATİON
// ============================================

interface TranscreateSceneOptions {
  scene: TimestampedScene;
  sourceLang: string;
  targetLang: string;
  preset: TranscreationPreset;
  style: TranscreationStyle;
  model: string;
  provider: LLMProvider;
}

/**
 * Tek bir sahneyi transcreate eder (retry mekanizması ile)
 */
export async function transcreateScene(options: TranscreateSceneOptions): Promise<TranscreationResult> {
  const { scene, sourceLang, targetLang, preset, style, model, provider } = options;
  const originalText = scene.text;
  const originalLength = originalText.length;
  const minChars = Math.round(originalLength * LENGTH_CONSTRAINTS.MIN_RATIO);
  const maxChars = Math.round(originalLength * LENGTH_CONSTRAINTS.MAX_RATIO);

  let lastResult = '';
  let lastValidation: LengthValidation | null = null;

  for (let attempt = 1; attempt <= LENGTH_CONSTRAINTS.MAX_RETRIES; attempt++) {
    const systemPrompt = buildSystemPrompt(preset, style, sourceLang, targetLang, {
      originalLength,
      minChars,
      maxChars
    });

    // Önceki denemede tolerans dışı kaldıysa, user prompt'a uyarı ekle
    let userPrompt = originalText;
    if (attempt > 1 && lastValidation) {
      const direction = lastValidation.ratio < 1 ? 'KISA' : 'UZUN';
      userPrompt = `⚠️ ÖNCEKİ DENEME BAŞARISIZ: Metin çok ${direction} (${lastValidation.differencePercent}). 
Lütfen ${minChars}-${maxChars} karakter arasında tut.

METİN:
${originalText}`;
    }

    try {
      const response = await retryOpenAI(
        () => createCompletion({
          provider,
          model,
          systemPrompt,
          messages: [{ role: 'user', content: userPrompt }],
          temperature: 0.4 + (attempt * 0.1) // Her denemede biraz daha yaratıcı
        }),
        `Transcreation sahne ${scene.sceneNumber} (deneme ${attempt})`
      );

      const rewrittenText = response.trim();
      const validation = validateLength(originalText, rewrittenText);
      lastResult = rewrittenText;
      lastValidation = validation;

      if (validation.isValid) {
        logger.info('Transcreation başarılı', {
          sceneNumber: scene.sceneNumber,
          ratio: validation.ratio.toFixed(3),
          difference: validation.differencePercent,
          attempt
        });

        return {
          sceneNumber: scene.sceneNumber,
          originalText,
          rewrittenText,
          lengthValidation: validation,
          styleApplied: style.id,
          presetApplied: preset.id,
          attempts: attempt,
          success: true
        };
      }

      logger.warn(`Transcreation tolerans dışı (${attempt}/${LENGTH_CONSTRAINTS.MAX_RETRIES})`, {
        sceneNumber: scene.sceneNumber,
        ratio: validation.ratio.toFixed(3),
        expected: `${minChars}-${maxChars} karakter`,
        got: rewrittenText.length,
        difference: validation.differencePercent
      });
    } catch (error) {
      logger.error('Transcreation LLM hatası', {
        sceneNumber: scene.sceneNumber,
        attempt,
        error: error instanceof Error ? error.message : 'Bilinmeyen hata'
      });
    }
  }

  // 3 denemede de başarısızsa, en son sonucu kullan
  logger.error('Transcreation %5 tolerans sağlanamadı, son sonuç kullanılıyor', {
    sceneNumber: scene.sceneNumber,
    finalRatio: lastValidation?.ratio.toFixed(3),
    finalDifference: lastValidation?.differencePercent
  });

  return {
    sceneNumber: scene.sceneNumber,
    originalText,
    rewrittenText: lastResult || originalText,
    lengthValidation: lastValidation || validateLength(originalText, originalText),
    styleApplied: style.id,
    presetApplied: preset.id,
    attempts: LENGTH_CONSTRAINTS.MAX_RETRIES,
    success: false
  };
}

// ============================================
// BATCH TRANSCREATİON
// ============================================

interface BatchTranscreateOptions {
  scenes: TimestampedScene[];
  sourceLang: string;
  targetLang: string;
  presetId: TranscreationPresetId;
  styleId: TranscreationStyleId;
  model: string;
  provider: LLMProvider;
}

/**
 * Sahneleri batch'lere böler
 */
function splitIntoBatches(
  scenes: TimestampedScene[],
  maxTokensPerBatch: number = 5000,
  provider: LLMProvider = 'openai'
): TimestampedScene[][] {
  const batches: TimestampedScene[][] = [];
  let currentBatch: TimestampedScene[] = [];
  let currentTokens = 0;

  for (const scene of scenes) {
    const sceneTokens = estimateTokens(scene.text, provider);

    if (sceneTokens > maxTokensPerBatch) {
      if (currentBatch.length > 0) {
        batches.push(currentBatch);
        currentBatch = [];
        currentTokens = 0;
      }
      batches.push([scene]);
      continue;
    }

    if (currentTokens + sceneTokens > maxTokensPerBatch) {
      batches.push(currentBatch);
      currentBatch = [scene];
      currentTokens = sceneTokens;
    } else {
      currentBatch.push(scene);
      currentTokens += sceneTokens;
    }
  }

  if (currentBatch.length > 0) {
    batches.push(currentBatch);
  }

  return batches;
}

/**
 * Tek bir batch'i transcreate eder
 */
async function transcrerateBatch(
  batch: TimestampedScene[],
  sourceLang: string,
  targetLang: string,
  preset: TranscreationPreset,
  style: TranscreationStyle,
  model: string,
  provider: LLMProvider,
  batchIndex: number,
  totalBatches: number
): Promise<TranscreationResult[]> {
  // Her sahnenin uzunluk bilgisini hesapla
  const scenesInput = batch.map((scene, idx) => {
    const originalLength = scene.text.length;
    const minChars = Math.round(originalLength * LENGTH_CONSTRAINTS.MIN_RATIO);
    const maxChars = Math.round(originalLength * LENGTH_CONSTRAINTS.MAX_RATIO);
    
    return {
      id: idx + 1,
      sceneNumber: scene.sceneNumber,
      text: scene.text,
      minChars,
      maxChars
    };
  });

  const presetInstructions = [];
  if (preset.settings.rhetoricalQuestions) presetInstructions.push('retorik sorular ekle');
  if (preset.settings.directAddress) presetInstructions.push('doğrudan hitap kullan');
  if (preset.settings.dramaticPauses) presetInstructions.push('dramatik duraklamalar ekle');

  const systemPrompt = `Sen profesyonel bir içerik yazarı ve çevirmensin. Çoklu metin parçalarını ${sourceLang} dilinden ${targetLang} diline çevirirken, anlatımı daha akıcı ve çekici hale getiriyorsun.

🎯 KRİTİK - SÜRE KONTROLÜ:
- Her sahne için verilen min/max karakter sayısına UYULMALI
- SADECE %5 FARK TOLERANSI VAR!

⛔ YASAK:
- ❌ Metni KISALTMA veya ÖZETLEME
- ❌ İçerik ATLAMA
- ❌ Gereksiz UZATMA

✅ YAPILACAKLAR (${preset.name} - ${style.name}):
${style.instructions}
${presetInstructions.length > 0 ? `- ${presetInstructions.join(', ')}` : ''}

📝 STİL:
${style.systemPromptAddition}

🎙️ SESLENDİRME İÇİN:
- Kısaltmaları aç
- Sayıları yazıyla yaz
- Doğal konuşma akışı

Batch: ${batchIndex + 1}/${totalBatches}

JSON FORMAT (ZORUNLU):
{
  "results": [
    {"id": 1, "text": "yeniden yazılmış metin 1"},
    {"id": 2, "text": "yeniden yazılmış metin 2"}
  ]
}`;

  const userPrompt = `TRANSCREATE ET (${batch.length} sahne):

${JSON.stringify(scenesInput, null, 2)}

⚠️ Her sahne için minChars-maxChars arasında kalmalı!`;

  const response = await retryOpenAI(
    () => createCompletion({
      provider,
      model,
      systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
      temperature: 0.4,
      responseFormat: 'json_object'
    }),
    `Transcreation batch ${batchIndex + 1}/${totalBatches}`
  );

  try {
    const parsed = JSON.parse(response);
    const results = parsed.results || [];

    return batch.map((scene, idx) => {
      const result = results.find((r: { id: number; text: string }) => r.id === idx + 1);
      const rewrittenText = result?.text || scene.text;
      const validation = validateLength(scene.text, rewrittenText);

      return {
        sceneNumber: scene.sceneNumber,
        originalText: scene.text,
        rewrittenText,
        lengthValidation: validation,
        styleApplied: style.id,
        presetApplied: preset.id,
        attempts: 1,
        success: validation.isValid
      };
    });
  } catch (error) {
    logger.error('Batch transcreation parse hatası', { batchIndex, error });
    
    // Fallback: orijinal metinleri kullan
    return batch.map(scene => ({
      sceneNumber: scene.sceneNumber,
      originalText: scene.text,
      rewrittenText: scene.text,
      lengthValidation: validateLength(scene.text, scene.text),
      styleApplied: style.id,
      presetApplied: preset.id,
      attempts: 1,
      success: false
    }));
  }
}

/**
 * Tolerans dışı kalan sahneleri tekrar dene
 */
async function retryFailedScenes(
  failedResults: TranscreationResult[],
  scenes: TimestampedScene[],
  sourceLang: string,
  targetLang: string,
  preset: TranscreationPreset,
  style: TranscreationStyle,
  model: string,
  provider: LLMProvider
): Promise<TranscreationResult[]> {
  const retriedResults: TranscreationResult[] = [];

  for (const failed of failedResults) {
    const scene = scenes.find(s => s.sceneNumber === failed.sceneNumber);
    if (!scene) continue;

    // Tek sahne olarak transcreate et (retry mekanizması ile)
    const result = await transcreateScene({
      scene,
      sourceLang,
      targetLang,
      preset,
      style,
      model,
      provider
    });

    retriedResults.push(result);
  }

  return retriedResults;
}

/**
 * Tüm sahneleri batch olarak transcreate eder
 */
export async function batchTranscreateScenes(options: BatchTranscreateOptions): Promise<BatchTranscreationResult> {
  const { scenes, sourceLang, targetLang, presetId, styleId, model, provider } = options;
  
  const preset = getPresetById(presetId);
  const style = getStyleById(styleId);

  logger.info('Batch transcreation başlatılıyor', {
    sceneCount: scenes.length,
    sourceLang,
    targetLang,
    preset: preset.name,
    style: style.name,
    model,
    provider
  });

  // 1. Sahneleri batch'lere böl
  const batches = splitIntoBatches(scenes, 5000, provider);
  
  logger.info('Sahneler batch\'lere bölündü', {
    totalScenes: scenes.length,
    totalBatches: batches.length,
    avgBatchSize: Math.round(scenes.length / batches.length)
  });

  // 2. Her batch'i transcreate et
  const allResults: TranscreationResult[] = [];

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    
    logger.debug(`Batch ${i + 1}/${batches.length} transcreate ediliyor...`, {
      batchSize: batch.length
    });

    const batchResults = await transcrerateBatch(
      batch,
      sourceLang,
      targetLang,
      preset,
      style,
      model,
      provider,
      i,
      batches.length
    );

    allResults.push(...batchResults);
  }

  // 3. Tolerans dışı kalanları tekrar dene
  const failedResults = allResults.filter(r => !r.success);
  
  if (failedResults.length > 0) {
    logger.info('Tolerans dışı sahneler tekrar deneniyor', {
      failedCount: failedResults.length
    });

    const retriedResults = await retryFailedScenes(
      failedResults,
      scenes,
      sourceLang,
      targetLang,
      preset,
      style,
      model,
      provider
    );

    // Sonuçları güncelle
    for (const retried of retriedResults) {
      const index = allResults.findIndex(r => r.sceneNumber === retried.sceneNumber);
      if (index !== -1) {
        allResults[index] = retried;
      }
    }
  }

  // 4. İstatistikleri hesapla
  const totalOriginalChars = allResults.reduce((sum, r) => sum + r.originalText.length, 0);
  const totalNewChars = allResults.reduce((sum, r) => sum + r.rewrittenText.length, 0);
  const overallRatio = totalNewChars / totalOriginalChars;
  const successfulScenes = allResults.filter(r => r.success).length;
  const totalAttempts = allResults.reduce((sum, r) => sum + r.attempts, 0);

  const stats: BatchTranscreationStats = {
    totalScenes: scenes.length,
    successfulScenes,
    failedScenes: scenes.length - successfulScenes,
    totalOriginalChars,
    totalNewChars,
    overallRatio,
    withinTolerance: overallRatio >= LENGTH_CONSTRAINTS.MIN_RATIO && overallRatio <= LENGTH_CONSTRAINTS.MAX_RATIO,
    averageAttempts: totalAttempts / scenes.length
  };

  logger.info('Batch transcreation tamamlandı - SÜRE KONTROLÜ', {
    totalScenes: scenes.length,
    successfulScenes,
    failedScenes: stats.failedScenes,
    originalChars: totalOriginalChars,
    newChars: totalNewChars,
    overallRatio: `${(overallRatio * 100).toFixed(1)}%`,
    withinTolerance: stats.withinTolerance
  });

  return {
    results: allResults,
    stats
  };
}

/**
 * Transcreation sonuçlarını TimestampedScene'lere uygula
 */
export function applyTranscreationResults(
  scenes: TimestampedScene[],
  results: TranscreationResult[]
): TimestampedScene[] {
  return scenes.map(scene => {
    const result = results.find(r => r.sceneNumber === scene.sceneNumber);
    
    return {
      ...scene,
      textAdapted: result?.rewrittenText || scene.text
    };
  });
}

/**
 * Başlığı transcreate eder
 */
export async function transcreateTitle(
  title: string,
  sourceLang: string,
  targetLang: string,
  style: TranscreationStyle,
  model: string,
  provider: LLMProvider
): Promise<string> {
  const systemPrompt = `Başlığı ${sourceLang} dilinden ${targetLang} diline çevir ve ${style.name} tarzında daha çekici hale getir. 
${style.systemPromptAddition}
Sadece çevrilmiş başlığı döndür.`;

  const response = await retryOpenAI(
    () => createCompletion({
      provider,
      model,
      systemPrompt,
      messages: [{ role: 'user', content: title }],
      temperature: 0.5
    }),
    'Başlık transcreation'
  );

  return response.trim().replace(/^["']|["']$/g, '');
}
