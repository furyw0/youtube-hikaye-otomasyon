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
    name: 'Philosophical/Deep',
    description: 'Deep, thought-provoking narration',
    instructions: `- Use a deep and thought-provoking tone
- Ask existential and philosophical questions
- Use metaphors and symbolic language
- Invite the viewer to reflect
- Reference universal truths`,
    systemPromptAddition: `Narration style: Philosophical and deeply thought-provoking. Confront the viewer with existential questions. Use introspective phrases like "What about you?" or "Have you ever wondered..."`
  },
  {
    id: 'storyteller',
    name: 'Storyteller',
    description: 'Engaging storytelling narration',
    instructions: `- Write like an engaging storyteller
- Add suspense and curiosity elements
- Use transitions like "And then..." or "At that moment..."
- Create emotional connection
- Emphasize dramatic moments`,
    systemPromptAddition: `Narration style: Engaging storyteller. Draw the listener into the story. Use phrases like "Imagine this..." or "And then something unexpected happened..."`
  },
  {
    id: 'documentary',
    name: 'Documentary',
    description: 'Informative, professional narration',
    instructions: `- Use an objective and informative tone
- Present facts in a flowing manner
- Use professional documentary language
- Make details clear and understandable
- Be a trustworthy narrator`,
    systemPromptAddition: `Narration style: Professional documentary narrator. David Attenborough style - flowing, informative, and trustworthy. Present facts in an engaging way.`
  },
  {
    id: 'entertaining',
    name: 'Entertaining',
    description: 'Light, entertaining narration',
    instructions: `- Use an energetic and entertaining tone
- Add light humor and irony
- Use conversational language
- Be friendly with the viewer
- Use surprising expressions`,
    systemPromptAddition: `Narration style: Entertaining and friendly. Like telling a friend. Use phrases like "You won't believe this..." or "Now wait, this part is great..."`
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
  applyCulturalAdaptation?: boolean;
}

/**
 * Sahneleri batch'lere böler (export edildi - Inngest step'leri için)
 */
export function splitIntoBatches(
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
 * Tek bir batch'i transcreate eder (Basitleştirilmiş - batchTranslateAndAdaptScenes gibi)
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
  totalBatches: number,
  applyCulturalAdaptation: boolean = false
): Promise<TimestampedScene[]> {
  // Basit input formatı (batchTranslateAndAdaptScenes gibi)
  const scenesInput = batch.map((scene, idx) => ({
    id: idx + 1,
    text: scene.text
  }));

  // Yaratıcılık seviyesine göre talimatlar
  const creativityLevel = Math.round(preset.settings.creativeFreedom * 100);
  const structurePreserve = Math.round(preset.settings.preserveStructure * 100);

  const presetInstructions = [];
  if (preset.settings.rhetoricalQuestions) presetInstructions.push('Add rhetorical questions to engage the audience');
  if (preset.settings.directAddress) presetInstructions.push('Use direct address (you/your) to connect with viewers');
  if (preset.settings.dramaticPauses) presetInstructions.push('Add dramatic pauses with "..." for suspense');

  // Kültürel adaptasyon seçeneğine göre talimat
  const culturalAdaptationRule = applyCulturalAdaptation
    ? `✅ CULTURAL ADAPTATION ENABLED: You MAY adapt names, places, and cultural references to fit ${targetLang} culture.`
    : `⛔ NO CULTURAL ADAPTATION: Keep ALL original names, places, cities, countries, and cultural references EXACTLY as they are. Only translate them phonetically if needed. Example: "New York" stays "New York", "John" stays "John".`;

  const systemPrompt = `You are an expert TRANSCREATOR (not just translator). Your job is to CREATIVELY REWRITE content to make it more ENGAGING and COMPELLING in ${targetLang}.

⚠️ CRITICAL OUTPUT LANGUAGE: ${targetLang.toUpperCase()} ONLY!

🎯 YOUR MISSION - TRANSCREATION (NOT Translation):
This is TRANSCREATION, not plain translation. You must:
1. REWRITE sentences to be more dramatic, engaging, and captivating
2. TRANSFORM boring narration into compelling storytelling
3. ADD emotional weight, suspense, and flow
4. MAINTAIN the same meaning but EXPRESS it more powerfully

📊 CREATIVITY SETTINGS:
- Creative Freedom: ${creativityLevel}% (${creativityLevel >= 50 ? 'BE BOLD with rewrites!' : 'Moderate changes'})
- Structure Preservation: ${structurePreserve}%
- Style: ${style.name}

✨ REWRITING TECHNIQUES TO USE:
${style.instructions}
${presetInstructions.length > 0 ? presetInstructions.map(i => `• ${i}`).join('\n') : ''}

${style.systemPromptAddition}

📏 LENGTH RULE:
- Output must be within ±5% of original character count (for video timing sync)
- Don't pad unnecessarily, but don't cut content either
- Rewrite creatively while respecting length

🔒 CONTENT INTEGRITY:
${culturalAdaptationRule}
- Keep the MEANING and STORY intact
- Keep character genders consistent
- Keep relationships and facts accurate

🎙️ VOICE-OVER OPTIMIZATION:
- Expand abbreviations naturally
- Write numbers as words
- Ensure smooth, speakable flow

❌ DON'T:
- Don't do word-for-word translation
- Don't be boring or flat
- Don't change the story's facts
- Don't skip or summarize content

✅ DO:
- Rewrite to captivate the audience
- Add emotion and drama
- Use vivid, engaging language
- Make it sound like a skilled storyteller wrote it

JSON OUTPUT:
{"results": [{"id": 1, "text": "creatively rewritten text in ${targetLang}"}]}`;

  const response = await retryOpenAI(
    () => createCompletion({
      provider,
      model,
      systemPrompt,
      messages: [{ role: 'user', content: JSON.stringify(scenesInput, null, 2) }],
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
      return {
        ...scene,
        textAdapted: result?.text || scene.text
      };
    });
  } catch (error) {
    logger.error('Batch transcreation parse hatası, orijinal metinler kullanılıyor', { batchIndex, error });
    return batch.map(scene => ({ ...scene, textAdapted: scene.text }));
  }
}

