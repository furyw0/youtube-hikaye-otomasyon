/**
 * YouTube Metadata Servisi
 * Adapte edilmiş hikaye için YouTube açıklaması ve kapak yazısı oluşturur
 */

import logger from '@/lib/logger';
import { OpenAIError } from '@/lib/errors';
import { retryOpenAI } from './retry.service';
import { createCompletion, parseJSONResponse } from './llm-router.service';
import type { LLMProvider } from './llm-router.service';

interface PromptScenario {
  youtubeDescriptionSystemPrompt?: string;
  youtubeDescriptionUserPrompt?: string;
  coverTextSystemPrompt?: string;
  coverTextUserPrompt?: string;
}

interface MetadataOptions {
  adaptedTitle: string;
  adaptedContent: string;
  originalDescription?: string;
  originalCoverText?: string;
  targetLanguage: string;
  targetCountry: string;
  model: string;
  provider: LLMProvider;
  adaptationNotes: string[];  // İsim/yer değişiklikleri
  promptScenario?: PromptScenario | null;
}

interface MetadataResult {
  youtubeDescription: string;
  coverText: string;
}

interface VisualStyleInfo {
  name: string;
  description?: string;
  systemPrompt?: string;
  technicalPrefix?: string;
  styleSuffix?: string;
}

interface ThumbnailPromptOptions {
  adaptedTitle: string;
  adaptedContent: string;
  coverText: string;
  targetLanguage: string;
  model: string;
  provider: LLMProvider;
  visualStyle?: VisualStyleInfo | null;
}

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
 * Varsayılan YouTube açıklaması promptları
 */
const DEFAULT_YOUTUBE_DESCRIPTION_SYSTEM_PROMPT = `Sen YouTube video açıklaması uzmanısın. Adapte edilmiş hikaye için SEO uyumlu, ilgi çekici YouTube açıklaması yazıyorsun.

🎯 GÖREV: Adapte edilmiş hikaye için kapsamlı YouTube açıklaması yaz.

📏 AÇIKLAMA YAPISI:
1. Çekici giriş (2-3 cümle) - Hikayenin özeti ve merak uyandırıcı
2. Hikaye hakkında (4-5 cümle) - Ana tema, karakterler, önemli olaylar
3. Neden izlemeli? (2-3 cümle) - İzleyiciye vaat
4. Hashtag'ler (5-10 adet) - #HikayeAnlatımı #{{TARGET_COUNTRY}} vb.

⛔ YASAK:
- ❌ Orijinal isim/yer bilgilerini kullanma
- ❌ Clickbait veya yanıltıcı ifadeler
- ❌ "Orijinal" veya "uyarlandı" gibi ifadeler
- ❌ Telif hakkı veya kaynak bilgisi

✅ ZORUNLU:
- ✅ Adapte edilmiş isim ve yer bilgilerini kullan
- ✅ {{TARGET_LANGUAGE}} dilinde doğal ifadeler
- ✅ SEO dostu anahtar kelimeler
- ✅ Emoji kullanımı (ölçülü)
- ✅ 200-500 kelime arası

{{ADAPTATION_CHANGES}}
{{ORIGINAL_REF}}

Hedef: {{TARGET_COUNTRY}} / {{TARGET_LANGUAGE}}`;

const DEFAULT_YOUTUBE_DESCRIPTION_USER_PROMPT = `Başlık: "{{TITLE}}"

Bu hikaye için YouTube açıklaması yaz.`;

/**
 * Varsayılan kapak yazısı promptları
 */
const DEFAULT_COVER_TEXT_SYSTEM_PROMPT = `Sen YouTube thumbnail (kapak görseli) metin uzmanısın. Dikkat çekici, tıklanabilir kapak yazıları oluşturuyorsun.

🎯 GÖREV: Adapte edilmiş hikaye için YÜKSEK TIKLANABİLİRLİK sağlayan kapak yazısı yaz.

📏 KURAL VE SINIRLAR:
- Maksimum 60-80 karakter
- Kısa, anlaşılır, şok edici
- Emoji kullanımı (1-2 adet, isteğe bağlı)
- {{TARGET_LANGUAGE}} dilinde doğal ifade

🔥 YÜKSEK TIKLANABİLİRLİK FORMÜLLERİ:
1. Soru formatı: "Gerçeği Öğrenince Neler Oldu?"
2. Tamamlanmamış: "Bu Adam 10 Yıl Sonra..."
3. Şok/Şaşkınlık: "Kimse Ona İnanmadı Ama..."
4. Merak: "Kapı Açıldığında İçeride..."
5. Zıtlık: "Fakir Adam, Zengin Oldu ve..."

⛔ YASAK:
- ❌ Orijinal isim/yer bilgileri
- ❌ Yanlış bilgi veya kandırmaca
- ❌ Çok uzun cümleler
- ❌ "Hikaye" kelimesini kullanma

✅ ZORUNLU:
- ✅ Adapte edilmiş isim/yerler
- ✅ Merak uyandırıcı
- ✅ Okuma kolaylığı
- ✅ BÜYÜK HARFLERLE başlayabilir

{{ADAPTATION_CHANGES}}
{{ORIGINAL_REF}}

Hedef: {{TARGET_COUNTRY}} / {{TARGET_LANGUAGE}}

Sadece kapak yazısını döndür, başka açıklama ekleme.`;

