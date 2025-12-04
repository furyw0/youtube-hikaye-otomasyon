/**
 * ImageFX Servisi
 * Google ImageFX ile görsel üretimi
 * Kütüphane: @rohitaryal/imagefx-api
 */

import logger from '@/lib/logger';
import { ImageFXError } from '@/lib/errors';
import { retryImageFX } from './retry.service';
import { IMAGEFX_SETTINGS } from '@/lib/constants';
import dbConnect from '@/lib/mongodb';
import Settings from '@/models/Settings';

/**
 * Settings'den ImageFX Cookie'yi al
 */
async function getCookieFromSettings(): Promise<string | null> {
  try {
    await dbConnect();
    const settings = await Settings.findOne().select('+imagefxCookie');
    return settings?.imagefxCookie || null;
  } catch (error) {
    logger.warn('Settings\'den ImageFX cookie alınamadı', { error });
    return null;
  }
}

/**
 * ImageFX cookie'yi al (önce Settings, sonra env)
 */
async function getImageFXCookie(): Promise<string> {
  const settingsCookie = await getCookieFromSettings();
  const cookie = settingsCookie || process.env.GOOGLE_COOKIE;
  
  if (!cookie) {
    throw new ImageFXError('ImageFX Google Cookie tanımlanmamış. Lütfen Ayarlar sayfasından veya GOOGLE_COOKIE ortam değişkeninden girin.');
  }
  
  return cookie;
}

export interface GenerateImageOptions {
  prompt: string;
  model?: 'IMAGEN_4' | 'IMAGEN_3_5';
  aspectRatio?: 'SQUARE' | 'LANDSCAPE' | 'PORTRAIT';
  seed?: number;
  cookie?: string; // Opsiyonel: Settings'den gelen cookie
}

/**
 * Prompt'u sanitize eder - "Prominent People Filter" hatasını önlemek için
 * Google ImageFX gerçek/ünlü kişi promptlarını reddediyor
 * 
 * NOT: "Fictional", "artistic", "illustration" gibi kelimeler ÇİZGİ FİLM tarzını tetikleyebilir!
 * Bunun yerine fotorealistik terimleri güçlendiriyoruz.
 */
function sanitizePrompt(prompt: string): string {
  // İsim temizleme - gerçek kişi isimlerini jenerik tanımlarla değiştir
  const nameReplacements: [RegExp, string][] = [
    // Yaş + cinsiyet kalıpları - yaşı kaldır, sadece tanımı bırak
    [/(\d+)[\s-]*(year[\s-]*old|yaşında|jährige[rn]?|años?|ans?)\s+(man|woman|boy|girl|child|person|male|female|mann|frau|kind|niño|niña|homme|femme|enfant)/gi, 'a $3'],
    
    // İsimli kalıpları temizle - ismi tamamen kaldır
    [/\b[A-Z][a-z]+\s+(Morales|García|López|Martínez|González|Rodríguez|Hernández|Pérez|Sánchez|Ramírez|Torres|Flores|Rivera|Gómez|Díaz|Reyes|Cruz|Ortiz|Moreno|Jiménez)\b/gi, 'a person'],
    [/\b(Santiago|Carlos|Miguel|José|Juan|María|Ana|Carmen|Luis|Pedro|Roberto|Fernando|Diego|Antonio|Manuel|Francisco|David|Daniel|Pablo|Alejandro)\s+[A-Z][a-z]+/gi, 'a person'],
    
    // "person named X" kalıbı
    [/(person|man|woman|boy|girl|child)\s+(named|called|known as)\s+[A-Z][a-zA-Z]+(\s+[A-Z][a-zA-Z]+)?/gi, 'a $1'],
    
    // Tek başına isimler (cümle başında büyük harfle)
    [/\b(Santiago|Carlos|Miguel|José|Juan|María|Roberto|Fernando|Diego)\b/gi, 'the person'],
  ];

  let sanitized = prompt;
  
  for (const [pattern, replacement] of nameReplacements) {
    sanitized = sanitized.replace(pattern, replacement);
  }

  // ÇİZGİ FİLM ÖNLEME: Anti-cartoon direktifleri ekle
  const antiCartoonSuffix = '. Style: Ultra realistic photograph, NOT cartoon, NOT anime, NOT illustration, NOT 3D render, NOT CGI, NOT digital art. Real human skin texture, real lighting, DSLR camera quality, 85mm lens, shallow depth of field.';
  
  // Eğer prompt zaten "photorealistic" içeriyorsa, güçlendir
  if (sanitized.toLowerCase().includes('photorealistic')) {
    // "Photorealistic" kelimesini daha güçlü versiyonla değiştir
    sanitized = sanitized.replace(
      /photorealistic/gi, 
      'hyper-realistic photograph like taken with Sony A7R IV camera'
    );
  } else {
    // Başına ekle
    sanitized = 'Hyper-realistic photograph, real human, real environment, ' + sanitized;
  }

  // Sonuna anti-cartoon direktiflerini ekle
  sanitized += antiCartoonSuffix;

  return sanitized;
}

