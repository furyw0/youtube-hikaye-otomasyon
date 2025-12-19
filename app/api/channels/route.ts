/**
 * API Endpoint: Kanallar (YouTube Kanal Grupları)
 * GET /api/channels - Kullanıcının kanallarını listele
 * POST /api/channels - Yeni kanal oluştur
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import dbConnect from '@/lib/mongodb';
import Channel from '@/models/Channel';
import Story from '@/models/Story';
import { auth } from '@/auth';
import logger from '@/lib/logger';

// Renk seçenekleri
const CHANNEL_COLORS = [
  '#ef4444', // red
  '#f97316', // orange
  '#f59e0b', // amber
  '#84cc16', // lime
  '#22c55e', // green
  '#14b8a6', // teal
  '#06b6d4', // cyan
  '#3b82f6', // blue
  '#6366f1', // indigo
  '#8b5cf6', // violet
  '#a855f7', // purple
  '#ec4899', // pink
];

// Validation schema
const createChannelSchema = z.object({
  name: z.string().min(2, 'Kanal adı en az 2 karakter olmalı').max(50, 'Kanal adı en fazla 50 karakter olabilir'),
  description: z.string().max(200, 'Açıklama en fazla 200 karakter olabilir').optional(),
  color: z.string().regex(/^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/, 'Geçerli bir renk kodu girin').optional(),
  icon: z.string().max(4).optional(),
  youtubeChannelUrl: z.string().url().optional().or(z.literal('')),
  isDefault: z.boolean().optional()
});

/**
 * GET - Kullanıcının tüm kanallarını getir
 */
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({
        success: false,
        error: 'Yetkisiz erişim'
      }, { status: 401 });
    }

    const userId = session.user.id;
    await dbConnect();

    // Kanalları getir ve hikaye sayısını hesapla
    const channels = await Channel.find({ userId })
      .sort({ isDefault: -1, createdAt: -1 })
      .lean();

    // Her kanal için hikaye sayısını hesapla
    const channelsWithCount = await Promise.all(
      channels.map(async (channel) => {
        const storyCount = await Story.countDocuments({ channelId: channel._id });
        return {
          _id: channel._id.toString(),
          name: channel.name,
          description: channel.description,
          color: channel.color,
          icon: channel.icon,
          youtubeChannelUrl: channel.youtubeChannelUrl,
          isDefault: channel.isDefault,
          storyCount,
          createdAt: channel.createdAt,
          updatedAt: channel.updatedAt
        };
      })
    );

    // Toplam gruplanmamış hikaye sayısı
    const ungroupedCount = await Story.countDocuments({ 
      userId, 
      channelId: { $exists: false } 
    });

    return NextResponse.json({
      success: true,
      channels: channelsWithCount,
      ungroupedCount,
      availableColors: CHANNEL_COLORS
    });

  } catch (error) {
    logger.error('Kanallar getirme hatası', {
      error: error instanceof Error ? error.message : 'Bilinmeyen hata'
    });

    return NextResponse.json({
      success: false,
      error: 'Kanallar yüklenemedi'
    }, { status: 500 });
  }
}

/**
 * POST - Yeni kanal oluştur
 */
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
    const validated = createChannelSchema.parse(body);

    await dbConnect();

    // Aynı isimde kanal var mı kontrol et
    const existingChannel = await Channel.findOne({ userId, name: validated.name });
    if (existingChannel) {
      return NextResponse.json({
        success: false,
        error: 'Bu isimde bir kanal zaten mevcut'
      }, { status: 400 });
    }

    // Varsayılan renk seç (rastgele)
    const randomColor = CHANNEL_COLORS[Math.floor(Math.random() * CHANNEL_COLORS.length)];

    // Yeni kanal oluştur
    const channel = await Channel.create({
      userId,
      name: validated.name,
      description: validated.description || '',
      color: validated.color || randomColor,
      icon: validated.icon || '📺',
      youtubeChannelUrl: validated.youtubeChannelUrl || '',
      isDefault: validated.isDefault || false
    });

    logger.info('Yeni kanal oluşturuldu', {
      userId,
      channelId: channel._id,
      name: channel.name
    });

    return NextResponse.json({
      success: true,
      channel: {
        _id: channel._id.toString(),
        name: channel.name,
        description: channel.description,
        color: channel.color,
        icon: channel.icon,
        youtubeChannelUrl: channel.youtubeChannelUrl,
        isDefault: channel.isDefault,
        storyCount: 0,
        createdAt: channel.createdAt,
        updatedAt: channel.updatedAt
      }
    }, { status: 201 });

  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({
        success: false,
        error: 'Geçersiz veri',
        details: error.errors
      }, { status: 400 });
    }

    logger.error('Kanal oluşturma hatası', {
      error: error instanceof Error ? error.message : 'Bilinmeyen hata'
    });

    return NextResponse.json({
      success: false,
      error: 'Kanal oluşturulamadı'
    }, { status: 500 });
  }
}
