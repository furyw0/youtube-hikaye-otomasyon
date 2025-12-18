import { Types } from 'mongoose';

// Hook tipi
export type HookType = 'intro' | 'subscribe' | 'like' | 'comment' | 'outro';

// Hook bilgisi
export interface SceneHook {
  hookType: HookType;
  text: string;
  position: 'before' | 'after';
}

export interface IScene {
  _id: Types.ObjectId;
  storyId: Types.ObjectId;
  sceneNumber: number;
  
  // Çoklu dil metinler
  sceneTextOriginal: string;
  sceneTextAdapted: string;
  sceneTextTurkish?: string; // Türkçe çeviri (hedef dil Türkçe değilse)
  
  // Görsel bilgileri
  hasImage: boolean;
  imageIndex?: number;
  visualDescription?: string;
  visualPrompt?: string;
  isFirstThreeMinutes: boolean;
  
  // YouTube Engagement Hook
  hook?: SceneHook;
  
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

