/**
 * Sahne Servisi
 * Hikayeyi sahnelere ayırır ve görsel promptlar oluşturur
 * İLK 3 DAKİKA STRATEJİSİ: 5 görsel + kalan 5 görsel = 10 toplam
 */

import logger from '@/lib/logger';
import { OpenAIError, SceneValidationError } from '@/lib/errors';
import { retryOpenAI } from './retry.service';
import { 
  createCompletion, 
  parseJSONResponse, 
  estimateTokens, 
  type LLMProvider 
} from './llm-router.service';
import { IMAGE_SETTINGS } from '@/lib/constants';
import { IVisualStyle } from '@/models/VisualStyle';

interface PromptScenario {
  sceneFirstThreeSystemPrompt?: string;
  sceneFirstThreeUserPrompt?: string;
  sceneRemainingSystemPrompt?: string;
  sceneRemainingUserPrompt?: string;
  visualPromptSystemPrompt?: string;
  visualPromptUserPrompt?: string;
}

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
  provider?: LLMProvider;
  promptScenario?: PromptScenario | null;
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
 * METIN TABANLI SAHNE BÖLME - KAYIP YOK!
 * Adapte metni hedef sahne sayısına göre cümle sınırlarında böler.
 * Bu fonksiyon TÜM METNİ KORUR, hiçbir karakter kaybolmaz.
 * 
 * @param content - Bölünecek metin
 * @param targetSceneCount - Hedef sahne sayısı
 * @param isFirstThreeMinutes - İlk 3 dakika sahneleri mi
 * @param startSceneNumber - Başlangıç sahne numarası
 * @returns SceneData[] - Oluşturulan sahneler (görsel açıklaması olmadan)
 */
function splitContentIntoScenes(
  content: string,
  targetSceneCount: number,
  isFirstThreeMinutes: boolean,
  startSceneNumber: number = 1
): SceneData[] {
  // Metni cümlelere böl (daha doğal kesim için)
  const sentences = content.split(/(?<=[.!?।。？！])\s+/).filter(s => s.trim());
  
  if (sentences.length === 0) {
    logger.warn('splitContentIntoScenes: Cümle bulunamadı, tüm metin tek sahne olarak döndürülüyor');
    return [{
      sceneNumber: startSceneNumber,
      text: content,
      textAdapted: content,
      estimatedDuration: Math.ceil(content.split(/\s+/).length * 0.4),
      hasImage: true,
      imageIndex: startSceneNumber,
      isFirstThreeMinutes
    }];
  }
  
  const scenes: SceneData[] = [];
  const avgSentencesPerScene = Math.ceil(sentences.length / targetSceneCount);
  const avgCharsPerScene = Math.ceil(content.length / targetSceneCount);
  
  let currentText = '';
  let sentenceIndex = 0;
  let sceneNumber = startSceneNumber;
  
  for (let i = 0; i < targetSceneCount; i++) {
    const isLastScene = i === targetSceneCount - 1;
    
    // Son sahne için kalan tüm cümleleri ekle
    if (isLastScene) {
      while (sentenceIndex < sentences.length) {
        currentText += (currentText ? ' ' : '') + sentences[sentenceIndex];
        sentenceIndex++;
      }
    } else {
      // Hedef uzunluğa ulaşana kadar cümle ekle
      while (sentenceIndex < sentences.length) {
        const sentence = sentences[sentenceIndex];
        const newLength = currentText.length + sentence.length + 1;
        
        // Minimum bir cümle ekle, sonra hedef uzunluğu kontrol et
        if (currentText.length > 0 && newLength > avgCharsPerScene * 1.2) {
          break;
        }
        
        currentText += (currentText ? ' ' : '') + sentence;
        sentenceIndex++;
        
        // Hedef uzunluğa ulaştıysak dur
        if (currentText.length >= avgCharsPerScene) {
          break;
        }
      }
    }
    
    // Sahneyi oluştur
    if (currentText.trim()) {
      const wordCount = currentText.split(/\s+/).length;
      scenes.push({
        sceneNumber: sceneNumber,
        text: currentText.trim(),
        textAdapted: currentText.trim(),
        estimatedDuration: Math.ceil(wordCount * 0.4), // ~0.4 saniye/kelime
        hasImage: false, // Görsel dağıtımı sonra yapılacak
        isFirstThreeMinutes
      });
      sceneNumber++;
      currentText = '';
    }
  }
  
  // Eğer kalan cümle varsa son sahneye ekle
  if (sentenceIndex < sentences.length) {
    const remaining = sentences.slice(sentenceIndex).join(' ');
    if (scenes.length > 0) {
      scenes[scenes.length - 1].text += ' ' + remaining;
      scenes[scenes.length - 1].textAdapted += ' ' + remaining;
    }
  }
  
  logger.info('splitContentIntoScenes: Metin tabanlı bölme tamamlandı', {
    inputLength: content.length,
    outputLength: scenes.reduce((sum, s) => sum + s.text.length, 0),
    targetScenes: targetSceneCount,
    actualScenes: scenes.length,
    coverage: Math.round(scenes.reduce((sum, s) => sum + s.text.length, 0) / content.length * 100) + '%'
  });
  
  return scenes;
}

