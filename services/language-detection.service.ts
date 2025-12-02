/**
 * Dil Algılama Servisi
 * Hikaye içeriğinin dilini otomatik algılar
 */

import { franc } from 'franc';
import logger from '@/lib/logger';
import { ValidationError } from '@/lib/errors';

// Franc kütüphanesinin dönüşüm tablosu (ISO 639-3 -> ISO 639-1)
const langCodeMap: Record<string, string> = {
  'eng': 'en', // English
  'tur': 'tr', // Turkish
  'deu': 'de', // German
  'fra': 'fr', // French
  'spa': 'es', // Spanish
  'ita': 'it', // Italian
  'por': 'pt', // Portuguese
  'rus': 'ru', // Russian
  'ara': 'ar', // Arabic
  'zho': 'zh', // Chinese
  'jpn': 'ja', // Japanese
  'kor': 'ko', // Korean
  'hin': 'hi', // Hindi
  'nld': 'nl', // Dutch
  'pol': 'pl', // Polish
  'swe': 'sv', // Swedish
  'nor': 'no', // Norwegian
  'dan': 'da', // Danish
  'fin': 'fi', // Finnish
  'ces': 'cs', // Czech
  'ron': 'ro', // Romanian
  'ukr': 'uk', // Ukrainian
  'ell': 'el', // Greek
  'hun': 'hu', // Hungarian
  'tha': 'th', // Thai
  'vie': 'vi', // Vietnamese
  'ind': 'id', // Indonesian
  'msa': 'ms', // Malay
  'heb': 'he', // Hebrew
};

interface DetectionResult {
  language: string;
  confidence: number;
  rawCode?: string;
}

/**
 * Metin dilini algılar
 * @param text - Algılanacak metin (minimum 100 karakter önerilir)
 * @returns ISO 639-1 dil kodu (örn: 'en', 'tr')
 */
export async function detectLanguage(text: string): Promise<DetectionResult> {
  try {
    // Metin çok kısa ise hata
    if (text.length < 100) {
      throw new ValidationError(
        'Dil algılama için metin çok kısa (minimum 100 karakter gerekli)',
        { textLength: text.length }
      );
    }

    // Franc ile dil algılama (ISO 639-3 döner)
    const detectedCode = franc(text, { minLength: 3 });

    // Bilinmeyen dil kontrolü
    if (detectedCode === 'und') {
      logger.warn('Dil algılanamadı, varsayılan olarak İngilizce kullanılacak', {
        textPreview: text.substring(0, 100)
      });
      
      return {
        language: 'en',
        confidence: 0.5,
        rawCode: detectedCode
      };
    }

    // ISO 639-3 kodunu ISO 639-1 koduna çevir
    const languageCode = langCodeMap[detectedCode] || detectedCode;

    logger.info('Dil başarıyla algılandı', {
      detectedCode,
      languageCode,
      textLength: text.length
    });

    return {
      language: languageCode,
      confidence: 0.9, // Franc kesin bir güven skoru vermez
      rawCode: detectedCode
    };

  } catch (error) {
    logger.error('Dil algılama hatası', { 
      error: error instanceof Error ? error.message : 'Bilinmeyen hata',
      textLength: text?.length || 0
    });

    // Hata durumunda varsayılan dil
    return {
      language: 'en',
      confidence: 0.3,
      rawCode: 'error'
    };
  }
}

/**
 * Birden fazla dil varmı kontrol eder
 * @param text - Kontrol edilecek metin
 * @returns Çok dilli ise true
 */
export function hasMultipleLanguages(text: string): boolean {
  // Metni paragraflara böl ve her birinin dilini algıla
  const paragraphs = text.split('\n\n').filter(p => p.length > 100);
  
  if (paragraphs.length < 3) {
    return false; // Yeterli paragraf yok
  }

  const languages = new Set<string>();
  
  for (const paragraph of paragraphs.slice(0, 5)) { // İlk 5 paragrafı kontrol et
    const detectedCode = franc(paragraph, { minLength: 3 });
    if (detectedCode !== 'und') {
      languages.add(detectedCode);
    }
  }

  return languages.size > 1;
}

/**
 * Dil kodunu insan okunabilir ada çevirir
 * @param code - ISO 639-1 dil kodu
 * @returns Dil adı
 */
export function getLanguageName(code: string): string {
  const names: Record<string, string> = {
    'en': 'English',
    'tr': 'Türkçe',
    'de': 'Deutsch',
    'fr': 'Français',
    'es': 'Español',
    'it': 'Italiano',
    'pt': 'Português',
    'ru': 'Русский',
    'ar': 'العربية',
    'zh': '中文',
    'ja': '日本語',
    'ko': '한국어',
    'hi': 'हिन्दी',
    'nl': 'Nederlands',
    'pl': 'Polski',
    'sv': 'Svenska',
    'no': 'Norsk',
    'da': 'Dansk',
    'fi': 'Suomi',
    'cs': 'Čeština',
    'ro': 'Română',
    'uk': 'Українська',
    'el': 'Ελληνικά',
    'hu': 'Magyar',
    'th': 'ไทย',
    'vi': 'Tiếng Việt',
    'id': 'Bahasa Indonesia',
    'ms': 'Bahasa Melayu',
    'he': 'עברית',
  };

  return names[code] || code.toUpperCase();
}

