/**
 * API Endpoint: Hikaye Detayları
 * GET /api/stories/[id]
 */

import { NextRequest, NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import Story from '@/models/Story';
import Scene from '@/models/Scene';
import logger from '@/lib/logger';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: storyId } = await params;

    logger.debug('Hikaye detayları istendi', { storyId });

    // MongoDB bağlantısı
    await dbConnect();

    // Story ve scenes'leri getir
    const story = await Story.findById(storyId)
      .populate('scenes')
      .lean();

    if (!story) {
      logger.warn('Hikaye bulunamadı', { storyId });
      
      return NextResponse.json({
        success: false,
        error: 'Hikaye bulunamadı'
      }, { status: 404 });
    }

    logger.debug('Hikaye detayları gönderiliyor', {
      storyId,
      status: story.status,
      progress: story.progress,
      scenes: story.scenes.length
    });

    return NextResponse.json({
      success: true,
      story: {
        ...story,
        _id: story._id.toString(),
        scenes: story.scenes
      }
    });

  } catch (error) {
    logger.error('Hikaye detayları getirme hatası', {
      error: error instanceof Error ? error.message : 'Bilinmeyen hata'
    });

    return NextResponse.json({
      success: false,
      error: 'Sunucu hatası',
      message: error instanceof Error ? error.message : 'Bilinmeyen hata'
    }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: storyId } = await params;

    logger.info('Hikaye silme isteği', { storyId });

    await dbConnect();

    // Story kontrol
    const story = await Story.findById(storyId);
    
    if (!story) {
      return NextResponse.json({
        success: false,
        error: 'Hikaye bulunamadı'
      }, { status: 404 });
    }

    // Sahneleri sil
    await Scene.deleteMany({ storyId });

    // Story'yi sil
    await Story.findByIdAndDelete(storyId);

    // TODO: Blob storage'dan dosyaları sil

    logger.info('Hikaye silindi', { storyId });

    return NextResponse.json({
      success: true,
      message: 'Hikaye silindi'
    });

  } catch (error) {
    logger.error('Hikaye silme hatası', {
      error: error instanceof Error ? error.message : 'Bilinmeyen hata'
    });

    return NextResponse.json({
      success: false,
      error: 'Sunucu hatası'
    }, { status: 500 });
  }
}

