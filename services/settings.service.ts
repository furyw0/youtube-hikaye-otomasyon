/**
 * Settings Service
 * API Key ve Cookie yönetimi
 */

import logger from '@/lib/logger';
import dbConnect from '@/lib/mongodb';
import Settings from '@/models/Settings';

export interface ApiSettings {
  openaiApiKey?: string;
  elevenlabsApiKey?: string;
  imagefxCookie?: string;
  defaultOpenaiModel: string;
  defaultVoiceId?: string;
  defaultVoiceName?: string;
  defaultImagefxModel: string;
  defaultImagefxAspectRatio: string;
}

/**
 * Ayarları veritabanından okur
 * Önce veritabanı, sonra environment variables kullanır
 */
export async function getApiSettings(): Promise<ApiSettings> {
  try {
    await dbConnect();
    
    // Settings'i API key'leri dahil ederek oku
    const settings = await Settings.findOne()
      .select('+openaiApiKey +elevenlabsApiKey +imagefxCookie');

    // Varsayılan değerler
    const defaults: ApiSettings = {
      openaiApiKey: process.env.OPENAI_API_KEY,
      elevenlabsApiKey: process.env.ELEVENLABS_API_KEY,
      imagefxCookie: process.env.GOOGLE_COOKIE,
      defaultOpenaiModel: 'gpt-4o-mini',
      defaultImagefxModel: 'IMAGEN_4',
      defaultImagefxAspectRatio: 'LANDSCAPE'
    };

    if (!settings) {
      logger.debug('Veritabanında ayar bulunamadı, env değerleri kullanılıyor');
      return defaults;
    }

    // Veritabanı değerleri varsa onları kullan, yoksa env'den al
    return {
      openaiApiKey: settings.openaiApiKey || process.env.OPENAI_API_KEY,
      elevenlabsApiKey: settings.elevenlabsApiKey || process.env.ELEVENLABS_API_KEY,
      imagefxCookie: settings.imagefxCookie || process.env.GOOGLE_COOKIE,
      defaultOpenaiModel: settings.defaultOpenaiModel || defaults.defaultOpenaiModel,
      defaultVoiceId: settings.defaultVoiceId,
      defaultVoiceName: settings.defaultVoiceName,
      defaultImagefxModel: settings.defaultImagefxModel || defaults.defaultImagefxModel,
      defaultImagefxAspectRatio: settings.defaultImagefxAspectRatio || defaults.defaultImagefxAspectRatio
    };

  } catch (error) {
    logger.error('Ayarlar okunamadı', {
      error: error instanceof Error ? error.message : 'Bilinmeyen hata'
    });

    // Hata durumunda env değerlerini döndür
    return {
      openaiApiKey: process.env.OPENAI_API_KEY,
      elevenlabsApiKey: process.env.ELEVENLABS_API_KEY,
      imagefxCookie: process.env.GOOGLE_COOKIE,
      defaultOpenaiModel: 'gpt-4o-mini',
      defaultImagefxModel: 'IMAGEN_4',
      defaultImagefxAspectRatio: 'LANDSCAPE'
    };
  }
}

/**
 * API key'lerin geçerli olup olmadığını kontrol eder
 */
export async function validateApiSettings(): Promise<{
  valid: boolean;
  missing: string[];
}> {
  const settings = await getApiSettings();
  const missing: string[] = [];

  if (!settings.openaiApiKey) {
    missing.push('OpenAI API Key');
  }
  if (!settings.elevenlabsApiKey) {
    missing.push('ElevenLabs API Key');
  }
  if (!settings.imagefxCookie) {
    missing.push('ImageFX Cookie');
  }

  return {
    valid: missing.length === 0,
    missing
  };
}

