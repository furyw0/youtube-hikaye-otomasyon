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

// Validation schema
const createStorySchema = z.object({
  title: z.string().min(3).max(200),
  content: z.string().min(1000).max(100000),
  targetLanguage: z.string().length(2),
  targetCountry: z.string().min(2).max(50),
  openaiModel: z.string(),
  voiceId: z.string(),
  voiceName: z.string(),
  imagefxModel: z.enum(['IMAGEN_4', 'IMAGEN_3_5']).optional().default('IMAGEN_4'),
  imagefxAspectRatio: z.enum(['SQUARE', 'LANDSCAPE', 'PORTRAIT']).optional().default('LANDSCAPE'),
  imagefxSeed: z.number().int().min(0).max(2147483647).optional()
});

export async function POST(request: NextRequest) {
  try {
    // Rate limiting kontrolü (basit IP kontrolü)
    const ip = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown';
    
    logger.info('Hikaye oluşturma isteği alındı', { ip });

    // Parse request body
    const body = await request.json();
    
    // Zod validation
    const validated = createStorySchema.parse(body);

    // Custom validation (daha detaylı)
    const validationResult = validateCreateStoryRequest(validated);
    
    if (!validationResult.valid) {
      logger.warn('Validasyon hatası', {
        errors: validationResult.errors,
        ip
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
      originalTitle: validated.title,
      originalContent: validated.content,
      originalLanguage: detection.language,
      targetLanguage: validated.targetLanguage,
      targetCountry: validated.targetCountry,
      openaiModel: validated.openaiModel,
      voiceId: validated.voiceId,
      voiceName: validated.voiceName,
      imagefxModel: validated.imagefxModel,
      imagefxAspectRatio: validated.imagefxAspectRatio,
      imagefxSeed: validated.imagefxSeed,
      status: 'created',
      progress: 0,
      retryCount: 0,
      totalScenes: 0,
      totalImages: 10,
      firstMinuteImages: 5,
      estimatedTokens: validationResult.estimatedTokens,
      scenes: [],
      processLogs: [],
      blobUrls: {}
    });

    logger.info('Hikaye oluşturuldu', {
      storyId: story._id,
      detectedLanguage: detection.language,
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

