/**
 * Coqui TTS Servisi
 * Kullanıcının Windows bilgisayarında çalışan Coqui TTS sunucusu ile iletişim kurar
 * Cloudflare Tunnel üzerinden bağlantı sağlar
 */

import logger from '@/lib/logger';

// Desteklenen diller (XTTS v2)
export const COQUI_SUPPORTED_LANGUAGES = [
  { code: 'tr', name: 'Türkçe' },
  { code: 'en', name: 'English' },
  { code: 'es', name: 'Español' },
  { code: 'fr', name: 'Français' },
  { code: 'de', name: 'Deutsch' },
  { code: 'it', name: 'Italiano' },
  { code: 'pt', name: 'Português' },
  { code: 'pl', name: 'Polski' },
  { code: 'ru', name: 'Русский' },
  { code: 'nl', name: 'Nederlands' },
  { code: 'cs', name: 'Čeština' },
  { code: 'ar', name: 'العربية' },
  { code: 'zh-cn', name: '中文' },
  { code: 'ja', name: '日本語' },
  { code: 'hu', name: 'Magyar' },
  { code: 'ko', name: '한국어' },
  { code: 'hi', name: 'हिन्दी' },
] as const;

export type CoquiLanguageCode = typeof COQUI_SUPPORTED_LANGUAGES[number]['code'];

export interface CoquiVoice {
  id: string;
  name: string;
  language?: string;
  gender?: string;
  type?: 'builtin' | 'custom';
  description?: string;
  preview_text?: string;
  available?: boolean;
  createdAt?: string;
  filePath?: string;
}

export interface CoquiHealthResponse {
  ok: boolean;
  gpu: boolean;
  modelLoaded: boolean;
  version?: string;
}

export interface CoquiTTSOptions {
  text: string;
  tunnelUrl: string;
  language: CoquiLanguageCode;
  voiceId: string;
  speed?: number; // Konuşma hızı: 0.5-2.0 arası, varsayılan 1.0 (bazı diller için 0.85-0.9 önerilir)
}

export interface GeneratedCoquiAudio {
  audioBuffer: Buffer;
  duration: number;
  text: string;
  language: string;
  voiceId: string;
  generatedAt: Date;
}

/**
 * Tunnel URL'ini normalize et
 */
function normalizeUrl(tunnelUrl: string): string {
  let url = tunnelUrl.trim();
  
  // Protokol yoksa ekle
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    url = `https://${url}`;
  }
  
  // Sondaki slash'ı kaldır
  return url.replace(/\/$/, '');
}

/**
 * Coqui TTS sunucusu bağlantı testi
 */
export async function testCoquiConnection(tunnelUrl: string): Promise<CoquiHealthResponse> {
  const url = normalizeUrl(tunnelUrl);
  
  logger.info('Coqui TTS bağlantı testi başlatılıyor', { tunnelUrl: url });
  
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 saniye timeout
    
    const response = await fetch(`${url}/api/health`, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        'Accept': 'application/json'
      }
    });
    
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      logger.error('Coqui TTS bağlantı hatası', { status: response.status });
      return { ok: false, gpu: false, modelLoaded: false };
    }
    
    const data = await response.json();
    
    logger.info('Coqui TTS bağlantı testi başarılı', { 
      gpu: data.gpu, 
      modelLoaded: data.modelLoaded 
    });
    
    return {
      ok: true,
      gpu: data.gpu || false,
      modelLoaded: data.modelLoaded || false,
      version: data.version
    };
    
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      logger.error('Coqui TTS bağlantı zaman aşımı', { tunnelUrl: url });
    } else {
      logger.error('Coqui TTS bağlantı hatası', {
        error: error instanceof Error ? error.message : 'Bilinmeyen hata',
        tunnelUrl: url
      });
    }
    
    return { ok: false, gpu: false, modelLoaded: false };
  }
}

/**
 * Coqui TTS sunucusundan mevcut sesleri listele
 */
