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
- Ask existential and philosophical questions that make viewers pause
- Use metaphors and symbolic language that resonate emotionally
- Invite the viewer to reflect on their own life
- Reference universal truths everyone can relate to
- Create "aha moments" that viewers want to share
- Build tension before revealing insights`,
    systemPromptAddition: `Narration style: Philosophical and deeply thought-provoking. Make viewers feel like they're discovering profound truths. Use introspective phrases like "What about you?", "Have you ever wondered...", "Think about it for a moment...". Create a sense of shared wisdom. Make them FEEL the depth, don't just tell them.`
  },
  {
    id: 'storyteller',
    name: 'Storyteller',
    description: 'Engaging storytelling narration',
    instructions: `- Write like a master storyteller sitting by a campfire
- Create OPEN LOOPS - hint at what's coming to keep viewers watching
- Use sensory details: sights, sounds, feelings
- Build tension and release strategically
- Use transitions that create anticipation: "But what happened next changed everything..."
- Make the audience FEEL, not just hear the story
- Vary sentence rhythm: short punchy sentences for impact, longer for atmosphere
- End sections with hooks that demand the next part`,
    systemPromptAddition: `Narration style: Master storyteller. Your job is to make it IMPOSSIBLE for viewers to click away. Use phrases like "But here's where it gets interesting...", "What they didn't know was...", "And then... everything changed.", "Stay with me here, because this part is crucial...". Create emotional peaks and valleys. Short sentence. For impact. Then flow into longer descriptions.`
  },
  {
    id: 'documentary',
    name: 'Documentary',
    description: 'Informative, professional narration',
    instructions: `- Use an authoritative yet warm tone
- Present information in a way that builds curiosity
- Layer facts to create "revelation moments"
- Use professional documentary language without being dry
- Make complex topics feel accessible and fascinating
- Create the sense that viewers are learning something valuable
- Balance information with emotional resonance`,
    systemPromptAddition: `Narration style: Professional documentary narrator. David Attenborough meets mystery documentary. Present facts as discoveries. Use phrases like "What researchers found was remarkable...", "The truth, as it turned out...", "Few people realize that...". Make information feel exclusive and valuable.`
  },
  {
    id: 'entertaining',
    name: 'Entertaining',
    description: 'Light, entertaining narration',
    instructions: `- Use an energetic and relatable tone
- Add humor that doesn't feel forced
- Use conversational language - like texting a friend
- React to the story yourself: express surprise, disbelief
- Break the fourth wall occasionally
- Use current, natural expressions
- Create shareable moments viewers will remember`,
    systemPromptAddition: `Narration style: Your witty best friend telling you an INSANE story. Use phrases like "Okay but get this...", "I'm not even joking...", "Wait, it gets better...", "Can you even imagine?". Be genuinely entertained by your own story. React naturally.`
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
 * Context bilgisi - önceki batch'ten gelen bağlam
 */
export interface BatchContext {
  previousScenes?: { original: string; adapted: string }[];  // Önceki batch'in son 2 sahnesi
  storyTone?: string;  // İlk batch'ten belirlenen hikaye tonu
  establishedStyle?: string;  // Kullanılan üslup özellikleri
}

/**
 * Tek bir batch'i transcreate eder (Retry mekanizması ile)
 * Export edildi - Inngest step'lerinde kullanılıyor
 */
export async function transcrerateBatch(
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
  batchTargetChars?: number,  // Bu batch için hedef karakter sayısı
  context?: BatchContext  // Önceki batch'ten gelen bağlam
): Promise<TimestampedScene[]> {
  const MAX_BATCH_RETRIES = 3; // Karakter hedefini tutturmak için 3 deneme
  const TOLERANCE = 0.05; // %5 tolerans
  
  // Bu batch için orijinal karakter sayısı
  const batchOriginalChars = batch.reduce((sum, s) => sum + s.text.length, 0);
  
  // Hedef hesapla
  const effectiveTarget = batchTargetChars || batchOriginalChars;
  const minAllowed = Math.round(effectiveTarget * (1 - TOLERANCE));
  const maxAllowed = Math.round(effectiveTarget * (1 + TOLERANCE));
  
  let lastResult: TimestampedScene[] = [];
  let lastTotalChars = 0;
  let bestResult: TimestampedScene[] = [];
  let bestDiff = Infinity;
  
  for (let attempt = 1; attempt <= MAX_BATCH_RETRIES; attempt++) {
    // Basit input formatı (batchTranslateAndAdaptScenes gibi)
    const scenesInput = batch.map((scene, idx) => ({
      id: idx + 1,
      text: scene.text,
      charCount: scene.text.length
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

    // Ölçek hesapla ve modu belirle
    const scale = batchTargetChars ? batchTargetChars / batchOriginalChars : 1;
    const isCondensing = scale < 0.95;  // Kısaltma modu
    const isExpanding = scale > 1.05;   // Uzatma modu
    const scalePercent = Math.round(scale * 100);
    
    // Önceki deneme uyarısı
    let retryWarning = '';
    if (attempt > 1 && lastTotalChars > 0) {
      const wasShort = lastTotalChars < minAllowed;
      const wasLong = lastTotalChars > maxAllowed;
      const diff = lastTotalChars - effectiveTarget;
      const diffPercent = ((lastTotalChars / effectiveTarget - 1) * 100).toFixed(1);
      
      if (wasShort) {
        retryWarning = `
