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
import Channel from '@/models/Channel';
import logger from '@/lib/logger';
import { auth } from '@/auth';
import { deleteStoryFiles, uploadZip } from '@/services/blob.service';
import { createZipArchive } from '@/services/zip.service';
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

    // Story'yi getir - userId kontrolü ile, channel bilgisi populate edilmiş
    const story = await Story.findOne({ _id: storyId, userId })
      .populate({
        path: 'channelId',
        select: 'name color icon youtubeChannelUrl',
        model: Channel
      })
      .lean();

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

    // Channel bilgisini düzgün formatta hazırla
    interface PopulatedChannel {
      _id: string;
      name: string;
      color: string;
      icon: string;
      youtubeChannelUrl?: string;
    }
    
    const populatedChannel = story.channelId && typeof story.channelId === 'object' && 'name' in story.channelId
      ? story.channelId as unknown as PopulatedChannel
      : null;
    
    const channelInfo = populatedChannel ? {
      _id: populatedChannel._id,
      name: populatedChannel.name,
      color: populatedChannel.color,
      icon: populatedChannel.icon,
      youtubeChannelUrl: populatedChannel.youtubeChannelUrl
    } : null;

    return NextResponse.json({
      success: true,
      story: {
        ...story,
        _id: story._id.toString(),
        channel: channelInfo,
        channelId: channelInfo?._id,
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

// PATCH - Hikaye güncelleme (status değişikliği, YouTube URL ekleme, kanal değişikliği, ZIP yeniden oluşturma vb.)
const patchSchema = z.object({
  action: z.enum(['complete', 'retry', 'setYoutubeUrl', 'removeYoutubeUrl', 'regenerateZip', 'setChannel', 'removeChannel']),
  youtubeUrl: z.string().url().optional(),
  channelId: z.string().optional(),
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

    if (validated.data.action === 'setYoutubeUrl') {
      // YouTube URL ekle
      if (!validated.data.youtubeUrl) {
        return NextResponse.json({
          success: false,
          error: 'YouTube URL gerekli'
        }, { status: 400 });
      }

      // YouTube URL formatını doğrula
      const youtubeRegex = /^(https?:\/\/)?(www\.)?(youtube\.com\/(watch\?v=|shorts\/)|youtu\.be\/)/;
      if (!youtubeRegex.test(validated.data.youtubeUrl)) {
        return NextResponse.json({
          success: false,
          error: 'Geçersiz YouTube URL formatı'
        }, { status: 400 });
      }

      await Story.findByIdAndUpdate(storyId, {
        youtubeUrl: validated.data.youtubeUrl,
        youtubePublishedAt: new Date()
      });

      logger.info('YouTube URL eklendi', { storyId, userId, youtubeUrl: validated.data.youtubeUrl });

      return NextResponse.json({
        success: true,
        message: 'YouTube linki eklendi'
      });
    }

    if (validated.data.action === 'removeYoutubeUrl') {
      // YouTube URL kaldır
      await Story.findByIdAndUpdate(storyId, {
        $unset: { youtubeUrl: 1, youtubePublishedAt: 1 }
      });

      logger.info('YouTube URL kaldırıldı', { storyId, userId });

      return NextResponse.json({
        success: true,
        message: 'YouTube linki kaldırıldı'
      });
    }

    if (validated.data.action === 'regenerateZip') {
      // ZIP'i yeniden oluştur
      logger.info('ZIP yeniden oluşturma başlatılıyor', { storyId, userId });

      // Sahneleri getir
      const scenes = await Scene.find({ storyId }).sort({ sceneNumber: 1 }).lean();
      
      if (scenes.length === 0) {
        return NextResponse.json({
          success: false,
          error: 'Hikayede sahne bulunamadı'
        }, { status: 400 });
      }

      // Story'yi lean() olmadan getir (tam obje için)
      const storyData = await Story.findById(storyId).lean();
      if (!storyData) {
        return NextResponse.json({
          success: false,
          error: 'Hikaye bulunamadı'
        }, { status: 404 });
      }

      try {
        // ZIP oluştur
        const zipBuffer = await createZipArchive({
          ...storyData,
          scenes: scenes
        } as any);

        // Blob'a yükle
        const uploaded = await uploadZip(storyId, zipBuffer, 'story-package');

        // Story'yi güncelle
        await Story.findByIdAndUpdate(storyId, {
          'blobUrls.zipFile': uploaded.url
        });

        // Sahne bilgilerini topla
        const scenesWithAudio = scenes.filter(s => s.blobUrls?.audio);
        const scenesWithImages = scenes.filter(s => s.blobUrls?.image);

        logger.info('ZIP yeniden oluşturuldu', {
          storyId,
          userId,
          zipSize: uploaded.size,
          zipUrl: uploaded.url,
          totalScenes: scenes.length,
          scenesWithAudio: scenesWithAudio.length,
          scenesWithImages: scenesWithImages.length
        });

        return NextResponse.json({
          success: true,
          message: 'ZIP dosyası yeniden oluşturuldu',
          zipUrl: uploaded.url,
          zipSize: uploaded.size,
          stats: {
            totalScenes: scenes.length,
            scenesWithAudio: scenesWithAudio.length,
            scenesWithImages: scenesWithImages.length
          }
        });

      } catch (zipError) {
        logger.error('ZIP yeniden oluşturma hatası', {
          storyId,
          error: zipError instanceof Error ? zipError.message : 'Bilinmeyen hata'
        });

        return NextResponse.json({
          success: false,
          error: 'ZIP oluşturulurken hata oluştu',
          details: zipError instanceof Error ? zipError.message : 'Bilinmeyen hata'
        }, { status: 500 });
      }
    }

    if (validated.data.action === 'setChannel') {
      // Kanal ata
      if (!validated.data.channelId) {
        return NextResponse.json({
          success: false,
          error: 'Kanal ID gerekli'
        }, { status: 400 });
      }

      // Kanal kullanıcıya ait mi kontrol et
      const channel = await Channel.findOne({ _id: validated.data.channelId, userId });
      if (!channel) {
        return NextResponse.json({
          success: false,
          error: 'Kanal bulunamadı'
        }, { status: 404 });
      }

      await Story.findByIdAndUpdate(storyId, {
        channelId: validated.data.channelId
      });

      logger.info('Hikaye kanala eklendi', { 
        storyId, 
        userId, 
        channelId: validated.data.channelId,
        channelName: channel.name 
      });

      return NextResponse.json({
        success: true,
        message: 'Hikaye kanala eklendi',
        channel: {
          _id: channel._id.toString(),
          name: channel.name,
          color: channel.color,
          icon: channel.icon
        }
      });
    }

    if (validated.data.action === 'removeChannel') {
      // Kanaldan çıkar
      await Story.findByIdAndUpdate(storyId, {
        $unset: { channelId: 1 }
      });

      logger.info('Hikaye kanaldan çıkarıldı', { storyId, userId });

      return NextResponse.json({
        success: true,
        message: 'Hikaye kanaldan çıkarıldı'
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