export async function getCoquiVoices(tunnelUrl: string): Promise<CoquiVoice[]> {
  const url = normalizeUrl(tunnelUrl);
  
  logger.debug('Coqui TTS ses listesi çekiliyor', { tunnelUrl: url });
  
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);
    
    const response = await fetch(`${url}/api/voices`, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        'Accept': 'application/json'
      }
    });
    
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const data = await response.json();
    
    logger.info('Coqui TTS ses listesi alındı', { count: data.voices?.length || 0 });
    
    return data.voices || [];
    
  } catch (error) {
    logger.error('Coqui TTS ses listesi hatası', {
      error: error instanceof Error ? error.message : 'Bilinmeyen hata'
    });
    throw error;
  }
}

/**
 * Coqui TTS sunucusuna yeni referans ses yükle
 */
export async function uploadCoquiVoice(
  tunnelUrl: string, 
  audioBuffer: Buffer, 
  name: string,
  language: string = 'tr',
  gender: string = 'unknown'
): Promise<CoquiVoice> {
  const url = normalizeUrl(tunnelUrl);
  
  logger.info('Coqui TTS referans ses yükleniyor', { name, language, gender, size: audioBuffer.length });
  
  try {
    const formData = new FormData();
    // Buffer'ı ArrayBuffer'a çevir ve Blob oluştur
    const arrayBuffer = audioBuffer.buffer.slice(
      audioBuffer.byteOffset, 
      audioBuffer.byteOffset + audioBuffer.byteLength
    ) as ArrayBuffer;
    const blob = new Blob([arrayBuffer], { type: 'audio/wav' });
    formData.append('audio', blob, `${name}.wav`);
    formData.append('name', name);
    formData.append('language', language);
    formData.append('gender', gender);
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);
    
    const response = await fetch(`${url}/api/voices`, {
      method: 'POST',
      signal: controller.signal,
      body: formData
    });
    
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    }
    
    const data = await response.json();
    
    logger.info('Coqui TTS referans ses yüklendi', { voiceId: data.voice?.id });
    
    return data.voice;
    
  } catch (error) {
    logger.error('Coqui TTS ses yükleme hatası', {
      error: error instanceof Error ? error.message : 'Bilinmeyen hata'
    });
    throw error;
  }
}

/**
 * Coqui TTS sunucusundan referans ses sil
 */
export async function deleteCoquiVoice(tunnelUrl: string, voiceId: string): Promise<void> {
  const url = normalizeUrl(tunnelUrl);
  
  logger.info('Coqui TTS referans ses siliniyor', { voiceId });
  
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    
    const response = await fetch(`${url}/api/voices/${voiceId}`, {
      method: 'DELETE',
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    }
    
    logger.info('Coqui TTS referans ses silindi', { voiceId });
    
  } catch (error) {
    logger.error('Coqui TTS ses silme hatası', {
      error: error instanceof Error ? error.message : 'Bilinmeyen hata'
    });
    throw error;
  }
}

/**
 * Desteklenen dilleri döndür
 */
export function getCoquiLanguages(): typeof COQUI_SUPPORTED_LANGUAGES {
  return COQUI_SUPPORTED_LANGUAGES;
}

/**
 * MP3/WAV audio buffer'ının süresini tahmin et
 */
function estimateAudioDuration(buffer: Buffer, text: string): number {
  // WAV 44.1kHz 16-bit mono için ~88 KB/saniye
  // Basit tahmin
  const bytesPerSecond = 88000;
  const estimatedDuration = buffer.length / bytesPerSecond;
  
  // Alternatif: Kelime sayısına göre (ortalama okuma hızı: ~150 kelime/dakika)
  const wordCount = text.trim().split(/\s+/).length;
  const wordBasedDuration = (wordCount / 150) * 60;
  
  // İki tahminin ortalaması
  const avgDuration = (estimatedDuration + wordBasedDuration) / 2;
  
  return Math.max(1, Math.round(avgDuration * 10) / 10);
}

/**
 * Chunk ayarları - adaptif boyutlandırma
 */
interface ChunkOptions {
  minLength: number;      // Minimum chunk boyutu
  targetLength: number;   // Hedef chunk boyutu
  maxLength: number;      // Maksimum chunk boyutu
}

const DEFAULT_CHUNK_OPTIONS: ChunkOptions = {
  minLength: 150,   // Çok kısa parçaları önle (sessizlik sorunu)
  targetLength: 400, // İdeal boyut
  maxLength: 600    // Coqui için güvenli üst limit
};

