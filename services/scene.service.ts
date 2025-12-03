/**
 * Sahne Servisi
 * Hikayeyi sahnelere ayırır ve görsel promptlar oluşturur
 * İLK 3 DAKİKA STRATEJİSİ: 5 görsel + kalan 5 görsel = 10 toplam
 */

import logger from '@/lib/logger';
import { OpenAIError, SceneValidationError } from '@/lib/errors';
import { retryOpenAI } from './retry.service';
import { createChatCompletion, parseJSONResponse, estimateTokens } from './openai.service';
import { IMAGE_SETTINGS } from '@/lib/constants';

interface SceneData {
  sceneNumber: number;
  text: string;
  visualDescription?: string;
  estimatedDuration: number;
  hasImage: boolean;
  imageIndex?: number;
  isFirstThreeMinutes: boolean;
}

interface GenerateScenesOptions {
  originalContent: string;
  adaptedContent: string;
  model: string;
}

interface GenerateScenesResult {
  scenes: SceneData[];
  totalScenes: number;
  totalImages: number;
  firstThreeMinutesScenes: number;
  estimatedTotalDuration: number;
}

/**
 * AŞAMA 1: İlk 3 dakika için sahneler oluştur (5 görsel)
 */
async function generateFirstThreeMinutes(
  content: string,
  language: 'original' | 'adapted',
  model: string
): Promise<SceneData[]> {
  const systemPrompt = `Sen hikaye sahne uzmanısın. Hikayenin İLK 3 DAKİKASINI sahnelere ayırıyorsun.

HEDEF: İlk 3 dakika (180 saniye) için 5 sahne oluştur.

KURALLAR:
1. Her sahne MUTLAKA görsel içermeli (toplam 5 görsel)
2. Her sahne ~36 saniye seslendirme olmalı (5 × 36s = 180s)
3. İlk 3 dakika izleyiciyi ÇEKMELİ - en ilginç ve aksiyon dolu sahneler
4. Her sahne için AYRINTILI görsel betimleme yap
5. Görsel betimlemeler ImageFX için uygun olmalı (detaylı, sinematik)
6. Hikaye akışını bozma, içeriği koru

Her sahne için (JSON):
- sceneNumber: Sahne numarası (1-5)
- text: Sahne metni (~200-250 kelime, ~36 saniye ses için)
- visualDescription: DETAYLI görsel betimleme (karakterler, ortam, atmosfer, duygular, renkler)
- estimatedDuration: Tahmini süre (saniye)
- hasImage: true (her sahnede)
- imageIndex: Görsel sırası (1-5)
- isFirstThreeMinutes: true

JSON FORMAT:
{
  "scenes": [
    {
      "sceneNumber": 1,
      "text": "...",
      "visualDescription": "Çok detaylı görsel betimleme...",
      "estimatedDuration": 36,
      "hasImage": true,
      "imageIndex": 1,
      "isFirstThreeMinutes": true
    }
  ],
  "notes": "Neden bu sahneleri seçtim..."
}`;

  const response = await retryOpenAI(
    () => createChatCompletion({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { 
          role: 'user', 
          content: `Hikayenin başlangıcı (ilk ~2000 kelime):\n\n${content.substring(0, 15000)}`
        }
      ],
      temperature: 0.4,
      responseFormat: 'json_object'
    }),
    `İlk 3 dakika sahneleri (${language})`
  );

  const parsed = parseJSONResponse<{ scenes: SceneData[]; notes?: string }>(
    response,
    ['scenes']
  );

  // Validasyon
  if (!parsed.scenes || parsed.scenes.length !== 5) {
    throw new SceneValidationError(
      `İlk 3 dakika için 5 sahne bekleniyor, ${parsed.scenes?.length || 0} alındı`
    );
  }

  // Her sahnenin görsel içerdiğini kontrol et
  const imagesCount = parsed.scenes.filter(s => s.hasImage).length;
  if (imagesCount !== 5) {
    throw new SceneValidationError(
      `İlk 3 dakikada 5 görsel bekleniyor, ${imagesCount} bulundu`
    );
  }

  logger.info(`İlk 3 dakika sahneleri oluşturuldu (${language})`, {
    scenes: parsed.scenes.length,
    notes: parsed.notes
  });

  return parsed.scenes;
}

