/**
 * TTS Router Servisi
 * Kullanıcının ayarlarına göre ElevenLabs veya Coqui TTS'e yönlendirir
 */

import logger from '@/lib/logger';
import { ISettings, TTSProvider } from '@/models/Settings';
import { generateAudio, GeneratedAudio } from './elevenlabs.service';
import { 
  generateSpeechWithCoqui, 
  GeneratedCoquiAudio,
  CoquiLanguageCode 
} from './coqui.service';

export interface TTSResult {
  audioBuffer: Buffer;
  duration: number;
  text: string;
  provider: TTSProvider;
  generatedAt: Date;
}

export interface TTSOptions {
  text: string;
  settings: ISettings;
  language?: string; // Coqui için gerekli
}

/**
 * Dil kodunu Coqui formatına çevir
 */
function mapLanguageToCoqui(language?: string): CoquiLanguageCode {
  if (!language) return 'tr';
  
  const languageMap: Record<string, CoquiLanguageCode> = {
    'tr': 'tr',
    'turkish': 'tr',
    'en': 'en',
    'english': 'en',
    'de': 'de',
    'german': 'de',
    'fr': 'fr',
    'french': 'fr',
    'es': 'es',
    'spanish': 'es',
    'it': 'it',
    'italian': 'it',
    'pt': 'pt',
    'portuguese': 'pt',
    'pl': 'pl',
    'polish': 'pl',
    'ru': 'ru',
    'russian': 'ru',
    'nl': 'nl',
    'dutch': 'nl',
    'cs': 'cs',
    'czech': 'cs',
    'ar': 'ar',
    'arabic': 'ar',
    'zh': 'zh-cn',
    'zh-cn': 'zh-cn',
    'chinese': 'zh-cn',
    'ja': 'ja',
    'japanese': 'ja',
    'hu': 'hu',
    'hungarian': 'hu',
    'ko': 'ko',
    'korean': 'ko',
    'hi': 'hi',
    'hindi': 'hi',
  };
  
  return languageMap[language.toLowerCase()] || 'tr';
}

/**
 * ElevenLabs ile ses üret
 */
async function generateWithElevenLabs(
  text: string, 
  settings: ISettings
): Promise<TTSResult> {
  const voiceId = settings.defaultVoiceId;
  
  if (!voiceId) {
    throw new Error('ElevenLabs için ses seçilmemiş. Lütfen Ayarlar sayfasından bir ses seçin.');
  }
  
  logger.info('ElevenLabs ile ses üretiliyor', { 
    textLength: text.length,
    voiceId 
  });
  
  const result: GeneratedAudio = await generateAudio({
    text,
    voiceId,
    modelId: settings.defaultElevenlabsModel
  });
  
  return {
    audioBuffer: result.audioBuffer,
    duration: result.duration,
    text: result.text,
    provider: 'elevenlabs',
    generatedAt: result.generatedAt
  };
}

/**
 * Coqui TTS ile ses üret
 */
async function generateWithCoqui(
  text: string, 
  settings: ISettings,
  language?: string
): Promise<TTSResult> {
  if (!settings.coquiTunnelUrl) {
    throw new Error('Coqui TTS için Tunnel URL tanımlanmamış. Lütfen Ayarlar sayfasından girin.');
  }
  
  if (!settings.coquiSelectedVoiceId) {
    throw new Error('Coqui TTS için referans ses seçilmemiş. Lütfen Ayarlar sayfasından bir ses yükleyin ve seçin.');
  }
  
  const coquiLanguage = settings.coquiLanguage || mapLanguageToCoqui(language);
  
  logger.info('Coqui TTS ile ses üretiliyor', { 
    textLength: text.length,
    tunnelUrl: settings.coquiTunnelUrl,
    language: coquiLanguage,
    voiceId: settings.coquiSelectedVoiceId
  });
  
  const result: GeneratedCoquiAudio = await generateSpeechWithCoqui({
    text,
    tunnelUrl: settings.coquiTunnelUrl,
    language: coquiLanguage as CoquiLanguageCode,
    voiceId: settings.coquiSelectedVoiceId
  });
  
  return {
    audioBuffer: result.audioBuffer,
    duration: result.duration,
    text: result.text,
    provider: 'coqui',
    generatedAt: result.generatedAt
  };
}

