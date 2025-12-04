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
  textCoverageRatio: number; // Adapte metnin ne kadarının sahnelere dahil edildiği (0-1 arası)
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
 * NOT: Bu fonksiyona ADAPTE EDİLMİŞ metin gönderilir (isimler ve kültürel unsurlar değiştirilmiş)
 */
async function generateFirstThreeMinutes(
  content: string,
  language: 'original' | 'adapted',
  model: string
): Promise<SceneData[]> {
  // İlk 3 dakika için kullanılacak metin (ilk ~15.000 karakter)
  const firstPartContent = content.substring(0, 15000);
  const inputCharCount = firstPartContent.length;
  
  const systemPrompt = `Sen hikaye sahne uzmanısın. Hikayenin İLK BÖLÜMÜNÜ sahnelere ayırıyorsun.

⛔ EN ÖNEMLİ KURAL - KISALTMA YASAK:
Sana verilen metin ${inputCharCount} karakter. 
Çıktıdaki TÜM SAHNE METİNLERİNİN TOPLAMI da yaklaşık ${inputCharCount} karakter OLMALI!
Eğer toplam çıktı çok kısaysa, EKSİK BÖLMÜŞSÜN demektir!

📏 UZUNLUK HEDEFİ:
- Giriş: ~${inputCharCount} karakter
- Çıkış: Tüm scene.text toplamı >= ${Math.round(inputCharCount * 0.90)} karakter olmalı

⛔ KESINLIKLE YASAK:
- ❌ METNİ KISALTMA veya ÖZETLEME
- ❌ Cümle, paragraf veya kelime ATLAMA
- ❌ Kendi cümlelerinle YENİDEN YAZMA
- ❌ "..." ile kısaltma yapma
- ❌ Herhangi bir bölümü ÇIKARMA

✅ ZORUNLU: METNİ AYNEN BÖL
1. Verilen metni 6 PARÇAYA BÖL - her parça "text" alanına KELİMESİ KELİMESİNE kopyalanmalı
2. Hiçbir şey ekleme, hiçbir şey çıkarma - SADECE BÖL
3. Paragraf veya cümle sınırlarında böl (kelime ortasından kesme)
4. Her sahne ~${Math.round(inputCharCount / 6)} karakter olmalı

📝 HER SAHNE İÇİN:
- sceneNumber: 1-6 arası
- text: VERİLEN METİNDEN KESİT (birebir kopyala, özetleme!)
- visualDescription: Detaylı görsel betimleme (fotorealistik sinematik)
- estimatedDuration: ~30 saniye
- hasImage: true
- imageIndex: 1-6 arası
- isFirstThreeMinutes: true

JSON FORMAT:
{
  "scenes": [...],
  "totalTextLength": <tüm scene.text uzunluklarının toplamı>
}`;

  const response = await retryOpenAI(
    () => createChatCompletion({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { 
          role: 'user', 
          content: `KISALTMADAN 6 SAHNEYE BÖL (toplam ~${inputCharCount} karakter korunmalı):\n\n${firstPartContent}`
        }
      ],
      temperature: 0.3, // Daha düşük = daha az yaratıcılık = daha az kısaltma
      responseFormat: 'json_object'
    }),
    `İlk 3 dakika sahneleri (${language})`
  );

  const parsed = parseJSONResponse<{ scenes: SceneData[]; notes?: string }>(
    response,
    ['scenes']
  );

  // ===== KRİTİK VALİDASYON =====
  // İlk 3 dakika için KESİNLİKLE 6 sahne olmalı (her biri ~30 saniye)
  const MIN_FIRST_THREE_SCENES = 6;
  
  if (!parsed.scenes || parsed.scenes.length < MIN_FIRST_THREE_SCENES) {
    logger.error(`İlk 3 dakika için ${MIN_FIRST_THREE_SCENES} sahne bekleniyor, ${parsed.scenes?.length || 0} alındı - RETRY gerekli`, {
      receivedScenes: parsed.scenes?.length || 0,
      expected: MIN_FIRST_THREE_SCENES
    });
    throw new SceneValidationError(
      `İlk 3 dakika için minimum ${MIN_FIRST_THREE_SCENES} sahne bekleniyor, ${parsed.scenes?.length || 0} alındı. Her sahne ~30 saniye olmalı.`
    );
  }

  // Süre kontrolü - hiçbir sahne 45 saniyeyi geçmemeli
  const MAX_SCENE_DURATION = 45;
  for (const scene of parsed.scenes) {
    if (scene.estimatedDuration > MAX_SCENE_DURATION) {
      logger.warn(`Sahne ${scene.sceneNumber} çok uzun: ${scene.estimatedDuration}s, ${MAX_SCENE_DURATION}s'ye düşürülüyor`);
      scene.estimatedDuration = 30; // Varsayılan 30 saniye
    }
    // Minimum süre kontrolü
    if (!scene.estimatedDuration || scene.estimatedDuration < 10) {
      scene.estimatedDuration = 30;
    }
  }

  // Toplam süre kontrolü (ilk 3 dakika = 180 saniye civarı olmalı)
  const totalDuration = parsed.scenes.reduce((sum, s) => sum + (s.estimatedDuration || 30), 0);
  logger.info(`İlk 3 dakika toplam süre: ${totalDuration}s (hedef: ~180s)`, {
    scenes: parsed.scenes.length,
    totalDuration,
    avgPerScene: Math.round(totalDuration / parsed.scenes.length)
  });

  // TÜM SAHNELERE görsel ekle (ilk 3 dakika için her sahne önemli)
  const targetImages = IMAGE_SETTINGS.FIRST_THREE_MINUTES_IMAGES; // 6
  const totalScenes = parsed.scenes.length;
  const desiredImages = Math.min(targetImages, totalScenes);
  
  logger.info(`İlk 3 dakika görsel dağıtımı yapılıyor`, {
    totalScenes,
    targetImages: desiredImages
  });

  // Eşit aralıklarla görsel ekle
  let imageIdx = 1;
  const step = totalScenes / desiredImages;
  
  // Önce tüm görselleri temizle
  parsed.scenes.forEach(scene => {
    scene.hasImage = false;
    delete scene.imageIndex;
  });
  
  // Sonra eşit dağıt
  for (let i = 0; i < desiredImages && imageIdx <= targetImages; i++) {
    const sceneIndex = Math.min(Math.floor(i * step), totalScenes - 1);
    const scene = parsed.scenes[sceneIndex];
    
    if (!scene.hasImage) {
      scene.hasImage = true;
      scene.imageIndex = imageIdx++;
      
      // Görsel betimleme yoksa ekle
      if (!scene.visualDescription) {
        scene.visualDescription = `Cinematic dramatic photograph: ${scene.text.substring(0, 100)}...`;
      }
    }
  }

  const imagesCount = parsed.scenes.filter(s => s.hasImage).length;
  
  logger.info(`İlk 3 dakika sahneleri oluşturuldu (${language})`, {
    scenes: parsed.scenes.length,
    images: imagesCount,
    totalDuration,
    notes: parsed.notes
  });

  return parsed.scenes;
}

