import mongoose, { Schema, Model, Types } from 'mongoose';

export type TTSProvider = 'elevenlabs' | 'coqui';
export type LLMProvider = 'openai' | 'claude';

export interface ISettings {
  _id: Types.ObjectId;
  userId: Types.ObjectId; // Kullanıcıya özel ayarlar
  
  // API Keys (şifrelenmiş saklanır)
  openaiApiKey?: string;
  claudeApiKey?: string;
  elevenlabsApiKey?: string;
  imagefxCookie?: string; // Google Cookie for ImageFX
  
  // LLM Sağlayıcı Ayarları
  llmProvider: LLMProvider;
  
  // TTS Sağlayıcı Ayarları
  ttsProvider: TTSProvider;
  
  // Coqui TTS Ayarları
  coquiTunnelUrl?: string;
  coquiLanguage?: string;        // 'tr', 'en', 'de', vb.
  coquiSelectedVoiceId?: string; // Seçili referans ses ID'si
  
  // Varsayılan ayarlar
  defaultOpenaiModel: string;
  defaultClaudeModel: string;
  defaultElevenlabsModel: string;
  defaultVoiceId?: string;
  defaultVoiceName?: string;
  defaultImagefxModel: string;
  defaultImagefxAspectRatio: string;
  
  // Rate limiting
  maxDailyStories: number;
  maxConcurrentProcessing: number;
  
  // Metadata
  updatedAt: Date;
  createdAt: Date;
}

const SettingsSchema = new Schema<ISettings>(
  {
    // Kullanıcı referansı
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true
    },
    
    // API Keys
    openaiApiKey: {
      type: String,
      select: false // Güvenlik için varsayılan olarak getirme
    },
    claudeApiKey: {
      type: String,
      select: false
    },
    elevenlabsApiKey: {
      type: String,
      select: false
    },
    imagefxCookie: {
      type: String,
      select: false
    },
    
    // LLM Sağlayıcı
    llmProvider: {
      type: String,
      enum: ['openai', 'claude'],
      default: 'openai'
    },
    
    // TTS Sağlayıcı
    ttsProvider: {
      type: String,
      enum: ['elevenlabs', 'coqui'],
      default: 'elevenlabs'
    },
    
    // Coqui TTS Ayarları
    coquiTunnelUrl: {
      type: String
    },
    coquiLanguage: {
      type: String,
      default: 'tr'
    },
    coquiSelectedVoiceId: {
      type: String
    },
    
    // Varsayılan ayarlar
    defaultOpenaiModel: {
      type: String,
      default: 'gpt-4o-mini'
    },
    defaultClaudeModel: {
      type: String,
      default: 'claude-sonnet-4-20250514'
    },
    defaultElevenlabsModel: {
      type: String,
      default: 'eleven_flash_v2_5'
    },
    defaultVoiceId: {
      type: String
    },
    defaultVoiceName: {
      type: String
    },
    defaultImagefxModel: {
      type: String,
      default: 'IMAGEN_4'
    },
    defaultImagefxAspectRatio: {
      type: String,
      default: 'LANDSCAPE'
    },
    
    // Rate limiting
    maxDailyStories: {
      type: Number,
      default: 10
    },
    maxConcurrentProcessing: {
      type: Number,
      default: 2
    }
  },
  {
    timestamps: true
  }
);

// Indexes (userId index'i schema'da unique: true ile tanımlı)

const Settings: Model<ISettings> = mongoose.models.Settings || mongoose.model<ISettings>('Settings', SettingsSchema);

export default Settings;