export interface GeneratedImage {
  imageBuffer: Buffer;
  seed: number;
  model: string;
  aspectRatio: string;
  prompt: string;
  generatedAt: Date;
}

/**
 * Aspect ratio değerini ImageFX formatına çevirir
 */
function getAspectRatioValue(ratio: string): 'IMAGE_ASPECT_RATIO_SQUARE' | 'IMAGE_ASPECT_RATIO_LANDSCAPE' | 'IMAGE_ASPECT_RATIO_PORTRAIT' {
  const mapping = {
    'SQUARE': 'IMAGE_ASPECT_RATIO_SQUARE' as const,
    'LANDSCAPE': 'IMAGE_ASPECT_RATIO_LANDSCAPE' as const,
    'PORTRAIT': 'IMAGE_ASPECT_RATIO_PORTRAIT' as const
  };
  return mapping[ratio as keyof typeof mapping] || mapping['LANDSCAPE'];
}

/**
 * Model değerini ImageFX formatına çevirir
 * Not: ImageFX API şu an sadece 'IMAGEN_3_5' destekliyor
 */
function getModelValue(): 'IMAGEN_3_5' {
  // ImageFX API şu an sadece IMAGEN_3_5 destekliyor
  return 'IMAGEN_3_5';
}

/**
 * Tek bir görsel üretir
 */
export async function generateImage(options: GenerateImageOptions): Promise<GeneratedImage> {
  const {
    prompt,
    model = 'IMAGEN_4',
    aspectRatio = 'LANDSCAPE',
    seed = 0,
    cookie
  } = options;

  logger.info('Görsel üretimi başlatılıyor', {
    model,
    aspectRatio,
    seed,
    promptLength: prompt.length
  });

  try {
    // Google Cookie al (önce parametre, sonra Settings, sonra env)
    const googleCookie = cookie || await getImageFXCookie();

    // ImageFX kütüphanesini yükle
    const { ImageFX, Prompt } = await import('@rohitaryal/imagefx-api');
    const client = new ImageFX(googleCookie);

    // Prompt'u sanitize et (Prominent People Filter önleme)
    const sanitizedPrompt = sanitizePrompt(prompt);
    
    logger.debug('Prompt sanitize edildi', {
      originalLength: prompt.length,
      sanitizedLength: sanitizedPrompt.length,
      preview: sanitizedPrompt.substring(0, 100)
    });

    // Prompt objesi oluştur
    const imagefxPrompt = new Prompt({
      prompt: sanitizedPrompt,
      generationModel: getModelValue(),
      aspectRatio: getAspectRatioValue(aspectRatio),
      numberOfImages: IMAGEFX_SETTINGS.NUMBER_OF_IMAGES,
      seed: seed || 0
    });

    logger.debug('ImageFX çağrısı yapılıyor', { prompt: sanitizedPrompt.substring(0, 100), model, aspectRatio });

    // Retry ile görsel üret - generateImage metodu kullanılıyor
    // Ref: https://github.com/rohitaryal/imageFX-api
    const images = await retryImageFX(
      async () => await client.generateImage(imagefxPrompt, 2),
      `Görsel üretimi: ${prompt.substring(0, 50)}...`
    );

    // Sonucu kontrol et
    if (!images || images.length === 0) {
      throw new ImageFXError('ImageFX yanıtında görsel bulunamadı');
    }

    const firstImage = images[0];

    // Image nesnesinden base64 encoded PNG al
    // encodedImage private olduğu için any cast gerekli
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const encodedImage = (firstImage as any).encodedImage;
    
    if (!encodedImage) {
      throw new ImageFXError('Görsel verisi alınamadı');
    }

    // Base64'ü Buffer'a çevir
    const imageBuffer = Buffer.from(encodedImage, 'base64');

    logger.info('Görsel başarıyla üretildi', {
      model,
      aspectRatio,
      seed: firstImage.seed,
      bufferSize: imageBuffer.length,
      promptPreview: prompt.substring(0, 100)
    });

    return {
      imageBuffer,
      seed: firstImage.seed || seed || 0,
      model,
      aspectRatio,
      prompt,
      generatedAt: new Date()
    };

  } catch (error) {
    logger.error('Görsel üretimi hatası', {
      error: error instanceof Error ? error.message : 'Bilinmeyen hata',
      model,
      aspectRatio,
      promptPreview: prompt.substring(0, 100)
    });

    // Hata tipine göre özel mesaj
    if (error instanceof Error) {
      if (error.message.includes('cookie')) {
        throw new ImageFXError(
          `Google Cookie geçersiz veya süresi dolmuş: ${error.message}`
        );
      }
      if (error.message.includes('rate limit') || error.message.includes('quota')) {
        throw new ImageFXError(
          `ImageFX rate limit aşıldı, lütfen bekleyin: ${error.message}`
        );
      }
    }

    throw new ImageFXError(
      `Görsel üretimi başarısız: ${error instanceof Error ? error.message : 'Bilinmeyen hata'}`
    );
  }
}

