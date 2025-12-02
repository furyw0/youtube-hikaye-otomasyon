/**
 * ImageFX Servisi
 * Google ImageFX ile görsel üretimi
 * Kütüphane: @rohitaryal/imagefx-api
 */

import logger from '@/lib/logger';
import { ImageFXError } from '@/lib/errors';
import { retryImageFX } from './retry.service';
import { IMAGEFX_SETTINGS } from '@/lib/constants';

// ImageFX kütüphanesi (dinamik import - sadece gerektiğinde yükle)
let ImageFX: any = null;

async function getImageFXClient() {
  if (!ImageFX) {
    const module = await import('@rohitaryal/imagefx-api');
    ImageFX = module.default || module;
  }
  return ImageFX;
}

export interface GenerateImageOptions {
  prompt: string;
  model?: 'IMAGEN_4' | 'IMAGEN_3_5';
  aspectRatio?: 'SQUARE' | 'LANDSCAPE' | 'PORTRAIT';
  seed?: number;
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
function getAspectRatioValue(ratio: string): string {
  const mapping: Record<string, string> = {
    'SQUARE': 'IMAGE_ASPECT_RATIO_SQUARE',
    'LANDSCAPE': 'IMAGE_ASPECT_RATIO_LANDSCAPE',
    'PORTRAIT': 'IMAGE_ASPECT_RATIO_PORTRAIT'
  };
  return mapping[ratio] || mapping['LANDSCAPE'];
}

/**
 * Model değerini ImageFX formatına çevirir
 */
function getModelValue(model: string): string {
  const mapping: Record<string, string> = {
    'IMAGEN_4': 'IMAGEN_4',
    'IMAGEN_3_5': 'IMAGEN_3_5'
  };
  return mapping[model] || 'IMAGEN_4';
}

/**
 * Tek bir görsel üretir
 */
export async function generateImage(options: GenerateImageOptions): Promise<GeneratedImage> {
  const {
    prompt,
    model = 'IMAGEN_4',
    aspectRatio = 'LANDSCAPE',
    seed
  } = options;

  logger.info('Görsel üretimi başlatılıyor', {
    model,
    aspectRatio,
    seed,
    promptLength: prompt.length
  });

  try {
    // Google Cookie kontrolü
    const googleCookie = process.env.GOOGLE_COOKIE;
    if (!googleCookie) {
      throw new ImageFXError('GOOGLE_COOKIE ortam değişkeni tanımlanmamış');
    }

    // ImageFX istemcisini al
    const ImageFXClient = await getImageFXClient();
    const client = new ImageFXClient(googleCookie);

    // Parametreleri hazırla
    const imagefxParams = {
      prompt,
      model: getModelValue(model),
      aspectRatio: getAspectRatioValue(aspectRatio),
      numberOfImages: IMAGEFX_SETTINGS.NUMBER_OF_IMAGES,
      ...(seed && { seed })
    };

    logger.debug('ImageFX çağrısı yapılıyor', imagefxParams);

    // Retry ile görsel üret
    const result = await retryImageFX(
      async () => await client.generateImages(imagefxParams),
      `Görsel üretimi: ${prompt.substring(0, 50)}...`
    );

    // Sonucu kontrol et
    if (!result || !result.images || result.images.length === 0) {
      throw new ImageFXError('ImageFX yanıtında görsel bulunamadı', { result });
    }

    const firstImage = result.images[0];

    // Buffer'a çevir
    let imageBuffer: Buffer;
    if (Buffer.isBuffer(firstImage.buffer)) {
      imageBuffer = firstImage.buffer;
    } else if (firstImage.buffer instanceof ArrayBuffer) {
      imageBuffer = Buffer.from(firstImage.buffer);
    } else if (typeof firstImage.buffer === 'string') {
      // Base64 string olabilir
      imageBuffer = Buffer.from(firstImage.buffer, 'base64');
    } else {
      throw new ImageFXError('Görsel buffer formatı tanınamadı', {
        bufferType: typeof firstImage.buffer
      });
    }

    logger.info('Görsel başarıyla üretildi', {
      model,
      aspectRatio,
      seed: firstImage.seed || seed,
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
          'Google Cookie geçersiz veya süresi dolmuş',
          { originalError: error.message }
        );
      }
      if (error.message.includes('rate limit') || error.message.includes('quota')) {
        throw new ImageFXError(
          'ImageFX rate limit aşıldı, lütfen bekleyin',
          { originalError: error.message }
        );
      }
    }

    throw new ImageFXError(
      `Görsel üretimi başarısız: ${error instanceof Error ? error.message : 'Bilinmeyen hata'}`,
      { prompt: prompt.substring(0, 200) }
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
    throw new ImageFXError('Hiçbir görsel üretilemedi', { errors });
  }

  return results;
}

/**
 * ImageFX sağlık kontrolü
 */
export async function healthCheck(): Promise<boolean> {
  try {
    const googleCookie = process.env.GOOGLE_COOKIE;
    if (!googleCookie) {
      logger.error('GOOGLE_COOKIE tanımlanmamış');
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