/**
 * Kullanıcı ayarlarına göre TTS sağlayıcısını seç ve ses üret
 */
export async function generateSpeech(options: TTSOptions): Promise<TTSResult> {
  const { text, settings, language } = options;
  const provider = settings.ttsProvider || 'elevenlabs';
  
  logger.info('TTS Router: Ses üretimi başlatılıyor', { 
    provider,
    textLength: text.length 
  });
  
  try {
    let result: TTSResult;
    
    if (provider === 'coqui') {
      result = await generateWithCoqui(text, settings, language);
    } else {
      result = await generateWithElevenLabs(text, settings);
    }
    
    logger.info('TTS Router: Ses üretimi tamamlandı', { 
      provider: result.provider,
      duration: result.duration,
      bufferSize: result.audioBuffer.length
    });
    
    return result;
    
  } catch (error) {
    logger.error('TTS Router: Ses üretimi hatası', {
      provider,
      error: error instanceof Error ? error.message : 'Bilinmeyen hata'
    });
    throw error;
  }
}

/**
 * Birden fazla metni sese çevir
 */
export async function generateSpeeches(
  texts: Array<{ sceneNumber: number; text: string }>,
  settings: ISettings,
  language?: string
): Promise<Map<number, TTSResult>> {
  const provider = settings.ttsProvider || 'elevenlabs';
  
  logger.info('TTS Router: Toplu ses üretimi başlatılıyor', {
    provider,
    totalTexts: texts.length
  });
  
  const results = new Map<number, TTSResult>();
  const errors: Array<{ sceneNumber: number; error: string }> = [];
  
  // Coqui TTS için sıralı üretim gerekli (GPU tek seferde bir ses üretir)
  // ElevenLabs için de rate limit olduğundan sıralı yapalım
  for (const { sceneNumber, text } of texts) {
    try {
      const result = await generateSpeech({
        text,
        settings,
        language
      });
      
      results.set(sceneNumber, result);
      logger.debug(`Sahne ${sceneNumber} sesi tamamlandı`, { provider });
      
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Bilinmeyen hata';
      errors.push({ sceneNumber, error: errorMsg });
      logger.error(`Sahne ${sceneNumber} sesi başarısız`, { provider, error: errorMsg });
    }
  }
  
  logger.info('TTS Router: Toplu ses üretimi tamamlandı', {
    provider,
    successful: results.size,
    failed: errors.length,
    total: texts.length
  });
  
  if (errors.length > 0) {
    logger.warn('Bazı sesler üretilemedi', { errors });
  }
  
  return results;
}

/**
 * TTS sağlayıcısının kullanılabilir olup olmadığını kontrol et
 */
export async function checkTTSAvailability(settings: ISettings): Promise<{
  available: boolean;
  provider: TTSProvider;
  error?: string;
}> {
  const provider = settings.ttsProvider || 'elevenlabs';
  
  if (provider === 'coqui') {
    if (!settings.coquiTunnelUrl) {
      return {
        available: false,
        provider,
        error: 'Coqui TTS Tunnel URL tanımlanmamış'
      };
    }
    
    if (!settings.coquiSelectedVoiceId) {
      return {
        available: false,
        provider,
        error: 'Coqui TTS referans ses seçilmemiş'
      };
    }
    
    // Bağlantı testi yapılabilir ama bu fonksiyon hızlı olmalı
    // Detaylı test için testCoquiConnection kullanılmalı
    return { available: true, provider };
    
  } else {
    // ElevenLabs
    if (!settings.elevenlabsApiKey && !process.env.ELEVENLABS_API_KEY) {
      return {
        available: false,
        provider,
        error: 'ElevenLabs API Key tanımlanmamış'
      };
    }
    
    if (!settings.defaultVoiceId) {
      return {
        available: false,
        provider,
        error: 'ElevenLabs ses seçilmemiş'
      };
    }
    
    return { available: true, provider };
  }
}

