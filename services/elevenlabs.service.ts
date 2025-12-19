/**
 * ElevenLabs Servisi
 * Text-to-Speech ses üretimi
 */

import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';
import logger from '@/lib/logger';
import { ElevenLabsError } from '@/lib/errors';
import { retryElevenLabs } from './retry.service';
import { streamToBuffer } from '@/lib/utils';
import dbConnect from '@/lib/mongodb';
import Settings from '@/models/Settings';

// ElevenLabs istemcisi ve kullanılan API key (cache için)
let elevenlabsClient: ElevenLabsClient | null = null;
let cachedApiKey: string | null = null;

/**
 * Settings'den ElevenLabs API Key'i al
 */
async function getApiKeyFromSettings(): Promise<string | null> {
  try {
    await dbConnect();
    const settings = await Settings.findOne().select('+elevenlabsApiKey');
    return settings?.elevenlabsApiKey || null;
  } catch (error) {
    logger.warn('Settings\'den API key alınamadı', { error });
    return null;
  }
}

/**
 * ElevenLabs istemcisini başlat (async - Settings'den okur)
 */
async function getElevenLabsClient(): Promise<ElevenLabsClient> {
  // Önce Settings'den API key'i kontrol et
  const settingsApiKey = await getApiKeyFromSettings();
  const apiKey = settingsApiKey || process.env.ELEVENLABS_API_KEY;
  
  if (!apiKey) {
    throw new ElevenLabsError('ElevenLabs API Key tanımlanmamış. Lütfen Ayarlar sayfasından veya ELEVENLABS_API_KEY ortam değişkeninden girin.');
  }

  // API key değişmişse yeni client oluştur
  if (elevenlabsClient && cachedApiKey === apiKey) {
    return elevenlabsClient;
  }

  elevenlabsClient = new ElevenLabsClient({ apiKey });
  cachedApiKey = apiKey;
  
  logger.info('ElevenLabs istemcisi başlatıldı', { 
    source: settingsApiKey ? 'settings' : 'env' 
  });
  
  return elevenlabsClient;
}

export interface ElevenLabsVoice {
  voice_id: string;
  name: string;
  description?: string;
  preview_url?: string;
  category?: string;
  labels?: Record<string, string>;
}

export interface GenerateAudioOptions {
  text: string;
  voiceId: string;
  modelId?: string;
  stability?: number;
  similarityBoost?: number;
  style?: number;
  useSpeakerBoost?: boolean;
  speed?: number; // 0.7-1.2 arası, varsayılan 1.0
}

export interface GeneratedAudio {
  audioBuffer: Buffer;
  duration: number;
  voiceId: string;
  text: string;
  generatedAt: Date;
}

/**
 * Tüm sesleri listeler
 */
export async function listVoices(): Promise<ElevenLabsVoice[]> {
  try {
    const client = await getElevenLabsClient();
    
    logger.debug('ElevenLabs sesleri çekiliyor...');
    
    const response = await client.voices.getAll();
    
    const voices: ElevenLabsVoice[] = response.voices.map(v => ({
      voice_id: v.voiceId,
      name: v.name || 'Unknown Voice',
      description: v.description || '',
      preview_url: v.previewUrl,
      category: v.category as string,
      labels: v.labels || {}
    }));
    
    logger.info('ElevenLabs sesleri çekildi', { count: voices.length });
    
    return voices;
    
  } catch (error) {
    logger.error('ElevenLabs ses listesi hatası', {
      error: error instanceof Error ? error.message : 'Bilinmeyen hata'
    });
    
    throw new ElevenLabsError(
      `Ses listesi alınamadı: ${error instanceof Error ? error.message : 'Bilinmeyen hata'}`
    );
  }
}

/**
 * Tek bir sesin detaylarını getirir
 */
export async function getVoice(voiceId: string): Promise<ElevenLabsVoice> {
  try {
    const client = await getElevenLabsClient();
    
    const voice = await client.voices.get(voiceId);
    
    return {
      voice_id: voice.voiceId,
      name: voice.name || 'Unknown Voice',
      description: voice.description || '',
      preview_url: voice.previewUrl,
      category: voice.category as string,
      labels: voice.labels || {}
    };
    
  } catch (error) {
    logger.error('ElevenLabs ses detayı hatası', {
      voiceId,
      error: error instanceof Error ? error.message : 'Bilinmeyen hata'
    });
    
    throw new ElevenLabsError(
      `Ses detayı alınamadı (${voiceId}): ${error instanceof Error ? error.message : 'Bilinmeyen hata'}`
    );
  }
}

/**
 * MP3 audio buffer'ının süresini tahmin eder
 */
function estimateAudioDuration(buffer: Buffer, text: string): number {
  // Basit tahmin: MP3 128kbps için ~16 KB/saniye
  const bytesPerSecond = 16000;
  const estimatedDuration = buffer.length / bytesPerSecond;
  
  // Alternatif tahmin: Kelime sayısına göre (ortalama okuma hızı: ~150 kelime/dakika)
  const wordCount = text.trim().split(/\s+/).length;
  const wordBasedDuration = (wordCount / 150) * 60;
  
  // İki tahminin ortalamasını al
  const avgDuration = (estimatedDuration + wordBasedDuration) / 2;
  
  return Math.round(avgDuration * 10) / 10; // 1 ondalık basamak
}

