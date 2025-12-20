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

export const CLAUDE_MODELS = [
  { 
    id: 'claude-sonnet-4-20250514', 
    name: 'Claude Sonnet 4 (Önerilen)', 
    description: 'En güçlü model, prompt caching (200K token)'
  },
  { 
    id: 'claude-opus-4-20250514', 
    name: 'Claude Opus 4', 
    description: 'En yüksek performans (200K token)'
  },
  { 
    id: 'claude-3-5-sonnet-20241022', 
    name: 'Claude 3.5 Sonnet', 
    description: 'Dengeli performans, ekonomik (200K token)'
  },
  { 
    id: 'claude-3-5-haiku-20241022', 
    name: 'Claude 3.5 Haiku', 
    description: 'Hızlı ve ekonomik (200K token)'
  }
];

export const TARGET_LANGUAGES = [
  { code: 'en', name: '🇬🇧 English (İngilizce)' },
  { code: 'es', name: '🇪🇸 Español (İspanyolca)' },
  { code: 'fr', name: '🇫🇷 Français (Fransızca)' },
  { code: 'de', name: '🇩🇪 Deutsch (Almanca)' },
  { code: 'ar', name: '🇸🇦 العربية (Arapça)' },
  { code: 'tr', name: '🇹🇷 Türkçe' },
  { code: 'it', name: '🇮🇹 Italiano (İtalyanca)' },
  { code: 'pt', name: '🇵🇹 Português (Portekizce)' },
  { code: 'ru', name: '🇷🇺 Русский (Rusça)' },
  { code: 'ja', name: '🇯🇵 日本語 (Japonca)' },
  { code: 'ko', name: '🇰🇷 한국어 (Korece)' },
  { code: 'zh', name: '🇨🇳 中文 (Çince)' },
  { code: 'hi', name: '🇮🇳 हिन्दी (Hintçe)' },
  { code: 'nl', name: '🇳🇱 Nederlands (Hollandaca)' },
  { code: 'pl', name: '🇵🇱 Polski (Lehçe)' },
  { code: 'sv', name: '🇸🇪 Svenska (İsveççe)' },
  { code: 'da', name: '🇩🇰 Dansk (Danca)' },
  { code: 'no', name: '🇳🇴 Norsk (Norveççe)' },
  { code: 'fi', name: '🇫🇮 Suomi (Fince)' },
  { code: 'el', name: '🇬🇷 Ελληνικά (Yunanca)' },
  { code: 'cs', name: '🇨🇿 Čeština (Çekçe)' },
  { code: 'ro', name: '🇷🇴 Română (Romence)' },
  { code: 'hu', name: '🇭🇺 Magyar (Macarca)' },
  { code: 'th', name: '🇹🇭 ไทย (Tayca)' },
  { code: 'vi', name: '🇻🇳 Tiếng Việt (Vietnamca)' },
  { code: 'id', name: '🇮🇩 Bahasa Indonesia (Endonezce)' },
  { code: 'ms', name: '🇲🇾 Bahasa Melayu (Malayca)' },
  { code: 'uk', name: '🇺🇦 Українська (Ukraynaca)' },
  { code: 'he', name: '🇮🇱 עברית (İbranice)' },
  { code: 'fa', name: '🇮🇷 فارسی (Farsça)' }
];

export const TARGET_COUNTRIES = [
  { code: 'USA', name: '🇺🇸 United States (ABD)' },
  { code: 'UK', name: '🇬🇧 United Kingdom (İngiltere)' },
  { code: 'Turkey', name: '🇹🇷 Türkiye' },
  { code: 'Germany', name: '🇩🇪 Germany (Almanya)' },
  { code: 'France', name: '🇫🇷 France (Fransa)' },
  { code: 'Spain', name: '🇪🇸 Spain (İspanya)' },
  { code: 'Italy', name: '🇮🇹 Italy (İtalya)' },
  { code: 'Netherlands', name: '🇳🇱 Netherlands (Hollanda)' },
  { code: 'Belgium', name: '🇧🇪 Belgium (Belçika)' },
  { code: 'Switzerland', name: '🇨🇭 Switzerland (İsviçre)' },
  { code: 'Austria', name: '🇦🇹 Austria (Avusturya)' },
  { code: 'Poland', name: '🇵🇱 Poland (Polonya)' },
  { code: 'Sweden', name: '🇸🇪 Sweden (İsveç)' },
  { code: 'Norway', name: '🇳🇴 Norway (Norveç)' },
  { code: 'Denmark', name: '🇩🇰 Denmark (Danimarka)' },
  { code: 'Finland', name: '🇫🇮 Finland (Finlandiya)' },
  { code: 'Russia', name: '🇷🇺 Russia (Rusya)' },
  { code: 'Ukraine', name: '🇺🇦 Ukraine (Ukrayna)' },
  { code: 'Greece', name: '🇬🇷 Greece (Yunanistan)' },
  { code: 'Portugal', name: '🇵🇹 Portugal (Portekiz)' },
  { code: 'Brazil', name: '🇧🇷 Brazil (Brezilya)' },
  { code: 'Mexico', name: '🇲🇽 Mexico (Meksika)' },
  { code: 'Argentina', name: '🇦🇷 Argentina (Arjantin)' },
  { code: 'Canada', name: '🇨🇦 Canada (Kanada)' },
  { code: 'Australia', name: '🇦🇺 Australia (Avustralya)' },
  { code: 'NewZealand', name: '🇳🇿 New Zealand (Yeni Zelanda)' },
  { code: 'Japan', name: '🇯🇵 Japan (Japonya)' },
  { code: 'SouthKorea', name: '🇰🇷 South Korea (Güney Kore)' },
  { code: 'China', name: '🇨🇳 China (Çin)' },
  { code: 'India', name: '🇮🇳 India (Hindistan)' },
  { code: 'Indonesia', name: '🇮🇩 Indonesia (Endonezya)' },
  { code: 'Malaysia', name: '🇲🇾 Malaysia (Malezya)' },
  { code: 'Thailand', name: '🇹🇭 Thailand (Tayland)' },
  { code: 'Vietnam', name: '🇻🇳 Vietnam' },
  { code: 'Philippines', name: '🇵🇭 Philippines (Filipinler)' },
  { code: 'Singapore', name: '🇸🇬 Singapore (Singapur)' },
  { code: 'UAE', name: '🇦🇪 UAE (Birleşik Arap Emirlikleri)' },
  { code: 'SaudiArabia', name: '🇸🇦 Saudi Arabia (Suudi Arabistan)' },
  { code: 'Egypt', name: '🇪🇬 Egypt (Mısır)' },
  { code: 'Israel', name: '🇮🇱 Israel (İsrail)' },
  { code: 'SouthAfrica', name: '🇿🇦 South Africa (Güney Afrika)' },
  { code: 'Nigeria', name: '🇳🇬 Nigeria (Nijerya)' },
  { code: 'Iran', name: '🇮🇷 Iran' }
];

