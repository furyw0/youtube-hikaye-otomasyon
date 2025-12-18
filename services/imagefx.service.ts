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
function sanitizePrompt(prompt: string, aggressiveMode: boolean = false): string {
  let sanitized = prompt;
  
  // ===== AŞAMA 1: TÜM İSİMLERİ TEMİZLE =====
  // Yaygın isim kalıpları (tüm dillerde)
  const commonNames = [
    // İspanyolca
    'Santiago', 'Carlos', 'Miguel', 'José', 'Juan', 'María', 'Ana', 'Carmen', 'Luis', 'Pedro',
    'Roberto', 'Fernando', 'Diego', 'Antonio', 'Manuel', 'Francisco', 'David', 'Daniel', 'Pablo',
    'Alejandro', 'Isabella', 'Sofia', 'Elena', 'Clara', 'Rosa', 'Teresa', 'Lucia', 'Marta',
    // İngilizce
    'John', 'Michael', 'William', 'James', 'Robert', 'David', 'Thomas', 'Sarah', 'Emma', 'Emily',
    'Jessica', 'Jennifer', 'Ashley', 'Amanda', 'Stephanie', 'Nicole', 'Elizabeth', 'Michelle',
    // Almanca
    'Hans', 'Klaus', 'Peter', 'Stefan', 'Thomas', 'Anna', 'Maria', 'Lisa', 'Julia', 'Laura',
    // Fransızca
    'Pierre', 'Jean', 'Louis', 'Marie', 'Sophie', 'Claire', 'Julie', 'Camille',
    // Türkçe
    'Ahmet', 'Mehmet', 'Ali', 'Mustafa', 'Ayşe', 'Fatma', 'Zeynep', 'Elif', 'Hasan', 'Hüseyin'
  ];
  
  // Tüm isimleri "the person" ile değiştir
  for (const name of commonNames) {
    const nameRegex = new RegExp(`\\b${name}\\b`, 'gi');
    sanitized = sanitized.replace(nameRegex, 'the person');
  }
  
  // ===== AŞAMA 2: YAŞ + CİNSİYET KALIPLARINI TEMİZLE =====
  // "35-year-old man" -> "adult man"
  sanitized = sanitized.replace(/\d+[\s-]*(year[\s-]*old|yaşında|jährige[rn]?|años?|ans?)\s*/gi, 'adult ');
  
  // ===== AŞAMA 3: İSİM + SOYAD KALIPLARINI TEMİZLE =====
  // İki ardışık büyük harfli kelime (isim + soyad)
  sanitized = sanitized.replace(/\b[A-Z][a-z]+\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?\b/g, 'a person');
  
  // ===== AŞAMA 4: "named X" KALIPLARINI TEMİZLE =====
  sanitized = sanitized.replace(/(named|called|known as|nicknamed)\s+[A-Za-z]+/gi, '');
  
  // ===== AŞAMA 5: AGRESİF MOD (Tüm insan referanslarını kaldır) =====
  if (aggressiveMode) {
    // Tüm insan referanslarını atmosfer/manzara ile değiştir
    sanitized = sanitized.replace(/\b(person|man|woman|boy|girl|child|people|human|face|portrait|figure)\b/gi, 'scene');
    sanitized = sanitized.replace(/\b(his|her|him|their|they|he|she)\b/gi, 'the');
    
    // Prompt'u tamamen manzara odaklı yap
    sanitized = `Cinematic landscape photograph, dramatic lighting, atmospheric mood. ${sanitized}. No people, no faces, no figures. Pure environmental storytelling.`;
  } else {
    // ===== AŞAMA 6: FOTOREALİSTİK STİL =====
    // NOT: Artık suffix eklenmyor çünkü kullanıcının visual style suffix'i kullanılıyor
    // Sadece "Avoid:" veya negatif ifadeler yoksa ekliyoruz
    
    if (!sanitized.toLowerCase().includes('avoid:') && !sanitized.toLowerCase().includes('not cartoon')) {
      const antiCartoonSuffix = '. NOT cartoon, NOT anime, NOT illustration, NOT 3D render.';
      sanitized += antiCartoonSuffix;
    }
    
    // Zaten fotorealistik terimler varsa ekleme yapma
    if (!sanitized.toLowerCase().includes('photograph') && !sanitized.toLowerCase().includes('photo')) {
      sanitized = 'Photograph, ' + sanitized;
    }
  }

  // Fazla boşlukları temizle
  sanitized = sanitized.replace(/\s+/g, ' ').trim();
  
  // "the person the person" gibi tekrarları temizle
  sanitized = sanitized.replace(/(the person\s*)+/g, 'a person ');
  sanitized = sanitized.replace(/(a person\s*)+/g, 'a person ');
  
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
 * PROMINENT_PEOPLE_FILTER_FAILED hatası alınırsa agresif mod ile tekrar dener
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

  // Google Cookie al (önce parametre, sonra Settings, sonra env)
  const googleCookie = cookie || await getImageFXCookie();

  // ImageFX kütüphanesini yükle
  const { ImageFX, Prompt } = await import('@rohitaryal/imagefx-api');
  const client = new ImageFX(googleCookie);

  // İki aşamalı deneme: Normal -> Agresif
  const attempts = [
    { aggressiveMode: false, label: 'normal' },
    { aggressiveMode: true, label: 'agresif (insan referansları kaldırıldı)' }
  ];

  for (const attempt of attempts) {
    try {
      // Prompt'u sanitize et
      const sanitizedPrompt = sanitizePrompt(prompt, attempt.aggressiveMode);
      
      logger.debug(`Prompt sanitize edildi (${attempt.label})`, {
        originalLength: prompt.length,
        sanitizedLength: sanitizedPrompt.length,
        aggressiveMode: attempt.aggressiveMode,
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

      logger.debug('ImageFX çağrısı yapılıyor', { 
        promptPreview: sanitizedPrompt.substring(0, 100), 
        mode: attempt.label,
        model, 
        aspectRatio 
      });

      // Retry ile görsel üret
      const images = await retryImageFX(
        async () => await client.generateImage(imagefxPrompt, 2),
        `Görsel üretimi (${attempt.label}): ${prompt.substring(0, 50)}...`
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
        mode: attempt.label,
        promptPreview: sanitizedPrompt.substring(0, 100)
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
      const errorMessage = error instanceof Error ? error.message : 'Bilinmeyen hata';
      
      // PROMINENT_PEOPLE_FILTER hatası mı?
      const isProminentPeopleError = errorMessage.includes('PROMINENT_PEOPLE_FILTER');
      
      logger.warn(`Görsel üretimi başarısız (${attempt.label})`, {
        error: errorMessage,
        isProminentPeopleError,
        willRetryWithAggressive: isProminentPeopleError && !attempt.aggressiveMode,
        model,
        aspectRatio
      });

      // Eğer normal mod ve PROMINENT_PEOPLE hatası ise, agresif mod denenecek
      if (isProminentPeopleError && !attempt.aggressiveMode) {
        logger.info('Agresif mod ile tekrar denenecek (insan referansları kaldırılacak)');
        continue; // Sonraki attempt'e geç (agresif mod)
      }

      // Cookie hatası - hemen fırlat
      if (errorMessage.includes('cookie') || errorMessage.includes('401')) {
        throw new ImageFXError(
          `Google Cookie geçersiz veya süresi dolmuş: ${errorMessage}`
        );
      }

      // Rate limit hatası - hemen fırlat
      if (errorMessage.includes('rate limit') || errorMessage.includes('quota') || errorMessage.includes('429')) {
        throw new ImageFXError(
          `ImageFX rate limit aşıldı, lütfen bekleyin: ${errorMessage}`
        );
      }

      // Agresif mod da başarısız olduysa veya farklı bir hata ise fırlat
      if (attempt.aggressiveMode) {
        throw new ImageFXError(
          `Görsel üretimi başarısız (agresif mod dahil): ${errorMessage}`
        );
      }
    }
  }

  // Hiçbir attempt başarılı olmadı
  throw new ImageFXError('Görsel üretimi tüm denemelerde başarısız oldu');
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

