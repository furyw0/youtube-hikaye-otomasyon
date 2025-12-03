/**
 * Validasyon Servisi
 * Hikaye içeriğini ve kullanıcı girdilerini doğrular
 */

import { STORY_LIMITS, OPENAI_MODELS } from '@/lib/constants';
import { ValidationError } from '@/lib/errors';
import logger from '@/lib/logger';

interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  estimatedTokens: number;
  estimatedCost?: number;
}

/**
 * Hikaye içeriğini doğrular
 */
export function validateStoryContent(content: string): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Uzunluk kontrolü
  if (content.length < STORY_LIMITS.MIN_LENGTH) {
    errors.push(
      `Hikaye çok kısa (minimum ${STORY_LIMITS.MIN_LENGTH} karakter gerekli, ${content.length} karakter var)`
    );
  }

  if (content.length > STORY_LIMITS.MAX_LENGTH) {
    errors.push(
      `Hikaye çok uzun (maksimum ${STORY_LIMITS.MAX_LENGTH} karakter, ${content.length} karakter var)`
    );
  }

  // İçerik kalitesi kontrolü
  const wordCount = content.trim().split(/\s+/).length;
  const avgWordLength = content.length / wordCount;

  if (wordCount < 200) {
    errors.push('Hikaye çok kısa (minimum 200 kelime gerekli)');
  }

  if (avgWordLength < 3) {
    warnings.push('Hikaye çok kısa kelimeler içeriyor, kalitesi düşük olabilir');
  }

  if (avgWordLength > 15) {
    warnings.push('Hikaye çok uzun kelimeler içeriyor, okunabilirlik düşük olabilir');
  }

  // Paragraf kontrolü
  const paragraphs = content.split('\n\n').filter(p => p.trim().length > 0);
  if (paragraphs.length < 3) {
    warnings.push('Hikaye yeterli paragrafa bölünmemiş');
  }

  // Token tahmini (1 token ≈ 4 karakter)
  const estimatedTokens = Math.ceil(content.length / 4);

  // Maliyet tahmini (gpt-4o-mini için)
  const model = OPENAI_MODELS.find(m => m.id === 'gpt-4o-mini');
  const estimatedCost = model 
    ? (estimatedTokens / 1000) * 0.00015 * 5 // 5 kez işleme tahmini
    : undefined;

  if (estimatedTokens > 100000) {
    warnings.push('Hikaye çok uzun, işlem süresi uzayabilir');
  }

  logger.info('Hikaye validasyonu tamamlandı', {
    contentLength: content.length,
    wordCount,
    paragraphs: paragraphs.length,
    estimatedTokens,
    estimatedCost,
    errors: errors.length,
    warnings: warnings.length
  });

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    estimatedTokens,
    estimatedCost
  };
}

interface StoryValidationResult {
  valid: boolean;
  error?: string;
  details?: string[];
  estimatedTokens: number;
}

/**
 * Hikaye doğrulama - API route'ları için basit arayüz
 */
export async function validateStory(content: string): Promise<StoryValidationResult> {
  const result = validateStoryContent(content);
  
  return {
    valid: result.valid,
    error: result.errors.length > 0 ? result.errors[0] : undefined,
    details: result.errors.length > 0 ? result.errors : undefined,
    estimatedTokens: result.estimatedTokens
  };
}

/**
 * Başlık doğrular
 */
export function validateTitle(title: string): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (title.length < 3) {
    errors.push('Başlık çok kısa (minimum 3 karakter)');
  }

  if (title.length > 200) {
    errors.push('Başlık çok uzun (maksimum 200 karakter)');
  }

  // Özel karakter kontrolü
  const specialChars = /[<>\/\\{}[\]]/g;
  if (specialChars.test(title)) {
    warnings.push('Başlık özel karakterler içeriyor');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    estimatedTokens: 0
  };
}

/**
 * OpenAI model seçimini doğrular
 */
export function validateOpenAIModel(modelId: string): boolean {
  return OPENAI_MODELS.some(m => m.id === modelId);
}

/**
 * Hedef dil kodunu doğrular
 */
export function validateLanguageCode(code: string): boolean {
  // ISO 639-1 format (2 karakter)
  return /^[a-z]{2}$/.test(code);
}

/**
 * Tam hikaye oluşturma isteğini doğrular
 */
export function validateCreateStoryRequest(data: any): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Başlık
  const titleValidation = validateTitle(data.title);
  errors.push(...titleValidation.errors);
  warnings.push(...titleValidation.warnings);

  // İçerik
  const contentValidation = validateStoryContent(data.content);
  errors.push(...contentValidation.errors);
  warnings.push(...contentValidation.warnings);

  // Model
  if (!validateOpenAIModel(data.openaiModel)) {
    errors.push(`Geçersiz OpenAI modeli: ${data.openaiModel}`);
  }

  // Hedef dil
  if (!validateLanguageCode(data.targetLanguage)) {
    errors.push(`Geçersiz hedef dil kodu: ${data.targetLanguage}`);
  }

  // Ülke
  if (!data.targetCountry || data.targetCountry.length < 2) {
    errors.push('Geçersiz hedef ülke');
  }

  // Ses ID - TTS Provider'a göre kontrol
  const ttsProvider = data.ttsProvider || 'elevenlabs';
  
  if (ttsProvider === 'coqui') {
    // Coqui TTS için coquiVoiceId gerekli
    if (!data.coquiVoiceId || data.coquiVoiceId.length < 3) {
      errors.push('Coqui TTS için geçersiz referans ses');
    }
    if (!data.coquiTunnelUrl) {
      errors.push('Coqui TTS için Tunnel URL gerekli');
    }
  } else {
    // ElevenLabs için voiceId gerekli
    if (!data.voiceId || data.voiceId.length < 5) {
      errors.push('Geçersiz ses ID');
    }
  }

  // ImageFX ayarları
  if (data.imagefxModel && !['IMAGEN_4', 'IMAGEN_3_5'].includes(data.imagefxModel)) {
    errors.push(`Geçersiz ImageFX modeli: ${data.imagefxModel}`);
  }

  if (data.imagefxAspectRatio && !['SQUARE', 'LANDSCAPE', 'PORTRAIT'].includes(data.imagefxAspectRatio)) {
    errors.push(`Geçersiz aspect ratio: ${data.imagefxAspectRatio}`);
  }

  if (data.imagefxSeed !== undefined && (data.imagefxSeed < 0 || data.imagefxSeed > 2147483647)) {
    errors.push('Geçersiz seed değeri (0-2147483647 arası olmalı)');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    estimatedTokens: contentValidation.estimatedTokens,
    estimatedCost: contentValidation.estimatedCost
  };
}