/**
 * AŞAMA 2: Kalan hikaye için sahneler oluştur (14 görsel hedef)
 * NOT: Bu fonksiyona ADAPTE EDİLMİŞ metin gönderilir (isimler ve kültürel unsurlar değiştirilmiş)
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
  
  // Kalan içeriğin karakter sayısı
  const inputCharCount = remainingContent.length;
  
  // Tahmini sahne sayısı (~800 karakter/sahne)
  const estimatedSceneCount = Math.max(minScenes, Math.ceil(inputCharCount / 800));
  
  const systemPrompt = `Sen hikaye sahne uzmanısın. Hikayenin KALAN KISMINI sahnelere ayırıyorsun.

⛔ EN ÖNEMLİ KURAL - KISALTMA YASAK:
Sana verilen metin ${inputCharCount} karakter.
Çıktıdaki TÜM SAHNE METİNLERİNİN TOPLAMI da yaklaşık ${inputCharCount} karakter OLMALI!
Eğer toplam çıktı çok kısaysa, EKSİK BÖLMÜŞSÜN demektir!

📏 UZUNLUK HEDEFİ:
- Giriş: ${inputCharCount} karakter
- Çıkış: Tüm scene.text toplamı >= ${Math.round(inputCharCount * 0.90)} karakter olmalı
- Tahmini sahne sayısı: ${estimatedSceneCount} (her biri ~800 karakter)

⛔ KESINLIKLE YASAK:
- ❌ METNİ KISALTMA veya ÖZETLEME
- ❌ Cümle, paragraf veya kelime ATLAMA
- ❌ Kendi cümlelerinle YENİDEN YAZMA
- ❌ "..." ile kısaltma yapma
- ❌ Herhangi bir bölümü ÇIKARMA
- ❌ SON KELIMEYE KADAR her şey dahil edilmeli!

✅ ZORUNLU: METNİ AYNEN BÖL
1. Verilen metni ${estimatedSceneCount} PARÇAYA BÖL
2. Her parça "text" alanına KELİMESİ KELİMESİNE kopyalanmalı
3. Hiçbir şey ekleme, hiçbir şey çıkarma - SADECE BÖL
4. Paragraf veya cümle sınırlarında böl
5. TÜM METİN dahil edilmeli - SON KELİMEYE KADAR!

📝 HER SAHNE İÇİN:
- sceneNumber: ${startSceneNumber}'dan başla
- text: VERİLEN METİNDEN KESİT (birebir kopyala!)
- visualDescription: Görsel betimleme (görselli sahnelerde)
- estimatedDuration: 12-20 saniye
- hasImage: true/false (hedef: ${targetImages} görsel)
- imageIndex: ${startImageIndex}-${endImageIndex} arası
- isFirstThreeMinutes: false

JSON FORMAT:
{
  "scenes": [...],
  "totalTextLength": <tüm scene.text uzunluklarının toplamı>
}`;

  const response = await retryOpenAI(
    () => createChatCompletion({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `KISALTMADAN ${estimatedSceneCount} SAHNEYE BÖL (toplam ${inputCharCount} karakter korunmalı):\n\n${remainingContent}` }
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

  // Görselli sahne sayısını kontrol et ve ZORLA hedef sayıya ulaştır
  let imagesCount = parsed.scenes.filter(s => s.hasImage).length;
  const maxImageIndex = endImageIndex; // startImageIndex + targetImages - 1 (yukarıda hesaplandı)
  
  // HER ZAMAN otomatik dağıtım yap - OpenAI genelde yeterli görsel oluşturmuyor
  const totalScenes = parsed.scenes.length;
  const desiredImages = Math.min(targetImages, totalScenes); // Sahne sayısından fazla görsel olamaz
  
  logger.info(`Görsel dağıtımı yapılıyor`, {
    currentImages: imagesCount,
    targetImages: desiredImages,
    totalScenes
  });

  // Önce tüm görselleri temizle, sonra eşit dağıt
  parsed.scenes.forEach(scene => {
    scene.hasImage = false;
    delete scene.imageIndex;
  });
  
  // Eşit aralıklarla görsel ekle
  const step = totalScenes / desiredImages;
  let imageIdx = startImageIndex;
  
  for (let i = 0; i < desiredImages && imageIdx <= maxImageIndex; i++) {
    const sceneIndex = Math.min(Math.floor(i * step), totalScenes - 1);
    const scene = parsed.scenes[sceneIndex];
    
    if (!scene.hasImage) {
      scene.hasImage = true;
      scene.imageIndex = imageIdx++;
      
      // Görsel betimleme yoksa ekle
      if (!scene.visualDescription) {
        scene.visualDescription = `Cinematic photograph of the scene: ${scene.text.substring(0, 100)}...`;
      }
    }
  }

  imagesCount = parsed.scenes.filter(s => s.hasImage).length;
  
  logger.info(`Görsel dağıtımı tamamlandı`, {
    finalImages: imagesCount,
    target: desiredImages
  });

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
    
    // 1. İlk 3 dakika - ADAPTE metin için sahne oluştur (RETRY ile)
    logger.info('İlk 3 dakika sahneleri oluşturuluyor (adapte metin)...');
    
    let firstThreeAdapted: SceneData[] = [];
    const MAX_FIRST_THREE_RETRIES = 3;
    
    for (let attempt = 1; attempt <= MAX_FIRST_THREE_RETRIES; attempt++) {
      try {
        firstThreeAdapted = await generateFirstThreeMinutes(
          adaptedContent,
          'adapted',
          model
        );
        
        // Başarılı - döngüden çık
        logger.info(`İlk 3 dakika sahneleri oluşturuldu (deneme ${attempt})`, {
          scenes: firstThreeAdapted.length
        });
        break;
        
      } catch (error) {
        logger.warn(`İlk 3 dakika sahne oluşturma başarısız (deneme ${attempt}/${MAX_FIRST_THREE_RETRIES})`, {
          error: error instanceof Error ? error.message : 'Bilinmeyen hata',
          attempt
        });
        
        if (attempt === MAX_FIRST_THREE_RETRIES) {
          throw error; // Son deneme de başarısızsa hata fırlat
        }
        
        // Bir sonraki deneme için bekle
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }

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

    // ===== METİN UZUNLUĞU KONTROLÜ (KRİTİK!) =====
    const totalAdaptedSceneTextLength = finalScenes
      .map(s => (s.textAdapted || '').length)
      .reduce((a, b) => a + b, 0);
    
    const adaptedContentLength = adaptedContent.length;
    const textCoverageRatio = totalAdaptedSceneTextLength / adaptedContentLength;
    
    logger.info('📏 Metin kapsama oranı kontrolü', {
      adaptedContentLength,
      totalAdaptedSceneTextLength,
      textCoverageRatio: Math.round(textCoverageRatio * 100) + '%',
      lostCharacters: adaptedContentLength - totalAdaptedSceneTextLength
    });

    // ALARM: Metin çok kısalmış!
    if (textCoverageRatio < 0.50) {
      logger.error('🚨 KRİTİK ALARM: Sahne metinleri orijinal içeriğin <%50! Hikaye ciddi şekilde kısaltılmış!', {
        adaptedContentLength,
        totalAdaptedSceneTextLength,
        lostCharacters: adaptedContentLength - totalAdaptedSceneTextLength,
        lostPercentage: Math.round((1 - textCoverageRatio) * 100) + '%',
        expectedMinLength: Math.round(adaptedContentLength * 0.85)
      });
    } else if (textCoverageRatio < 0.70) {
      logger.error('⚠️ UYARI: Sahne metinleri orijinal içeriğin <%70! Hikaye kısaltılmış olabilir.', {
        adaptedContentLength,
        totalAdaptedSceneTextLength,
        textCoverageRatio: Math.round(textCoverageRatio * 100) + '%'
      });
    } else if (textCoverageRatio < 0.85) {
      logger.warn('📉 Metin kapsama oranı düşük (<%85)', {
        textCoverageRatio: Math.round(textCoverageRatio * 100) + '%'
      });
    } else {
      logger.info('✅ Metin kapsama oranı iyi', {
        textCoverageRatio: Math.round(textCoverageRatio * 100) + '%'
      });
    }

    logger.info('Sahne oluşturma tamamlandı', {
      totalScenes: finalScenes.length,
      totalImages,
      firstThreeMinutesScenes: firstThreeAdapted.length,
      estimatedTotalDuration: `${Math.floor(estimatedTotalDuration / 60)}m ${estimatedTotalDuration % 60}s`,
      textCoverageRatio: Math.round(textCoverageRatio * 100) + '%'
    });

    return {
      scenes: finalScenes,
      totalScenes: finalScenes.length,
      totalImages,
      firstThreeMinutesScenes: firstThreeAdapted.length,
      estimatedTotalDuration,
      textCoverageRatio // Yeni: kapsama oranını da döndür
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

⛔ GOOGLE IMAGEFX KISITLAMALARI (ÇOK ÖNEMLİ!):
ImageFX "Prominent People Filter" kullanıyor. Şunlar YASAK:
- ❌ ASLA isim kullanma (Santiago, Carlos, Maria, John vb.)
- ❌ ASLA spesifik yaş belirtme (35-year-old, 8 yaşındaki vb.)
- ❌ ASLA "named X" veya "called X" kalıpları
- ❌ ASLA gerçek kişi referansları
- ❌ ASLA ünlü/tanınmış kişi benzerlikleri

✅ BUNLARI KULLAN:
- "a man", "a woman", "a child", "a teenager", "an elderly person"
- "middle-aged", "young adult", "teenager" (yaş yerine)
- "dark-haired man", "blonde woman" (isim yerine fiziksel özellik)

⚠️ KRİTİK - ASLA EKLEME:
- ASLA metin, yazı, harf, kelime ekleme
- ASLA altyazı, subtitle, caption ekleme
- ASLA filigran, watermark ekleme
- ASLA logo, marka, işaret ekleme

✅ STİL KURALLARI:
1. SADECE "photorealistic cinematic photograph" stili
2. ASLA çizgi film, anime, illüstrasyon, cartoon YAPMA
3. 4K, ultra detailed, cinematic lighting
4. Film seti kalitesinde, profesyonel fotoğraf

${isFirstImage ? `
🎭 KARAKTER TANIMLARI (İLK GÖRSEL - İSİMSİZ!):
- Karakterlerin fiziksel özelliklerini tanımla AMA İSİM KULLANMA
- "the protagonist", "the main character", "a man with..." şeklinde
- Saç rengi, göz rengi, ten rengi, yüz özellikleri
- Kıyafet detayları
- Bu tanımlar sonraki görsellerde tutarlı kalacak
` : `
🎭 KARAKTER TUTARLILIĞI (İSİMSİZ!):
${characterDescriptions || 'Önceki görsellerdeki karakterlerle AYNI fiziksel özellikleri kullan - İSİM KULLANMA'}
`}

📝 PROMPT KURALLARI:
1. İngilizce yaz
2. ${isFirstThreeMinutes ? '150-200 kelime' : '100-150 kelime'}
3. Prompt MUTLAKA şununla başlamalı: "Photorealistic cinematic photograph, no text, no watermarks,"
4. Karakterleri İSİMSİZ tanımla: "the man", "the woman", "the child"
5. Işık, gölge, renk paleti, atmosfer detaylı olsun
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
  'Bu İLK GÖRSEL - Karakterlerin fiziksel özelliklerini DETAYLI tanımla AMA İSİM KULLANMA!' :
  'Önceki görsellerdeki karakterlerle AYNI fiziksel özellikleri kullan - İSİM KULLANMA!'}

⚠️ HATIRLATMA: 
- ASLA isim kullanma (hikayede isim geçse bile "the man", "the woman" yaz)
- ASLA yaş belirtme ("35-year-old" yerine "middle-aged" yaz)
- İsim yerine: "the protagonist", "the main character", "a dark-haired man" vb.

ImageFX için detaylı prompt oluştur. İSİM KULLANMA! Metin/altyazı ekleme!`
          }
        ],
        temperature: isFirstThreeMinutes ? 0.6 : 0.5 // Tutarlılık için daha düşük
      }),
      `Görsel prompt - Sahne ${scene.sceneNumber}`
    );

    // Prompt'u temizle ve GÜÇLÜ anti-cartoon prefix ekle
    let cleanPrompt = response.trim();
    
    // ÇİZGİ FİLM ÖNLEME: Çok güçlü fotorealistik prefix
    const requiredPrefix = 'Ultra realistic photograph shot with Sony A7R IV camera, 85mm f/1.4 lens, real human skin texture with pores and imperfections, real fabric textures, natural lighting, NOT cartoon, NOT anime, NOT illustration, NOT 3D render, NOT CGI, NOT digital art, NOT painting, no text, no subtitles, no captions, no watermarks, clean image,';
    
    // Her zaman prefix ekle (çizgi film önleme için kritik)
    cleanPrompt = `${requiredPrefix} ${cleanPrompt}`;
    
    // Sonuna da GÜÇLÜ stil direktifleri ekle
    const styleSuffix = '. Shot on RED cinema camera, cinematic color grading, shallow depth of field, film grain, real photography, hyper-realistic, photojournalistic style. --no cartoon, anime, illustration, drawing, sketch, 3D render, CGI, digital art, painting, watercolor, comic, manga, pixar, disney, animated';
    cleanPrompt += styleSuffix;

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

