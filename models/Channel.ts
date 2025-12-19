/**
 * Channel Model
 * YouTube kanallarını temsil eden model
 */

import mongoose, { Schema, Model, Types } from 'mongoose';

export interface IChannel {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  name: string;
  description?: string;
  color: string;  // Hex color for UI
  icon?: string;  // Emoji or icon identifier
  youtubeChannelUrl?: string;  // YouTube kanal linki
  isDefault?: boolean;  // Varsayılan kanal mı
  storyCount?: number;  // Virtual field - hikaye sayısı
  createdAt: Date;
  updatedAt: Date;
}

type ChannelModel = Model<IChannel>;

const ChannelSchema = new Schema<IChannel, ChannelModel>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Kullanıcı ID gerekli'],
      index: true,
    },
    name: {
      type: String,
      required: [true, 'Kanal adı gerekli'],
      trim: true,
      minlength: [2, 'Kanal adı en az 2 karakter olmalı'],
      maxlength: [50, 'Kanal adı en fazla 50 karakter olabilir'],
    },
    description: {
      type: String,
      trim: true,
      maxlength: [200, 'Açıklama en fazla 200 karakter olabilir'],
    },
    color: {
      type: String,
      required: true,
      default: '#6366f1',  // Indigo default
      match: [/^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/, 'Geçerli bir hex renk kodu girin'],
    },
    icon: {
      type: String,
      default: '📺',  // Default emoji
    },
    youtubeChannelUrl: {
      type: String,
      trim: true,
    },
    isDefault: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Compound index for user's channels
ChannelSchema.index({ userId: 1, name: 1 }, { unique: true });
ChannelSchema.index({ userId: 1, createdAt: -1 });

// Virtual: Story count
ChannelSchema.virtual('storyCount', {
  ref: 'Story',
  localField: '_id',
  foreignField: 'channelId',
  count: true,
});

// Aynı kullanıcıda sadece bir default channel olabilir
ChannelSchema.pre('save', async function(next) {
  if (this.isDefault && this.isModified('isDefault')) {
    // Diğer kanalların default'ını kaldır
    await mongoose.model('Channel').updateMany(
      { userId: this.userId, _id: { $ne: this._id } },
      { isDefault: false }
    );
  }
  next();
});

const Channel: ChannelModel =
  mongoose.models.Channel || mongoose.model<IChannel, ChannelModel>('Channel', ChannelSchema);

export default Channel;