const DEFAULT_COVER_TEXT_USER_PROMPT = `Başlık: "{{TITLE}}"

Hikaye özeti: {{STORY_SUMMARY}}

Dikkat çekici kapak yazısı oluştur.`;

/**
 * YouTube açıklaması oluştur
 */
async function generateYouTubeDescription(
  options: MetadataOptions
): Promise<string> {
  const { 
    adaptedTitle, 
    adaptedContent, 
    originalDescription,
    targetLanguage, 
    targetCountry,
    model,
    provider,
    adaptationNotes,
    promptScenario
  } = options;

  const adaptationChanges = adaptationNotes.length > 0
    ? `\n\n🔄 ADAPTASYON DEĞİŞİKLİKLERİ (BUNLARI KULLAN):\n${adaptationNotes.slice(0, 10).map(n => `- ${n}`).join('\n')}`
    : '';

  const originalRef = originalDescription
    ? `\n\n📝 ORİJİNAL AÇIKLAMA (REFERANS):\n${originalDescription}\n\nBu açıklamayı referans alarak yeni açıklama oluştur. Değişen isim ve yer bilgilerini kullan.`
    : '';

  // Değişkenler
  const variables: Record<string, string> = {
    TARGET_COUNTRY: targetCountry,
    TARGET_LANGUAGE: targetLanguage,
    TITLE: adaptedTitle,
    ADAPTATION_CHANGES: adaptationChanges,
    ORIGINAL_REF: originalRef
  };

  // Prompt şablonlarını al
  const systemPromptTemplate = promptScenario?.youtubeDescriptionSystemPrompt || DEFAULT_YOUTUBE_DESCRIPTION_SYSTEM_PROMPT;
  const userPromptTemplate = promptScenario?.youtubeDescriptionUserPrompt || DEFAULT_YOUTUBE_DESCRIPTION_USER_PROMPT;

  const systemPrompt = fillPromptTemplate(systemPromptTemplate, variables);
  const userPrompt = fillPromptTemplate(userPromptTemplate, variables);

  const response = await retryOpenAI(
    () => createCompletion({
      provider,
      model,
      systemPrompt,
      cacheableContent: adaptedContent.substring(0, 10000), // İlk kısım context için
      cacheTTL: '1h',
      messages: [
        { 
          role: 'user', 
          content: userPrompt 
        }
      ],
      temperature: 0.6
    }),
    'YouTube açıklaması oluşturma'
  );

  return response.trim();
}

/**
 * Kapak yazısı oluştur (dikkat çekici, clickbait tarzı)
 */