/**
 * AŞAMA 2: Kalan hikaye için sahneler oluştur (5 görsel daha)
 */
async function generateRemainingScenes(
  content: string,
  firstThreeMinutesEndPosition: number,
  language: 'original' | 'adapted',
  model: string
): Promise<SceneData[]> {
  const remainingContent = content.substring(firstThreeMinutesEndPosition);
  
  // Kalan içerik çok kısa ise minimum sahne sayısını ayarla
  const contentLength = remainingContent.length;
  const estimatedScenes = Math.max(5, Math.ceil(contentLength / 1200)); // ~1200 karakter/sahne, minimum 5
  const minScenes = Math.max(5, Math.min(estimatedScenes, 10)); // Minimum 5, maksimum 10 zorunlu
  
  const systemPrompt = `Sen hikaye sahne uzmanısın. Hikayenin KALAN KISMINI sahnelere ayırıyorsun.

HEDEF: Hikayenin kalan kısmını ${minScenes}-${estimatedScenes + 10} sahneye böl, 5 tanesine görsel ekle.

KURALLAR:
1. Her sahne 15-20 saniye seslendirme (~150-200 kelime)
2. Minimum ${minScenes} sahne oluştur (içerik kısa ise daha az olabilir)
3. Bu sahnelerden tam 5 tanesine görsel ekle
4. Görselli sahneleri EŞIT ARALIKLARLA dağıt
5. Görselli sahneler için DETAYLI görsel betimleme yap
6. Hikaye akışını koru, hiçbir şeyi atlama
7. Her sahne akıcı ve tutarlı olmalı
8. İçerik kısa ise daha az sahne oluşturabilirsin

Her sahne için (JSON):
- sceneNumber: Sahne numarası (6'dan başla)
- text: Sahne metni
- visualDescription: Görsel betimleme (sadece görselli sahnelerde)
- estimatedDuration: Tahmini süre (15-20 saniye)
- hasImage: true/false
- imageIndex: Görsel sırası (6-10 arası, sadece görselli sahnelerde)
- isFirstThreeMinutes: false

JSON FORMAT:
{
  "scenes": [
    {
      "sceneNumber": 6,
      "text": "...",
      "visualDescription": "...",
      "estimatedDuration": 18,
      "hasImage": true,
      "imageIndex": 6,
      "isFirstThreeMinutes": false
    },
    {
      "sceneNumber": 7,
      "text": "...",
      "estimatedDuration": 17,
      "hasImage": false,
      "isFirstThreeMinutes": false
    }
  ]
}`;

  const response = await retryOpenAI(
    () => createChatCompletion({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: remainingContent || 'Hikaye burada sona eriyor. Son 5 sahneyi oluştur.' }
      ],
      temperature: 0.3,
      responseFormat: 'json_object'
    }),
    `Kalan sahneler (${language})`
  );

  const parsed = parseJSONResponse<{ scenes: SceneData[] }>(response, ['scenes']);

  // Validasyon - minimum 5 sahne (5 görsel için)
  if (!parsed.scenes || parsed.scenes.length < 5) {
    throw new SceneValidationError(
      `En az 5 sahne bekleniyor, ${parsed.scenes?.length || 0} alındı`
    );
  }

  // Görselli sahne sayısını kontrol et
  let imagesCount = parsed.scenes.filter(s => s.hasImage).length;
  
  if (imagesCount !== 5) {
    logger.warn('Görselli sahne sayısı hatalı, düzeltiliyor', {
      expected: 5,
      found: imagesCount
    });

    // Eşit aralıklarla 5 sahneye görsel ekle
    const totalScenes = parsed.scenes.length;
    const step = Math.floor(totalScenes / 5);
    
    let imageIdx = 6; // 6-10 arası
    parsed.scenes.forEach((scene, idx) => {
      const shouldHaveImage = Math.floor(idx / step) < 5 && imageIdx <= 10;
      scene.hasImage = shouldHaveImage;
      if (shouldHaveImage) {
        scene.imageIndex = imageIdx++;
      } else {
        delete scene.imageIndex;
        delete scene.visualDescription;
      }
    });

    imagesCount = parsed.scenes.filter(s => s.hasImage).length;
  }

  if (imagesCount !== 5) {
    throw new SceneValidationError(
      `Kalan kısımda 5 görsel bekleniyor, ${imagesCount} bulundu`
    );
  }

  logger.info(`Kalan sahneler oluşturuldu (${language})`, {
    scenes: parsed.scenes.length,
    imagesCount
  });

  return parsed.scenes;
}

