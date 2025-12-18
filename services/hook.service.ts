/**
 * YouTube Engagement Hook Servisi
 * Videolara abone, beğeni ve yorum hook'ları ekler
 */

import logger from '@/lib/logger';
import { createCompletion, LLMProvider } from './llm-router.service';

// Hook Tipleri
export type HookType = 'intro' | 'subscribe' | 'like' | 'comment' | 'outro';

export interface Hook {
  hookType: HookType;
  text: string;
  position: 'before' | 'after';
}

export interface HookPlacement {
  sceneIndex: number;
  type: HookType;
  position: 'before' | 'after';
}

export interface SceneWithHook {
  sceneNumber: number;
  text: string;
  visualDescription?: string;
  hook?: Hook;
  // Diğer mevcut alanlar korunur
  [key: string]: unknown;
}

interface GenerateHooksOptions {
  storyContext: string;
  targetLanguage: string;
  model: string;
  provider?: LLMProvider;
  sceneCount: number;
}

interface GenerateHookTextOptions {
  hookType: HookType;
  storyContext: string;
  sceneContext: string;
  targetLanguage: string;
  model: string;
  provider?: LLMProvider;
}

// Dil bazlı hook talimatları
const LANGUAGE_INSTRUCTIONS: Record<string, string> = {
  tr: 'Türkçe yaz, samimi ve sıcak bir dil kullan',
  en: 'Write in English, use a friendly and engaging tone',
  fr: 'Écris en français, utilise un ton amical et engageant',
  de: 'Schreibe auf Deutsch, verwende einen freundlichen Ton',
  es: 'Escribe en español, usa un tono amigable y atractivo',
  it: 'Scrivi in italiano, usa un tono amichevole e coinvolgente',
  pt: 'Escreva em português, use um tom amigável e envolvente',
  ru: 'Пиши на русском, используй дружелюбный тон',
  ar: 'اكتب بالعربية، استخدم نبرة ودية وجذابة',
  ja: '日本語で書いて、フレンドリーで魅力的なトーンを使用',
  ko: '한국어로 작성하고 친근하고 매력적인 톤을 사용',
  zh: '用中文写，使用友好且吸引人的语气'
};

// Hook açıklamaları
const HOOK_DESCRIPTIONS: Record<HookType, { purpose: string; maxWords: number }> = {
  intro: {
    purpose: 'Merak uyandır, izleyiciyi hikayeye çek. "Bu hikayede inanılmaz bir şey olacak" gibi',
    maxWords: 20
  },
  subscribe: {
    purpose: 'Kanala abone olmayı öner. Doğal bir geçiş cümlesi kullan',
    maxWords: 25
  },
  like: {
    purpose: 'Videoyu beğenmeyi öner. Duygusal bir anla bağlantılı olsun',
    maxWords: 20
  },
  comment: {
    purpose: 'Yorum yapmayı teşvik et. Soru sor veya görüş iste',
    maxWords: 25
  },
  outro: {
    purpose: 'Final hook. Abone ol + bildirim çanı + başka videolar için teşekkür',
    maxWords: 30
  }
};

/**
 * Hook yerleştirme pozisyonlarını hesapla
 */
