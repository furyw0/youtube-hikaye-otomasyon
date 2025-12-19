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

// Dil isimleri (LLM'e hangi dilde yazması gerektiğini söylemek için)
const LANGUAGE_NAMES: Record<string, string> = {
  tr: 'Turkish',
  en: 'English',
  fr: 'French',
  de: 'German',
  es: 'Spanish',
  it: 'Italian',
  pt: 'Portuguese',
  ru: 'Russian',
  ar: 'Arabic',
  ja: 'Japanese',
  ko: 'Korean',
  zh: 'Chinese'
};

// Hook açıklamaları - İngilizce (LLM için net talimatlar)
const HOOK_DESCRIPTIONS: Record<HookType, { purpose: string; maxWords: number; style: string }> = {
  intro: {
    purpose: 'Grab attention and create curiosity. Hint at the most dramatic moment. Use powerful phrases like "What happens at the end will shock you".',
    maxWords: 30,
    style: 'Mysterious and intriguing. Viewer should wonder "what will happen?"'
  },
  subscribe: {
    purpose: 'Highlight channel value. Make a clear and sincere call like "Subscribe for more stories like this". Ask to turn on notifications.',
    maxWords: 35,
    style: 'Friendly but direct. Tell the viewer what the channel will give them.'
  },
  like: {
    purpose: 'Ask for like at emotional peak. Direct but sincere call like "If this moment touched you, leave a like".',
    maxWords: 25,
    style: 'Emotional and sincere. Use the impact of what just happened.'
  },
  comment: {
    purpose: 'Invite viewer to discussion. Ask a strong thought-provoking question. Say "Let\'s meet in the comments".',
    maxWords: 30,
    style: 'Curiosity-inducing question. Viewer should want to respond.'
  },
  outro: {
    purpose: 'Strong closing. Subscribe + notification bell + thank you. Create anticipation for next video.',
    maxWords: 40,
    style: 'Warm farewell and clear call. "Subscribe and turn on notifications".'
  }
};

/**
 * Hook yerleştirme pozisyonlarını hesapla
 * NOT: İzleyicilerin çoğu videoyu tamamlamıyor, bu yüzden hook'lar ERKen yerleştirilmeli!
 * 
 * Yerleşim Stratejisi:
 * - Intro: %5-10 (ilk 30 saniye - merak uyandır)
 * - Subscribe: %15-20 (1-2 dakika - hemen abone çağrısı)
 * - Like: %30-35 (erken doruk - duygusal an)
 * - Comment: %50 (orta nokta - etkileşim)
 * - Outro: Son sahne (izleyenler için kapanış)
 */
export function determineHookPlacements(sceneCount: number): HookPlacement[] {
  const placements: HookPlacement[] = [];
  
  if (sceneCount < 5) {
    // Çok kısa hikayeler için yoğun hook'lar
    placements.push({ sceneIndex: 0, type: 'intro', position: 'after' });
    if (sceneCount >= 3) {
      placements.push({ sceneIndex: 1, type: 'subscribe', position: 'after' });
    }
    placements.push({ sceneIndex: sceneCount - 1, type: 'outro', position: 'after' });
    return placements;
  }
  
  // Intro hook: Sahne 1 veya 2 (%5-10)
  const introIndex = Math.max(0, Math.floor(sceneCount * 0.05));
  placements.push({ sceneIndex: introIndex, type: 'intro', position: 'after' });
  
  // Subscribe hook: %15-20 noktası (ERKEN!)
  const subscribeIndex = Math.max(introIndex + 1, Math.floor(sceneCount * 0.15));
  placements.push({ sceneIndex: subscribeIndex, type: 'subscribe', position: 'after' });
  
  // Like hook: %30-35 noktası (erken doruk)
  const likeIndex = Math.max(subscribeIndex + 1, Math.floor(sceneCount * 0.30));
  placements.push({ sceneIndex: likeIndex, type: 'like', position: 'after' });
  
  // Comment hook: %50 noktası (orta)
  const commentIndex = Math.max(likeIndex + 1, Math.floor(sceneCount * 0.50));
  if (commentIndex < sceneCount - 1) {
    placements.push({ sceneIndex: commentIndex, type: 'comment', position: 'after' });
  }
  
  // Outro hook: Son sahne
  placements.push({ sceneIndex: sceneCount - 1, type: 'outro', position: 'after' });
  
  return placements;
}

/**
 * Tek bir hook metni üret
 * LLM her zaman sahneye özel hook üretir, başarısız olursa null döner
 */
async function generateSingleHookText(options: GenerateHookTextOptions): Promise<string | null> {
  const { hookType, storyContext, sceneContext, targetLanguage, model, provider } = options;
  
  const targetLangName = LANGUAGE_NAMES[targetLanguage] || 'English';
  const hookInfo = HOOK_DESCRIPTIONS[hookType];
  
  const systemPrompt = `You are a successful YouTube content creator. You write PERSUASIVE hook texts that motivate viewers to take action.

CRITICAL INSTRUCTION: Write ONLY in ${targetLangName}. The entire hook text must be in ${targetLangName}.

YOUR STRENGTHS:
- You speak directly and sincerely, not indirectly
- You create emotional connection with viewers
- You make clear calls but not spammy, sincere
- Native ${targetLangName} speaker tone

HOOK STYLE: ${hookInfo.style}

Maximum ${hookInfo.maxWords} words. Output ONLY the hook text in ${targetLangName}, nothing else.`;

  const userPrompt = `STORY CONTEXT:
${storyContext.substring(0, 800)}

CURRENT SCENE:
${sceneContext}

TASK: Write a ${hookType.toUpperCase()} hook
PURPOSE: ${hookInfo.purpose}

IMPORTANT: Write the hook in ${targetLangName} language ONLY.
Write a PERSUASIVE and SINCERE hook appropriate for this scene.
Output ONLY the hook text, no explanations.`;

  try {
    const response = await createCompletion({
      provider: provider || 'openai',
      model,
      systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
      temperature: 0.7,
      maxTokens: 200,
      responseFormat: 'text'
    });
    
    // Temizle: tırnak ve gereksiz karakterleri kaldır
    let cleanedResponse = response.trim().replace(/^["']|["']$/g, '');
    // Başındaki ve sonundaki fazla boşlukları temizle
    cleanedResponse = cleanedResponse.replace(/^\s+|\s+$/g, '');
    
    // Boş yanıt kontrolü
    if (!cleanedResponse || cleanedResponse.length < 10) {
      logger.warn('Hook metni çok kısa veya boş, atlanıyor', { hookType });
      return null;
    }
    
    return cleanedResponse;
  } catch (error) {
    logger.error('Hook metni üretilemedi, hook atlanacak', {
      hookType,
      error: error instanceof Error ? error.message : 'Bilinmeyen hata'
    });
    // Fallback kullanmıyoruz - LLM başarısız olursa hook eklenmeyecek
    return null;
  }
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
      sceneContext: scene.text.substring(0, 500), // Daha fazla bağlam ver
      targetLanguage,
      model,
      provider
    });
    
    // LLM başarısız olduysa veya boş döndüyse, bu hook'u atla
    if (!hookText) {
      logger.warn(`Hook üretilemedi, atlanıyor`, { 
        sceneIndex: placement.sceneIndex, 
        hookType: placement.type 
      });
      return null;
    }
    
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
