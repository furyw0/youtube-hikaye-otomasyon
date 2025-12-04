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
 * Adapte sahneleri hedef sahne sayısına göre akıllıca yeniden dağıtır.
 * İçerik bütünlüğünü koruyarak sahneleri birleştirir veya böler.
 */
function redistributeScenes(scenes: SceneData[], targetCount: number): SceneData[] {
  if (scenes.length === targetCount) return scenes;
  
  const result: SceneData[] = [];
  const totalText = scenes.map(s => s.text).join(' ');
  const avgTextPerScene = Math.ceil(totalText.length / targetCount);
  
  if (scenes.length > targetCount) {
    // Fazla sahne var - birleştir
    const ratio = scenes.length / targetCount;
    
    for (let i = 0; i < targetCount; i++) {
      const startIdx = Math.floor(i * ratio);
      const endIdx = Math.min(Math.floor((i + 1) * ratio), scenes.length);
      
      // Bu aralıktaki sahneleri birleştir
      const scenesToMerge = scenes.slice(startIdx, endIdx);
      const mergedText = scenesToMerge.map(s => s.text).join(' ');
      
      // İlk sahnenin özelliklerini kullan
      const baseScene = scenesToMerge[0];
      
      result.push({
        sceneNumber: i + 1,
        text: mergedText,
        visualDescription: baseScene.visualDescription,
        estimatedDuration: scenesToMerge.reduce((sum, s) => sum + s.estimatedDuration, 0),
        hasImage: scenesToMerge.some(s => s.hasImage),
        imageIndex: scenesToMerge.find(s => s.hasImage)?.imageIndex,
        isFirstThreeMinutes: baseScene.isFirstThreeMinutes
      });
    }
  } else {
    // Eksik sahne var - böl
    const words = totalText.split(/\s+/);
    const wordsPerScene = Math.ceil(words.length / targetCount);
    
    for (let i = 0; i < targetCount; i++) {
      const startWord = i * wordsPerScene;
      const endWord = Math.min((i + 1) * wordsPerScene, words.length);
      const sceneText = words.slice(startWord, endWord).join(' ');
      
      // Orijinal sahnelerden özellik al (orantılı)
      const sourceIdx = Math.min(Math.floor(i * scenes.length / targetCount), scenes.length - 1);
      const sourceScene = scenes[sourceIdx];
      
      result.push({
        sceneNumber: i + 1,
        text: sceneText || sourceScene.text, // Boş kalmasın
        visualDescription: sourceScene.visualDescription,
        estimatedDuration: Math.ceil(sceneText.split(/\s+/).length * 0.4), // ~0.4 saniye/kelime
        hasImage: sourceScene.hasImage,
        imageIndex: sourceScene.imageIndex,
        isFirstThreeMinutes: i < 5 // İlk 5 sahne ilk 3 dakika kabul edilir
      });
    }
  }
  
  return result;
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

⚠️ KRİTİK - ASLA YAPMA:
- ASLA hikayeyi kısaltma veya özetleme
- ASLA cümle, paragraf veya olay atlama
- ASLA kendi kelimenle yeniden yazma

✅ ZORUNLU KURALLAR:
1. Her sahnenin metni HİKAYENİN ORİJİNAL METNİNDEN ALINMALI (kelimesi kelimesine)
2. Hikayenin ilk bölümünü 5 parçaya BÖL (yeniden yazma, orijinal metni kullan)
3. Her sahne MUTLAKA görsel içermeli (toplam 5 görsel)
4. Her sahne ~36 saniye seslendirme olmalı (5 × 36s = 180s)
5. İlk 3 dakika izleyiciyi ÇEKMELİ - en ilginç ve aksiyon dolu sahneler
6. Her sahne için AYRINTILI görsel betimleme yap
7. Görsel betimlemeler ImageFX için uygun olmalı (detaylı, sinematik)
8. Hikaye akışını ve BÜTÜNLÜĞÜNÜ koru

Her sahne için (JSON):
- sceneNumber: Sahne numarası (1-5)
- text: HİKAYENİN ORİJİNAL METNİ (özetlenmiş değil, kelimesi kelimesine)
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
      "text": "Hikayenin orijinal metni aynen buraya...",
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

⚠️ KRİTİK - ASLA YAPMA:
- ASLA hikayeyi kısaltma veya özetleme
- ASLA cümle, paragraf veya olay atlama
- ASLA kendi kelimenle yeniden yazma
- ASLA hikayenin herhangi bir bölümünü çıkarma

✅ ZORUNLU KURALLAR:
1. Her sahnenin metni HİKAYENİN ORİJİNAL METNİNDEN ALINMALI (kelimesi kelimesine)
2. TÜM HİKAYE dahil edilmeli - son kelimeye kadar
3. Her sahne 15-20 saniye seslendirme (~150-200 kelime)
4. Minimum ${minScenes} sahne oluştur (içerik kısa ise daha az olabilir)
5. Bu sahnelerden tam 5 tanesine görsel ekle
6. Görselli sahneleri EŞIT ARALIKLARLA dağıt
7. Görselli sahneler için DETAYLI görsel betimleme yap
8. Hikaye akışını ve BÜTÜNLÜĞÜNÜ koru
9. Her sahne akıcı ve tutarlı olmalı

Her sahne için (JSON):
- sceneNumber: Sahne numarası (6'dan başla)
- text: HİKAYENİN ORİJİNAL METNİ (özetlenmiş değil, kelimesi kelimesine)
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
      "text": "Hikayenin orijinal metni aynen buraya...",
      "visualDescription": "...",
      "estimatedDuration": 18,
      "hasImage": true,
      "imageIndex": 6,
      "isFirstThreeMinutes": false
    },
    {
      "sceneNumber": 7,
      "text": "Hikayenin devamı aynen...",
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

    // 7. Sahne sayılarını akıllıca eşitle (içerik bütünlüğünü koru)
    let finalAdapted = allAdapted;
    
    if (allOriginal.length !== allAdapted.length) {
      logger.warn('Sahne sayıları eşleşmiyor, akıllı eşitleme yapılıyor...', {
        original: allOriginal.length,
        adapted: allAdapted.length
      });
      
      // Adapte içeriği orijinal sahne sayısına göre yeniden dağıt
      finalAdapted = redistributeScenes(allAdapted, allOriginal.length);
      
      logger.info('Sahne sayıları akıllıca eşitlendi', { 
        from: allAdapted.length,
        to: allOriginal.length 
      });
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
      textAdapted: finalAdapted[idx].text
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
 * Stil tutarlılığı ve metin/altyazı engelleme içerir
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
  
  // İlk görsel için karakter tanımları (tutarlılık için)
  let characterDescriptions = '';

  for (let i = 0; i < imageScenes.length; i++) {
    const scene = imageScenes[i];
    const isFirstImage = i === 0;
    const isFirstThreeMinutes = scene.isFirstThreeMinutes;
    
    const systemPrompt = `Sen ImageFX için görsel prompt uzmanısın.

${isFirstThreeMinutes ? 
  'BU İLK 3 DAKİKA! İzleyicinin dikkatini ÇEKMELİ!' : 
  'Hikayenin devamı için görsel.'}

⚠️ KRİTİK - ASLA EKLEME:
- ASLA metin, yazı, harf, kelime ekleme
- ASLA altyazı, subtitle, caption ekleme
- ASLA filigran, watermark ekleme
- ASLA logo, marka, işaret ekleme
- Görsel SADECE sahneyi göstermeli, hiçbir yazı içermemeli

✅ STİL KURALLARI (TÜM GÖRSELLER İÇİN AYNI):
1. SADECE "photorealistic cinematic photograph" stili
2. ASLA çizgi film, anime, illüstrasyon, cartoon YAPMA
3. Gerçek insan fotoğrafı gibi görünmeli
4. 4K, ultra detailed, cinematic lighting
5. Film seti kalitesinde, profesyonel fotoğraf

${isFirstImage ? `
🎭 KARAKTER TANIMLARI (İLK GÖRSEL):
- Bu ilk görseldir, karakterlerin DETAYLI fiziksel özelliklerini tanımla
- Yaş, saç rengi, göz rengi, ten rengi, yüz özellikleri
- Kıyafet detayları
- Bu tanımlar sonraki görsellerde AYNI tutulacak
` : `
🎭 KARAKTER TUTARLILIĞI:
${characterDescriptions || 'Önceki görsellerdeki karakterlerle AYNI fiziksel özellikleri kullan'}
`}

📝 PROMPT KURALLARI:
1. İngilizce yaz
2. ${isFirstThreeMinutes ? '150-200 kelime' : '100-150 kelime'}
3. Prompt MUTLAKA şununla başlamalı: "Photorealistic cinematic photograph, no text, no subtitles, clean image,"
4. Karakterlerin duygusal durumu DETAYLI
5. Işık, gölge, renk paleti, atmosfer
6. Sahne kompozisyonu ve perspektif
7. Sadece prompt yaz, açıklama ekleme

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

${isFirstImage ? 
  'Bu İLK GÖRSEL - Karakterlerin fiziksel özelliklerini DETAYLI tanımla.' :
  'Önceki görsellerdeki karakterlerle AYNI fiziksel özellikleri kullan.'}

ImageFX için detaylı prompt oluştur. ASLA metin/altyazı ekleme!`
          }
        ],
        temperature: isFirstThreeMinutes ? 0.6 : 0.5 // Tutarlılık için daha düşük
      }),
      `Görsel prompt - Sahne ${scene.sceneNumber}`
    );

    // Prompt'u temizle ve standart prefix ekle
    let cleanPrompt = response.trim();
    
    // Eğer prompt standart prefix ile başlamıyorsa ekle
    const requiredPrefix = 'Photorealistic cinematic photograph, no text, no subtitles, no captions, no watermarks, clean image,';
    if (!cleanPrompt.toLowerCase().includes('no text') && !cleanPrompt.toLowerCase().includes('no subtitle')) {
      cleanPrompt = `${requiredPrefix} ${cleanPrompt}`;
    }
    
    // Negatif prompt ekle (sona)
    const negativeAddition = ' --no text, subtitles, captions, watermarks, letters, words, writing, cartoon, anime, illustration, drawing';
    if (!cleanPrompt.includes('--no')) {
      cleanPrompt += negativeAddition;
    }

    prompts.set(scene.sceneNumber, cleanPrompt);
    
    // İlk görsel için karakter tanımlarını kaydet (sonraki görseller için)
    if (isFirstImage) {
      characterDescriptions = cleanPrompt.substring(0, 500); // İlk 500 karakter karakter tanımı olarak kullanılır
    }
    
    logger.debug(`Görsel prompt oluşturuldu - Sahne ${scene.sceneNumber}`, {
      promptLength: cleanPrompt.length,
      isFirstThreeMinutes,
      hasNoTextPrefix: cleanPrompt.includes('no text')
    });
  }

  logger.info('Görsel promptları tamamlandı', {
    totalPrompts: prompts.size
  });

  return prompts;
}