/**
 * Yaygın kısaltmaları korumak için placeholder ile değiştir
 * Bu sayede kısaltmalardaki nokta cümle sonu olarak algılanmaz
 */
const ABBREVIATIONS: Array<{ pattern: RegExp; placeholder: string; original: string }> = [
  { pattern: /Dr\./gi, placeholder: '§DR§', original: 'Dr.' },
  { pattern: /Prof\./gi, placeholder: '§PROF§', original: 'Prof.' },
  { pattern: /Mr\./gi, placeholder: '§MR§', original: 'Mr.' },
  { pattern: /Mrs\./gi, placeholder: '§MRS§', original: 'Mrs.' },
  { pattern: /Ms\./gi, placeholder: '§MS§', original: 'Ms.' },
  { pattern: /Jr\./gi, placeholder: '§JR§', original: 'Jr.' },
  { pattern: /Sr\./gi, placeholder: '§SR§', original: 'Sr.' },
  { pattern: /vs\./gi, placeholder: '§VS§', original: 'vs.' },
  { pattern: /vb\./gi, placeholder: '§VB§', original: 'vb.' },
  { pattern: /örn\./gi, placeholder: '§ORN§', original: 'örn.' },
  { pattern: /yy\./gi, placeholder: '§YY§', original: 'yy.' },
  { pattern: /no\./gi, placeholder: '§NO§', original: 'no.' },
  { pattern: /St\./gi, placeholder: '§ST§', original: 'St.' },
  { pattern: /Ave\./gi, placeholder: '§AVE§', original: 'Ave.' },
  { pattern: /Ltd\./gi, placeholder: '§LTD§', original: 'Ltd.' },
  { pattern: /Inc\./gi, placeholder: '§INC§', original: 'Inc.' },
  { pattern: /etc\./gi, placeholder: '§ETC§', original: 'etc.' },
];

/**
 * Kısaltmaları placeholder ile değiştir
 */
function protectAbbreviations(text: string): string {
  let result = text;
  for (const abbr of ABBREVIATIONS) {
    result = result.replace(abbr.pattern, abbr.placeholder);
  }
  return result;
}

/**
 * Placeholder'ları orijinal kısaltmalarla değiştir
 */
function restoreAbbreviations(text: string): string {
  let result = text;
  for (const abbr of ABBREVIATIONS) {
    result = result.replace(new RegExp(abbr.placeholder, 'g'), abbr.original);
  }
  return result;
}

/**
 * Metni öncelik sırasına göre bölme noktalarından ayır
 * Öncelik: Paragraf > Satır sonu > Cümle sonu > Noktalı virgül > Virgül
 */
function findBestSplitPoint(text: string, maxLength: number): number {
  if (text.length <= maxLength) return text.length;
  
  const searchRange = text.substring(0, maxLength);
  
  // 1. Öncelik: Paragraf sonu (\n\n)
  const paragraphEnd = searchRange.lastIndexOf('\n\n');
  if (paragraphEnd > maxLength * 0.3) {
    return paragraphEnd + 2; // \n\n dahil
  }
  
  // 2. Öncelik: Satır sonu (\n)
  const lineEnd = searchRange.lastIndexOf('\n');
  if (lineEnd > maxLength * 0.3) {
    return lineEnd + 1;
  }
  
  // 3. Öncelik: Cümle sonu (.!?)
  // Son cümle sonunu bul (lookbehind olmadan)
  let lastSentenceEnd = -1;
  for (let i = searchRange.length - 1; i >= Math.floor(maxLength * 0.3); i--) {
    const char = searchRange[i];
    if (char === '.' || char === '!' || char === '?' || char === '।' || char === '。' || char === '？' || char === '！') {
      // Kısaltma placeholder'ı değilse
      if (searchRange[i + 1] === ' ' || searchRange[i + 1] === '\n' || i === searchRange.length - 1) {
        lastSentenceEnd = i;
        break;
      }
    }
  }
  if (lastSentenceEnd > maxLength * 0.3) {
    return lastSentenceEnd + 1;
  }
  
  // 4. Öncelik: Noktalı virgül veya iki nokta (;:)
  let lastSemicolon = -1;
  for (let i = searchRange.length - 1; i >= Math.floor(maxLength * 0.4); i--) {
    const char = searchRange[i];
    if (char === ';' || char === ':') {
      lastSemicolon = i;
      break;
    }
  }
  if (lastSemicolon > maxLength * 0.4) {
    return lastSemicolon + 1;
  }
  
  // 5. Öncelik: Virgül (son çare)
  const lastComma = searchRange.lastIndexOf(',');
  if (lastComma > maxLength * 0.5) {
    return lastComma + 1;
  }
  
  // 6. Son çare: Boşluk
  const lastSpace = searchRange.lastIndexOf(' ');
  if (lastSpace > maxLength * 0.6) {
    return lastSpace + 1;
  }
  
  // Hiçbir bölme noktası bulunamadı, maxLength'te kes
  return maxLength;
}