/**
 * Birden fazla görsel üretir (paralel)
 */
export async function generateImages(
  prompts: Array<{ sceneNumber: number; prompt: string }>,
  options: Omit<GenerateImageOptions, 'prompt'>
): Promise<Map<number, GeneratedImage>> {
  logger.info('Toplu görsel üretimi başlatılıyor', {
    totalPrompts: prompts.length,
    ...options
  });

  const results = new Map<number, GeneratedImage>();
  const errors: Array<{ sceneNumber: number; error: string }> = [];

  // Paralel üretim (ImageFX rate limit'e dikkat!)
  // Her seferinde 3 görsel üretelim
  const BATCH_SIZE = 3;
  const DELAY_BETWEEN_BATCHES_MS = 5000; // 5 saniye

  for (let i = 0; i < prompts.length; i += BATCH_SIZE) {
    const batch = prompts.slice(i, i + BATCH_SIZE);
    
    logger.debug(`Batch ${Math.floor(i / BATCH_SIZE) + 1} üretiliyor`, {
      scenes: batch.map(b => b.sceneNumber)
    });

    const batchPromises = batch.map(async ({ sceneNumber, prompt }) => {
      try {
        const image = await generateImage({
          prompt,
          ...options
        });
        results.set(sceneNumber, image);
        logger.debug(`Sahne ${sceneNumber} görseli tamamlandı`);
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Bilinmeyen hata';
        errors.push({ sceneNumber, error: errorMsg });
        logger.error(`Sahne ${sceneNumber} görseli başarısız`, { error: errorMsg });
      }
    });

    await Promise.all(batchPromises);

    // Batch'ler arası bekleme (son batch hariç)
    if (i + BATCH_SIZE < prompts.length) {
      logger.debug(`${DELAY_BETWEEN_BATCHES_MS}ms bekleniyor...`);
      await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_BATCHES_MS));
    }
  }

  logger.info('Toplu görsel üretimi tamamlandı', {
    successful: results.size,
    failed: errors.length,
    total: prompts.length
  });

  if (errors.length > 0) {
    logger.warn('Bazı görseller üretilemedi', { errors });
  }

  if (results.size === 0) {
    throw new ImageFXError(`Hiçbir görsel üretilemedi. Hatalar: ${JSON.stringify(errors)}`);
  }

  return results;
}

/**
 * ImageFX sağlık kontrolü
 */
export async function healthCheck(): Promise<boolean> {
  try {
    // Cookie kontrolü (Settings veya env'den)
    const googleCookie = await getImageFXCookie();
    if (!googleCookie) {
      logger.error('ImageFX cookie tanımlanmamış');
      return false;
    }

    // Basit bir test görsel üret
    const testPrompt = 'A simple test image, blue sky';
    const result = await generateImage({
      prompt: testPrompt,
      model: 'IMAGEN_3_5', // Daha hızlı model
      aspectRatio: 'SQUARE'
    });

    logger.info('ImageFX sağlık kontrolü başarılı', {
      bufferSize: result.imageBuffer.length
    });

    return true;

  } catch (error) {
    logger.error('ImageFX sağlık kontrolü başarısız', {
      error: error instanceof Error ? error.message : 'Bilinmeyen hata'
    });
    return false;
  }
}

