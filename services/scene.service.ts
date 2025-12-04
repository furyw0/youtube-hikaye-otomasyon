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
  textAdapted?: string; // Adapte edilmiş metin
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
 * Adapte edilmiş metni orijinal sahne oranlarına göre böler.
 * Bu şekilde orijinal ve adapte metinler HER ZAMAN senkron kalır.
 */
function splitAdaptedContentByOriginalRatios(
  adaptedContent: string,
  originalScenes: SceneData[]
): string[] {
  // Orijinal toplam uzunluk
  const totalOriginalLength = originalScenes.reduce((sum, s) => sum + s.text.length, 0);
  
  // Adapte metni cümlelere böl (daha doğal kesim için)
  const sentences = adaptedContent.split(/(?<=[.!?।。？！])\s+/).filter(s => s.trim());
  
  const result: string[] = [];
  let sentenceIndex = 0;
  
  for (let i = 0; i < originalScenes.length; i++) {
    const scene = originalScenes[i];
    
    // Bu sahnenin oranı
    const ratio = scene.text.length / totalOriginalLength;
    
    // Bu sahne için hedef karakter sayısı
    const targetLength = Math.round(adaptedContent.length * ratio);
    
    // Cümleleri topla
    let sceneText = '';
    while (sentenceIndex < sentences.length) {
      const sentence = sentences[sentenceIndex];
      
      // Eğer bu son sahne ise, kalan tüm cümleleri ekle
      if (i === originalScenes.length - 1) {
        sceneText += (sceneText ? ' ' : '') + sentence;
        sentenceIndex++;
        continue;
      }
      
      // Hedef uzunluğa ulaştıysak ve en az bir cümle varsa dur
      if (sceneText.length >= targetLength && sceneText.length > 0) {
        break;
      }
      
      sceneText += (sceneText ? ' ' : '') + sentence;
      sentenceIndex++;
    }
    
    result.push(sceneText.trim() || scene.text); // Boş kalmasın, orijinali kullan
  }
  
  return result;
}

/**
 * Adapte sahneleri hedef sahne sayısına göre akıllıca yeniden dağıtır.
 * İçerik bütünlüğünü koruyarak sahneleri birleştirir veya böler.
 * @deprecated splitAdaptedContentByOriginalRatios kullanın
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
 * AŞAMA 1: İlk 3 dakika için sahneler oluştur (6 görsel)
 */