⚠️⚠️⚠️ PREVIOUS ATTEMPT FAILED - TEXT WAS TOO SHORT! ⚠️⚠️⚠️
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Previous output: ${lastTotalChars} chars (${diffPercent}% vs target)
NEEDED: ${effectiveTarget} chars (range: ${minAllowed}-${maxAllowed})
SHORTFALL: ${Math.abs(diff)} characters too short!

🔥 YOU MUST ADD MORE CONTENT THIS TIME:
• Expand descriptions with sensory details
• Add emotional depth to key moments  
• Use longer, more elaborate phrases
• Include rhetorical flourishes
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;
      } else if (wasLong) {
        retryWarning = `
⚠️⚠️⚠️ PREVIOUS ATTEMPT FAILED - TEXT WAS TOO LONG! ⚠️⚠️⚠️
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Previous output: ${lastTotalChars} chars (${diffPercent}% vs target)
NEEDED: ${effectiveTarget} chars (range: ${minAllowed}-${maxAllowed})
EXCESS: ${Math.abs(diff)} characters too long!

🔥 YOU MUST WRITE MORE CONCISELY THIS TIME:
• Remove redundant words and filler
• Use shorter, punchier phrases
• Combine sentences where possible
• Be direct - no unnecessary elaboration
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;
      }
    }
    
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
• DON'T remove context that readers need to understand`;

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
• DON'T pad with meaningless filler - every addition should enhance`;

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
    
    // Karakter hedefi kuralı - daha güçlü vurgu
    const lengthRule = batchTargetChars
      ? `
🚨🚨🚨 MANDATORY CHARACTER COUNT - THIS IS YOUR PRIMARY CONSTRAINT 🚨🚨🚨
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📊 INPUT: ${batch.length} segments totaling ${batchOriginalChars} characters
🎯 OUTPUT TARGET: ${batchTargetChars} characters TOTAL
📐 SCALE FACTOR: ${scalePercent}% (${isCondensing ? 'SHORTEN' : isExpanding ? 'EXPAND' : 'MAINTAIN'})
✅ ACCEPTABLE RANGE: ${minAllowed} to ${maxAllowed} characters

${retryWarning}

${adaptationModeInstructions}

⚡ TECHNIQUE: For each segment, multiply original char count by ${(scale).toFixed(2)}
   Example: 500 char segment → aim for ${Math.round(500 * scale)} chars in output

🔢 BEFORE SUBMITTING, COUNT YOUR TOTAL OUTPUT CHARACTERS!
   Your total MUST be between ${minAllowed} and ${maxAllowed} chars.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`
      : `📏 CRITICAL LENGTH RULE (VIDEO SYNC):
- Each segment's character count must stay within ±10% of original
- Example: 100 chars original → output must be 90-110 chars
- This ensures the rewritten audio matches the original video timing
- Be creative with HOW you say it, but keep the SAME length
- Don't pad with filler words, don't cut important content`;

    // Context bölümü oluştur (önceki batch'ten gelen bağlam)
    let contextSection = '';
    if (context?.previousScenes && context.previousScenes.length > 0) {
      contextSection = `
🔗 STORY CONTINUITY - CRITICAL FOR FLOW
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
This is batch ${batchIndex + 1} of ${totalBatches}. You MUST maintain continuity with previous content.

📖 PREVIOUS SCENES (for context - DO NOT include in your output):
${context.previousScenes.map((s, i) => `[Scene ${i + 1}] ${s.adapted}`).join('\n')}

${context.storyTone ? `🎭 ESTABLISHED TONE: ${context.storyTone}` : ''}
${context.establishedStyle ? `✨ STYLE CHARACTERISTICS: ${context.establishedStyle}` : ''}

⚠️ CONTINUITY RULES:
• Your output MUST flow naturally from the previous scenes above
• Maintain the SAME tone, voice, and energy level
• Don't repeat information already covered
• Ensure smooth transitions - no abrupt topic changes
• If a character was mentioned before, maintain consistency
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

`;
    } else if (batchIndex === 0) {
      contextSection = `
🎬 FIRST BATCH - ESTABLISHING TONE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
This is the OPENING of the story. Your choices here set the tone for everything that follows.
• Establish a compelling voice that hooks the audience
• Set the emotional baseline for the story
• Create anticipation for what's coming
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

`;
    }

    const systemPrompt = `You are an expert TRANSCREATOR. CREATIVELY REWRITE content to be ENGAGING and COMPELLING in ${targetLang.toUpperCase()}.

${contextSection}${lengthRule}

🎯 MISSION - TRANSCREATION:
Transform content while PRESERVING its soul:
1. Keep ALL story events, plot points, character moments
2. Maintain emotional journey and narrative arc
3. Express ideas more powerfully in ${targetLang}
4. STRICTLY respect character count target

🎬 YOUTUBE RETENTION (CRITICAL):
• OPEN LOOPS: Plant curiosity seeds - "But that wasn't even the craziest part..."
• Mini-cliffhangers at segment ends when appropriate
• Tease what's coming - never reveal everything at once
• Create emotional peaks: tension, relief, surprise

🗣️ NATURAL HUMAN SPEECH (NO AI SLOP):
• Write how REAL people talk, not how AI writes
• Use contractions: "didn't" not "did not", "wasn't" not "was not"
• Vary sentence lengths DRAMATICALLY:
  - Short punch. For impact.
  - Then flow into longer, descriptive passages that paint vivid pictures.
• Natural reactions: "Crazy, right?", "I know...", "But wait..."
• AVOID robotic phrases: "It is important to note", "Furthermore", "In conclusion"

🔧 FIX SOURCE ISSUES (IMPROVE THE ORIGINAL):
• Awkward phrasing → REWRITE for natural flow
• Logic doesn't flow → RESTRUCTURE for clarity
• Emotional beats missing → ADD them
• Abrupt transitions → SMOOTH them
• Sounds robotic → HUMANIZE it
• Make it BETTER than the original!

📊 STYLE: ${style.name} (Creative Freedom: ${creativityLevel}%)
${style.instructions}
${presetInstructions.length > 0 ? presetInstructions.map(i => `• ${i}`).join('\n') : ''}
${style.systemPromptAddition}

🔒 ABSOLUTE RULES:
${culturalAdaptationRule}
• STORY INTEGRITY: Every original event must appear in output
• CHARACTER CONSISTENCY: Keep genders, names, relationships accurate
• LOGICAL FLOW: Cause and effect must make sense
• EMOTIONAL TRUTH: Feelings conveyed must match original intent

🎙️ VOICE-OVER READY:
• Expand abbreviations naturally
• Numbers as words (3 → three, 1990 → nineteen ninety)
• Smooth, speakable rhythm
• No parentheses - integrate info into sentences

JSON OUTPUT:
{"results": [{"id": 1, "text": "rewritten text"}], "totalChars": <number>}`;

    try {
      const response = await retryOpenAI(
        () => createCompletion({
          provider,
          model,
          systemPrompt,
          messages: [{ role: 'user', content: JSON.stringify(scenesInput, null, 2) }],
          temperature: 0.3 + (attempt * 0.1), // Her denemede biraz daha yaratıcı
          responseFormat: 'json_object'
        }),
        `Transcreation batch ${batchIndex + 1}/${totalBatches} (attempt ${attempt})`
      );

      const parsed = JSON.parse(response);
      const results = parsed.results || [];

      const processedBatch = batch.map((scene, idx) => {
        const result = results.find((r: { id: number; text: string }) => r.id === idx + 1);
        return {
          ...scene,
          textAdapted: result?.text || scene.text
        };
      });
      
      // Toplam karakter sayısını hesapla
      const totalChars = processedBatch.reduce((sum, s) => sum + (s.textAdapted?.length || 0), 0);
      lastResult = processedBatch;
      lastTotalChars = totalChars;
      
      // En iyi sonucu kaydet (hedefe en yakın)
      const currentDiff = Math.abs(totalChars - effectiveTarget);
      if (currentDiff < bestDiff) {
        bestDiff = currentDiff;
        bestResult = processedBatch;
      }
      
      // Tolerans kontrolü
      const isWithinRange = totalChars >= minAllowed && totalChars <= maxAllowed;
      const diffPercent = ((totalChars / effectiveTarget - 1) * 100).toFixed(1);
      
      if (isWithinRange) {
        logger.info(`Batch ${batchIndex + 1} karakter hedefi tutturuldu ✅`, {
          attempt,
          target: effectiveTarget,
          actual: totalChars,
          diff: `${diffPercent}%`
        });
        return processedBatch;
      }
      
      logger.warn(`Batch ${batchIndex + 1} karakter hedefi tutturulamadı (${attempt}/${MAX_BATCH_RETRIES})`, {
        target: effectiveTarget,
        actual: totalChars,
        diff: `${diffPercent}%`,
        range: `${minAllowed}-${maxAllowed}`,
        shortOrLong: totalChars < minAllowed ? 'SHORT' : 'LONG'
      });
      
    } catch (error) {
      logger.error(`Batch ${batchIndex + 1} transcreation hatası (${attempt}/${MAX_BATCH_RETRIES})`, {
        error: error instanceof Error ? error.message : 'Bilinmeyen hata'
      });
      
      // Son denemede hata olursa orijinal metinleri kullan
      if (attempt === MAX_BATCH_RETRIES) {
        return batch.map(scene => ({ ...scene, textAdapted: scene.text }));
      }
    }
  }
  
  // Tüm denemeler bittikten sonra en iyi sonucu döndür
  if (bestResult.length > 0) {
    const bestTotalChars = bestResult.reduce((sum, s) => sum + (s.textAdapted?.length || 0), 0);
    logger.warn(`Batch ${batchIndex + 1}: ${MAX_BATCH_RETRIES} denemede hedef tutturulamadı, en iyi sonuç kullanılıyor`, {
      target: effectiveTarget,
      bestResult: bestTotalChars,
      diff: `${((bestTotalChars / effectiveTarget - 1) * 100).toFixed(1)}%`
    });
    return bestResult;
  }
  
  // Fallback: orijinal metinleri kullan
  logger.error(`Batch ${batchIndex + 1}: Tüm denemeler başarısız, orijinal metinler kullanılıyor`);
  return batch.map(scene => ({ ...scene, textAdapted: scene.text }));
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
 * Tüm sahneleri batch olarak transcreate eder (Retry ve düzeltme mekanizması ile)
 */