/**
 * Çok kısa chunk'ları bir sonraki chunk ile birleştir
 */
function mergeShortChunks(chunks: string[], minLength: number): string[] {
  if (chunks.length <= 1) return chunks;
  
  const merged: string[] = [];
  let pendingChunk = '';
  
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    
    if (pendingChunk) {
      // Önceki kısa chunk'ı bu chunk ile birleştir
      pendingChunk = pendingChunk + ' ' + chunk;
      
      if (pendingChunk.length >= minLength || i === chunks.length - 1) {
        merged.push(pendingChunk.trim());
        pendingChunk = '';
      }
    } else if (chunk.length < minLength && i < chunks.length - 1) {
      // Bu chunk çok kısa, bir sonraki ile birleştir
      pendingChunk = chunk;
    } else {
      merged.push(chunk.trim());
    }
  }
  
  // Kalan pending chunk varsa ekle
  if (pendingChunk) {
    if (merged.length > 0) {
      // Son chunk ile birleştir
      merged[merged.length - 1] = merged[merged.length - 1] + ' ' + pendingChunk;
    } else {
      merged.push(pendingChunk.trim());
    }
  }
  
  return merged.filter(c => c.length > 0);
}

/**
 * Metni akıllı şekilde parçalara ayır (gelişmiş chunking)
 * - Paragraf yapısını korur
 * - Cümle bütünlüğünü korur
 * - Kısaltmaları korur
 * - Çok kısa parçaları birleştirir (sessizlik sorununu önler)
 */
function splitTextIntoChunks(text: string, options: Partial<ChunkOptions> = {}): string[] {
  const opts = { ...DEFAULT_CHUNK_OPTIONS, ...options };
  
  // Boş veya çok kısa metin
  if (!text || text.trim().length === 0) {
    return [];
  }
  
  if (text.length <= opts.maxLength) {
    return [text.trim()];
  }
  
  // Kısaltmaları koru
  let processedText = protectAbbreviations(text);
  
  const chunks: string[] = [];
  let remaining = processedText;
  
  while (remaining.length > 0) {
    if (remaining.length <= opts.maxLength) {
      // Kalan metin max uzunluktan kısa, direkt ekle
      chunks.push(remaining.trim());
      break;
    }
    
    // En iyi bölme noktasını bul
    const splitPoint = findBestSplitPoint(remaining, opts.maxLength);
    
    const chunk = remaining.substring(0, splitPoint).trim();
    remaining = remaining.substring(splitPoint).trim();
    
    if (chunk.length > 0) {
      chunks.push(chunk);
    }
    
    // Sonsuz döngü koruması
    if (splitPoint === 0) {
      logger.warn('Metin bölme sonsuz döngü riski, kalan metin ekleniyor', {
        remainingLength: remaining.length
      });
      if (remaining.length > 0) {
        chunks.push(remaining.trim());
      }
      break;
    }
  }
  
  // Kısaltmaları geri yükle
  const restoredChunks = chunks.map(chunk => restoreAbbreviations(chunk));
  
  // Çok kısa chunk'ları birleştir
  const mergedChunks = mergeShortChunks(restoredChunks, opts.minLength);
  
  logger.debug('Metin chunklara ayrıldı', {
    originalLength: text.length,
    chunkCount: mergedChunks.length,
    chunkLengths: mergedChunks.map(c => c.length),
    options: opts
  });
  
  return mergedChunks.length > 0 ? mergedChunks : [text.trim()];
}

/**
 * Dile göre varsayılan konuşma hızı
 * Bazı diller doğal olarak daha hızlı konuşulur, yavaşlatmak gerekiyor
 */
