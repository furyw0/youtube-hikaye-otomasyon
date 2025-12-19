/**
 * Zaman Damgalı Transkript Parser Servisi
 * Video transkriptlerini parse eder ve akıllı sahne birleştirme yapar
 */

import logger from '@/lib/logger';
import { IMAGE_SETTINGS } from '@/lib/constants';

// --- Tipler ---

export interface TimestampedSegment {
  startTime: number;      // Saniye cinsinden başlangıç
  endTime: number;        // Saniye cinsinden bitiş (bir sonraki segmentin başlangıcı)
  text: string;           // Segment metni
  duration: number;       // Süre (saniye)
}

export interface TimestampedScene {
  sceneNumber: number;
  text: string;                    // Birleştirilmiş metin (orijinal)
  textAdapted?: string;            // Adapte edilmiş metin
  originalStartTime: number;       // Sahnenin başlangıç zamanı
  originalEndTime: number;         // Sahnenin bitiş zamanı
  originalDuration: number;        // Toplam süre
  estimatedDuration: number;       // Tahmini süre (TTS için)
  hasImage: boolean;
  imageIndex?: number;
  isFirstThreeMinutes: boolean;
  visualDescription?: string;
  segments: TimestampedSegment[];  // Bu sahneyi oluşturan segmentler
}

export interface MergeOptions {
  targetSceneDurationMin?: number;  // Minimum sahne süresi (saniye)
  targetSceneDurationMax?: number;  // Maksimum sahne süresi (saniye)
  firstThreeMinutesScenes?: number; // İlk 3 dakika için hedef sahne sayısı
  remainingScenes?: number;         // Kalan kısım için hedef sahne sayısı
}

export interface ParsedTranscript {
  segments: TimestampedSegment[];
  scenes: TimestampedScene[];
  totalDuration: number;
  totalSegments: number;
  totalScenes: number;
  firstThreeMinutesEnd: number;     // İlk 3 dakikanın bitiş index'i
}

// --- Yardımcı Fonksiyonlar ---

/**
 * Zaman damgasını saniyeye çevirir
 * Desteklenen formatlar: [00:00:00], [00:00], [0:00:00], [0:00]
 * @example "[00:01:30]" -> 90
 * @example "[01:30]" -> 90
 */
export function parseTimestamp(ts: string): number {
  // Köşeli parantezleri temizle
  const cleaned = ts.replace(/[\[\]]/g, '').trim();
  
  const parts = cleaned.split(':').map(p => parseInt(p, 10));
  
  if (parts.length === 3) {
    // HH:MM:SS formatı
    const [hours, minutes, seconds] = parts;
    return hours * 3600 + minutes * 60 + seconds;
  } else if (parts.length === 2) {
    // MM:SS formatı
    const [minutes, seconds] = parts;
    return minutes * 60 + seconds;
  }
  
  logger.warn('Geçersiz zaman damgası formatı', { timestamp: ts });
  return 0;
}

/**
 * Saniyeyi okunabilir formata çevirir
 * @example 90 -> "01:30"
 * @example 3661 -> "01:01:01"
 */
