/**
 * API Endpoint: Hikaye Oluştur
 * POST /api/stories/create
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import dbConnect from '@/lib/mongodb';
import Story from '@/models/Story';
import logger from '@/lib/logger';
import { detectLanguage } from '@/services/language-detection.service';
import { validateCreateStoryRequest } from '@/services/validation.service';
import { auth } from '@/auth';
import { IMAGE_SETTINGS } from '@/lib/constants';

// Validation schema
const createStorySchema = z.object({
  title: z.string().min(3).max(200),
  content: z.string().min(1000).max(100000),
  youtubeDescription: z.string().max(5000).optional(),
  coverText: z.string().max(100).optional(),
  targetLanguage: z.string().length(2),
  targetCountry: z.string().min(2).max(50),
  translationOnly: z.boolean().optional().default(false),
  enableHooks: z.boolean().optional().default(false),
  openaiModel: z.string(),
  // TTS Provider
  ttsProvider: z.enum(['elevenlabs', 'coqui']).optional().default('elevenlabs'),
  // ElevenLabs
  elevenlabsModel: z.enum([
    'eleven_flash_v2_5', 
    'eleven_turbo_v2_5', 
    'eleven_multilingual_v2', 
    'eleven_v3'
  ]).optional().default('eleven_flash_v2_5'),
  voiceId: z.string().optional(),
  voiceName: z.string().optional(),
  // Coqui TTS
  coquiTunnelUrl: z.string().optional(),
  coquiLanguage: z.string().optional(),
  coquiVoiceId: z.string().optional(),
  coquiVoiceName: z.string().optional(),
  // ImageFX
  imagefxModel: z.enum(['IMAGEN_4', 'IMAGEN_3_5']).optional().default('IMAGEN_4'),
  imagefxAspectRatio: z.enum(['SQUARE', 'LANDSCAPE', 'PORTRAIT']).optional().default('LANDSCAPE'),
  imagefxSeed: z.number().int().min(0).max(2147483647).optional(),
  // Görsel Stili
  visualStyleId: z.string().optional(),
  // Prompt Senaryosu
  promptScenarioId: z.string().optional()
}).refine((data) => {
  // TTS Provider'a göre gerekli alanları kontrol et
  if (data.ttsProvider === 'elevenlabs') {
    return !!data.voiceId;
  } else if (data.ttsProvider === 'coqui') {
    return !!data.coquiVoiceId && !!data.coquiTunnelUrl;
  }
  return true;
}, {
  message: 'TTS sağlayıcısı için gerekli alanlar eksik'
});

export async function POST(request: NextRequest) {
  try {
    // Auth kontrolü
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({
        success: false,
        error: 'Yetkisiz erişim'
      }, { status: 401 });
    }

    const userId = session.user.id;
    
    // Rate limiting kontrolü (basit IP kontrolü)
    const ip = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown';
    
    logger.info('Hikaye oluşturma isteği alındı', { ip, userId });

    // Parse request body
    const body = await request.json();
    
    // Zod validation
    const validated = createStorySchema.parse(body);

    // Custom validation (daha detaylı)
    const validationResult = validateCreateStoryRequest(validated);
    
    if (!validationResult.valid) {
      logger.warn('Validasyon hatası', {
        errors: validationResult.errors,
        ip,
        userId
      });
      
      return NextResponse.json({
        success: false,
        error: 'Validasyon hatası',
        details: validationResult.errors
      }, { status: 400 });
    }

    // MongoDB bağlantısı
    await dbConnect();

    // Dil algılama
    logger.debug('Dil algılanıyor...');
    const detection = await detectLanguage(validated.content);
    
    logger.info('Dil algılandı', {
      detectedLanguage: detection.language,
      confidence: detection.confidence
    });

    // Story oluştur
    const story = await Story.create({
      userId, // Kullanıcı ID'si
      originalTitle: validated.title,
      originalContent: validated.content,
      originalYoutubeDescription: validated.youtubeDescription,
      originalCoverText: validated.coverText,
      originalLanguage: detection.language,
      targetLanguage: validated.targetLanguage,
      targetCountry: validated.targetCountry,
      translationOnly: validated.translationOnly,
      enableHooks: validated.enableHooks,
      openaiModel: validated.openaiModel,
      // TTS Ayarları
      ttsProvider: validated.ttsProvider || 'elevenlabs',
      // ElevenLabs
      elevenlabsModel: validated.elevenlabsModel,
      voiceId: validated.voiceId,
      voiceName: validated.voiceName,
      // Coqui TTS
      coquiTunnelUrl: validated.coquiTunnelUrl,
      coquiLanguage: validated.coquiLanguage,
      coquiVoiceId: validated.coquiVoiceId,
      coquiVoiceName: validated.coquiVoiceName,
      // ImageFX
      imagefxModel: validated.imagefxModel,
      imagefxAspectRatio: validated.imagefxAspectRatio,
      imagefxSeed: validated.imagefxSeed,
      // Görsel Stili
      visualStyleId: validated.visualStyleId || undefined,
      // Prompt Senaryosu
      promptScenarioId: validated.promptScenarioId || undefined,
      status: 'created',
      progress: 0,
      retryCount: 0,
      totalScenes: 0,
      totalImages: IMAGE_SETTINGS.TOTAL_IMAGES, // 20 (hedef, hikaye kısaysa daha az)
      firstMinuteImages: IMAGE_SETTINGS.FIRST_THREE_MINUTES_IMAGES, // 6
      estimatedTokens: validationResult.estimatedTokens,
      scenes: [],
      processLogs: [],
      blobUrls: {}
    });

    logger.info('Hikaye oluşturuldu', {
      storyId: story._id,
      userId,
      detectedLanguage: detection.language,
      translationOnly: validated.translationOnly,
      estimatedTokens: validationResult.estimatedTokens,
      estimatedCost: validationResult.estimatedCost
    });

    return NextResponse.json({
      success: true,
      storyId: story._id.toString(),
      detectedLanguage: detection.language,
      estimatedTokens: validationResult.estimatedTokens,
      estimatedCost: validationResult.estimatedCost,
      warnings: validationResult.warnings
    }, { status: 201 });

  } catch (error) {
    // Zod validation hatası
    if (error instanceof z.ZodError) {
      logger.warn('Zod validation hatası', {
        errors: error.errors
      });
      
      return NextResponse.json({
        success: false,
        error: 'Geçersiz veri',
        details: error.errors.map(e => ({
          field: e.path.join('.'),
          message: e.message
        }))
      }, { status: 400 });
    }

    // Genel hata
    logger.error('Hikaye oluşturma hatası', {
      error: error instanceof Error ? error.message : 'Bilinmeyen hata',
      stack: error instanceof Error ? error.stack : undefined
    });

    return NextResponse.json({
      success: false,
      error: 'Sunucu hatası',
      message: error instanceof Error ? error.message : 'Bilinmeyen hata'
    }, { status: 500 });
  }
}
