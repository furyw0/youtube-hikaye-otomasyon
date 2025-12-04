import mongoose, { Schema, Model } from 'mongoose';
import { IScene } from '@/types/scene.types';

const SceneSchema = new Schema<IScene>(
  {
    storyId: {
      type: Schema.Types.ObjectId,
      ref: 'Story',
      required: true
    },
    sceneNumber: {
      type: Number,
      required: true
    },
    
    // Çoklu dil metinler
    sceneTextOriginal: {
      type: String,
      required: true
    },
    sceneTextAdapted: {
      type: String,
      required: true
    },
    sceneTextTurkish: {
      type: String, // Türkçe çeviri (hedef dil Türkçe değilse)
      required: false
    },
    
    // Görsel bilgileri
    hasImage: {
      type: Boolean,
      default: false
    },
    imageIndex: {
      type: Number
    },
    visualDescription: {
      type: String
    },
    visualPrompt: {
      type: String
    },
    isFirstThreeMinutes: {
      type: Boolean,
      default: false
    },
    
    // Süre
    estimatedDuration: {
      type: Number,
      required: true
    },
    actualDuration: {
      type: Number
    },
    
    // Dosyalar
    blobUrls: {
      image: String,
      audio: String,
      metadata: String
    },
    
    // Durum
    status: {
      type: String,
      enum: ['pending', 'processing', 'completed', 'failed'],
      default: 'pending'
    },
    errorMessage: {
      type: String
    },
    retryCount: {
      type: Number,
      default: 0
    }
  },
  {
    timestamps: true
  }
);

// Indexes
SceneSchema.index({ storyId: 1, sceneNumber: 1 });
SceneSchema.index({ status: 1 });
SceneSchema.index({ hasImage: 1 });
SceneSchema.index({ isFirstThreeMinutes: 1 });

const Scene: Model<IScene> = mongoose.models.Scene || mongoose.model<IScene>('Scene', SceneSchema);

export default Scene;