export const STORY_LIMITS = {
  MIN_LENGTH: 1000,
  MAX_LENGTH: 100000,
  AVG_LENGTH: 40000,
  CHUNK_SIZE: 8000 // ~2000 token
};

export const IMAGE_SETTINGS = {
  TOTAL_IMAGES: 20,              // Hedef: 20 görsel (hikaye kısaysa daha az olabilir)
  FIRST_THREE_MINUTES_IMAGES: 6, // İlk 3 dakikada 6 görsel
  REMAINING_IMAGES: 14,          // Kalan bölümde 14 görsel
  MIN_TOTAL_IMAGES: 5,           // Minimum görsel sayısı (kısa hikayeler için)
  FIRST_THREE_MINUTES_DURATION_SECONDS: 180, // 3 dakika
  AVG_SCENE_DURATION_SECONDS: 15 // Ortalama sahne süresi (daha kısa)
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

// ElevenLabs Modelleri - https://elevenlabs.io/docs/models
export const ELEVENLABS_MODELS = [
  { 
    id: 'eleven_flash_v2_5', 
    name: 'Flash v2.5 (Önerilen)', 
    description: 'Ultra hızlı (~75ms), 32 dil, 40K karakter'
  },
  { 
    id: 'eleven_turbo_v2_5', 
    name: 'Turbo v2.5', 
    description: 'Yüksek kalite, düşük gecikme (~250ms), 32 dil'
  },
  { 
    id: 'eleven_multilingual_v2', 
    name: 'Multilingual v2', 
    description: 'En doğal ses, 29 dil, 10K karakter'
  },
  { 
    id: 'eleven_v3', 
    name: 'Eleven v3 (Alpha)', 
    description: 'En yeni model, 70+ dil, dramatik ifade'
  }
];

export const ELEVENLABS_SETTINGS = {
  MODELS: ELEVENLABS_MODELS,
  DEFAULT_MODEL: 'eleven_flash_v2_5'
};

// ============================================
// TRANSCREATION (YENİDEN YAZIM) AYARLARI
// ============================================

// Süre/Uzunluk Kontrolü
export const TRANSCREATION_LENGTH_CONSTRAINTS = {
  MIN_RATIO: 0.95,      // Minimum %95 (max %5 kısalma)
  MAX_RATIO: 1.05,      // Maximum %105 (max %5 uzama)
  MAX_RETRIES: 1        // Batch'te retry yok (timeout önleme)
};

// Akıcılık Seviyeleri (Presets)
export const TRANSCREATION_PRESETS = [
  { 
    id: 'light', 
    name: 'Hafif', 
    description: 'Minimal değişiklik, ana yapı korunur',
    emoji: '🌱'
  },
  { 
    id: 'medium', 
    name: 'Orta', 
    description: 'Dengeli akıcılaştırma',
    emoji: '🌿'
  },
  { 
    id: 'strong', 
    name: 'Güçlü', 
    description: 'Maksimum akıcılık, serbest yeniden yazım',
    emoji: '🌳'
  }
] as const;

// Anlatım Stilleri
export const TRANSCREATION_STYLES = [
  { 
    id: 'philosophical', 
    name: 'Felsefi/Derin', 
    description: 'Derin düşündüren anlatım',
    emoji: '🔮'
  },
  { 
    id: 'storyteller', 
    name: 'Hikaye Anlatıcısı', 
    description: 'Sürükleyici hikaye anlatımı',
    emoji: '📖'
  },
  { 
    id: 'documentary', 
    name: 'Belgesel', 
    description: 'Bilgilendirici, profesyonel',
    emoji: '🎬'
  },
  { 
    id: 'entertaining', 
    name: 'Eğlenceli', 
    description: 'Hafif, eğlenceli anlatım',
    emoji: '🎉'
  }
] as const;

export const TRANSCREATION_SETTINGS = {
  PRESETS: TRANSCREATION_PRESETS,
  STYLES: TRANSCREATION_STYLES,
  LENGTH_CONSTRAINTS: TRANSCREATION_LENGTH_CONSTRAINTS,
  DEFAULT_PRESET: 'medium' as const,
  DEFAULT_STYLE: 'storyteller' as const
};