export async function batchTranscreateScenes(options: BatchTranscreateOptions): Promise<TranscreationBatchResult> {
  const { scenes, sourceLang, targetLang, presetId, styleId, model, provider, applyCulturalAdaptation = false, targetCharacterCount } = options;
  
  const preset = getPresetById(presetId);
  const style = getStyleById(styleId);

  // Orijinal toplam karakter sayısı
  const originalTotalChars = scenes.reduce((sum, s) => sum + s.text.length, 0);
  
  // Hedef karakter sayısı (verilmediyse orijinal)
  const effectiveTarget = targetCharacterCount || originalTotalChars;
  const TOLERANCE = 0.05; // %5 tolerans
  const minAllowed = Math.round(effectiveTarget * (1 - TOLERANCE));
  const maxAllowed = Math.round(effectiveTarget * (1 + TOLERANCE));

  logger.info('Batch transcreation başlatılıyor', {
    sceneCount: scenes.length,
    sourceLang,
    targetLang,
    preset: preset.name,
    style: style.name,
    model,
    provider,
    applyCulturalAdaptation,
    targetCharacterCount: targetCharacterCount || 'yok (orijinal uzunluk korunacak)',
    originalTotalChars,
    effectiveTarget,
    allowedRange: `${minAllowed}-${maxAllowed}`,
    firstScenePreview: scenes[0]?.text?.substring(0, 100)
  });

  // 1. Sahneleri batch'lere böl (4000 token - kalite ve hız dengesi)
  const batches = splitIntoBatches(scenes, 4000, provider);
  
  logger.info('Batch\'ler oluşturuldu', {
    totalScenes: scenes.length,
    totalBatches: batches.length
  });

  // 2. Başlığı transcreate et (boş string döndür - process-story'de ayrı işlenecek)
  // NOT: Başlık işlemi process-story.ts'de transcreateTitle() ile yapılıyor

  // 3. Her batch'i işle (batchTranslateAndAdaptScenes gibi basit for döngüsü)
  let processedScenes: TimestampedScene[] = [];

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

  // 4. İlk geçiş sonrası toplam karakter kontrolü
  let currentChars = processedScenes.reduce((sum, s) => sum + (s.textAdapted?.length || s.text.length), 0);
  let isWithinTarget = currentChars >= minAllowed && currentChars <= maxAllowed;
  
  logger.info('İlk geçiş sonucu', {
    target: effectiveTarget,
    actual: currentChars,
    diff: `${((currentChars / effectiveTarget - 1) * 100).toFixed(1)}%`,
    isWithinTarget
  });

  // 5. Hedef tutmadıysa düzeltme geçişi yap (en çok 2 ek deneme)
  const MAX_CORRECTION_ATTEMPTS = 2;
  let correctionAttempt = 0;
  
  while (!isWithinTarget && correctionAttempt < MAX_CORRECTION_ATTEMPTS) {
    correctionAttempt++;
    
    const isShort = currentChars < minAllowed;
    const diff = Math.abs(currentChars - effectiveTarget);
    const diffPercent = ((currentChars / effectiveTarget - 1) * 100);
    
    logger.warn(`Toplam hedef tutmadı, düzeltme geçişi ${correctionAttempt}/${MAX_CORRECTION_ATTEMPTS}`, {
      target: effectiveTarget,
      current: currentChars,
      diff: `${diffPercent.toFixed(1)}%`,
      direction: isShort ? 'KISA - uzatılacak' : 'UZUN - kısaltılacak'
    });
    
    // En çok sapan batch'leri bul ve yeniden işle
    const batchStats = batches.map((batch, idx) => {
      const batchScenes = processedScenes.filter((_, sceneIdx) => {
        let count = 0;
        for (let i = 0; i <= idx; i++) {
          count += batches[i].length;
        }
        const startIdx = idx === 0 ? 0 : count - batches[idx].length;
        const endIdx = count;
        return sceneIdx >= startIdx && sceneIdx < endIdx;
      });
      
      const batchOriginalChars = batch.reduce((sum, s) => sum + s.text.length, 0);
      const batchCurrentChars = batchScenes.reduce((sum, s) => sum + (s.textAdapted?.length || s.text.length), 0);
      const batchTargetChars = targetCharacterCount 
        ? Math.round(targetCharacterCount * (batchOriginalChars / originalTotalChars))
        : batchOriginalChars;
      const batchDiff = (batchCurrentChars / batchTargetChars - 1) * 100;
      
      return {
        idx,
        batch,
        batchOriginalChars,
        batchCurrentChars,
        batchTargetChars,
        batchDiff,
        needsCorrection: isShort 
          ? batchCurrentChars < batchTargetChars * 0.95 // %5'den fazla kısa
          : batchCurrentChars > batchTargetChars * 1.05  // %5'den fazla uzun
      };
    });
    
    // Düzeltme gereken batch'leri seç
    const batchesToCorrect = batchStats
      .filter(b => b.needsCorrection)
      .sort((a, b) => Math.abs(b.batchDiff) - Math.abs(a.batchDiff))
      .slice(0, 3); // En fazla 3 batch
    
    if (batchesToCorrect.length === 0) {
      logger.info('Düzeltilecek batch bulunamadı, mevcut sonuç kabul ediliyor');
      break;
    }
    
    logger.info(`${batchesToCorrect.length} batch düzeltilecek`, {
      batchIndices: batchesToCorrect.map(b => b.idx + 1)
    });
    
    // Seçilen batch'leri yeniden işle
    for (const batchInfo of batchesToCorrect) {
      // Düzeltilmiş hedef: eksik/fazla farkı telafi et
      const correctionFactor = isShort ? 1.15 : 0.85; // Daha agresif düzeltme
      const correctedTarget = Math.round(batchInfo.batchTargetChars * correctionFactor);
      
      logger.debug(`Batch ${batchInfo.idx + 1} yeniden işleniyor`, {
        originalTarget: batchInfo.batchTargetChars,
        correctedTarget,
        currentChars: batchInfo.batchCurrentChars
      });
      
      const correctedBatch = await transcrerateBatch(
        batchInfo.batch,
        sourceLang,
        targetLang,
        preset,
        style,
        model,
        provider,
        batchInfo.idx,
        batches.length,
        applyCulturalAdaptation,
        correctedTarget
      );
      
      // İlgili sahneleri güncelle
      let sceneOffset = 0;
      for (let i = 0; i < batchInfo.idx; i++) {
        sceneOffset += batches[i].length;
      }
      
      for (let j = 0; j < correctedBatch.length; j++) {
        processedScenes[sceneOffset + j] = correctedBatch[j];
      }
    }
    
    // Yeni toplam hesapla
    currentChars = processedScenes.reduce((sum, s) => sum + (s.textAdapted?.length || s.text.length), 0);
    isWithinTarget = currentChars >= minAllowed && currentChars <= maxAllowed;
    
    logger.info(`Düzeltme geçişi ${correctionAttempt} sonucu`, {
      target: effectiveTarget,
      actual: currentChars,
      diff: `${((currentChars / effectiveTarget - 1) * 100).toFixed(1)}%`,
      isWithinTarget
    });
  }

  // 6. Final istatistik ve doğrulama
  const finalChars = processedScenes.reduce((sum, s) => sum + (s.textAdapted?.length || s.text.length), 0);
  const ratio = finalChars / originalTotalChars;
  const finalDiff = ((finalChars / effectiveTarget - 1) * 100).toFixed(1);

  logger.info('Batch transcreation tamamlandı', {
    totalScenes: processedScenes.length,
    originalChars: originalTotalChars,
    targetChars: effectiveTarget,
    finalChars,
    ratio: `${(ratio * 100).toFixed(1)}%`,
    diffFromTarget: `${finalDiff}%`,
    isWithinTarget,
    correctionAttempts: correctionAttempt
  });

  return {
    title: '', // Başlık process-story'de ayrı işleniyor
    scenes: processedScenes,
    validation: {
      targetCharacterCount,
      actualCharacterCount: finalChars,
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
