import { Types } from 'mongoose';

export interface IStory {
  _id: Types.ObjectId;
  
  // Orijinal hikaye
  originalTitle: string;
  originalContent: string;
  originalLanguage: string;
  
  // Hedef
  targetLanguage: string;
  targetCountry: string;
  
  // Uyarlanmış hikaye
  adaptedTitle?: string;
  adaptedContent?: string;
  
  // AI Ayarları
  openaiModel: string;
  voiceId: string;
  voiceName: string;
  
  // ImageFX Ayarları
  imagefxModel: string;
  imagefxAspectRatio: string;
  imagefxSeed?: number;
  
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
  targetLanguage: string;
  targetCountry: string;
  openaiModel: string;
  voiceId: string;
  voiceName: string;
  imagefxModel?: string;
  imagefxAspectRatio?: string;
  imagefxSeed?: number;
}