const LANGUAGE_SPEED_DEFAULTS: Record<string, number> = {
  'fr': 0.85,    // Fransızca - doğal olarak hızlı
  'es': 0.88,    // İspanyolca - hızlı  
  'it': 0.88,    // İtalyanca - hızlı
  'pt': 0.88,    // Portekizce - hızlı
  'en': 0.92,    // İngilizce - orta-hızlı
  'de': 0.95,    // Almanca - normal
  'tr': 0.95,    // Türkçe - normal
  'ru': 0.92,    // Rusça - orta
  'nl': 0.92,    // Hollandaca - orta
  'pl': 0.92,    // Lehçe - orta
  'ar': 0.90,    // Arapça - biraz yavaş
  'zh-cn': 0.90, // Çince - biraz yavaş
  'ja': 0.88,    // Japonca - hızlı
  'ko': 0.90,    // Korece - biraz yavaş
  'hi': 0.90,    // Hintçe - biraz yavaş
  'cs': 0.92,    // Çekçe - orta
  'hu': 0.92,    // Macarca - orta
};

/**
 * Dile göre varsayılan speed değerini al
 */
export function getDefaultSpeedForLanguage(language: string): number {
  return LANGUAGE_SPEED_DEFAULTS[language.toLowerCase()] || 0.92;
}

/**
 * Settings'ten dil hızını al (kullanıcı ayarları öncelikli)
 */
export function getSpeedFromSettings(
  language: string, 
  languageSpeeds?: Array<{ code: string; speed: number }>
): number {
  // Kullanıcı ayarlarında varsa onu kullan
  if (languageSpeeds && languageSpeeds.length > 0) {
    const userSetting = languageSpeeds.find(
      ls => ls.code.toLowerCase() === language.toLowerCase()
    );
    if (userSetting) {
      return userSetting.speed;
    }
  }
  
  // Yoksa varsayılan değeri döndür
  return getDefaultSpeedForLanguage(language);
}

/**
 * Tek bir metin parçası için ses üret
 */
