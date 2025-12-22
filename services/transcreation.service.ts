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
  targetCharacterCount?: number;  // Hedef toplam karakter sayısı (opsiyonel)
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
  applyCulturalAdaptation: boolean = false,
  batchTargetChars?: number  // Bu batch için hedef karakter sayısı
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

  // Bu batch için orijinal karakter sayısı
  const batchOriginalChars = batch.reduce((sum, s) => sum + s.text.length, 0);
  
  // Ölçek hesapla ve modu belirle
  const scale = batchTargetChars ? batchTargetChars / batchOriginalChars : 1;
  const isCondensing = scale < 0.95;  // Kısaltma modu
  const isExpanding = scale > 1.05;   // Uzatma modu
  const scalePercent = Math.round(scale * 100);
  
  // Dinamik mod talimatları
  let adaptationModeInstructions = '';
  
  if (batchTargetChars) {
    if (isCondensing) {
      // KIŞALTMA MODU
      adaptationModeInstructions = `
📉 MODE: CONDENSING (${scalePercent}% of original - making it shorter)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✅ HOW TO CONDENSE WITHOUT LOSING MEANING:
• Keep the CORE MESSAGE of every sentence - just say it more concisely
• Remove redundant adjectives: "very beautiful, amazing, wonderful house" → "stunning house"
• Combine related sentences into one powerful statement
• Remove filler words: "actually, basically, really, very, just"
• Use stronger single words instead of phrases: "at this point in time" → "now"
• Keep ALL important plot points, events, and dialogue
• Preserve emotional beats - just express them more efficiently

❌ NEVER DO THESE WHEN CONDENSING:
• DON'T skip any story events or plot points
• DON'T remove character dialogue (shorten it, don't delete it)
• DON'T lose the emotional arc of the story
• DON'T cut transitions that maintain story flow
• DON'T remove context that readers need to understand

🎯 EXAMPLE:
Original: "The old man slowly walked down the long, winding road, thinking about all the many memories he had accumulated over his very long and eventful life."
Condensed: "The old man walked the winding road, lost in a lifetime of memories."
(Same meaning, same emotion, fewer characters)`;

    } else if (isExpanding) {
      // UZATMA MODU
      adaptationModeInstructions = `
📈 MODE: EXPANDING (${scalePercent}% of original - making it richer)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✅ HOW TO EXPAND WITHOUT CHANGING THE STORY:
• Add sensory details: sights, sounds, smells, textures
• Deepen emotional descriptions: show feelings more vividly
• Expand scene-setting: describe the environment more richly
• Add internal thoughts that match character's established personality
• Use more vivid metaphors and comparisons
• Slow down dramatic moments with more detail
• Add natural speech patterns to dialogue

❌ NEVER DO THESE WHEN EXPANDING:
• DON'T add new plot events that weren't in the original
• DON'T introduce new characters
• DON'T change character motivations or relationships
• DON'T add information that contradicts the original
• DON'T pad with meaningless filler - every addition should enhance

🎯 EXAMPLE:
Original: "She opened the door and saw him standing there."
Expanded: "Her hand trembled as she turned the cold brass handle. The door creaked open, and there he stood—silhouetted against the amber glow of the streetlight, rain dripping from his coat."
(Same event, richer experience, more characters)`;

    } else {
      // KORUMA MODU (yaklaşık aynı uzunluk)
      adaptationModeInstructions = `
📊 MODE: BALANCED (${scalePercent}% - similar length, better expression)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✅ REWRITE WITH SAME LENGTH:
• Replace weak words with stronger equivalents
• Restructure sentences for better flow
• Keep approximately the same character count per segment
• Focus on making it more engaging, not longer or shorter`;
    }
  }
  
  // Karakter hedefi kuralı
  const lengthRule = batchTargetChars
    ? `🚨 STRICT CHARACTER LIMIT - MANDATORY:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📊 THIS BATCH: ${batch.length} segments, ${batchOriginalChars} chars original
🎯 YOUR TARGET: ${batchTargetChars} characters (±5% = ${Math.round(batchTargetChars * 0.95)}-${Math.round(batchTargetChars * 1.05)})
📐 SCALE: ${scalePercent}% of original
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

${adaptationModeInstructions}

⚠️ FINAL CHECK:
1. Count total characters BEFORE submitting
2. Must be between ${Math.round(batchTargetChars * 0.95)} and ${Math.round(batchTargetChars * 1.05)} chars
3. Distribute naturally - some segments longer, some shorter
4. Story flow and meaning MUST remain intact`
    : `📏 CRITICAL LENGTH RULE (VIDEO SYNC):
- Each segment's character count must stay within ±5% of original
- Example: 100 chars original → output must be 95-105 chars
- This ensures the rewritten audio matches the original video timing
- Be creative with HOW you say it, but keep the SAME length
- Don't pad with filler words, don't cut important content`;

  const systemPrompt = `You are an expert TRANSCREATOR (not just translator). Your job is to CREATIVELY REWRITE content to make it more ENGAGING and COMPELLING in ${targetLang}.

⚠️ CRITICAL OUTPUT LANGUAGE: ${targetLang.toUpperCase()} ONLY!

🎯 YOUR MISSION - TRANSCREATION:
Transform the content while PRESERVING its soul:
1. Keep ALL story events, plot points, and character moments
2. Maintain the emotional journey and narrative arc
3. Express the same ideas more powerfully in ${targetLang}
4. Adapt length as instructed while keeping meaning intact

${lengthRule}

📊 CREATIVITY SETTINGS:
- Creative Freedom: ${creativityLevel}%
- Structure Preservation: ${structurePreserve}%
- Style: ${style.name}

✨ STYLE TECHNIQUES:
${style.instructions}
${presetInstructions.length > 0 ? presetInstructions.map(i => `• ${i}`).join('\n') : ''}
${style.systemPromptAddition}

🔒 ABSOLUTE RULES - NEVER BREAK:
${culturalAdaptationRule}
• STORY INTEGRITY: Every event in the original must appear in the output
• CHARACTER CONSISTENCY: Keep genders, names, relationships accurate
• LOGICAL FLOW: Cause and effect must make sense
• EMOTIONAL TRUTH: The feelings conveyed must match the original intent

🎙️ VOICE-OVER READY:
- Expand abbreviations naturally
- Write numbers as words
- Ensure smooth, speakable rhythm

JSON OUTPUT:
{"results": [{"id": 1, "text": "rewritten text"}]}`;

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
 * Batch sonuç tipi (validation bilgisi ile)
 */
