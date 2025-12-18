/**
 * Görsel Stil Modeli
 * Kullanıcıların özel görsel stilleri tanımlamasını sağlar
 */

import mongoose, { Schema, Model, Types } from 'mongoose';

export interface IVisualStyle {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  name: string;
  description?: string;
  isDefault: boolean;
  
  // Prompt Ayarları
  systemPrompt: string;
  technicalPrefix: string;
  styleSuffix: string;
  
  // Metadata
  createdAt: Date;
  updatedAt: Date;
}

const VisualStyleSchema = new Schema<IVisualStyle>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    name: {
      type: String,
      required: true,
      trim: true,
      maxLength: 100
    },
    description: {
      type: String,
      trim: true,
      maxLength: 500
    },
    isDefault: {
      type: Boolean,
      default: false
    },
    systemPrompt: {
      type: String,
      required: true,
      maxLength: 1000
    },
    technicalPrefix: {
      type: String,
      required: true,
      maxLength: 1000
    },
    styleSuffix: {
      type: String,
      required: true,
      maxLength: 500
    }
  },
  {
    timestamps: true
  }
);

// Indexes
VisualStyleSchema.index({ userId: 1, name: 1 }, { unique: true });
VisualStyleSchema.index({ userId: 1, isDefault: 1 });

const VisualStyle: Model<IVisualStyle> = mongoose.models.VisualStyle || mongoose.model<IVisualStyle>('VisualStyle', VisualStyleSchema);

export default VisualStyle;

/**
 * Varsayılan Görsel Stilleri
 * Kullanıcı için stil yoksa bunlar oluşturulur
 */
export const DEFAULT_VISUAL_STYLES = [
  {
    name: 'Sinematik',
    description: 'Profesyonel film kalitesinde fotorealistik görseller',
    isDefault: true,
    systemPrompt: 'Fotorealistik sinematik fotoğraf stili, dramatik aydınlatma, film kalitesi',
    technicalPrefix: 'Shot on Sony A7R IV, 85mm f/1.4 lens, natural lighting, film grain, shallow depth of field',
    styleSuffix: '--style raw --no text, watermark, logo, cartoon, anime, illustration, 3D render, CGI, drawing'
  },
  {
    name: 'Vintage/Sepia',
    description: 'Eski film etkisi, sepia tonları, nostaljik atmosfer',
    isDefault: true,
    systemPrompt: 'Vintage sepia-toned photograph, aged film aesthetic, warm brown tones, nostalgic atmosphere',
    technicalPrefix: 'Vintage photograph, sepia tones, old film grain, scratched film texture, weathered edges, antique aesthetic, faded colors, slight vignette',
    styleSuffix: '--style raw --no text, watermark, logo, modern, digital, sharp, vibrant colors, clean'
  },
  {
    name: 'Belgesel',
    description: 'Doğal ışık, otantik atmosfer, gerçekçi anlar',
    isDefault: true,
    systemPrompt: 'Documentary photography style, natural lighting, authentic atmosphere, photojournalistic',
    technicalPrefix: 'Documentary photograph, photojournalistic style, candid shot, natural lighting, authentic moment, real-life scene',
    styleSuffix: '--style raw --no text, watermark, logo, staged, artificial, posed, studio'
  },
  {
    name: 'Sanatsal',
    description: 'Güzel sanat fotoğrafçılığı, resimsi kalite, eterik atmosfer',
    isDefault: true,
    systemPrompt: 'Artistic fine art photography, painterly quality, ethereal atmosphere, soft focus',
    technicalPrefix: 'Fine art photograph, painterly aesthetic, soft focus, ethereal lighting, artistic composition, dreamy atmosphere',
    styleSuffix: '--style raw --no text, watermark, logo, harsh, digital, sharp, commercial'
  }
];
