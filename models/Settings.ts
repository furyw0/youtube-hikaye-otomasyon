import mongoose, { Schema, Model, Types } from 'mongoose';

export interface ISettings {
  _id: Types.ObjectId;
  
  // API Keys (şifrelenmiş saklanır)
  openaiApiKey?: string;
  elevenlabsApiKey?: string;
  imagefxCookie?: string; // Google Cookie for ImageFX
  
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

const Settings: Model<ISettings> = mongoose.models.Settings || mongoose.model<ISettings>('Settings', SettingsSchema);

export default Settings;

