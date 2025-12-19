/**
 * API Endpoint: Toplu Kanal Atama
 * POST /api/stories/bulk-channel - Birden fazla hikayeyi bir kanala ata
 */

import { NextRequest, NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import Story from '@/models/Story';
import Channel from '@/models/Channel';
import logger from '@/lib/logger';
import { auth } from '@/auth';
import { z } from 'zod';

const bulkChannelSchema = z.object({
  storyIds: z.array(z.string()).min(1, 'En az bir hikaye seçilmeli'),
  channelId: z.string().nullable(), // null = kanaldan çıkar
});

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({
        success: false,
        error: 'Yetkisiz erişim'
      }, { status: 401 });
    }

    const userId = session.user.id;
    const body = await request.json();

    // Validasyon
    const validated = bulkChannelSchema.safeParse(body);
    if (!validated.success) {
      return NextResponse.json({
        success: false,
        error: 'Geçersiz istek',
        details: validated.error.errors
      }, { status: 400 });
    }

    const { storyIds, channelId } = validated.data;

    await dbConnect();

    // Kanal varsa, kullanıcıya ait mi kontrol et
    let channel = null;
    if (channelId) {
      channel = await Channel.findOne({ _id: channelId, userId });
      if (!channel) {
        return NextResponse.json({
          success: false,
          error: 'Kanal bulunamadı'
        }, { status: 404 });
      }
    }

    // Hikayelerin tamamının kullanıcıya ait olduğunu kontrol et
    const storiesCount = await Story.countDocuments({
      _id: { $in: storyIds },
      userId
    });

    if (storiesCount !== storyIds.length) {
      return NextResponse.json({
        success: false,
        error: 'Bazı hikayeler bulunamadı veya size ait değil'
      }, { status: 400 });
    }

    // Toplu güncelleme
    let result;
    if (channelId) {
      // Kanala ekle
      result = await Story.updateMany(
        { _id: { $in: storyIds }, userId },
        { $set: { channelId: channelId } }
      );
    } else {
      // Kanaldan çıkar
      result = await Story.updateMany(
        { _id: { $in: storyIds }, userId },
        { $unset: { channelId: 1 } }
      );
    }

    logger.info('Toplu kanal atama yapıldı', {
      userId,
      storyIds,
      channelId,
      channelName: channel?.name || null,
      modifiedCount: result.modifiedCount
    });

    return NextResponse.json({
      success: true,
      message: channelId 
        ? `${result.modifiedCount} hikaye "${channel?.name}" kanalına eklendi`
        : `${result.modifiedCount} hikaye kanaldan çıkarıldı`,
      modifiedCount: result.modifiedCount,
      channel: channel ? {
        _id: channel._id.toString(),
        name: channel.name,
        color: channel.color,
        icon: channel.icon
      } : null
    });

  } catch (error) {
    logger.error('Toplu kanal atama hatası', {
      error: error instanceof Error ? error.message : 'Bilinmeyen hata'
    });

    return NextResponse.json({
      success: false,
      error: 'Sunucu hatası'
    }, { status: 500 });
  }
}
