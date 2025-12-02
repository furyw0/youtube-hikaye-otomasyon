/**
 * API Endpoint: Hikaye İşleme Başlat
 * POST /api/stories/process
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import dbConnect from '@/lib/mongodb';
import Story from '@/models/Story';
import logger from '@/lib/logger';
import { inngest } from '@/inngest/client';

// Validation schema
const processStorySchema = z.object({
  storyId: z.string().min(24).max(24) // MongoDB ObjectId
});

export async function POST(request: NextRequest) {
  try {
    logger.info('Hikaye işleme isteği alındı');

    // Parse request body
    const body = await request.json();
    
    // Validate
    const validated = processStorySchema.parse(body);
    const { storyId } = validated;

    // MongoDB bağlantısı
    await dbConnect();

    // Story kontrol
    const story = await Story.findById(storyId);
    
    if (!story) {
      logger.warn('Hikaye bulunamadı', { storyId });
      
      return NextResponse.json({
        success: false,
        error: 'Hikaye bulunamadı'
      }, { status: 404 });
    }

    // Zaten işleniyor mu kontrol
    if (story.status === 'processing' || story.status === 'queued') {
      logger.warn('Hikaye zaten işleniyor', {
        storyId,
        status: story.status
      });
      
      return NextResponse.json({
        success: false,
        error: 'Hikaye zaten işleniyor',
        status: story.status,
        progress: story.progress
      }, { status: 400 });
    }

    // Tamamlanmış mı kontrol
    if (story.status === 'completed') {
      logger.warn('Hikaye zaten tamamlanmış', { storyId });
      
      return NextResponse.json({
        success: false,
        error: 'Hikaye zaten tamamlanmış',
        status: story.status
      }, { status: 400 });
    }

    // Inngest'e gönder (background job başlat)
    logger.info('Inngest job başlatılıyor', { storyId });
    
    const { ids } = await inngest.send({
      name: 'story/process',
      data: { storyId: storyId.toString() }
    });

    const inngestRunId = ids[0];

    // Story durumunu güncelle
    story.status = 'queued';
    story.progress = 0;
    story.currentStep = 'Sıraya alındı...';
    await story.save();

    logger.info('Inngest job başlatıldı', {
      storyId,
      inngestRunId
    });

    return NextResponse.json({
      success: true,
      storyId,
      inngestRunId,
      message: 'İşlem başlatıldı',
      status: 'queued'
    });

  } catch (error) {
    // Zod validation hatası
    if (error instanceof z.ZodError) {
      logger.warn('Validation hatası', {
        errors: error.errors
      });
      
      return NextResponse.json({
        success: false,
        error: 'Geçersiz storyId'
      }, { status: 400 });
    }

    // Genel hata
    logger.error('Hikaye işleme başlatma hatası', {
      error: error instanceof Error ? error.message : 'Bilinmeyen hata'
    });

    return NextResponse.json({
      success: false,
      error: 'Sunucu hatası',
      message: error instanceof Error ? error.message : 'Bilinmeyen hata'
    }, { status: 500 });
  }
}

