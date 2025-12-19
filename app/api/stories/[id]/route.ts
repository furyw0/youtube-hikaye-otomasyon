/**
 * API Endpoint: Hikaye Detayları
 * GET /api/stories/[id]
 * PATCH /api/stories/[id] - Status güncelleme (manuel tamamlama)
 * DELETE /api/stories/[id]
 */

import { NextRequest, NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import Story from '@/models/Story';
import Scene from '@/models/Scene';
import logger from '@/lib/logger';
import { auth } from '@/auth';
import { deleteStoryFiles } from '@/services/blob.service';
import { z } from 'zod';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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
    const { id: storyId } = await params;

    logger.debug('Hikaye detayları istendi', { storyId, userId });

    // MongoDB bağlantısı
    await dbConnect();

    // Story'yi getir - userId kontrolü ile
    const story = await Story.findOne({ _id: storyId, userId }).lean();

    if (!story) {
      logger.warn('Hikaye bulunamadı veya yetkisiz', { storyId, userId });
      
      return NextResponse.json({
        success: false,
        error: 'Hikaye bulunamadı'
      }, { status: 404 });
    }

    // Scene'leri ayrı olarak getir (populate yerine direct query - daha güvenilir)
    const scenes = await Scene.find({ storyId: storyId })
      .sort({ sceneNumber: 1 })
      .lean();
    
    logger.debug('Hikaye detayları gönderiliyor', {
      storyId,
      status: story.status,
      progress: story.progress,
      scenesCount: scenes.length,
      scenesWithImages: scenes.filter(s => s.blobUrls?.image).length,
      scenesWithAudio: scenes.filter(s => s.blobUrls?.audio).length
    });

    return NextResponse.json({
      success: true,
      story: {
        ...story,
        _id: story._id.toString(),
        scenes: scenes // Direct query'den gelen scenes
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

// PATCH - Hikaye status güncelleme (manuel tamamlama için)
const patchSchema = z.object({
  action: z.enum(['complete', 'retry']),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({
        success: false,
        error: 'Yetkisiz erişim'
      }, { status: 401 });
    }

    const userId = session.user.id;
    const { id: storyId } = await params;
    const body = await request.json();

    // Validasyon
    const validated = patchSchema.safeParse(body);
    if (!validated.success) {
      return NextResponse.json({
        success: false,
        error: 'Geçersiz istek',
        details: validated.error.errors
      }, { status: 400 });
    }

    await dbConnect();

    const story = await Story.findOne({ _id: storyId, userId });
    if (!story) {
      return NextResponse.json({
        success: false,
        error: 'Hikaye bulunamadı'
      }, { status: 404 });
    }

    if (validated.data.action === 'complete') {
      // Manuel olarak tamamla
      await Story.findByIdAndUpdate(storyId, {
        status: 'completed',
        progress: 100,
        currentStep: 'Manuel olarak tamamlandı'
      });

      logger.info('Hikaye manuel olarak tamamlandı', { storyId, userId });

      return NextResponse.json({
        success: true,
        message: 'Hikaye tamamlandı olarak işaretlendi'
      });
    }

    if (validated.data.action === 'retry') {
      // Yeniden deneme için sıfırla
      await Story.findByIdAndUpdate(storyId, {
        status: 'pending',
        progress: 0,
        currentStep: 'Bekliyor',
        errorMessage: null
      });

      logger.info('Hikaye yeniden deneme için sıfırlandı', { storyId, userId });

      return NextResponse.json({
        success: true,
        message: 'Hikaye yeniden işleme alınacak'
      });
    }

    return NextResponse.json({
      success: false,
      error: 'Geçersiz işlem'
    }, { status: 400 });

  } catch (error) {
    logger.error('Hikaye güncelleme hatası', {
      error: error instanceof Error ? error.message : 'Bilinmeyen hata'
    });

    return NextResponse.json({
      success: false,
      error: 'Sunucu hatası'
    }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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
    const { id: storyId } = await params;

    logger.info('Hikaye silme isteği', { storyId, userId });

    await dbConnect();

    // Story kontrol - userId ile
    const story = await Story.findOne({ _id: storyId, userId });
    
    if (!story) {
      return NextResponse.json({
        success: false,
        error: 'Hikaye bulunamadı'
      }, { status: 404 });
    }

    // Blob storage'dan dosyaları sil
    try {
      await deleteStoryFiles(storyId);
      logger.info('Blob dosyaları silindi', { storyId });
    } catch (blobError) {
      // Blob silme hatası kritik değil, devam et
      logger.warn('Blob dosyaları silinemedi (devam ediliyor)', {
        storyId,
        error: blobError instanceof Error ? blobError.message : 'Bilinmeyen hata'
      });
    }

    // Sahneleri sil
    await Scene.deleteMany({ storyId });

    // Story'yi sil
    await Story.findByIdAndDelete(storyId);

    logger.info('Hikaye silindi', { storyId, userId });

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