async function generateFirstThreeMinutes(
  content: string,
  language: 'original' | 'adapted',
  model: string
): Promise<SceneData[]> {
  const systemPrompt = `Sen hikaye sahne uzmanısın. Hikayenin İLK 3 DAKİKASINI sahnelere ayırıyorsun.

HEDEF: İlk 3 dakika (180 saniye) için 6 sahne oluştur, HER BİRİNDE GÖRSEL OLACAK.

⚠️ KRİTİK - ASLA YAPMA:
- ASLA hikayeyi kısaltma veya özetleme
- ASLA cümle, paragraf veya olay atlama
- ASLA kendi kelimenle yeniden yazma

✅ ZORUNLU KURALLAR:
1. Her sahnenin metni HİKAYENİN ORİJİNAL METNİNDEN ALINMALI (kelimesi kelimesine)
2. Hikayenin ilk bölümünü 6 parçaya BÖL (yeniden yazma, orijinal metni kullan)
3. Her sahne MUTLAKA görsel içermeli (toplam 6 görsel)
4. Her sahne ~30 saniye seslendirme olmalı (6 × 30s = 180s)
5. İlk 3 dakika izleyiciyi ÇEKMELİ - en ilginç ve aksiyon dolu sahneler
6. Her sahne için AYRINTILI görsel betimleme yap
7. Görsel betimlemeler ImageFX için uygun olmalı (detaylı, sinematik)
8. Hikaye akışını ve BÜTÜNLÜĞÜNÜ koru

Her sahne için (JSON):
- sceneNumber: Sahne numarası (1-6)
- text: HİKAYENİN ORİJİNAL METNİ (özetlenmiş değil, kelimesi kelimesine)
- visualDescription: DETAYLI görsel betimleme (karakterler, ortam, atmosfer, duygular, renkler)
- estimatedDuration: Tahmini süre (saniye, ~30s)
- hasImage: true (her sahnede)
- imageIndex: Görsel sırası (1-6)
- isFirstThreeMinutes: true

JSON FORMAT:
{
  "scenes": [
    {
      "sceneNumber": 1,
      "text": "Hikayenin orijinal metni aynen buraya...",
      "visualDescription": "Çok detaylı görsel betimleme...",
      "estimatedDuration": 30,
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

  // Validasyon (esnek - minimum 3 sahne yeterli, hedef 6)
  if (!parsed.scenes || parsed.scenes.length < 3) {
    throw new SceneValidationError(
      `İlk 3 dakika için minimum 3 sahne bekleniyor, ${parsed.scenes?.length || 0} alındı`
    );
  }

  if (parsed.scenes.length < 6) {
    logger.warn(`İlk 3 dakika için 6 sahne hedeflendi, ${parsed.scenes.length} oluşturuldu (hikaye kısa olabilir)`);
  }

  // Her sahnenin görsel içerdiğini kontrol et
  const imagesCount = parsed.scenes.filter(s => s.hasImage).length;
  if (imagesCount < 3) {
    throw new SceneValidationError(
      `İlk 3 dakikada minimum 3 görsel bekleniyor, ${imagesCount} bulundu`
    );
  }

  logger.info(`İlk 3 dakika sahneleri oluşturuldu (${language})`, {
    scenes: parsed.scenes.length,
    images: imagesCount,
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
  model: string,
  firstThreeScenesCount: number = 6  // İlk 3 dakikada kaç sahne oluşturuldu
): Promise<SceneData[]> {
  const remainingContent = content.substring(firstThreeMinutesEndPosition);
  
  // Kalan içerik çok kısa ise minimum sahne sayısını ayarla
  const contentLength = remainingContent.length;
  
  // Hedef: 14 görsel, minimum 5 (hikaye kısaysa)
  const targetImages = IMAGE_SETTINGS.REMAINING_IMAGES; // 14
  const estimatedScenes = Math.max(targetImages, Math.ceil(contentLength / 1000)); // ~1000 karakter/sahne
  const minScenes = Math.max(5, Math.min(estimatedScenes, 30)); // Minimum 5, maksimum 30
  
  // sceneNumber ve imageIndex başlangıç değerleri
  const startSceneNumber = firstThreeScenesCount + 1;
  const startImageIndex = firstThreeScenesCount + 1;
  const endImageIndex = startImageIndex + targetImages - 1;
  
  const systemPrompt = `Sen hikaye sahne uzmanısın. Hikayenin KALAN KISMINI sahnelere ayırıyorsun.

HEDEF: Hikayenin kalan kısmını ${minScenes}-${estimatedScenes} sahneye böl, bu sahnelerden ${targetImages} tanesine görsel ekle.
NOT: Hikaye kısa ise daha az sahne ve görsel olabilir - önemli olan hikayenin TAMAMI dahil edilmesi.

⚠️ KRİTİK - ASLA YAPMA:
- ASLA hikayeyi kısaltma veya özetleme
- ASLA cümle, paragraf veya olay atlama
- ASLA kendi kelimenle yeniden yazma
- ASLA hikayenin herhangi bir bölümünü çıkarma

✅ ZORUNLU KURALLAR:
1. Her sahnenin metni HİKAYENİN ORİJİNAL METNİNDEN ALINMALI (kelimesi kelimesine)
2. TÜM HİKAYE dahil edilmeli - son kelimeye kadar
3. Her sahne 12-20 saniye seslendirme (~100-200 kelime)
4. En az 5 sahne oluştur, daha fazla olabilir
5. Bu sahnelerden MÜMKÜN OLDUĞUNCA ÇOĞUNA görsel ekle (hedef: ${targetImages})
6. Görselli sahneleri EŞIT ARALIKLARLA dağıt
7. Görselli sahneler için DETAYLI görsel betimleme yap
8. Hikaye akışını ve BÜTÜNLÜĞÜNÜ koru
9. Her sahne akıcı ve tutarlı olmalı

Her sahne için (JSON):
- sceneNumber: Sahne numarası (${startSceneNumber}'dan başla)
- text: HİKAYENİN ORİJİNAL METNİ (özetlenmiş değil, kelimesi kelimesine)
- visualDescription: Görsel betimleme (sadece görselli sahnelerde)
- estimatedDuration: Tahmini süre (12-20 saniye)
- hasImage: true/false
- imageIndex: Görsel sırası (${startImageIndex}-${endImageIndex} arası, sadece görselli sahnelerde)
- isFirstThreeMinutes: false

JSON FORMAT:
{
  "scenes": [
    {
      "sceneNumber": ${startSceneNumber},
      "text": "Hikayenin orijinal metni aynen buraya...",
      "visualDescription": "...",
      "estimatedDuration": 15,
      "hasImage": true,
      "imageIndex": ${startImageIndex},
      "isFirstThreeMinutes": false
    },
    {
      "sceneNumber": ${startSceneNumber + 1},
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

  // Validasyon - esnek: minimum 3 sahne yeterli (hikaye kısa olabilir)
  if (!parsed.scenes || parsed.scenes.length < 3) {
    throw new SceneValidationError(
      `En az 3 sahne bekleniyor, ${parsed.scenes?.length || 0} alındı`
    );
  }

  // Görselli sahne sayısını kontrol et
  let imagesCount = parsed.scenes.filter(s => s.hasImage).length;
  const maxImageIndex = endImageIndex; // startImageIndex + targetImages - 1 (yukarıda hesaplandı)
  
  // Minimum 2 görsel yeterli, hedef 14
  if (imagesCount < 2) {
    logger.warn('Çok az görsel var, otomatik düzeltme yapılıyor', {
      found: imagesCount,
      target: targetImages
    });

    // Eşit aralıklarla mümkün olduğunca çok sahneye görsel ekle
    const totalScenes = parsed.scenes.length;
    const desiredImages = Math.min(targetImages, totalScenes);
    const step = Math.max(1, Math.floor(totalScenes / desiredImages));
    
    let imageIdx = startImageIndex;
    parsed.scenes.forEach((scene, idx) => {
      const shouldHaveImage = idx % step === 0 && imageIdx <= maxImageIndex;
      scene.hasImage = shouldHaveImage;
      if (shouldHaveImage) {
        scene.imageIndex = imageIdx++;
      } else {
        delete scene.imageIndex;
        delete scene.visualDescription;
      }
    });

    imagesCount = parsed.scenes.filter(s => s.hasImage).length;
  } else if (imagesCount < targetImages && imagesCount >= 2) {
    // 2-13 arası görsel varsa, uyar ama devam et
    logger.info(`Kalan kısımda ${targetImages} görsel hedeflendi, ${imagesCount} oluşturuldu (hikaye kısa olabilir)`);
  }

  logger.info(`Kalan sahneler oluşturuldu (${language})`, {
    scenes: parsed.scenes.length,
    images: imagesCount,
    targetImages
  });

  return parsed.scenes;
}

/**
 * ANA FONKSİYON: Tüm sahneleri oluştur (çift dil)
 * YENİ YAKLAŞIM: Adapte metin üzerinden sahne oluştur, orijinali senkronize et
 */
export async function generateScenes(options: GenerateScenesOptions): Promise<GenerateScenesResult> {
  const { originalContent, adaptedContent, model } = options;

  logger.info('Sahne oluşturma başlatılıyor (ADAPTE metin bazlı)', {
    model,
    originalLength: originalContent.length,
    adaptedLength: adaptedContent.length
  });

  try {
    // ===== ADAPTE METİN ÜZERİNDEN SAHNE OLUŞTUR =====
    
    // 1. İlk 3 dakika - ADAPTE metin için sahne oluştur
    logger.info('İlk 3 dakika sahneleri oluşturuluyor (adapte metin)...');
    const firstThreeAdapted = await generateFirstThreeMinutes(
      adaptedContent,
      'adapted',
      model
    );

    // 2. İlk 3 dakikanın bittiği pozisyonu hesapla
    const firstThreeTextLength = firstThreeAdapted
      .map(s => s.text.length)
      .reduce((a, b) => a + b, 0);

    logger.debug('İlk 3 dakika metin uzunluğu (adapte)', {
      adapted: firstThreeTextLength,
      percentage: Math.round((firstThreeTextLength / adaptedContent.length) * 100)
    });

    // 3. Kalan sahneler - ADAPTE metin için sahne oluştur
    logger.info('Kalan sahneler oluşturuluyor (adapte metin)...');
    const remainingAdapted = await generateRemainingScenes(
      adaptedContent,
      firstThreeTextLength,
      'adapted',
      model,
      firstThreeAdapted.length  // İlk 3 dakikadaki sahne sayısı
    );

    // 4. Tüm adapte sahneleri birleştir
    const allAdapted = [...firstThreeAdapted, ...remainingAdapted];
    
    logger.info('Adapte sahneler oluşturuldu', { 
      total: allAdapted.length,
      firstThree: firstThreeAdapted.length,
      remaining: remainingAdapted.length
    });

    // ===== ORİJİNAL METNİ ADAPTE ORANLARINDA BÖL =====
    
    // 5. Orijinal metni adapte sahne oranlarına göre böl
    logger.info('Orijinal metin adapte sahne oranlarına göre bölünüyor...');
    const originalSceneTexts = splitAdaptedContentByOriginalRatios(
      originalContent,
      allAdapted
    );

    // 6. Çift dil şemasında birleştir
    // NOT: Ana metin artık ADAPTE metin (ses ve görsel için kullanılacak)
    const finalScenes: SceneData[] = allAdapted.map((adaptedScene, idx) => ({
      sceneNumber: adaptedScene.sceneNumber,
      text: originalSceneTexts[idx] || adaptedScene.text, // Orijinal metin (panel için)
      textAdapted: adaptedScene.text, // ANA METİN - Adapte (ses/görsel için)
      visualDescription: adaptedScene.visualDescription,
      estimatedDuration: adaptedScene.estimatedDuration,
      hasImage: adaptedScene.hasImage,
      imageIndex: adaptedScene.imageIndex,
      isFirstThreeMinutes: adaptedScene.isFirstThreeMinutes,
    }));
    
    logger.info('Sahneler birleştirildi', {
      totalScenes: finalScenes.length,
      withOriginalText: finalScenes.filter(s => s.text).length,
      withAdaptedText: finalScenes.filter(s => s.textAdapted).length
    });

    // 9. Final validasyonlar (esnek - hikaye kısaysa daha az görsel olabilir)
    const totalImages = finalScenes.filter(s => s.hasImage).length;
    
    // Minimum görsel kontrolü (çok az görsel varsa uyar ama devam et)
    if (totalImages < IMAGE_SETTINGS.MIN_TOTAL_IMAGES) {
      logger.warn(`Görsel sayısı minimum altında: ${totalImages} < ${IMAGE_SETTINGS.MIN_TOTAL_IMAGES}`, {
        totalImages,
        minRequired: IMAGE_SETTINGS.MIN_TOTAL_IMAGES,
        target: IMAGE_SETTINGS.TOTAL_IMAGES
      });
      // Hata fırlatma, devam et
    } else if (totalImages < IMAGE_SETTINGS.TOTAL_IMAGES) {
      logger.info(`Hedef görsel sayısına ulaşılamadı: ${totalImages}/${IMAGE_SETTINGS.TOTAL_IMAGES} (hikaye kısa olabilir)`, {
        totalImages,
        target: IMAGE_SETTINGS.TOTAL_IMAGES
      });
    }

    const firstThreeImages = finalScenes
      .filter(s => s.isFirstThreeMinutes && s.hasImage)
      .length;
    
    // İlk 3 dakika görsel kontrolü (esnek)
    if (firstThreeImages < 3) {
      logger.warn(`İlk 3 dakikada çok az görsel: ${firstThreeImages}`, {
        firstThreeImages,
        target: IMAGE_SETTINGS.FIRST_THREE_MINUTES_IMAGES
      });
    }

    const estimatedTotalDuration = finalScenes
      .map(s => s.estimatedDuration)
      .reduce((a, b) => a + b, 0);

    logger.info('Sahne oluşturma tamamlandı', {
      totalScenes: finalScenes.length,
      totalImages,
      firstThreeMinutesScenes: firstThreeAdapted.length,
      estimatedTotalDuration: `${Math.floor(estimatedTotalDuration / 60)}m ${estimatedTotalDuration % 60}s`
    });

    return {
      scenes: finalScenes,
      totalScenes: finalScenes.length,
      totalImages,
      firstThreeMinutesScenes: firstThreeAdapted.length,
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