export function determineHookPlacements(sceneCount: number): HookPlacement[] {
  const placements: HookPlacement[] = [];
  
  if (sceneCount < 5) {
    // Çok kısa hikayeler için sadece intro ve outro
    placements.push({ sceneIndex: 0, type: 'intro', position: 'after' });
    placements.push({ sceneIndex: sceneCount - 1, type: 'outro', position: 'after' });
    return placements;
  }
  
  // Intro hook: Sahne 2 (ilk sahne çok kısa olabilir)
  placements.push({ sceneIndex: 1, type: 'intro', position: 'after' });
  
  // Subscribe hook: ~%25 noktası
  const subscribeIndex = Math.floor(sceneCount * 0.25);
  if (subscribeIndex > 1) {
    placements.push({ sceneIndex: subscribeIndex, type: 'subscribe', position: 'after' });
  }
  
  // Like hook: ~%60 noktası (doruk noktası)
  const likeIndex = Math.floor(sceneCount * 0.60);
  if (likeIndex > subscribeIndex) {
    placements.push({ sceneIndex: likeIndex, type: 'like', position: 'after' });
  }
  
  // Comment hook: ~%75 noktası
  const commentIndex = Math.floor(sceneCount * 0.75);
  if (commentIndex > likeIndex && commentIndex < sceneCount - 1) {
    placements.push({ sceneIndex: commentIndex, type: 'comment', position: 'after' });
  }
  
  // Outro hook: Son sahne
  placements.push({ sceneIndex: sceneCount - 1, type: 'outro', position: 'after' });
  
  return placements;
}

/**
 * Tek bir hook metni üret
 */
