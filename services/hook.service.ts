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

// Hook açıklamaları - Daha doğal ve hikaye odaklı
const HOOK_DESCRIPTIONS: Record<HookType, { purpose: string; maxWords: number; transition: string }> = {
  intro: {
    purpose: 'Merak uyandır ve izleyiciyi hikayeye çek. Doğrudan "abone ol" DEME. Hikayenin gizemini vurgula.',
    maxWords: 35,
    transition: 'Hikayeye yumuşak giriş yap, sanki sır paylaşıyormuşsun gibi'
  },
  subscribe: {
    purpose: 'Hikaye akışında doğal bir mola ver ve dolaylı yoldan kanala değin. "Bu noktada bir an duralım" gibi geçiş cümleleri kullan.',
    maxWords: 40,
    transition: 'Önce hikayeyle ilgili bir yorum yap, sonra dolaylı olarak kanaldan bahset'
  },
  like: {
    purpose: 'Sahnenin duygusal etkisini pekiştir. Doğrudan "beğen" DEME. İzleyicinin hissettiklerini yansıt ve paylaşmaya davet et.',
    maxWords: 35,
    transition: 'Duygusal bir bağ kur, "bu an..." veya "şimdi hissettikleriniz..." gibi başla'
  },
  comment: {
    purpose: 'İzleyiciyi düşünmeye davet et. Hikayedeki karakterin kararıyla ilgili düşündürücü bir soru sor.',
    maxWords: 40,
    transition: 'Hikayedeki durumu izleyiciye bağla, "siz olsaydınız..." veya "düşünsenize..." gibi'
  },
  outro: {
    purpose: 'Hikayeyi duygusal bir kapanışla bitir. Teşekkür et ve gelecek hikayelere köprü kur. Doğrudan komut verme.',
    maxWords: 45,
    transition: 'Önce hikayeyi özetle veya son bir düşünce paylaş, sonra vedalaş'
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
  
  const systemPrompt = `Sen profesyonel bir hikaye anlatıcısısın. YouTube videoları için DOĞAL ve AKICİ hook metinleri yazıyorsun.

ÖNEMLİ KURALLAR:
1. Hiçbir zaman doğrudan "abone ol", "beğen", "yorum yap" gibi komutlar KULLANMA
2. Hook, hikayenin bir parçası gibi akmalı - izleyici bunun bir çağrı olduğunu hissetmemeli
3. ${langInstruction}
4. Geçiş cümlesi kullan: ${hookInfo.transition}
5. Maksimum ${hookInfo.maxWords} kelime

ÖRNEK YAKLAŞIMLAR:
- Intro: "Şimdi anlatacaklarım... hayatınıza farklı bakmanızı sağlayabilir."
- Subscribe: "Bu noktada bir an duralım... Bu tür hikayeler ruhunuza iyi geliyorsa, burada daha nicesi var."
- Like: "Az önce yaşananlar... içinizi bir şekilde etkilediyse, o duyguyu benimle paylaşabilirsiniz."
- Comment: "Şimdi düşünün... siz onun yerinde olsaydınız, hangi kapıyı seçerdiniz?"
- Outro: "Hikayemiz burada son buluyor ama... bu kanalda keşfedilmeyi bekleyen daha nice hayatlar var."`;

  const userPrompt = `HİKAYE BAĞLAMI:
${storyContext.substring(0, 1000)}

SAHNE İÇERİĞİ:
${sceneContext}

GÖREV: ${hookType.toUpperCase()} hook'u yaz
AMAÇ: ${hookInfo.purpose}

Bu sahnenin duygusal tonuna ve hikayenin akışına uygun, DOĞAL bir hook metni yaz.
Metni direkt yaz, tırnak işareti veya açıklama ekleme.`;

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
    return cleanedResponse;
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
 * Yedek hook metinleri - Daha doğal ve hikaye odaklı
 */
function getFallbackHookText(hookType: HookType, language: string): string {
  const fallbacks: Record<string, Record<HookType, string>> = {
    tr: {
      intro: 'Şimdi anlatacaklarım belki de hayata bakışınızı değiştirecek... Her şey o gün başladı.',
      subscribe: 'Bu noktada bir an duralım... Bu tür gerçek hikayeler ruhunuza dokunuyorsa, burada keşfedilmeyi bekleyen daha nicesi var.',
      like: 'Az önce yaşananlar... eğer içinizde bir şeyler kıpırdattıysa, o duyguyu benimle paylaşabilirsiniz.',
      comment: 'Şimdi bir düşünün... siz onun yerinde olsaydınız, aynı kararı verir miydiniz? Merak ediyorum.',
      outro: 'Hikayemiz burada son buluyor... Ama bu kanalda anlatılmayı bekleyen daha nice hayatlar, daha nice kaderler var. Bir sonraki hikayede buluşmak dileğiyle.'
    },
    en: {
      intro: 'What I am about to tell you might change how you see life... It all started on that day.',
      subscribe: 'Let me pause here for a moment... If stories like this speak to your soul, there are many more waiting to be discovered here.',
      like: 'What just happened... if it stirred something inside you, feel free to share that feeling with me.',
      comment: 'Now think about it... if you were in their place, would you have made the same choice? I am curious to know.',
      outro: 'Our story ends here... But on this channel, there are many more lives, many more destinies waiting to be told. Until we meet in the next story.'
    },
    fr: {
      intro: 'Ce que je vais vous raconter pourrait changer votre façon de voir la vie... Tout a commencé ce jour-là.',
      subscribe: 'Arrêtons-nous un instant ici... Si ce genre d\'histoires touche votre âme, il y en a bien d\'autres qui attendent d\'être découvertes.',
      like: 'Ce qui vient de se passer... si cela a éveillé quelque chose en vous, n\'hésitez pas à partager cette émotion avec moi.',
      comment: 'Maintenant réfléchissez... si vous étiez à sa place, auriez-vous fait le même choix? Je suis curieux de savoir.',
      outro: 'Notre histoire se termine ici... Mais sur cette chaîne, il y a encore tant de vies, tant de destins qui attendent d\'être racontés. À la prochaine histoire.'
    },
    de: {
      intro: 'Was ich Ihnen gleich erzählen werde, könnte Ihre Sicht auf das Leben verändern... Alles begann an jenem Tag.',
      subscribe: 'Lassen Sie mich hier kurz innehalten... Wenn solche Geschichten Ihre Seele berühren, warten hier noch viele weitere darauf, entdeckt zu werden.',
      like: 'Was gerade passiert ist... wenn es etwas in Ihnen bewegt hat, teilen Sie dieses Gefühl gerne mit mir.',
      comment: 'Denken Sie jetzt darüber nach... Hätten Sie an ihrer Stelle die gleiche Entscheidung getroffen? Ich bin gespannt.',
      outro: 'Unsere Geschichte endet hier... Aber auf diesem Kanal warten noch viele weitere Leben, viele weitere Schicksale darauf, erzählt zu werden. Bis zur nächsten Geschichte.'
    },
    es: {
      intro: 'Lo que estoy a punto de contarles podría cambiar su forma de ver la vida... Todo comenzó ese día.',
      subscribe: 'Hagamos una pausa aquí... Si este tipo de historias tocan su alma, hay muchas más esperando ser descubiertas.',
      like: 'Lo que acaba de pasar... si despertó algo en ustedes, no duden en compartir esa emoción conmigo.',
      comment: 'Ahora piénsenlo... si estuvieran en su lugar, ¿habrían tomado la misma decisión? Tengo curiosidad por saber.',
      outro: 'Nuestra historia termina aquí... Pero en este canal hay muchas más vidas, muchos más destinos esperando ser contados. Hasta la próxima historia.'
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
