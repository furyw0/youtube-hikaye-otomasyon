/**
 * Transcreation (Yeniden Yazım) Modülü Type Tanımları
 * 
 * Bu modül, içerikleri hedef dilde daha akıcı ve çekici hale getirmek için kullanılır.
 * Video süreleri kaynak ile en fazla %5 fark olmalıdır.
 */

// ============================================
// SÜRE/UZUNLUK KONTROLÜ SABİTLERİ
// ============================================

export const LENGTH_CONSTRAINTS = {
  MIN_RATIO: 0.95,      // Minimum %95 (max %5 kısalma)
  MAX_RATIO: 1.05,      // Maximum %105 (max %5 uzama)
  MAX_RETRIES: 3        // Tolerans sağlanamazsa max deneme
} as const;

// ============================================
// PRESET TANIMLARI
// ============================================

export type TranscreationPresetId = 'light' | 'medium' | 'strong';

export interface TranscreationPresetSettings {
  preserveStructure: number;    // 0-1 arası (1 = tam koruma)
  creativeFreedom: number;      // 0-1 arası (1 = tam özgürlük)
  rhetoricalQuestions: boolean; // Retorik soru ekleme
  directAddress: boolean;       // Doğrudan hitap (sen/siz)
  dramaticPauses: boolean;      // Dramatik duraklamalar
}

export interface TranscreationPreset {
  id: TranscreationPresetId;
  name: string;
  description: string;
  settings: TranscreationPresetSettings;
}

// ============================================
// STİL TANIMLARI
// ============================================

export type TranscreationStyleId = 'philosophical' | 'storyteller' | 'documentary' | 'entertaining';

export interface TranscreationStyle {
  id: TranscreationStyleId;
  name: string;
  description: string;
  instructions: string;       // LLM için stil talimatları
  systemPromptAddition: string; // System prompt'a eklenecek ek
}

// ============================================
// UZUNLUK DOĞRULAMA
// ============================================

export interface LengthValidation {
  isValid: boolean;
  originalLength: number;
  newLength: number;
  ratio: number;
  differencePercent: string;
  withinTolerance: boolean;
}

// ============================================
// TRANSCREATION SONUÇLARI
// ============================================

export interface TranscreationResult {
  sceneNumber: number;
  originalText: string;
  rewrittenText: string;
  lengthValidation: LengthValidation;
  styleApplied: TranscreationStyleId;
  presetApplied: TranscreationPresetId;
  attempts: number;
  success: boolean;
}

export interface BatchTranscreationStats {
  totalScenes: number;
  successfulScenes: number;
  failedScenes: number;
  totalOriginalChars: number;
  totalNewChars: number;
  overallRatio: number;
  withinTolerance: boolean;
  averageAttempts: number;
}

export interface BatchTranscreationResult {
  results: TranscreationResult[];
  stats: BatchTranscreationStats;
}

// ============================================
// TRANSCREATION AYARLARI (API/Inngest)
// ============================================

export interface TranscreationOptions {
  sourceLang: string;
  targetLang: string;
  preset: TranscreationPreset;
  style: TranscreationStyle;
  model: string;
  provider: 'openai' | 'anthropic';
  maxRetries?: number;
}

// ============================================
// TİMESTAMPED SCENE TİPİ (Transcreation için)
// ============================================

export interface TimestampedSceneForTranscreation {
  sceneNumber: number;
  text: string;
  startTime: number;
  endTime: number;
  duration: number;
  visualDescription?: string;
  isFirstThreeMinutes: boolean;
}

// ============================================
// STORY TİPİ İÇİN EKLENTİLER
// ============================================

export interface TranscreationStoryFields {
  useTranscreation?: boolean;
  transcreationPreset?: TranscreationPresetId;
  transcreationStyle?: TranscreationStyleId;
  skipAdaptation?: boolean;
}