interface TranscreationBatchResult {
  title: string;
  scenes: TimestampedScene[];
  validation: {
    targetCharacterCount?: number;
    actualCharacterCount: number;
    isWithinTarget: boolean;
  };
}

/**
 * Tüm sahneleri batch olarak transcreate eder (Basitleştirilmiş - batchTranslateAndAdaptScenes gibi)
 */
export async function batchTranscreateScenes(options: BatchTranscreateOptions): Promise<TranscreationBatchResult> {
  const { scenes, sourceLang, targetLang, presetId, styleId, model, provider, applyCulturalAdaptation = false, targetCharacterCount } = options;
  
  const preset = getPresetById(presetId);
  const style = getStyleById(styleId);

  // Orijinal toplam karakter sayısı
  const originalTotalChars = scenes.reduce((sum, s) => sum + s.text.length, 0);

  logger.info('Batch transcreation başlatılıyor', {
    sceneCount: scenes.length,
    sourceLang,
    targetLang,
    preset: preset.name,
    style: style.name,
    model,
    provider,
    applyCulturalAdaptation,
    targetCharacterCount: targetCharacterCount || 'yok (±%5 tolerans)',
    originalTotalChars,
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
    
    // Bu batch için orantılı hedef hesapla
    let batchTargetChars: number | undefined;
    if (targetCharacterCount) {
      const batchOriginalChars = batch.reduce((sum, s) => sum + s.text.length, 0);
      const batchRatio = batchOriginalChars / originalTotalChars;
      batchTargetChars = Math.round(targetCharacterCount * batchRatio);
      
      logger.debug(`Batch ${i + 1}/${batches.length} hedef hesaplandı`, {
        batchOriginalChars,
        batchRatio: `${(batchRatio * 100).toFixed(1)}%`,
        batchTargetChars
      });
    }
    
    logger.debug(`Batch ${i + 1}/${batches.length} transcreate ediliyor...`, {
      batchSize: batch.length,
      batchTargetChars: batchTargetChars || 'yok'
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
      applyCulturalAdaptation,
      batchTargetChars
    );

    processedScenes.push(...processedBatch);
    
    logger.debug(`Batch ${i + 1}/${batches.length} tamamlandı`);
  }

  // 4. İstatistik ve doğrulama
  const newChars = processedScenes.reduce((sum, s) => sum + (s.textAdapted?.length || s.text.length), 0);
  const ratio = newChars / originalTotalChars;

  // Hedef varsa doğrulama yap
  let isWithinTarget = true;
  if (targetCharacterCount) {
    const tolerance = 0.05; // ±%5 tolerans (sıkı hedef)
    const minAllowed = targetCharacterCount * (1 - tolerance);
    const maxAllowed = targetCharacterCount * (1 + tolerance);
    isWithinTarget = newChars >= minAllowed && newChars <= maxAllowed;

    logger.info('Karakter hedefi doğrulaması', {
      target: targetCharacterCount,
      actual: newChars,
      difference: `${((newChars / targetCharacterCount - 1) * 100).toFixed(1)}%`,
      withinTarget: isWithinTarget,
      allowedRange: `${Math.round(minAllowed)}-${Math.round(maxAllowed)}`
    });

    if (!isWithinTarget) {
      logger.warn('Karakter hedefi tutturulamadı (±%5 dışında)', {
        target: targetCharacterCount,
        actual: newChars,
        difference: newChars - targetCharacterCount,
        percentDiff: `${((newChars / targetCharacterCount - 1) * 100).toFixed(1)}%`
      });
    }
  } else {
    // Hedef yoksa ±%5 tolerans kontrolü
    isWithinTarget = ratio >= 0.95 && ratio <= 1.05;
  }

  logger.info('Batch transcreation tamamlandı', {
    totalScenes: processedScenes.length,
    originalChars: originalTotalChars,
    newChars,
    ratio: `${(ratio * 100).toFixed(1)}%`,
    targetCharacterCount: targetCharacterCount || 'yok',
    isWithinTarget
  });

  return {
    title: '', // Başlık process-story'de ayrı işleniyor
    scenes: processedScenes,
    validation: {
      targetCharacterCount,
      actualCharacterCount: newChars,
      isWithinTarget
    }
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