export function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  
  if (hours > 0) {
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Metnin cümle sonu ile bitip bitmediğini kontrol eder
 */
function endsWithSentence(text: string): boolean {
  const trimmed = text.trim();
  return /[.!?।。？！]$/.test(trimmed);
}

// --- Ana Fonksiyonlar ---

/**
 * Zaman damgalı transkripti segmentlere ayırır
 * @param content - Ham transkript içeriği
 * @returns Segment dizisi
 * 
 * @example
 * Input:
 * [00:00:00] İlk satır
 * [00:00:05] İkinci satır
 * 
 * Output:
 * [
 *   { startTime: 0, endTime: 5, text: "İlk satır", duration: 5 },
 *   { startTime: 5, endTime: 5, text: "İkinci satır", duration: 0 }
 * ]
 */
export function parseTimestampedTranscript(content: string): TimestampedSegment[] {
  const segments: TimestampedSegment[] = [];
  
  // Satır satır işle
  const lines = content.split('\n').filter(line => line.trim());
  
  // Zaman damgası regex'i: [HH:MM:SS] veya [MM:SS]
  const timestampRegex = /^\[(\d{1,2}:\d{2}(?::\d{2})?)\]\s*(.*)$/;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const match = line.match(timestampRegex);
    
    if (match) {
      const timestamp = match[1];
      const text = match[2].trim();
      const startTime = parseTimestamp(`[${timestamp}]`);
      
      // Metin boşsa atla
      if (!text) continue;
      
      segments.push({
        startTime,
        endTime: startTime, // Geçici, sonra güncellenecek
        text,
        duration: 0 // Geçici, sonra güncellenecek
      });
    } else {
      // Zaman damgası olmayan satır - önceki segmente ekle
      if (segments.length > 0 && line) {
        segments[segments.length - 1].text += ' ' + line;
      }
    }
  }
  
  // endTime ve duration hesapla
  for (let i = 0; i < segments.length; i++) {
    if (i < segments.length - 1) {
      segments[i].endTime = segments[i + 1].startTime;
    } else {
      // Son segment - tahmini süre ekle (ortalama 3 saniye)
      segments[i].endTime = segments[i].startTime + 3;
    }
    segments[i].duration = segments[i].endTime - segments[i].startTime;
  }
  
  logger.info('Transkript parse edildi', {
    totalSegments: segments.length,
    totalDuration: segments.length > 0 
      ? segments[segments.length - 1].endTime 
      : 0
  });
  
  return segments;
}

/**
 * Segmentleri akıllıca sahnelere birleştirir
 * Strateji: Anlam bütünlüğü + süre dengesi (15-30 saniye arası)
 * 
 * @param segments - Parse edilmiş segmentler
 * @param options - Birleştirme seçenekleri
 * @returns Birleştirilmiş sahneler
 */
export function mergeSegmentsToScenes(
  segments: TimestampedSegment[],
  options: MergeOptions = {}
): TimestampedScene[] {
  const {
    targetSceneDurationMin = 15,
    targetSceneDurationMax = 30,
    firstThreeMinutesScenes = IMAGE_SETTINGS.FIRST_THREE_MINUTES_IMAGES, // 6
    remainingScenes = IMAGE_SETTINGS.REMAINING_IMAGES // 14
  } = options;

  if (segments.length === 0) {
    logger.warn('mergeSegmentsToScenes: Segment bulunamadı');
    return [];
  }

  const totalDuration = segments[segments.length - 1].endTime;
  const firstThreeMinutesDuration = Math.min(180, totalDuration); // İlk 3 dakika (180 saniye)
  
  const scenes: TimestampedScene[] = [];
  let currentSceneSegments: TimestampedSegment[] = [];
  let currentDuration = 0;
  let sceneNumber = 1;
  
  // İlk 3 dakika için ideal sahne süresi
  const idealFirstThreeDuration = firstThreeMinutesDuration / firstThreeMinutesScenes;
  
  // Kalan için ideal sahne süresi
  const remainingDuration = totalDuration - firstThreeMinutesDuration;
  const idealRemainingDuration = remainingDuration > 0 
    ? remainingDuration / remainingScenes 
    : 0;

  /**
   * Mevcut segmentlerden sahne oluştur
   */
  const createScene = (isFirstThreeMinutes: boolean): void => {
    if (currentSceneSegments.length === 0) return;
    
    const firstSegment = currentSceneSegments[0];
    const lastSegment = currentSceneSegments[currentSceneSegments.length - 1];
    const text = currentSceneSegments.map(s => s.text).join(' ');
    
    scenes.push({
      sceneNumber,
      text,
      originalStartTime: firstSegment.startTime,
      originalEndTime: lastSegment.endTime,
      originalDuration: lastSegment.endTime - firstSegment.startTime,
      estimatedDuration: Math.ceil(text.split(/\s+/).length * 0.4), // ~0.4 saniye/kelime
      hasImage: false, // Sonra dağıtılacak
      isFirstThreeMinutes,
      segments: [...currentSceneSegments]
    });
    
    sceneNumber++;
    currentSceneSegments = [];
    currentDuration = 0;
  };

  // Segmentleri işle
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    const isFirstThreeMinutes = segment.startTime < firstThreeMinutesDuration;
    
    // Hedef süreyi belirle
    const targetDuration = isFirstThreeMinutes 
      ? idealFirstThreeDuration 
      : idealRemainingDuration;
    
    // Dinamik min/max hesapla
    // Min: hedefin %70'i veya sabit minimum (15sn), hangisi büyükse
    // Max: hedefin %130'u veya sabit maksimum (45sn), hangisi büyükse
    let dynamicMin = Math.max(targetSceneDurationMin, targetDuration * 0.7);
    let dynamicMax = Math.max(targetSceneDurationMax, targetDuration * 1.3);
    
    // dynamicMax her zaman dynamicMin'den büyük olmalı
    if (dynamicMax <= dynamicMin) {
      dynamicMax = dynamicMin + 15; // En az 15 saniye fark olsun
    }
    
    currentSceneSegments.push(segment);
    currentDuration += segment.duration;
    
    // Sahne oluşturma koşulları
    const shouldCreateScene = 
      // Minimum süreye ulaşıldı VE cümle sonu
      (currentDuration >= dynamicMin && endsWithSentence(segment.text)) ||
      // Maksimum süreyi aştı
      currentDuration >= dynamicMax ||
      // Son segment
      i === segments.length - 1 ||
      // İlk 3 dakika sınırında (SADECE geçiş anında, her segment için değil!)
      (isFirstThreeMinutes && 
       i < segments.length - 1 && 
       segments[i + 1].startTime >= firstThreeMinutesDuration);
    
    if (shouldCreateScene) {
      createScene(isFirstThreeMinutes);
    }
  }
  
  // Kalan segmentler varsa sahne oluştur
  if (currentSceneSegments.length > 0) {
    const isFirstThree = currentSceneSegments[0].startTime < firstThreeMinutesDuration;
    createScene(isFirstThree);
  }

  // Görsel dağılımı yap
  distributeImages(scenes, firstThreeMinutesScenes, remainingScenes);

  logger.info('Segmentler sahnelere birleştirildi', {
    totalSegments: segments.length,
    totalScenes: scenes.length,
    firstThreeMinutesScenes: scenes.filter(s => s.isFirstThreeMinutes).length,
    remainingScenes: scenes.filter(s => !s.isFirstThreeMinutes).length,
    totalDuration: formatDuration(totalDuration),
    avgSceneDuration: scenes.length > 0 
      ? formatDuration(totalDuration / scenes.length)
      : '0',
    idealFirstThreeDuration: formatDuration(idealFirstThreeDuration),
    idealRemainingDuration: formatDuration(idealRemainingDuration)
  });

  return scenes;
}