// NOT: retryFailedScenes kaldırıldı - basitleştirilmiş yapı kullanılıyor

/**
 * Basit Batch Sonuç Tipi (batchTranslateAndAdaptScenes ile uyumlu)
 */
interface SimpleBatchResult {
  title: string;
  scenes: TimestampedScene[];
}

/**
 * Tüm sahneleri batch olarak transcreate eder (Basitleştirilmiş - batchTranslateAndAdaptScenes gibi)
 */
export async function batchTranscreateScenes(options: BatchTranscreateOptions): Promise<SimpleBatchResult> {
  const { scenes, sourceLang, targetLang, presetId, styleId, model, provider, applyCulturalAdaptation = false } = options;
  
  const preset = getPresetById(presetId);
  const style = getStyleById(styleId);

  logger.info('Batch transcreation başlatılıyor', {
    sceneCount: scenes.length,
    sourceLang,
    targetLang,
    preset: preset.name,
    style: style.name,
    model,
    provider,
    applyCulturalAdaptation,
    firstScenePreview: scenes[0]?.text?.substring(0, 100)
  });

  // 1. Sahneleri batch'lere böl (5000 token - batchTranslateAndAdaptScenes ile aynı)
  const batches = splitIntoBatches(scenes, 5000, provider);
  
  logger.info('Batch\'ler oluşturuldu', {
    totalScenes: scenes.length,
    totalBatches: batches.length
  });

  // 2. Başlığı transcreate et (boş string döndür - process-story'de ayrı işlenecek)
  // NOT: Başlık işlemi process-story.ts'de transcreateTitle() ile yapılıyor

  // 3. Her batch'i işle (batchTranslateAndAdaptScenes gibi basit for döngüsü)
  const processedScenes: TimestampedScene[] = [];

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    
    logger.debug(`Batch ${i + 1}/${batches.length} transcreate ediliyor...`, {
      batchSize: batch.length
    });

    const processedBatch = await transcrerateBatch(
      batch,
      sourceLang,
      targetLang,
      preset,
      style,
      model,
      provider,
      i,
      batches.length,
      applyCulturalAdaptation
    );

    processedScenes.push(...processedBatch);
    
    logger.debug(`Batch ${i + 1}/${batches.length} tamamlandı`);
  }

  // 4. Basit istatistik logu
  const originalChars = scenes.reduce((sum, s) => sum + s.text.length, 0);
  const newChars = processedScenes.reduce((sum, s) => sum + (s.textAdapted?.length || s.text.length), 0);
  const ratio = newChars / originalChars;

  logger.info('Batch transcreation tamamlandı', {
    totalScenes: processedScenes.length,
    originalChars,
    newChars,
    ratio: `${(ratio * 100).toFixed(1)}%`,
    withinTolerance: ratio >= 0.95 && ratio <= 1.05
  });

  return {
    title: '', // Başlık process-story'de ayrı işleniyor
    scenes: processedScenes
  };
}

/**
 * Transcreation sonuçlarını TimestampedScene'lere uygula
 * NOT: Artık gerekli değil - batchTranscreateScenes direkt TimestampedScene[] döndürüyor
 * Geriye uyumluluk için korunuyor
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
  const systemPrompt = `Translate the title from ${sourceLang} to ${targetLang} and make it more engaging in ${style.name} style.
${style.systemPromptAddition}
⚠️ OUTPUT MUST BE IN ${targetLang.toUpperCase()} LANGUAGE!
Return ONLY the translated title, nothing else.`;

  const response = await retryOpenAI(
    () => createCompletion({
      provider,
      model,
      systemPrompt,
      messages: [{ role: 'user', content: title }],
      temperature: 0.5
    }),
    'Title transcreation'
  );

  return response.trim().replace(/^["']|["']$/g, '');
}