async function generateCoverText(
  options: MetadataOptions
): Promise<string> {
  const { 
    adaptedTitle, 
    adaptedContent, 
    originalCoverText,
    targetLanguage, 
    targetCountry,
    model,
    provider,
    adaptationNotes,
    promptScenario
  } = options;

  const adaptationChanges = adaptationNotes.length > 0
    ? `\n\n🔄 ADAPTASYON DEĞİŞİKLİKLERİ:\n${adaptationNotes.slice(0, 10).map(n => `- ${n}`).join('\n')}`
    : '';

  const originalRef = originalCoverText
    ? `\n\n📝 ORİJİNAL KAPAK YAZISI (REFERANS):\n"${originalCoverText}"\n\nBu stili ve yaklaşımı referans al.`
    : '';

  // Değişkenler
  const variables: Record<string, string> = {
    TARGET_COUNTRY: targetCountry,
    TARGET_LANGUAGE: targetLanguage,
    TITLE: adaptedTitle,
    STORY_SUMMARY: adaptedContent.substring(0, 500) + '...',
    ADAPTATION_CHANGES: adaptationChanges,
    ORIGINAL_REF: originalRef
  };

  // Prompt şablonlarını al
  const systemPromptTemplate = promptScenario?.coverTextSystemPrompt || DEFAULT_COVER_TEXT_SYSTEM_PROMPT;
  const userPromptTemplate = promptScenario?.coverTextUserPrompt || DEFAULT_COVER_TEXT_USER_PROMPT;

  const systemPrompt = fillPromptTemplate(systemPromptTemplate, variables);
  const userPrompt = fillPromptTemplate(userPromptTemplate, variables);

  const response = await retryOpenAI(
    () => createCompletion({
      provider,
      model,
      systemPrompt,
      cacheableContent: adaptedContent.substring(0, 5000), // Kısa context
      cacheTTL: '1h',
      messages: [
        { 
          role: 'user', 
          content: userPrompt
        }
      ],
      temperature: 0.8 // Daha yaratıcı
    }),
    'Kapak yazısı oluşturma'
  );

  // Temizle ve tırnak/gereksiz karakterleri kaldır
  let coverText = response.trim()
    .replace(/^["']|["']$/g, '') // Başta/sonda tırnak
    .replace(/\n.*/g, ''); // Sadece ilk satır

  // Uzunluk kontrolü
  if (coverText.length > 80) {
    logger.warn('Kapak yazısı çok uzun, kısaltılıyor', {
      original: coverText.length,
      text: coverText
    });
    coverText = coverText.substring(0, 77) + '...';
  }

  return coverText;
}

/**
 * YouTube thumbnail (kapak görseli) için İngilizce prompt oluştur
 */
export async function generateThumbnailPrompt(
  options: ThumbnailPromptOptions
): Promise<string> {
  const { 
    adaptedTitle, 
    adaptedContent, 
    coverText,
    targetLanguage,
    model,
    provider,
    visualStyle
  } = options;

  // Hikayeden önemli sahneleri çıkar
  const storySummary = adaptedContent.substring(0, 2000);

  // Görsel stili varsa prompt'a ekle
  const visualStyleSection = visualStyle ? `
🎨 VISUAL STYLE (MUST FOLLOW):
Style Name: ${visualStyle.name}
${visualStyle.description ? `Description: ${visualStyle.description}` : ''}
${visualStyle.systemPrompt ? `Style: ${visualStyle.systemPrompt}` : ''}
${visualStyle.technicalPrefix ? `Technical: ${visualStyle.technicalPrefix}` : ''}
${visualStyle.styleSuffix ? `Style Suffix (add at end): ${visualStyle.styleSuffix}` : ''}

⚠️ IMPORTANT: The thumbnail MUST match this visual style! Incorporate the style elements into the thumbnail design.
` : '';

  const defaultStyleSection = !visualStyle ? `
🎨 STYLE GUIDELINES:
- Cinematic composition with depth
- Dramatic lighting (golden hour, spotlights, silhouettes)
- Rich, saturated colors
- Professional photography or digital art style
- Clean, uncluttered composition
- 16:9 aspect ratio optimized
` : '';

  const systemPrompt = `You are a YouTube thumbnail image prompt expert. Create compelling, eye-catching thumbnail image prompts for AI image generation.

🎯 GOAL: Create a cinematic, dramatic thumbnail image that will make viewers want to click.

📸 THUMBNAIL REQUIREMENTS:
1. DRAMATIC focal point - one clear subject/scene
2. EMOTIONAL impact - convey the story's core emotion
3. MYSTERY/INTRIGUE - leave viewers curious
4. PROFESSIONAL quality - like a movie poster
5. VIBRANT colors and high contrast
6. NO TEXT in the image (text will be added separately)
${visualStyleSection}${defaultStyleSection}
⛔ AVOID:
- Multiple confusing elements
- Dark or muddy images
- Explicit violence or gore
- Text or logos in the image
- Generic stock photo look

📝 OUTPUT FORMAT:
Write a detailed English prompt for AI image generation (150-250 words). Include:
1. Main subject/character
2. Scene/setting description
3. Lighting and atmosphere
4. Camera angle and composition
5. Artistic style reference${visualStyle ? ' (MUST match the specified visual style!)' : ''}
6. Color palette

Only return the prompt, no explanations.`;

  const userPrompt = `Story Title: "${adaptedTitle}"
Cover Text: "${coverText}"
Story Language: ${targetLanguage}
${visualStyle ? `Visual Style: ${visualStyle.name}` : ''}

Story Summary:
${storySummary}

Create a dramatic, click-worthy YouTube thumbnail image prompt for this story${visualStyle ? ` in ${visualStyle.name} style` : ''}.`;

  const response = await retryOpenAI(
    () => createCompletion({
      provider,
      model,
      systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
      temperature: 0.7
    }),
    'Thumbnail prompt oluşturma'
  );

  logger.info('Thumbnail prompt oluşturuldu', {
    promptLength: response.length,
    visualStyle: visualStyle?.name || 'default'
  });

  return response.trim();
}

/**
 * YouTube metadata oluştur (açıklama + kapak yazısı)
 */
export async function generateYouTubeMetadata(
  options: MetadataOptions
): Promise<MetadataResult> {
  logger.info('YouTube metadata oluşturma başlatılıyor', {
    targetCountry: options.targetCountry,
    targetLanguage: options.targetLanguage,
    model: options.model,
    provider: options.provider,
    hasOriginalDescription: !!options.originalDescription,
    hasOriginalCoverText: !!options.originalCoverText,
    adaptationChanges: options.adaptationNotes.length
  });

  try {
    // Paralel olarak açıklama ve kapak yazısı oluştur
    const [youtubeDescription, coverText] = await Promise.all([
      generateYouTubeDescription(options),
      generateCoverText(options)
    ]);

    logger.info('YouTube metadata oluşturuldu', {
      descriptionLength: youtubeDescription.length,
      coverTextLength: coverText.length
    });

    return {
      youtubeDescription,
      coverText
    };

  } catch (error) {
    logger.error('YouTube metadata oluşturma hatası', {
      error: error instanceof Error ? error.message : 'Bilinmeyen hata',
      targetCountry: options.targetCountry
    });

    throw new OpenAIError(
      `YouTube metadata oluşturma başarısız: ${error instanceof Error ? error.message : 'Bilinmeyen hata'}`
    );
  }
}
