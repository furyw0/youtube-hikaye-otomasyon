import mongoose, { Schema, Model } from 'mongoose';
import { IStory } from '@/types/story.types';

const StorySchema = new Schema<IStory>(
  {
    // Kullanıcı ilişkisi
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    
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
    originalYoutubeDescription: {
      type: String
    },
    originalCoverText: {
      type: String
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
    
    // Çeviri Modu
    translationOnly: {
      type: Boolean,
      default: false
    },
    
    // YouTube Engagement Hook'ları
    enableHooks: {
      type: Boolean,
      default: false
    },
    
    // Zaman Damgalı İçerik Modu
    useTimestampedContent: {
      type: Boolean,
      default: false
    },
    timestampedContent: {
      type: String,
      required: false
    },
    totalOriginalDuration: {
      type: Number,  // Orijinal video süresi (saniye)
      required: false
    },
    
    // Transcreation (Yeniden Yazım) Modu
    useTranscreation: {
      type: Boolean,
      default: false
    },
    transcreationPreset: {
      type: String,
      enum: ['light', 'medium', 'strong'],
      default: 'medium'
    },
    transcreationStyle: {
      type: String,
      enum: ['philosophical', 'storyteller', 'documentary', 'entertaining'],
      default: 'storyteller'
    },
    skipAdaptation: {
      type: Boolean,
      default: false
    },
    
    // Uyarlanmış hikaye
    adaptedTitle: {
      type: String
    },
    adaptedContent: {
      type: String
    },
    adaptedYoutubeDescription: {
      type: String
    },
    adaptedCoverText: {
      type: String
    },
    
    // AI Ayarları
    openaiModel: {
      type: String,
      required: true,
      default: 'gpt-4o-mini'
    },
    
    // TTS Sağlayıcı
    ttsProvider: {
      type: String,
      enum: ['elevenlabs', 'coqui'],
      default: 'elevenlabs'
    },
    
    // ElevenLabs Ayarları
    elevenlabsModel: {
      type: String,
      default: 'eleven_flash_v2_5'
    },
    voiceId: {
      type: String,
      required: false  // Coqui kullanılabilir
    },
    voiceName: {
      type: String,
      required: false  // Coqui kullanılabilir
    },
    
    // Coqui TTS Ayarları
    coquiTunnelUrl: {
      type: String,
      required: false
    },
    coquiLanguage: {
      type: String,
      default: 'tr'
    },
    coquiVoiceId: {
      type: String,
      required: false
    },
    coquiVoiceName: {
      type: String,
      required: false
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
    
    // Görsel Stili
    visualStyleId: {
      type: Schema.Types.ObjectId,
      ref: 'VisualStyle',
      required: false
    },
    
    // Prompt Senaryosu
    promptScenarioId: {
      type: Schema.Types.ObjectId,
      ref: 'PromptScenario',
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
    
    // Karakter Sayıları
    originalContentLength: {
      type: Number
    },
    translatedContentLength: {
      type: Number
    },
    adaptedContentLength: {
      type: Number
    },
    
    // İşleme Süreleri
    processingStartedAt: {
      type: Date
    },
    processingCompletedAt: {
      type: Date
    },
    processingDuration: {
      type: Number // Saniye cinsinden toplam üretim süresi
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
      zipFile: String,
      thumbnail: String  // YouTube kapak görseli
    },
    
    // YouTube Yayın Bilgisi
    youtubeUrl: {
      type: String,
      required: false
    },
    youtubePublishedAt: {
      type: Date,
      required: false
    }
  },
  {
    timestamps: true
  }
);

// Indexes
StorySchema.index({ userId: 1, createdAt: -1 });
StorySchema.index({ status: 1, createdAt: -1 });
StorySchema.index({ originalLanguage: 1 });
StorySchema.index({ targetLanguage: 1 });

const Story: Model<IStory> = mongoose.models.Story || mongoose.model<IStory>('Story', StorySchema);

export default Story;