/**
 * Sahnelere görsel dağıtımı yapar
 * İlk 3 dakika için 6 görsel, kalan için 14 görsel hedeflenir
 */
function distributeImages(
  scenes: TimestampedScene[],
  firstThreeTarget: number,
  remainingTarget: number
): void {
  const firstThreeScenes = scenes.filter(s => s.isFirstThreeMinutes);
  const remainingScenes = scenes.filter(s => !s.isFirstThreeMinutes);
  
  // İlk 3 dakika görsel dağılımı
  const firstThreeCount = Math.min(firstThreeTarget, firstThreeScenes.length);
  if (firstThreeScenes.length > 0 && firstThreeCount > 0) {
    const step = firstThreeScenes.length / firstThreeCount;
    let imageIndex = 1;
    
    for (let i = 0; i < firstThreeCount; i++) {
      const sceneIndex = Math.min(Math.floor(i * step), firstThreeScenes.length - 1);
      firstThreeScenes[sceneIndex].hasImage = true;
      firstThreeScenes[sceneIndex].imageIndex = imageIndex++;
    }
  }
  
  // Kalan görsel dağılımı
  const remainingCount = Math.min(remainingTarget, remainingScenes.length);
  if (remainingScenes.length > 0 && remainingCount > 0) {
    const step = remainingScenes.length / remainingCount;
    let imageIndex = firstThreeCount + 1;
    
    for (let i = 0; i < remainingCount; i++) {
      const sceneIndex = Math.min(Math.floor(i * step), remainingScenes.length - 1);
      remainingScenes[sceneIndex].hasImage = true;
      remainingScenes[sceneIndex].imageIndex = imageIndex++;
    }
  }
}

