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

// Hook açıklamaları - İkna edici ve etkili
const HOOK_DESCRIPTIONS: Record<HookType, { purpose: string; maxWords: number; style: string }> = {
  intro: {
    purpose: 'İzleyicinin dikkatini yakala ve merak uyandır. Hikayenin en çarpıcı anına ipucu ver. "Sonunda olanlar sizi şoke edecek" gibi güçlü ifadeler kullan.',
    maxWords: 30,
    style: 'Gizemli ve çekici. İzleyici "ne olacak?" diye merak etmeli.'
  },
  subscribe: {
    purpose: 'Kanalın değerini vurgula. "Bu tür içerikler için abone olun" şeklinde net ve samimi bir çağrı yap. Bildirimleri açmalarını iste.',
    maxWords: 35,
    style: 'Samimi ama net. İzleyiciye kanalın ona ne katacağını söyle.'
  },
  like: {
    purpose: 'Duygusal doruk noktasında beğeni iste. "Bu an sizi de etkilediyse beğenin" gibi direkt ama içten bir çağrı.',
    maxWords: 25,
    style: 'Duygusal ve içten. Az önce yaşanan anın etkisini kullan.'
  },
  comment: {
    purpose: 'İzleyiciyi tartışmaya davet et. Güçlü ve düşündürücü bir soru sor. "Yorumlarda buluşalım" de.',
    maxWords: 30,
    style: 'Merak uyandırıcı soru. İzleyici cevap vermek istemeli.'
  },
  outro: {
    purpose: 'Güçlü bir kapanış. Abone ol + bildirim çanı + teşekkür. Bir sonraki video için beklenti oluştur.',
    maxWords: 40,
    style: 'Sıcak vedalaşma ve net çağrı. "Abone olun, bildirimleri açın" de.'
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
  
  const langInstruction = LANGUAGE_INSTRUCTIONS[targetLanguage] || LANGUAGE_INSTRUCTIONS['en'];
  const hookInfo = HOOK_DESCRIPTIONS[hookType];
  
  const systemPrompt = `Sen başarılı bir YouTube içerik üreticisisin. İzleyicileri harekete geçiren, İKNA EDİCİ hook metinleri yazıyorsun.

SENİN GÜCÜN:
- Doğrudan ve samimi konuşursun, dolaylı değil
- İzleyiciyle duygusal bağ kurarsın
- Net çağrılar yaparsın ama spam gibi değil, içten
- ${langInstruction}

HOOK STİLİ: ${hookInfo.style}

ÖRNEK ETKİLİ HOOK'LAR:
- Intro: "Bu hikayenin sonunda gözleriniz dolacak... Hazır mısınız?"
- Subscribe: "Bu tür gerçek hikayeler ilginizi çekiyorsa, abone olun ve bildirimleri açın. Haftada 3 yeni hikaye paylaşıyorum."
- Like: "Bu sahne içinizi sızlattıysa, bir beğeni bırakın. Bu hikayeyi daha fazla kişiye ulaştırmama yardımcı olur."
- Comment: "Siz olsaydınız ne yapardınız? Yorumlarda tartışalım, merak ediyorum."
- Outro: "Hikaye burada bitiyor ama kanal bitmiyor. Abone olun, bir sonraki hikayede görüşelim."

Maksimum ${hookInfo.maxWords} kelime.`;

  const userPrompt = `HİKAYE:
${storyContext.substring(0, 800)}

BU SAHNE:
${sceneContext}

GÖREV: ${hookType.toUpperCase()} hook'u yaz
AMAÇ: ${hookInfo.purpose}

Bu sahneye uygun, İKNA EDİCİ ve SAMİMİ bir hook yaz.
SADECE hook metnini yaz, başka açıklama ekleme.`;

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
