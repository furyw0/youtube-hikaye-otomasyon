import mongoose, { Schema, Model } from 'mongoose';
import { IStory } from '@/types/story.types';

const StorySchema = new Schema<IStory>(
  {
    // Orijinal hikaye
    originalTitle: {
      type: String,
      required: true,
      trim: true
    },
    originalContent: {
      type: String,
      required: true
    },
    originalLanguage: {
      type: String,
      required: true,
      default: 'unknown'
    },
    
    // Hedef
    targetLanguage: {
      type: String,
      required: true
    },
    targetCountry: {
      type: String,
      required: true
    },
    
    // Uyarlanmış hikaye
    adaptedTitle: {
      type: String
    },
    adaptedContent: {
      type: String
    },
    
    // AI Ayarları
    openaiModel: {
      type: String,
      required: true,
      default: 'gpt-4o-mini'
    },
    elevenlabsModel: {
      type: String,
      default: 'eleven_flash_v2_5'
    },
    voiceId: {
      type: String,
      required: true
    },
    voiceName: {
      type: String,
      required: true
    },
    
    // ImageFX Ayarları
    imagefxModel: {
      type: String,
      default: 'IMAGEN_4'
    },
    imagefxAspectRatio: {
      type: String,
      default: 'IMAGE_ASPECT_RATIO_LANDSCAPE'
    },
    imagefxSeed: {
      type: Number,
      required: false
    },
    
    // İşlem Durumu
    status: {
      type: String,
      enum: ['created', 'queued', 'processing', 'completed', 'failed'],
      default: 'created'
    },
    progress: {
      type: Number,
      default: 0,
      min: 0,
      max: 100
    },
    currentStep: {
      type: String
    },
    errorMessage: {
      type: String
    },
    retryCount: {
      type: Number,
      default: 0
    },
    inngestRunId: {
      type: String
    },
    
    // Görsel Stratejisi
    totalScenes: {
      type: Number,
      default: 0
    },
    totalImages: {
      type: Number,
      default: 10
    },
    firstMinuteImages: {
      type: Number,
      default: 5
    },
    
    // İstatistikler
    estimatedTokens: {
      type: Number,
      default: 0
    },
    actualDuration: {
      type: Number
    },
    
    // İlişkiler
    scenes: [{
      type: Schema.Types.ObjectId,
      ref: 'Scene'
    }],
    processLogs: [{
      type: Schema.Types.ObjectId,
      ref: 'ProcessLog'
    }],
    
    // Dosyalar
    blobUrls: {
      zipFile: String
    }
  },
  {
    timestamps: true
  }
);

// Indexes
StorySchema.index({ status: 1, createdAt: -1 });
StorySchema.index({ originalLanguage: 1 });
StorySchema.index({ targetLanguage: 1 });

const Story: Model<IStory> = mongoose.models.Story || mongoose.model<IStory>('Story', StorySchema);

export default Story;