/**
 * Tam transkript işleme - parse + merge
 * @param content - Ham transkript içeriği
 * @param options - Birleştirme seçenekleri
 * @returns İşlenmiş transkript bilgisi
 */
export function processTimestampedTranscript(
  content: string,
  options: MergeOptions = {}
): ParsedTranscript {
  // 1. Parse
  const segments = parseTimestampedTranscript(content);
  
  if (segments.length === 0) {
    logger.warn('processTimestampedTranscript: Segment bulunamadı');
    return {
      segments: [],
      scenes: [],
      totalDuration: 0,
      totalSegments: 0,
      totalScenes: 0,
      firstThreeMinutesEnd: 0
    };
  }
  
  // 2. Merge
  const scenes = mergeSegmentsToScenes(segments, options);
  
  // 3. İstatistikler
  const totalDuration = segments[segments.length - 1].endTime;
  const firstThreeMinutesEnd = scenes.findIndex(s => !s.isFirstThreeMinutes);
  
  return {
    segments,
    scenes,
    totalDuration,
    totalSegments: segments.length,
    totalScenes: scenes.length,
    firstThreeMinutesEnd: firstThreeMinutesEnd === -1 ? scenes.length : firstThreeMinutesEnd
  };
}

/**
 * Sahnelerden düz metin çıkarır (çeviri/adaptasyon için)
 * Her sahnenin metnini yeni satırla ayırır
 */
export function extractFullTextFromScenes(scenes: TimestampedScene[]): string {
  return scenes.map(s => s.text).join('\n\n');
}

/**
 * Sahne bazlı metin listesi döndürür (sahne bazlı çeviri için)
 */
export function extractSceneTextsForTranslation(scenes: TimestampedScene[]): string[] {
  return scenes.map(s => s.text);
}

/**
 * Adapte edilmiş metinleri sahnelere geri atar
 */
export function applyAdaptedTextsToScenes(
  scenes: TimestampedScene[],
  adaptedTexts: string[]
): TimestampedScene[] {
  if (adaptedTexts.length !== scenes.length) {
    logger.warn('applyAdaptedTextsToScenes: Metin sayısı sahne sayısıyla eşleşmiyor', {
      scenes: scenes.length,
      adaptedTexts: adaptedTexts.length
    });
  }
  
  return scenes.map((scene, index) => ({
    ...scene,
    textAdapted: adaptedTexts[index] || scene.text
  }));
}

/**
 * Transkript formatını doğrular
 * @returns Geçerli mi ve hata mesajları
 */
export function validateTranscriptFormat(content: string): {
  valid: boolean;
  errors: string[];
  warnings: string[];
  stats: {
    lineCount: number;
    timestampedLines: number;
    estimatedDuration: number;
  };
} {
  const errors: string[] = [];
  const warnings: string[] = [];
  
  const lines = content.split('\n').filter(line => line.trim());
  const timestampRegex = /^\[(\d{1,2}:\d{2}(?::\d{2})?)\]/;
  
  let timestampedLines = 0;
  let lastTimestamp = -1;
  let estimatedDuration = 0;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const match = line.match(timestampRegex);
    
    if (match) {
      timestampedLines++;
      const timestamp = parseTimestamp(`[${match[1]}]`);
      
      // Sıralama kontrolü
      if (timestamp < lastTimestamp) {
        warnings.push(`Satır ${i + 1}: Zaman damgası sıralı değil (${formatDuration(timestamp)} < ${formatDuration(lastTimestamp)})`);
      }
      
      lastTimestamp = timestamp;
      estimatedDuration = timestamp;
    }
  }
  
  // Validasyonlar
  if (timestampedLines === 0) {
    errors.push('Hiç zaman damgası bulunamadı. Format: [00:00:00] veya [00:00]');
  }
  
  if (timestampedLines < 10) {
    warnings.push(`Sadece ${timestampedLines} zaman damgalı satır bulundu. Daha fazla segment önerilir.`);
  }
  
  if (estimatedDuration < 60) {
    warnings.push(`Tahmini süre çok kısa: ${formatDuration(estimatedDuration)}`);
  }
  
  return {
    valid: errors.length === 0,
    errors,
    warnings,
    stats: {
      lineCount: lines.length,
      timestampedLines,
      estimatedDuration
    }
  };
}
