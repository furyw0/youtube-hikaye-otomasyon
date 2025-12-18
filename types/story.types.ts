import { Types } from 'mongoose';

export interface IStory {
  _id: Types.ObjectId;
  
  // Kullanıcı ilişkisi
  userId: Types.ObjectId;
  
  // Orijinal hikaye
  originalTitle: string;
  originalContent: string;
  originalLanguage: string;
  originalYoutubeDescription?: string;
  originalCoverText?: string;
  
  // Hedef
  targetLanguage: string;
  targetCountry: string;
  
  // Çeviri Modu
  translationOnly?: boolean;
  
  // Uyarlanmış hikaye
  adaptedTitle?: string;
  adaptedContent?: string;
  adaptedYoutubeDescription?: string;
  adaptedCoverText?: string;
  
  // AI Ayarları
  openaiModel: string;
  
  // TTS Sağlayıcı
  ttsProvider: 'elevenlabs' | 'coqui';
  
  // ElevenLabs Ayarları
  elevenlabsModel?: string;
  voiceId?: string;
  voiceName?: string;
  
  // Coqui TTS Ayarları
  coquiTunnelUrl?: string;
  coquiLanguage?: string;
  coquiVoiceId?: string;
  coquiVoiceName?: string;
  
  // ImageFX Ayarları
  imagefxModel: string;
  imagefxAspectRatio: string;
  imagefxSeed?: number;
  
  // Görsel Stili
  visualStyleId?: Types.ObjectId;
  
  // Prompt Senaryosu
  promptScenarioId?: Types.ObjectId;
  
  // İşlem Durumu
  status: 'created' | 'queued' | 'processing' | 'completed' | 'failed';
  progress: number;
  currentStep?: string;
  errorMessage?: string;
  retryCount: number;
  inngestRunId?: string;
  
  // Görsel Stratejisi
  totalScenes: number;
  totalImages: number;
  firstMinuteImages: number;
  
  // İstatistikler
  estimatedTokens: number;
  actualDuration?: number;
  
  // İşleme Süreleri
  processingStartedAt?: Date;
  processingCompletedAt?: Date;
  processingDuration?: number; // Saniye cinsinden toplam üretim süresi
  
  // İlişkiler
  scenes: Types.ObjectId[];
  processLogs: Types.ObjectId[];
  
  // Dosyalar
  blobUrls: {
    zipFile?: string;
  };
  
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateStoryInput {
  title: string;
  content: string;
  youtubeDescription?: string;
  coverText?: string;
  targetLanguage: string;
  targetCountry: string;
  translationOnly?: boolean;
  openaiModel: string;
  // TTS
  ttsProvider?: 'elevenlabs' | 'coqui';
  // ElevenLabs
  elevenlabsModel?: string;
  voiceId?: string;
  voiceName?: string;
  // Coqui TTS
  coquiTunnelUrl?: string;
  coquiLanguage?: string;
  coquiVoiceId?: string;
  coquiVoiceName?: string;
  // ImageFX
  imagefxModel?: string;
  imagefxAspectRatio?: string;
  imagefxSeed?: number;
  // Görsel Stili
  visualStyleId?: string;
  // Prompt Senaryosu
  promptScenarioId?: string;
}