/**
 * Metni sese çevirir
 */
export async function generateAudio(options: GenerateAudioOptions): Promise<GeneratedAudio> {
  const {
    text,
    voiceId,
    modelId = 'eleven_flash_v2_5', // Default: En hızlı model (~75ms)
    stability = 0.5,
    similarityBoost = 0.75,
    style = 0,
    useSpeakerBoost = true,
    speed = 0.9 // Varsayılan: biraz yavaş (daha anlaşılır)
  } = options;

  logger.info('Ses üretimi başlatılıyor', {
    voiceId,
    modelId,
    textLength: text.length,
    wordCount: text.trim().split(/\s+/).length,
    speed
  });

  try {
    const client = await getElevenLabsClient();

    // Retry ile ses üret
    const audioStream = await retryElevenLabs(
      async () => {
        return await client.textToSpeech.convert(voiceId, {
          text,
          modelId: modelId,
          voiceSettings: {
            stability,
            similarityBoost: similarityBoost,
            style,
            useSpeakerBoost: useSpeakerBoost,
            speed // Konuşma hızı (0.7-1.2)
          }
        });
      },
      `Ses üretimi: ${text.substring(0, 50)}...`
    );

    // Stream'i Buffer'a çevir
    const audioBuffer = await streamToBuffer(audioStream as any);

    // Ses süresini tahmin et
    const duration = estimateAudioDuration(audioBuffer, text);

    logger.info('Ses başarıyla üretildi', {
      voiceId,
      bufferSize: audioBuffer.length,
      duration: `${duration}s`,
      textPreview: text.substring(0, 100)
    });

    return {
      audioBuffer,
      duration,
      voiceId,
      text,
      generatedAt: new Date()
    };

  } catch (error) {
    logger.error('Ses üretimi hatası', {
      error: error instanceof Error ? error.message : 'Bilinmeyen hata',
      voiceId,
      textLength: text.length
    });

    // Hata tipine göre özel mesaj
    if (error instanceof Error) {
      if (error.message.includes('quota') || error.message.includes('limit')) {
        throw new ElevenLabsError(
          `ElevenLabs quota veya limit aşıldı: ${error.message}`
        );
      }
      if (error.message.includes('voice')) {
        throw new ElevenLabsError(
          `Geçersiz ses ID (${voiceId}): ${error.message}`
        );
      }
    }

    throw new ElevenLabsError(
      `Ses üretimi başarısız (${voiceId}): ${error instanceof Error ? error.message : 'Bilinmeyen hata'}`
    );
  }
}

/**
 * Birden fazla metni sese çevirir (paralel)
 */
export async function generateAudios(
  texts: Array<{ sceneNumber: number; text: string }>,
  voiceId: string,
  options?: Partial<GenerateAudioOptions>
): Promise<Map<number, GeneratedAudio>> {
  logger.info('Toplu ses üretimi başlatılıyor', {
    totalTexts: texts.length,
    voiceId
  });

  const results = new Map<number, GeneratedAudio>();
  const errors: Array<{ sceneNumber: number; error: string }> = [];

  // Paralel üretim (ElevenLabs rate limit'e dikkat!)
  // Her seferinde 5 ses üretelim
  const BATCH_SIZE = 5;
  const DELAY_BETWEEN_BATCHES_MS = 3000; // 3 saniye

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    
    logger.debug(`Batch ${Math.floor(i / BATCH_SIZE) + 1} üretiliyor`, {
      scenes: batch.map(b => b.sceneNumber)
    });

    const batchPromises = batch.map(async ({ sceneNumber, text }) => {
      try {
        const audio = await generateAudio({
          text,
          voiceId,
          ...options
        });
        results.set(sceneNumber, audio);
        logger.debug(`Sahne ${sceneNumber} sesi tamamlandı`);
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Bilinmeyen hata';
        errors.push({ sceneNumber, error: errorMsg });
        logger.error(`Sahne ${sceneNumber} sesi başarısız`, { error: errorMsg });
      }
    });

    await Promise.all(batchPromises);

    // Batch'ler arası bekleme (son batch hariç)
    if (i + BATCH_SIZE < texts.length) {
      logger.debug(`${DELAY_BETWEEN_BATCHES_MS}ms bekleniyor...`);
      await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_BATCHES_MS));
    }
  }

  logger.info('Toplu ses üretimi tamamlandı', {
    successful: results.size,
    failed: errors.length,
    total: texts.length
  });

  if (errors.length > 0) {
    logger.warn('Bazı sesler üretilemedi', { errors });
  }

  if (results.size === 0) {
    throw new ElevenLabsError(`Hiçbir ses üretilemedi. Hatalar: ${JSON.stringify(errors)}`);
  }

  return results;
}

/**
 * ElevenLabs sağlık kontrolü
 */
export async function healthCheck(): Promise<boolean> {
  try {
    const voices = await listVoices();
    
    if (voices.length === 0) {
      logger.warn('ElevenLabs sağlık kontrolü: Ses bulunamadı');
      return false;
    }

    logger.info('ElevenLabs sağlık kontrolü başarılı', {
      voiceCount: voices.length
    });

    return true;

  } catch (error) {
    logger.error('ElevenLabs sağlık kontrolü başarısız', {
      error: error instanceof Error ? error.message : 'Bilinmeyen hata'
    });
    return false;
  }
}

