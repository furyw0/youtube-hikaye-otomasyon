/**
 * Uygulama Sabitleri
 */

export const OPENAI_MODELS = [
  { 
    id: 'gpt-4o-mini', 
    name: 'GPT-4o Mini (Önerilen)', 
    description: 'En ekonomik ve güçlü model (128K token)'
  },
  { 
    id: 'gpt-4o', 
    name: 'GPT-4o', 
    description: 'En gelişmiş model (128K token)'
  },
  { 
    id: 'gpt-4-turbo', 
    name: 'GPT-4 Turbo', 
    description: 'Hızlı ve güçlü (128K token)'
  },
  { 
    id: 'gpt-3.5-turbo', 
    name: 'GPT-3.5 Turbo', 
    description: 'Ekonomik seçenek (16K token)'
  }
];

export const TARGET_LANGUAGES = [
  { code: 'en', name: 'English' },
  { code: 'es', name: 'Español' },
  { code: 'fr', name: 'Français' },
  { code: 'de', name: 'Deutsch' },
  { code: 'ar', name: 'العربية' },
  { code: 'tr', name: 'Türkçe' },
  { code: 'it', name: 'Italiano' },
  { code: 'pt', name: 'Português' },
  { code: 'ru', name: 'Русский' }
];

export const TARGET_COUNTRIES = [
  { code: 'USA', name: 'United States' },
  { code: 'UK', name: 'United Kingdom' },
  { code: 'Spain', name: 'Spain' },
  { code: 'Germany', name: 'Germany' },
  { code: 'France', name: 'France' },
  { code: 'UAE', name: 'UAE' },
  { code: 'Turkey', name: 'Türkiye' },
  { code: 'Italy', name: 'Italy' },
  { code: 'Brazil', name: 'Brazil' },
  { code: 'Russia', name: 'Russia' }
];

export const STORY_LIMITS = {
  MIN_LENGTH: 1000,
  MAX_LENGTH: 100000,
  AVG_LENGTH: 40000,
  CHUNK_SIZE: 8000 // ~2000 token
};

export const IMAGE_SETTINGS = {
  TOTAL_IMAGES: 10,
  FIRST_THREE_MINUTES_IMAGES: 5,
  FIRST_THREE_MINUTES_DURATION_SECONDS: 180, // 3 dakika
  AVG_SCENE_DURATION_SECONDS: 18 // Ortalama sahne süresi
};

export const IMAGEFX_MODELS = [
  { id: 'IMAGEN_4', name: 'Imagen 4' },
  { id: 'IMAGEN_3_5', name: 'Imagen 3.5' }
];

export const IMAGEFX_ASPECT_RATIOS = [
  { id: 'LANDSCAPE', name: 'Yatay (16:9)' },
  { id: 'SQUARE', name: 'Kare (1:1)' },
  { id: 'PORTRAIT', name: 'Dikey (9:16)' }
];

export const IMAGEFX_SETTINGS = {
  MODELS: IMAGEFX_MODELS,
  ASPECT_RATIOS: IMAGEFX_ASPECT_RATIOS,
  DEFAULT_MODEL: 'IMAGEN_4',
  DEFAULT_ASPECT_RATIO: 'LANDSCAPE',
  DEFAULT_SEED: null,
  NUMBER_OF_IMAGES: 1
};

export const RETRY_SETTINGS = {
  MAX_RETRIES: 3,
  BACKOFF_MS: 1000
};