async function generateSingleHookText(options: GenerateHookTextOptions): Promise<string> {
  const { hookType, storyContext, sceneContext, targetLanguage, model, provider } = options;
  
  const langInstruction = LANGUAGE_INSTRUCTIONS[targetLanguage] || LANGUAGE_INSTRUCTIONS['en'];
  const hookInfo = HOOK_DESCRIPTIONS[hookType];
  
  const systemPrompt = `Sen bir YouTube video seslendirmesi için doğal hook metinleri yazan uzman bir içerik üreticisisin.
Hook'lar video akışını bozmadan, doğal bir şekilde entegre edilmeli.
${langInstruction}.
Kısa ve etkili cümleler kur. Maksimum ${hookInfo.maxWords} kelime.`;

  const userPrompt = `Hikaye özeti:
${storyContext.substring(0, 500)}...

Sahne bağlamı:
${sceneContext}

Hook türü: ${hookType}
Hook amacı: ${hookInfo.purpose}

Bu sahne için doğal ve hikayeyle uyumlu bir ${hookType} hook'u yaz.
SADECE hook metnini yaz, başka bir şey ekleme.`;

  try {
    const response = await createCompletion({
      provider: provider || 'openai',
      model,
      systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
      temperature: 0.8,
      maxTokens: 150,
      responseFormat: 'text'
    });
    
    // Temizle: tırnak ve gereksiz karakterleri kaldır
    return response.trim().replace(/^["']|["']$/g, '');
  } catch (error) {
    logger.error('Hook metni üretilemedi', {
      hookType,
      error: error instanceof Error ? error.message : 'Bilinmeyen hata'
    });
    // Fallback metinler
    return getFallbackHookText(hookType, targetLanguage);
  }
}

/**
 * Yedek hook metinleri
 */
function getFallbackHookText(hookType: HookType, language: string): string {
  const fallbacks: Record<string, Record<HookType, string>> = {
    tr: {
      intro: 'Bu hikayede inanılmaz şeyler olacak...',
      subscribe: 'Bu tür hikayeler ilginizi çekiyorsa, abone olup bildirimleri açabilirsiniz.',
      like: 'Bu an sizi de etkilediyse, beğeni bırakabilirsiniz.',
      comment: 'Siz olsaydınız ne yapardınız? Yorumlarda paylaşın.',
      outro: 'Yeni hikayeler için abone olun ve bildirimleri açın. İzlediğiniz için teşekkürler.'
    },
    en: {
      intro: 'Something incredible is about to happen in this story...',
      subscribe: 'If you enjoy these stories, consider subscribing and turning on notifications.',
      like: 'If this moment touched you, feel free to leave a like.',
      comment: 'What would you have done? Share your thoughts in the comments.',
      outro: 'Subscribe for more stories and turn on notifications. Thanks for watching.'
    },
    fr: {
      intro: 'Quelque chose d\'incroyable va se passer dans cette histoire...',
      subscribe: 'Si ce type d\'histoires vous plaît, abonnez-vous à la chaîne.',
      like: 'Si ce moment vous a touché, laissez un like.',
      comment: 'Qu\'auriez-vous fait à sa place? Dites-le dans les commentaires.',
      outro: 'Pour plus d\'histoires, abonnez-vous et activez les notifications.'
    }
  };
  
  const langFallbacks = fallbacks[language] || fallbacks['en'];
  return langFallbacks[hookType];
}

/**
 * Tüm hook metinlerini batch olarak üret
 */
export async function generateAllHookTexts(
  placements: HookPlacement[],
  scenes: Array<{ text: string; sceneNumber: number }>,
  options: GenerateHooksOptions
): Promise<Map<number, Hook>> {
  const { storyContext, targetLanguage, model, provider } = options;
  
  const hookMap = new Map<number, Hook>();
  
  // Hook'ları paralel olarak üret (daha hızlı)
  const hookPromises = placements.map(async (placement) => {
    const scene = scenes[placement.sceneIndex];
    if (!scene) return null;
    
    const hookText = await generateSingleHookText({
      hookType: placement.type,
      storyContext,
      sceneContext: scene.text.substring(0, 300),
      targetLanguage,
      model,
      provider
    });
    
    return {
      sceneIndex: placement.sceneIndex,
      hook: {
        hookType: placement.type,
        text: hookText,
        position: placement.position
      }
    };
  });
  
  const results = await Promise.all(hookPromises);
  
  for (const result of results) {
    if (result) {
      hookMap.set(result.sceneIndex, result.hook);
    }
  }
  
  logger.info('Hook metinleri üretildi', {
    totalHooks: hookMap.size,
    placements: placements.map(p => ({ scene: p.sceneIndex, type: p.type }))
  });
  
  return hookMap;
}

/**
 * Sahnelere hook'ları ekle
 */
export async function addEngagementHooks<T extends { text: string; sceneNumber: number }>(
  scenes: T[],
  options: GenerateHooksOptions
): Promise<Array<T & { hook?: Hook }>> {
  const { sceneCount } = options;
  
  logger.info('Engagement hook\'ları ekleniyor', { sceneCount });
  
  // Hook yerleştirme pozisyonlarını belirle
  const placements = determineHookPlacements(sceneCount);
  
  // Hook metinlerini üret
  const hookMap = await generateAllHookTexts(placements, scenes, options);
  
  // Sahnelere hook'ları ekle
  const scenesWithHooks = scenes.map((scene, index) => {
    const hook = hookMap.get(index);
    return {
      ...scene,
      hook: hook || undefined
    };
  });
  
  return scenesWithHooks;
}

/**
 * Hook'lu sahne metnini birleştir (TTS için)
 * Hook position'a göre metni düzenler
 */
export function mergeHookWithSceneText(sceneText: string, hook?: Hook): string {
  if (!hook) return sceneText;
  
  // Hook ile sahne metni arasına kısa bir duraklama ekle
  const pause = ' ... ';
  
  if (hook.position === 'before') {
    return `${hook.text}${pause}${sceneText}`;
  } else {
    return `${sceneText}${pause}${hook.text}`;
  }
}

/**
 * Hook tipine göre emoji al (UI için)
 */
export function getHookEmoji(hookType: HookType): string {
  const emojis: Record<HookType, string> = {
    intro: '🎬',
    subscribe: '🔔',
    like: '👍',
    comment: '💬',
    outro: '🎯'
  };
  return emojis[hookType];
}

/**
 * Hook tipine göre Türkçe açıklama al (UI için)
 */
export function getHookLabel(hookType: HookType): string {
  const labels: Record<HookType, string> = {
    intro: 'Giriş Hook',
    subscribe: 'Abone Hook',
    like: 'Beğeni Hook',
    comment: 'Yorum Hook',
    outro: 'Çıkış Hook'
  };
  return labels[hookType];
}
