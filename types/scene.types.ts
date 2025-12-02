import { Types } from 'mongoose';

export interface IScene {
  _id: Types.ObjectId;
  storyId: Types.ObjectId;
  sceneNumber: number;
  
  // Çift dil metinler
  sceneTextOriginal: string;
  sceneTextAdapted: string;
  
  // Görsel bilgileri
  hasImage: boolean;
  imageIndex?: number;
  visualDescription?: string;
  visualPrompt?: string;
  isFirstThreeMinutes: boolean;
  
  // Süre
  estimatedDuration: number;
  actualDuration?: number;
  
  // Dosyalar
  blobUrls: {
    image?: string;
    audio?: string;
    metadata?: string;
  };
  
  // Durum
  status: 'pending' | 'processing' | 'completed' | 'failed';
  errorMessage?: string;
  retryCount: number;
  
  createdAt: Date;
  updatedAt: Date;
}

export interface RawScene {
  sceneNumber: number;
  text: string;
  visualDescription?: string;
  estimatedDuration: number;
  needsImage?: boolean;
  isHighlight?: boolean;
}

