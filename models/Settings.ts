import mongoose, { Schema, Model, Types } from 'mongoose';

export type TTSProvider = 'elevenlabs' | 'coqui';

export interface ISettings {
  _id: Types.ObjectId;
  userId: Types.ObjectId; // Kullanıcıya özel ayarlar
  
  // API Keys (şifrelenmiş saklanır)
  openaiApiKey?: string;
  elevenlabsApiKey?: string;
  imagefxCookie?: string; // Google Cookie for ImageFX
  
  // TTS Sağlayıcı Ayarları
  ttsProvider: TTSProvider;
  
  // Coqui TTS Ayarları
  coquiTunnelUrl?: string;
  coquiLanguage?: string;        // 'tr', 'en', 'de', vb.
  coquiSelectedVoiceId?: string; // Seçili referans ses ID'si
  
  // Varsayılan ayarlar
  defaultOpenaiModel: string;
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
    elevenlabsApiKey: {
      type: String,
      select: false
    },
    imagefxCookie: {
      type: String,
      select: false
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

// Indexes
SettingsSchema.index({ userId: 1 });

const Settings: Model<ISettings> = mongoose.models.Settings || mongoose.model<ISettings>('Settings', SettingsSchema);

export default Settings;

