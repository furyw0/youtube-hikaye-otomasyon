/**
 * ElevenLabs Servisi
 * Text-to-Speech ses üretimi
 */

import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';
import logger from '@/lib/logger';
import { ElevenLabsError } from '@/lib/errors';
import { retryElevenLabs } from './retry.service';
import { streamToBuffer } from '@/lib/utils';

// ElevenLabs istemcisi
let elevenlabsClient: ElevenLabsClient | null = null;

/**
 * ElevenLabs istemcisini başlat
 */
function getElevenLabsClient(): ElevenLabsClient {
  if (elevenlabsClient) {
    return elevenlabsClient;
  }

  const apiKey = process.env.ELEVENLABS_API_KEY;
  
  if (!apiKey) {
    throw new ElevenLabsError('ELEVENLABS_API_KEY ortam değişkeni tanımlanmamış');
  }

  elevenlabsClient = new ElevenLabsClient({ apiKey });
  
  logger.info('ElevenLabs istemcisi başlatıldı');
  
  return elevenlabsClient;
}

export interface Voice {
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
export async function listVoices(): Promise<Voice[]> {
  const client = getElevenLabsClient();
  
  try {
    logger.debug('ElevenLabs sesleri çekiliyor...');
    
    const response = await client.voices.getAll();
    
    const voices: Voice[] = response.voices.map(v => ({
      voice_id: v.voice_id,
      name: v.name,
      description: v.description,
      preview_url: v.preview_url,
      category: v.category,
      labels: v.labels
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
export async function getVoice(voiceId: string): Promise<Voice> {
  const client = getElevenLabsClient();
  
  try {
    const voice = await client.voices.get(voiceId);
    
    return {
      voice_id: voice.voice_id,
      name: voice.name,
      description: voice.description,
      preview_url: voice.preview_url,
      category: voice.category,
      labels: voice.labels
    };
    
  } catch (error) {
    logger.error('ElevenLabs ses detayı hatası', {
      voiceId,
      error: error instanceof Error ? error.message : 'Bilinmeyen hata'
    });
    
    throw new ElevenLabsError(
      `Ses detayı alınamadı: ${error instanceof Error ? error.message : 'Bilinmeyen hata'}`,
      { voiceId }
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
    modelId = 'eleven_multilingual_v2',
    stability = 0.5,
    similarityBoost = 0.75,
    style = 0,
    useSpeakerBoost = true
  } = options;

  logger.info('Ses üretimi başlatılıyor', {
    voiceId,
    modelId,
    textLength: text.length,
    wordCount: text.trim().split(/\s+/).length
  });

  try {
    const client = getElevenLabsClient();

    // Retry ile ses üret
    const audioStream = await retryElevenLabs(
      async () => {
        return await client.textToSpeech.convert(voiceId, {
          text,
          model_id: modelId,
          voice_settings: {
            stability,
            similarity_boost: similarityBoost,
            style,
            use_speaker_boost: useSpeakerBoost
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
          'ElevenLabs quota veya limit aşıldı',
          { originalError: error.message }
        );
      }
      if (error.message.includes('voice')) {
        throw new ElevenLabsError(
          'Geçersiz ses ID',
          { voiceId, originalError: error.message }
        );
      }
    }

    throw new ElevenLabsError(
      `Ses üretimi başarısız: ${error instanceof Error ? error.message : 'Bilinmeyen hata'}`,
      { voiceId, textPreview: text.substring(0, 200) }
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
    throw new ElevenLabsError('Hiçbir ses üretilemedi', { errors });
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