/**
 * LLM'den sadece görsel açıklamalarını al
 * Metin bölme işlemini kendimiz yapacağız, sadece görsel açıklamaları LLM'den alıyoruz
 */
async function generateVisualDescriptionsOnly(
  scenes: SceneData[],
  model: string,
  provider: LLMProvider = 'openai'
): Promise<Map<number, string>> {
  const descriptions = new Map<number, string>();
  
  // Her sahne için özet metin hazırla
  const sceneSummaries = scenes.map(s => ({
    sceneNumber: s.sceneNumber,
    textPreview: s.text.substring(0, 300) + (s.text.length > 300 ? '...' : '')
  }));
  
  const systemPrompt = `Sen görsel sahne uzmanısın. Verilen sahne özetleri için SADECE görsel açıklamaları oluştur.

Her sahne için sinematik, fotorealistik bir görsel açıklaması yaz.

YASAKLAR:
- ❌ Metin, yazı, altyazı içeren görseller
- ❌ Logo, watermark
- ❌ Karikatür, anime, çizim

ZORUNLU:
- ✅ Fotorealistik, sinematik fotoğraf stili
- ✅ Dramatik aydınlatma
- ✅ Detaylı sahne betimleme (ortam, karakterler, atmosfer)

JSON FORMAT:
{
  "descriptions": [
    { "sceneNumber": 1, "visualDescription": "..." },
    ...
  ]
}`;

  const userPrompt = `Bu ${scenes.length} sahne için görsel açıklamaları oluştur:

${JSON.stringify(sceneSummaries, null, 2)}`;

  try {
    const response = await retryOpenAI(
      () => createCompletion({
        provider,
        model,
        systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
        temperature: 0.4,
        responseFormat: 'json_object'
      }),
      'Görsel açıklamaları oluşturma'
    );

    const parsed = parseJSONResponse<{ descriptions: Array<{ sceneNumber: number; visualDescription: string }> }>(
      response, provider, ['descriptions']
    );

    for (const desc of parsed.descriptions) {
      descriptions.set(desc.sceneNumber, desc.visualDescription);
    }

    logger.info('Görsel açıklamaları oluşturuldu', {
      requested: scenes.length,
      received: descriptions.size
    });

  } catch (error) {
    logger.warn('Görsel açıklamaları oluşturulamadı, varsayılan kullanılacak', {
      error: error instanceof Error ? error.message : 'Bilinmeyen hata'
    });
    
    // Fallback: basit açıklamalar
    for (const scene of scenes) {
      descriptions.set(
        scene.sceneNumber,
        `Cinematic dramatic photograph: ${scene.text.substring(0, 100)}...`
      );
    }
  }
  
  return descriptions;
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
 * Varsayılan ilk 3 dakika sahne promptları
 */
const DEFAULT_SCENE_FIRST_THREE_SYSTEM_PROMPT = `Sen hikaye sahne uzmanısın. Hikayenin İLK BÖLÜMÜNÜ sahnelere ayırıyorsun.

⛔ EN ÖNEMLİ KURAL - KISALTMA YASAK:
Sana verilen metin {{INPUT_CHAR_COUNT}} karakter. 
Çıktıdaki TÜM SAHNE METİNLERİNİN TOPLAMI da yaklaşık {{INPUT_CHAR_COUNT}} karakter OLMALI!
Eğer toplam çıktı çok kısaysa, EKSİK BÖLMÜŞSÜN demektir!

📏 UZUNLUK HEDEFİ:
- Giriş: ~{{INPUT_CHAR_COUNT}} karakter
- Çıkış: Tüm scene.text toplamı >= {{MIN_OUTPUT_LENGTH}} karakter olmalı

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
4. Her sahne ~{{AVG_SCENE_LENGTH}} karakter olmalı

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

const DEFAULT_SCENE_FIRST_THREE_USER_PROMPT = `KISALTMADAN 6 SAHNEYE BÖL (toplam ~{{INPUT_CHAR_COUNT}} karakter korunmalı)`;

/**
 * Varsayılan kalan sahneler promptları
 */
const DEFAULT_SCENE_REMAINING_SYSTEM_PROMPT = `Sen hikaye sahne uzmanısın. Hikayenin KALAN KISMINI sahnelere ayırıyorsun.

⛔ EN ÖNEMLİ KURAL - KISALTMA YASAK:
Sana verilen metin {{INPUT_CHAR_COUNT}} karakter.
Çıktıdaki TÜM SAHNE METİNLERİNİN TOPLAMI da yaklaşık {{INPUT_CHAR_COUNT}} karakter OLMALI!
Eğer toplam çıktı çok kısaysa, EKSİK BÖLMÜŞSÜN demektir!

📏 UZUNLUK HEDEFİ:
- Giriş: {{INPUT_CHAR_COUNT}} karakter
- Çıkış: Tüm scene.text toplamı >= {{MIN_OUTPUT_LENGTH}} karakter olmalı
- Tahmini sahne sayısı: {{ESTIMATED_SCENE_COUNT}} (her biri ~800 karakter)

⛔ KESINLIKLE YASAK:
- ❌ METNİ KISALTMA veya ÖZETLEME
- ❌ Cümle, paragraf veya kelime ATLAMA
- ❌ Kendi cümlelerinle YENİDEN YAZMA
- ❌ "..." ile kısaltma yapma
- ❌ Herhangi bir bölümü ÇIKARMA
- ❌ SON KELIMEYE KADAR her şey dahil edilmeli!

✅ ZORUNLU: METNİ AYNEN BÖL
1. Verilen metni {{ESTIMATED_SCENE_COUNT}} PARÇAYA BÖL
2. Her parça "text" alanına KELİMESİ KELİMESİNE kopyalanmalı
3. Hiçbir şey ekleme, hiçbir şey çıkarma - SADECE BÖL
4. Paragraf veya cümle sınırlarında böl
5. TÜM METİN dahil edilmeli - SON KELİMEYE KADAR!

📝 HER SAHNE İÇİN:
- sceneNumber: {{START_SCENE_NUMBER}}'dan başla
- text: VERİLEN METİNDEN KESİT (birebir kopyala!)
- visualDescription: Görsel betimleme (görselli sahnelerde)
- estimatedDuration: 12-20 saniye
- hasImage: true/false (hedef: {{TARGET_IMAGES}} görsel)
- imageIndex: {{START_IMAGE_INDEX}}-{{END_IMAGE_INDEX}} arası
- isFirstThreeMinutes: false

JSON FORMAT:
{
  "scenes": [...],
  "totalTextLength": <tüm scene.text uzunluklarının toplamı>
}`;

const DEFAULT_SCENE_REMAINING_USER_PROMPT = `KISALTMADAN {{ESTIMATED_SCENE_COUNT}} SAHNEYE BÖL (toplam {{INPUT_CHAR_COUNT}} karakter korunmalı)`;

/**
 * Varsayılan görsel prompt promptları
 */
const DEFAULT_VISUAL_PROMPT_SYSTEM_PROMPT = `Sen sinematik görsel prompt yazarısın. Verilen sahne için ImageFX'te kullanılacak İNGİLİZCE prompt yaz.

🎯 ANA GÖREV: Sahnenin ANLAMINI ve DUYGUSUNU yansıtan görsel prompt oluştur.

🎨 STİL TANIMI:
{{STYLE_SYSTEM_PROMPT}}

📸 TEKNİK KURALLAR:
- Kamera açısı, ışık yönü, renk paleti belirt
- Karakterleri fiziksel özelliklerle tanımla (isim KULLANMA)
- Sahnenin duygusal atmosferini yansıt

⛔ YASAKLAR:
- İsim kullanma → "the man", "the woman" kullan
- Yaş belirtme → "middle-aged", "young" kullan  
- Metin/yazı/logo ekleme
- Çizgi film/anime stili

{{CHARACTER_INSTRUCTION}}

Hikaye: {{STORY_CONTEXT}}`;

const DEFAULT_VISUAL_PROMPT_USER_PROMPT = `SAHNE {{SCENE_NUMBER}}:

"{{SCENE_TEXT}}"

{{VISUAL_HINT}}

Bu sahne için sinematik fotoğraf prompt'u yaz. Sahnenin:
- Ana aksiyonu/olayı
- Karakterlerin duygu durumu
- Ortam/mekan detayları
- Işık ve atmosfer

{{CHARACTER_DETAIL_INSTRUCTION}}

SADECE İngilizce prompt yaz, başka açıklama ekleme.`;

/**
 * AŞAMA 1: İlk 3 dakika için sahneler oluştur (6 görsel)
 * NOT: Bu fonksiyona ADAPTE EDİLMİŞ metin gönderilir (isimler ve kültürel unsurlar değiştirilmiş)
 */
async function generateFirstThreeMinutes(
  content: string,
  language: 'original' | 'adapted',
  model: string,
  provider: LLMProvider = 'openai',
  promptScenario?: PromptScenario | null
): Promise<SceneData[]> {
  // İlk 3 dakika için kullanılacak metin (ilk ~15.000 karakter)
  const firstPartContent = content.substring(0, 15000);
  const inputCharCount = firstPartContent.length;
  
  // Değişkenler
  const variables: Record<string, string> = {
    INPUT_CHAR_COUNT: inputCharCount.toString(),
    MIN_OUTPUT_LENGTH: Math.round(inputCharCount * 0.90).toString(),
    AVG_SCENE_LENGTH: Math.round(inputCharCount / 6).toString()
  };

  // Prompt şablonlarını al
  const systemPromptTemplate = promptScenario?.sceneFirstThreeSystemPrompt || DEFAULT_SCENE_FIRST_THREE_SYSTEM_PROMPT;
  const userPromptTemplate = promptScenario?.sceneFirstThreeUserPrompt || DEFAULT_SCENE_FIRST_THREE_USER_PROMPT;

  const systemPrompt = fillPromptTemplate(systemPromptTemplate, variables);
  const userPrompt = fillPromptTemplate(userPromptTemplate, variables);

  const response = await retryOpenAI(
    () => createCompletion({
      provider,
      model,
      systemPrompt,
      cacheableContent: firstPartContent, // Cache için içerik
      cacheTTL: '1h',
      messages: [
        { 
          role: 'user', 
          content: userPrompt
        }
      ],
      temperature: 0.3, // Daha düşük = daha az yaratıcılık = daha az kısaltma
      responseFormat: 'json_object'
    }),
    `İlk 3 dakika sahneleri (${language})`
  );

  const parsed = parseJSONResponse<{ scenes: SceneData[]; notes?: string }>(
    response,
    provider,
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
  firstThreeScenesCount: number = 6,  // İlk 3 dakikada kaç sahne oluşturuldu
  provider: LLMProvider = 'openai',
  promptScenario?: PromptScenario | null
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
  
  // Değişkenler
  const variables: Record<string, string> = {
    INPUT_CHAR_COUNT: inputCharCount.toString(),
    MIN_OUTPUT_LENGTH: Math.round(inputCharCount * 0.90).toString(),
    ESTIMATED_SCENE_COUNT: estimatedSceneCount.toString(),
    START_SCENE_NUMBER: startSceneNumber.toString(),
    TARGET_IMAGES: targetImages.toString(),
    START_IMAGE_INDEX: startImageIndex.toString(),
    END_IMAGE_INDEX: endImageIndex.toString()
  };

  // Prompt şablonlarını al
  const systemPromptTemplate = promptScenario?.sceneRemainingSystemPrompt || DEFAULT_SCENE_REMAINING_SYSTEM_PROMPT;
  const userPromptTemplate = promptScenario?.sceneRemainingUserPrompt || DEFAULT_SCENE_REMAINING_USER_PROMPT;

  const systemPrompt = fillPromptTemplate(systemPromptTemplate, variables);
  const userPrompt = fillPromptTemplate(userPromptTemplate, variables);

  const response = await retryOpenAI(
    () => createCompletion({
      provider,
      model,
      systemPrompt,
      cacheableContent: remainingContent, // Cache için içerik
      cacheTTL: '1h',
      messages: [
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.3,
      responseFormat: 'json_object'
    }),
    `Kalan sahneler (${language})`
  );

  const parsed = parseJSONResponse<{ scenes: SceneData[] }>(response, provider, ['scenes']);

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
 * HİBRİT YAKLAŞIM: LLM ile anlamlı sahne yapısı + Metin tabanlı bölme garantisi
 * 
 * Strateji:
 * 1. LLM ile sahne oluşturmayı dene
 * 2. textCoverageRatio kontrol et
 * 3. Eğer %85 altındaysa → Metin tabanlı bölme yap (KAYIP YOK!)
 * 4. Görsel açıklamalarını koru
 */
export async function generateScenes(options: GenerateScenesOptions): Promise<GenerateScenesResult> {
  const { originalContent, adaptedContent, model, provider = 'openai', promptScenario } = options;

  const MIN_COVERAGE_RATIO = 0.85; // Minimum %85 metin kapsama zorunlu
  const MAX_LLM_RETRIES = 2; // LLM ile maksimum deneme

  logger.info('Sahne oluşturma başlatılıyor (HİBRİT yaklaşım)', {
    model,
    originalLength: originalContent.length,
    adaptedLength: adaptedContent.length,
    minCoverageRatio: MIN_COVERAGE_RATIO
  });

  let llmScenes: SceneData[] = [];
  let textCoverageRatio = 0;
  let usedFallback = false;

  try {
    // ===== AŞAMA 1: LLM İLE SAHNE OLUŞTURMA DENEMESİ =====
    for (let llmAttempt = 1; llmAttempt <= MAX_LLM_RETRIES; llmAttempt++) {
      try {
        logger.info(`LLM ile sahne oluşturma deneniyor (deneme ${llmAttempt}/${MAX_LLM_RETRIES})...`);
        
        // 1. İlk 3 dakika sahneleri
        let firstThreeAdapted: SceneData[] = [];
        const MAX_FIRST_THREE_RETRIES = 3;
        
        for (let attempt = 1; attempt <= MAX_FIRST_THREE_RETRIES; attempt++) {
          try {
            firstThreeAdapted = await generateFirstThreeMinutes(
              adaptedContent,
              'adapted',
              model,
              provider,
              promptScenario
            );
            break;
          } catch (error) {
            if (attempt === MAX_FIRST_THREE_RETRIES) throw error;
            await new Promise(resolve => setTimeout(resolve, 2000));
          }
        }

        // 2. İlk 3 dakikanın bittiği pozisyonu hesapla
        const firstThreeTextLength = firstThreeAdapted
          .map(s => s.text.length)
          .reduce((a, b) => a + b, 0);

        // 3. Kalan sahneler
        const remainingAdapted = await generateRemainingScenes(
          adaptedContent,
          firstThreeTextLength,
          'adapted',
          model,
          firstThreeAdapted.length,
          provider,
          promptScenario
        );

        // 4. Tüm sahneleri birleştir
        llmScenes = [...firstThreeAdapted, ...remainingAdapted];
        
        // 5. textCoverageRatio hesapla
        const totalLLMTextLength = llmScenes.reduce((sum, s) => sum + s.text.length, 0);
        textCoverageRatio = totalLLMTextLength / adaptedContent.length;
        
        logger.info(`LLM sahne sonucu (deneme ${llmAttempt})`, {
          scenes: llmScenes.length,
          totalTextLength: totalLLMTextLength,
          adaptedContentLength: adaptedContent.length,
          textCoverageRatio: Math.round(textCoverageRatio * 100) + '%',
          lostCharacters: adaptedContent.length - totalLLMTextLength
        });

        // 6. Kapsama oranı yeterli mi?
        if (textCoverageRatio >= MIN_COVERAGE_RATIO) {
          logger.info(`✅ LLM sahneleri yeterli kapsama sağlıyor (${Math.round(textCoverageRatio * 100)}% >= ${MIN_COVERAGE_RATIO * 100}%)`);
          break;
        } else {
          logger.warn(`⚠️ LLM sahneleri yetersiz kapsama (${Math.round(textCoverageRatio * 100)}% < ${MIN_COVERAGE_RATIO * 100}%), ${llmAttempt < MAX_LLM_RETRIES ? 'yeniden deneniyor...' : 'fallback kullanılacak'}`);
        }

      } catch (error) {
        logger.warn(`LLM sahne oluşturma hatası (deneme ${llmAttempt}/${MAX_LLM_RETRIES})`, {
          error: error instanceof Error ? error.message : 'Bilinmeyen hata'
        });
        if (llmAttempt === MAX_LLM_RETRIES) {
          logger.warn('LLM denemeleri tükendi, fallback kullanılacak');
        }
      }
    }

    // ===== AŞAMA 2: FALLBACK - METİN TABANLI BÖLME =====
    let finalScenes: SceneData[] = [];

    if (textCoverageRatio < MIN_COVERAGE_RATIO) {
      usedFallback = true;
      logger.info('🔄 METİN TABANLI BÖLME FALLBACK aktif (tüm metin korunacak)');
      
      // Hedef sahne sayısını belirle
      const targetFirstThreeScenes = IMAGE_SETTINGS.FIRST_THREE_MINUTES_IMAGES; // 6
      const targetRemainingScenes = IMAGE_SETTINGS.REMAINING_IMAGES; // 14
      const totalTargetScenes = targetFirstThreeScenes + targetRemainingScenes; // 20
      
      // İlk 3 dakika için karakter hedefi (toplam metnin ~%25'i)
      const firstThreeCharTarget = Math.round(adaptedContent.length * 0.25);
      const firstThreeContent = adaptedContent.substring(0, firstThreeCharTarget);
      const remainingContent = adaptedContent.substring(firstThreeCharTarget);
      
      // Metin tabanlı bölme - İLK 3 DAKİKA
      const firstThreeScenes = splitContentIntoScenes(
        firstThreeContent,
        targetFirstThreeScenes,
        true, // isFirstThreeMinutes
        1 // startSceneNumber
      );
      
      // Metin tabanlı bölme - KALAN
      const remainingScenes = splitContentIntoScenes(
        remainingContent,
        targetRemainingScenes,
        false, // isFirstThreeMinutes
        targetFirstThreeScenes + 1 // startSceneNumber
      );
      
      // Birleştir
      const allTextBasedScenes = [...firstThreeScenes, ...remainingScenes];
      
      // LLM'den görsel açıklamalarını al (veya fallback kullan)
      const visualDescriptions = await generateVisualDescriptionsOnly(allTextBasedScenes, model, provider);
      
      // Görsel açıklamalarını ve görsel indexlerini ekle
      let imageIndex = 1;
      for (const scene of allTextBasedScenes) {
        // Görsel açıklamasını ekle
        scene.visualDescription = visualDescriptions.get(scene.sceneNumber) || 
          `Cinematic dramatic photograph: ${scene.text.substring(0, 100)}...`;
        
        // Görsel indexi ekle
        if (imageIndex <= IMAGE_SETTINGS.TOTAL_IMAGES) {
          scene.hasImage = true;
          scene.imageIndex = imageIndex++;
        }
      }
      
      // Orijinal metni oranlarına göre böl
      const originalSceneTexts = splitAdaptedContentByOriginalRatios(originalContent, allTextBasedScenes);
      
      // Final sahneleri oluştur
      finalScenes = allTextBasedScenes.map((scene, idx) => ({
        ...scene,
        text: originalSceneTexts[idx] || scene.text,
        textAdapted: scene.text
      }));
      
      // Yeni textCoverageRatio hesapla
      const totalFallbackTextLength = finalScenes.reduce((sum, s) => sum + (s.textAdapted || '').length, 0);
      textCoverageRatio = totalFallbackTextLength / adaptedContent.length;
      
      logger.info('✅ Metin tabanlı bölme tamamlandı', {
        totalScenes: finalScenes.length,
        totalTextLength: totalFallbackTextLength,
        textCoverageRatio: Math.round(textCoverageRatio * 100) + '%',
        lostCharacters: adaptedContent.length - totalFallbackTextLength
      });
      
    } else {
      // LLM sahneleri yeterli, onları kullan
      logger.info('LLM sahneleri kullanılıyor (kapsama yeterli)');
      
      // Orijinal metni adapte sahne oranlarına göre böl
      const originalSceneTexts = splitAdaptedContentByOriginalRatios(originalContent, llmScenes);

      // Çift dil şemasında birleştir
      finalScenes = llmScenes.map((adaptedScene, idx) => ({
        sceneNumber: adaptedScene.sceneNumber,
        text: originalSceneTexts[idx] || adaptedScene.text,
        textAdapted: adaptedScene.text,
        visualDescription: adaptedScene.visualDescription,
        estimatedDuration: adaptedScene.estimatedDuration,
        hasImage: adaptedScene.hasImage,
        imageIndex: adaptedScene.imageIndex,
        isFirstThreeMinutes: adaptedScene.isFirstThreeMinutes,
      }));
    }

    // ===== AŞAMA 3: FİNAL VALİDASYONLAR =====
    const totalImages = finalScenes.filter(s => s.hasImage).length;
    const firstThreeImages = finalScenes.filter(s => s.isFirstThreeMinutes && s.hasImage).length;
    const estimatedTotalDuration = finalScenes.reduce((sum, s) => sum + s.estimatedDuration, 0);
    
    // Final textCoverageRatio
    const finalTotalTextLength = finalScenes.reduce((sum, s) => sum + (s.textAdapted || '').length, 0);
    const finalTextCoverageRatio = finalTotalTextLength / adaptedContent.length;
    
    // Görsel sayısı kontrolü
    if (totalImages < IMAGE_SETTINGS.MIN_TOTAL_IMAGES) {
      logger.warn(`Görsel sayısı minimum altında: ${totalImages} < ${IMAGE_SETTINGS.MIN_TOTAL_IMAGES}`);
    }

    logger.info('🎬 Sahne oluşturma tamamlandı', {
      usedFallback,
      totalScenes: finalScenes.length,
      totalImages,
      firstThreeImages,
      estimatedTotalDuration: `${Math.floor(estimatedTotalDuration / 60)}m ${estimatedTotalDuration % 60}s`,
      textCoverageRatio: Math.round(finalTextCoverageRatio * 100) + '%',
      adaptedContentLength: adaptedContent.length,
      finalTextLength: finalTotalTextLength,
      lostCharacters: adaptedContent.length - finalTotalTextLength
    });

    return {
      scenes: finalScenes,
      totalScenes: finalScenes.length,
      totalImages,
      firstThreeMinutesScenes: finalScenes.filter(s => s.isFirstThreeMinutes).length,
      estimatedTotalDuration,
      textCoverageRatio: finalTextCoverageRatio
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
 * @param visualStyle - Opsiyonel: Kullanıcının seçtiği görsel stil
 * @param promptScenario - Opsiyonel: Kullanıcının seçtiği prompt senaryosu
 */
export async function generateVisualPrompts(
  scenes: SceneData[],
  storyContext: string,
  model: string,
  provider: LLMProvider = 'openai',
  visualStyle?: IVisualStyle | null,
  promptScenario?: PromptScenario | null
): Promise<Map<number, string>> {
  logger.info('Görsel promptları oluşturuluyor', {
    totalScenes: scenes.length,
    imageScenes: scenes.filter(s => s.hasImage).length,
    visualStyle: visualStyle?.name || 'varsayılan'
  });

  const prompts = new Map<number, string>();
  const imageScenes = scenes.filter(s => s.hasImage);
  
  // İlk görsel için karakter tanımları (tutarlılık için)
  let mainCharacterDescription = '';
  
  // Stil tanımları - visualStyle varsa kullan, yoksa varsayılanları kullan
  const styleSystemPrompt = visualStyle?.systemPrompt || 
    'Fotorealistik sinematik fotoğraf stili, dramatik aydınlatma, film kalitesi';
  const styleTechnicalPrefix = visualStyle?.technicalPrefix || 
    'Shot on Sony A7R IV, 85mm f/1.4 lens, natural lighting, film grain, shallow depth of field';
  const styleStyleSuffix = visualStyle?.styleSuffix || 
    '--style raw --no text, watermark, logo, cartoon, anime, illustration, 3D render, CGI, drawing';

  // Prompt şablonlarını al
  const systemPromptTemplate = promptScenario?.visualPromptSystemPrompt || DEFAULT_VISUAL_PROMPT_SYSTEM_PROMPT;
  const userPromptTemplate = promptScenario?.visualPromptUserPrompt || DEFAULT_VISUAL_PROMPT_USER_PROMPT;

  for (let i = 0; i < imageScenes.length; i++) {
    const scene = imageScenes[i];
    const isFirstImage = i === 0;
    const isFirstThreeMinutes = scene.isFirstThreeMinutes;
    
    // Dinamik değişkenler
    const characterInstruction = isFirstImage 
      ? `🎭 İLK GÖRSEL - Karakter tanımı oluştur:
Ana karakteri detaylı tanımla: saç rengi/stili, ten rengi, yüz özellikleri, kıyafet.
Bu tanım sonraki görsellerde kullanılacak.`
      : `🎭 KARAKTER TUTARLILIĞI:
${mainCharacterDescription}`;

    const characterDetailInstruction = isFirstImage 
      ? 'Ana karakteri detaylı tanımla.' 
      : 'Karakteri önceki tanımla tutarlı tut.';

    const visualHint = scene.visualDescription 
      ? `Görsel ipucu: ${scene.visualDescription.substring(0, 200)}` 
      : '';

    // Değişkenler
    const variables: Record<string, string> = {
      STYLE_SYSTEM_PROMPT: styleSystemPrompt,
      CHARACTER_INSTRUCTION: characterInstruction,
      STORY_CONTEXT: storyContext.substring(0, 300),
      SCENE_NUMBER: scene.sceneNumber.toString(),
      SCENE_TEXT: scene.text.substring(0, 800),
      VISUAL_HINT: visualHint,
      CHARACTER_DETAIL_INSTRUCTION: characterDetailInstruction
    };

    const systemPrompt = fillPromptTemplate(systemPromptTemplate, variables);
    const userPrompt = fillPromptTemplate(userPromptTemplate, variables);

    const response = await retryOpenAI(
      () => createCompletion({
        provider,
        model,
        systemPrompt,
        cacheableContent: storyContext, // Hikaye context cache'lenir
        cacheTTL: '1h',
        messages: [
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.5
      }),
      `Görsel prompt - Sahne ${scene.sceneNumber}`
    );

    // GPT'den gelen prompt'u temizle
    let scenePrompt = response.trim();
    
    // Eğer prompt stil anahtar kelimesiyle başlamıyorsa prefix ekle
    if (!scenePrompt.toLowerCase().includes('photograph') && !scenePrompt.toLowerCase().includes('photo')) {
      scenePrompt = `Photograph, ${scenePrompt}`;
    }
    
    // Final prompt: [Technical Prefix] + [Scene Content] + [Style Suffix]
    // visualStyle varsa onun değerlerini kullan
    const finalPrompt = `${styleTechnicalPrefix}. ${scenePrompt}. ${styleStyleSuffix}`;

    prompts.set(scene.sceneNumber, finalPrompt);
    
    // İlk görsel için karakter tanımını çıkar ve kaydet
    if (isFirstImage) {
      // GPT'nin oluşturduğu karakter tanımını bul
      const characterMatch = scenePrompt.match(/(?:man|woman|person|character)[^.]*(?:with|wearing|has)[^.]+/i);
      mainCharacterDescription = characterMatch 
        ? `Ana karakter: ${characterMatch[0]}` 
        : `Önceki görseldeki karakterle aynı özellikleri kullan`;
    }
    
    logger.debug(`Görsel prompt oluşturuldu - Sahne ${scene.sceneNumber}`, {
      promptLength: finalPrompt.length,
      isFirstThreeMinutes
    });
  }

  logger.info('Görsel promptları tamamlandı', {
    totalPrompts: prompts.size
  });

  return prompts;
}