/**
 * ANA FONKSİYON: Tüm sahneleri oluştur (çift dil)
 */
export async function generateScenes(options: GenerateScenesOptions): Promise<GenerateScenesResult> {
  const { originalContent, adaptedContent, model } = options;

  logger.info('Sahne oluşturma başlatılıyor', {
    model,
    originalLength: originalContent.length,
    adaptedLength: adaptedContent.length
  });

  try {
    // 1. İlk 3 dakika - Orijinal dil
    logger.info('İlk 3 dakika sahneleri oluşturuluyor (orijinal)...');
    const firstThreeOriginal = await generateFirstThreeMinutes(
      originalContent,
      'original',
      model
    );

    // 2. İlk 3 dakika - Adapte dil
    logger.info('İlk 3 dakika sahneleri oluşturuluyor (adapte)...');
    const firstThreeAdapted = await generateFirstThreeMinutes(
      adaptedContent,
      'adapted',
      model
    );

    // 3. İlk 3 dakikanın bittiği pozisyonu hesapla
    const firstThreeTextLength = firstThreeOriginal
      .map(s => s.text.length)
      .reduce((a, b) => a + b, 0);

    logger.debug('İlk 3 dakika metin uzunluğu', {
      original: firstThreeTextLength,
      percentage: Math.round((firstThreeTextLength / originalContent.length) * 100)
    });

    // 4. Kalan sahneler - Orijinal dil
    logger.info('Kalan sahneler oluşturuluyor (orijinal)...');
    const remainingOriginal = await generateRemainingScenes(
      originalContent,
      firstThreeTextLength,
      'original',
      model
    );

    // 5. Kalan sahneler - Adapte dil
    logger.info('Kalan sahneler oluşturuluyor (adapte)...');
    const remainingAdapted = await generateRemainingScenes(
      adaptedContent,
      firstThreeTextLength,
      'adapted',
      model
    );

    // 6. Birleştir
    const allOriginal = [...firstThreeOriginal, ...remainingOriginal];
    const allAdapted = [...firstThreeAdapted, ...remainingAdapted];

    // 7. Validasyon: Sahne sayıları eşit olmalı
    if (allOriginal.length !== allAdapted.length) {
      throw new SceneValidationError(
        `Sahne sayıları eşleşmiyor: ${allOriginal.length} vs ${allAdapted.length}`
      );
    }

    // 8. Çift dil şemasında birleştir
    const finalScenes: SceneData[] = allOriginal.map((origScene, idx) => ({
      sceneNumber: origScene.sceneNumber,
      text: origScene.text, // Orijinal metin
      visualDescription: origScene.visualDescription,
      estimatedDuration: origScene.estimatedDuration,
      hasImage: origScene.hasImage,
      imageIndex: origScene.imageIndex,
      isFirstThreeMinutes: origScene.isFirstThreeMinutes,
      // Adapte metni de sakla (ayrı bir property olarak - model şemasında tutulacak)
      textAdapted: allAdapted[idx].text
    } as any)); // Type assertion - SceneData interface'i güncellenecek

    // 9. Final validasyonlar
    const totalImages = finalScenes.filter(s => s.hasImage).length;
    if (totalImages !== IMAGE_SETTINGS.TOTAL_IMAGES) {
      throw new SceneValidationError(
        `${IMAGE_SETTINGS.TOTAL_IMAGES} görsel bekleniyor, ${totalImages} bulundu`
      );
    }

    const firstThreeImages = finalScenes
      .filter(s => s.isFirstThreeMinutes && s.hasImage)
      .length;
    
    if (firstThreeImages !== IMAGE_SETTINGS.FIRST_THREE_MINUTES_IMAGES) {
      throw new SceneValidationError(
        `İlk 3 dakikada ${IMAGE_SETTINGS.FIRST_THREE_MINUTES_IMAGES} görsel bekleniyor, ${firstThreeImages} bulundu`
      );
    }

    const estimatedTotalDuration = finalScenes
      .map(s => s.estimatedDuration)
      .reduce((a, b) => a + b, 0);

    logger.info('Sahne oluşturma tamamlandı', {
      totalScenes: finalScenes.length,
      totalImages,
      firstThreeMinutesScenes: firstThreeOriginal.length,
      estimatedTotalDuration: `${Math.floor(estimatedTotalDuration / 60)}m ${estimatedTotalDuration % 60}s`
    });

    return {
      scenes: finalScenes,
      totalScenes: finalScenes.length,
      totalImages,
      firstThreeMinutesScenes: firstThreeOriginal.length,
      estimatedTotalDuration
    };

  } catch (error) {
    logger.error('Sahne oluşturma hatası', {
      error: error instanceof Error ? error.message : 'Bilinmeyen hata'
    });

    throw error instanceof SceneValidationError 
      ? error 
      : new OpenAIError(
          `Sahne oluşturma başarısız: ${error instanceof Error ? error.message : 'Bilinmeyen hata'}`
        );
  }
}

