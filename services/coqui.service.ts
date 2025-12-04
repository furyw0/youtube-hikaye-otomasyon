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
 * Metni cümle bazında parçalara ayır (chunking)
 * Coqui TTS uzun metinlerde sorun çıkarabiliyor
 */
function splitTextIntoChunks(text: string, maxChunkLength: number = 500): string[] {
  // Cümle sonu işaretlerine göre böl
  const sentences = text.split(/(?<=[.!?।。？！])\s+/);
  const chunks: string[] = [];
  let currentChunk = '';

  for (const sentence of sentences) {
    if (currentChunk.length + sentence.length > maxChunkLength && currentChunk.length > 0) {
      chunks.push(currentChunk.trim());
      currentChunk = sentence;
    } else {
      currentChunk += (currentChunk ? ' ' : '') + sentence;
    }
  }

  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim());
  }

  return chunks.length > 0 ? chunks : [text];
}

/**
 * Tek bir metin parçası için ses üret
 */
async function generateSingleChunk(
  url: string,
  text: string,
  language: string,
  voiceId: string,
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
        voice_id: voiceId
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
 * WAV buffer'ları birleştir (basit concatenation)
 */
function concatenateWavBuffers(buffers: Buffer[]): Buffer {
  if (buffers.length === 0) throw new Error('Birleştirilecek buffer yok');
  if (buffers.length === 1) return buffers[0];

  // İlk buffer'ın header'ını kullan (44 byte WAV header)
  const headerSize = 44;
  const header = buffers[0].slice(0, headerSize);
  
  // Tüm data'ları birleştir (header hariç)
  const dataParts = buffers.map((buf, i) => 
    i === 0 ? buf.slice(headerSize) : buf.slice(headerSize)
  );
  
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
  
  return result;
}

/**
 * Coqui TTS ile ses üret (chunking destekli)
 */
export async function generateSpeechWithCoqui(options: CoquiTTSOptions): Promise<GeneratedCoquiAudio> {
  const { text, tunnelUrl, language, voiceId } = options;
  const url = normalizeUrl(tunnelUrl);
  
  // Metin çok uzunsa chunk'lara ayır
  const MAX_CHUNK_LENGTH = 500; // ~500 karakter, Coqui için güvenli
  const chunks = text.length > MAX_CHUNK_LENGTH 
    ? splitTextIntoChunks(text, MAX_CHUNK_LENGTH)
    : [text];
  
  logger.info('Coqui TTS ses üretimi başlatılıyor', {
    textLength: text.length,
    chunks: chunks.length,
    language,
    voiceId
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
      const buffer = await generateSingleChunk(url, chunk, language, voiceId, 120000);
      audioBuffers.push(buffer);
      
      logger.debug(`Chunk ${i + 1}/${chunks.length} tamamlandı`, {
        bufferSize: buffer.length
      });
    }
    
    // Chunk'ları birleştir
    const audioBuffer = chunks.length > 1 
      ? concatenateWavBuffers(audioBuffers)
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

