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
  createdAt: string;
  filePath: string;
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
  name: string
): Promise<CoquiVoice> {
  const url = normalizeUrl(tunnelUrl);
  
  logger.info('Coqui TTS referans ses yükleniyor', { name, size: audioBuffer.length });
  
  try {
    const formData = new FormData();
    const blob = new Blob([audioBuffer], { type: 'audio/wav' });
    formData.append('audio', blob, `${name}.wav`);
    formData.append('name', name);
    
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
 * Coqui TTS ile ses üret
 */
export async function generateSpeechWithCoqui(options: CoquiTTSOptions): Promise<GeneratedCoquiAudio> {
  const { text, tunnelUrl, language, voiceId } = options;
  const url = normalizeUrl(tunnelUrl);
  
  logger.info('Coqui TTS ses üretimi başlatılıyor', {
    textLength: text.length,
    language,
    voiceId
  });
  
  try {
    const controller = new AbortController();
    // Uzun metinler için daha fazla süre ver
    const timeoutMs = Math.max(60000, text.length * 100); // En az 60 saniye, kelime başına 100ms
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    
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
    const audioBuffer = Buffer.from(arrayBuffer);
    
    const duration = estimateAudioDuration(audioBuffer, text);
    
    logger.info('Coqui TTS ses üretimi tamamlandı', {
      bufferSize: audioBuffer.length,
      duration: `${duration}s`,
      textPreview: text.substring(0, 100)
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