/**
 * Görsel promptları oluştur (ImageFX için)
 */
export async function generateVisualPrompts(
  scenes: SceneData[],
  storyContext: string,
  model: string
): Promise<Map<number, string>> {
  logger.info('Görsel promptları oluşturuluyor', {
    totalScenes: scenes.length,
    imageScenes: scenes.filter(s => s.hasImage).length
  });

  const prompts = new Map<number, string>();
  const imageScenes = scenes.filter(s => s.hasImage);

  for (const scene of imageScenes) {
    const isFirstThreeMinutes = scene.isFirstThreeMinutes;
    
    const systemPrompt = `Sen ImageFX için görsel prompt uzmanısın.

${isFirstThreeMinutes ? 
  'BU İLK 3 DAKİKA! İzleyicinin dikkatini ÇEKMELİ!' : 
  'Hikayenin devamı için görsel.'}

KURALLAR:
1. İngilizce prompt yaz
2. Cinematic, 4K, ultra detailed
3. Karakterlerin görünümü ve duygusal durumu DETAYLI
4. Işık, gölge, renk paleti, atmosfer BELİRT
5. Sahne kompozisyonu ve perspektif
6. ${isFirstThreeMinutes ? '150-200 kelime (ÇOK DETAYLI)' : '100-150 kelime'}
7. "Photograph", "realistic", "cinematic" gibi kelimeler kullan
8. Sadece prompt yaz, açıklama ekleme

Hikaye Bağlamı: ${storyContext.substring(0, 500)}...`;

    const response = await retryOpenAI(
      () => createChatCompletion({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { 
            role: 'user', 
            content: `Sahne ${scene.sceneNumber}${isFirstThreeMinutes ? ' (İLK 3 DAKİKA)' : ''}:

Sahne Metni:
${scene.text.substring(0, 1000)}

Görsel Betimleme:
${scene.visualDescription || 'N/A'}

ImageFX için detaylı prompt oluştur.`
          }
        ],
        temperature: isFirstThreeMinutes ? 0.7 : 0.6
      }),
      `Görsel prompt - Sahne ${scene.sceneNumber}`
    );

    prompts.set(scene.sceneNumber, response.trim());
    
    logger.debug(`Görsel prompt oluşturuldu - Sahne ${scene.sceneNumber}`, {
      promptLength: response.length,
      isFirstThreeMinutes
    });
  }

  logger.info('Görsel promptları tamamlandı', {
    totalPrompts: prompts.size
  });

  return prompts;
}