async function generateSingleChunk(
  url: string,
  text: string,
  language: string,
  voiceId: string,
  speed: number = 1.0,
  timeoutMs: number = 120000
): Promise<Buffer> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${url}/api/tts`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'audio/wav'
      },
      body: JSON.stringify({
        text,
        language,
        voice_id: voiceId,
        speed // Konuşma hızı (XTTS destekliyorsa)
      })
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);

  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}

/**
 * WAV header'dan sample rate ve diğer bilgileri oku
 */
function parseWavHeader(buffer: Buffer): { sampleRate: number; bitsPerSample: number; numChannels: number } {
  return {
    numChannels: buffer.readUInt16LE(22),
    sampleRate: buffer.readUInt32LE(24),
    bitsPerSample: buffer.readUInt16LE(34)
  };
}

/**
 * Belirli sürede sessizlik buffer'ı oluştur
 * @param durationMs Sessizlik süresi (milisaniye)
 * @param sampleRate Sample rate (Hz)
 * @param bitsPerSample Bit derinliği
 * @param numChannels Kanal sayısı
 */
function createSilenceBuffer(
  durationMs: number, 
  sampleRate: number = 24000, 
  bitsPerSample: number = 16, 
  numChannels: number = 1
): Buffer {
  const bytesPerSample = bitsPerSample / 8;
  const numSamples = Math.floor((durationMs / 1000) * sampleRate);
  const dataSize = numSamples * bytesPerSample * numChannels;
  
  // Sessizlik = sıfır değerli samples
  return Buffer.alloc(dataSize, 0);
}

/**
 * WAV buffer'ları birleştir (gelişmiş - sessizlik ekleme destekli)
 * @param buffers Birleştirilecek WAV buffer'ları
 * @param silenceMs Parçalar arası eklenecek sessizlik süresi (milisaniye)
 */
function concatenateWavBuffers(buffers: Buffer[], silenceMs: number = 50): Buffer {
  if (buffers.length === 0) throw new Error('Birleştirilecek buffer yok');
  if (buffers.length === 1) return buffers[0];

  // İlk buffer'ın header'ını kullan (44 byte WAV header)
  const headerSize = 44;
  const header = buffers[0].slice(0, headerSize);
  
  // WAV bilgilerini oku
  const wavInfo = parseWavHeader(buffers[0]);
  
  // Parçalar arası sessizlik buffer'ı oluştur
  const silenceBuffer = silenceMs > 0 
    ? createSilenceBuffer(silenceMs, wavInfo.sampleRate, wavInfo.bitsPerSample, wavInfo.numChannels)
    : Buffer.alloc(0);
  
  // Tüm data'ları topla (header hariç, aralarına sessizlik ekle)
  const dataParts: Buffer[] = [];
  
  for (let i = 0; i < buffers.length; i++) {
    // Buffer'ın data kısmını ekle
    dataParts.push(buffers[i].slice(headerSize));
    
    // Son buffer değilse araya sessizlik ekle
    if (i < buffers.length - 1 && silenceBuffer.length > 0) {
      dataParts.push(silenceBuffer);
    }
  }
  
  const totalDataSize = dataParts.reduce((sum, part) => sum + part.length, 0);
  const result = Buffer.alloc(headerSize + totalDataSize);
  
  // Header'ı kopyala
  header.copy(result, 0);
  
  // Data boyutlarını güncelle
  result.writeUInt32LE(totalDataSize + 36, 4); // ChunkSize
  result.writeUInt32LE(totalDataSize, 40); // Subchunk2Size
  
  // Data'ları birleştir
  let offset = headerSize;
  for (const part of dataParts) {
    part.copy(result, offset);
    offset += part.length;
  }
  
  logger.debug('WAV buffer\'ları birleştirildi', {
    bufferCount: buffers.length,
    silenceMs,
    totalDataSize,
    resultSize: result.length
  });
  
  return result;
}

/**
 * Coqui TTS ile ses üret (gelişmiş chunking destekli)
 */
export async function generateSpeechWithCoqui(options: CoquiTTSOptions): Promise<GeneratedCoquiAudio> {
  const { text, tunnelUrl, language, voiceId, speed } = options;
  const url = normalizeUrl(tunnelUrl);
  
  // Dile göre varsayılan hız veya kullanıcının belirttiği hız
  const effectiveSpeed = speed ?? getDefaultSpeedForLanguage(language);
  
  // Metin çok uzunsa akıllı chunk'lara ayır
  const chunks = splitTextIntoChunks(text, DEFAULT_CHUNK_OPTIONS);
  
  logger.info('Coqui TTS ses üretimi başlatılıyor', {
    textLength: text.length,
    chunks: chunks.length,
    language,
    voiceId,
    speed: effectiveSpeed
  });
  
  try {
    const audioBuffers: Buffer[] = [];
    
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      
      logger.debug(`Chunk ${i + 1}/${chunks.length} işleniyor`, {
        chunkLength: chunk.length,
        preview: chunk.substring(0, 50)
      });
      
      // Her chunk için 120 saniye timeout
      const buffer = await generateSingleChunk(url, chunk, language, voiceId, effectiveSpeed, 120000);
      audioBuffers.push(buffer);
      
      logger.debug(`Chunk ${i + 1}/${chunks.length} tamamlandı`, {
        bufferSize: buffer.length
      });
    }
    
    // Chunk'ları birleştir (parçalar arası 50ms sessizlik ekle)
    const audioBuffer = chunks.length > 1 
      ? concatenateWavBuffers(audioBuffers, 50)
      : audioBuffers[0];
    
    const duration = estimateAudioDuration(audioBuffer, text);
    
    logger.info('Coqui TTS ses üretimi tamamlandı', {
      bufferSize: audioBuffer.length,
      duration: `${duration}s`,
      chunks: chunks.length
    });
    
    return {
      audioBuffer,
      duration,
      text,
      language,
      voiceId,
      generatedAt: new Date()
    };
    
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      logger.error('Coqui TTS ses üretimi zaman aşımı', { textLength: text.length });
      throw new Error('Ses üretimi zaman aşımına uğradı. Metin çok uzun olabilir.');
    }
    
    logger.error('Coqui TTS ses üretimi hatası', {
      error: error instanceof Error ? error.message : 'Bilinmeyen hata',
      textLength: text.length
    });
    
    throw error;
  }
}

/**
 * Birden fazla metni Coqui TTS ile sese çevir (sıralı)
 * Not: Coqui TTS lokal çalıştığı için paralel istek yapılmamalı
 */
export async function generateCoquiAudios(
  texts: Array<{ sceneNumber: number; text: string }>,
  tunnelUrl: string,
  language: CoquiLanguageCode,
  voiceId: string
): Promise<Map<number, GeneratedCoquiAudio>> {
  logger.info('Coqui TTS toplu ses üretimi başlatılıyor', {
    totalTexts: texts.length,
    language,
    voiceId
  });
  
  const results = new Map<number, GeneratedCoquiAudio>();
  const errors: Array<{ sceneNumber: number; error: string }> = [];
  
  // Sıralı üretim (Coqui TTS GPU'da tek seferde bir ses üretir)
  for (const { sceneNumber, text } of texts) {
    try {
      logger.debug(`Sahne ${sceneNumber} sesi üretiliyor...`);
      
      const audio = await generateSpeechWithCoqui({
        text,
        tunnelUrl,
        language,
        voiceId
      });
      
      results.set(sceneNumber, audio);
      logger.debug(`Sahne ${sceneNumber} sesi tamamlandı`);
      
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Bilinmeyen hata';
      errors.push({ sceneNumber, error: errorMsg });
      logger.error(`Sahne ${sceneNumber} sesi başarısız`, { error: errorMsg });
    }
  }
  
  logger.info('Coqui TTS toplu ses üretimi tamamlandı', {
    successful: results.size,
    failed: errors.length,
    total: texts.length
  });
  
  if (errors.length > 0) {
    logger.warn('Bazı sesler üretilemedi', { errors });
  }
  
  if (results.size === 0 && texts.length > 0) {
    throw new Error(`Hiçbir ses üretilemedi. Hatalar: ${JSON.stringify(errors)}`);
  }
  
  return results;
}

/**
 * Coqui TTS sağlık kontrolü
 */
export async function coquiHealthCheck(tunnelUrl: string): Promise<boolean> {
  try {
    const health = await testCoquiConnection(tunnelUrl);
    return health.ok && health.modelLoaded;
  } catch {
    return false;
  }
}

/**
 * Belirli bir sesin önizleme sesini getir
 */
export async function getCoquiVoicePreview(tunnelUrl: string, voiceId: string): Promise<Buffer> {
  const url = normalizeUrl(tunnelUrl);
  
  logger.info('Coqui TTS ses önizlemesi getiriliyor', { voiceId, tunnelUrl: url });
  
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000); // 60 saniye timeout (önizleme üretimi uzun sürebilir)
    
    const response = await fetch(`${url}/api/voices/${voiceId}/preview`, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        'Accept': 'audio/wav'
      }
    });
    
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      const errorText = await response.text();
      logger.error('Coqui TTS önizleme hatası', { 
        status: response.status, 
        error: errorText,
        voiceId 
      });
      throw new Error(`Önizleme getirilemedi: ${response.status} - ${errorText}`);
    }
    
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    
    logger.info('Coqui TTS önizleme başarıyla alındı', { 
      voiceId, 
      size: buffer.length 
    });
    
    return buffer;
    
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      logger.error('Coqui TTS önizleme zaman aşımı', { voiceId });
      throw new Error('Önizleme getirme zaman aşımına uğradı');
    }
    
    logger.error('Coqui TTS önizleme hatası', { 
      error: error instanceof Error ? error.message : 'Bilinmeyen hata',
      voiceId
    });
    throw error;
  }
}

/**
 * Belirli bir sesin detaylarını getir
 */
export async function getCoquiVoiceDetails(tunnelUrl: string, voiceId: string): Promise<CoquiVoice | null> {
  const url = normalizeUrl(tunnelUrl);
  
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    
    const response = await fetch(`${url}/api/voices/${voiceId}`, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        'Accept': 'application/json'
      }
    });
    
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      if (response.status === 404) {
        return null;
      }
      throw new Error(`Ses detayları getirilemedi: ${response.status}`);
    }
    
    const data = await response.json();
    return data.voice || null;
    
  } catch (error) {
    logger.error('Coqui TTS ses detayları hatası', { 
      error: error instanceof Error ? error.message : 'Bilinmeyen hata',
      voiceId
    });
    return null;
  }
}

