/**
 * API Endpoint: Tekil Kanal İşlemleri
 * GET /api/channels/[id] - Kanal detayını getir
 * PUT /api/channels/[id] - Kanal güncelle
 * DELETE /api/channels/[id] - Kanal sil
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import mongoose from 'mongoose';
import dbConnect from '@/lib/mongodb';
import Channel from '@/models/Channel';
import Story from '@/models/Story';
import { auth } from '@/auth';
import logger from '@/lib/logger';

// Validation schema
const updateChannelSchema = z.object({
  name: z.string().min(2).max(50).optional(),
  description: z.string().max(200).optional(),
  color: z.string().regex(/^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/).optional(),
  icon: z.string().max(4).optional(),
  youtubeChannelUrl: z.string().url().optional().or(z.literal('')),
  isDefault: z.boolean().optional()
});

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET - Kanal detayını getir
 */
export async function GET(
  request: NextRequest,
  context: RouteParams
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({
        success: false,
        error: 'Yetkisiz erişim'
      }, { status: 401 });
    }

    const { id } = await context.params;
    const userId = session.user.id;

    // ID formatını kontrol et
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return NextResponse.json({
        success: false,
        error: 'Geçersiz kanal ID'
      }, { status: 400 });
    }

    await dbConnect();

    const channel = await Channel.findOne({ _id: id, userId }).lean();
    if (!channel) {
      return NextResponse.json({
        success: false,
        error: 'Kanal bulunamadı'
      }, { status: 404 });
    }

    // Hikaye sayısını getir
    const storyCount = await Story.countDocuments({ channelId: channel._id });

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
        storyCount,
        createdAt: channel.createdAt,
        updatedAt: channel.updatedAt
      }
    });

  } catch (error) {
    logger.error('Kanal detay getirme hatası', {
      error: error instanceof Error ? error.message : 'Bilinmeyen hata'
    });

    return NextResponse.json({
      success: false,
      error: 'Kanal yüklenemedi'
    }, { status: 500 });
  }
}

/**
 * PUT - Kanal güncelle
 */
export async function PUT(
  request: NextRequest,
  context: RouteParams
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({
        success: false,
        error: 'Yetkisiz erişim'
      }, { status: 401 });
    }

    const { id } = await context.params;
    const userId = session.user.id;
    const body = await request.json();

    // ID formatını kontrol et
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return NextResponse.json({
        success: false,
        error: 'Geçersiz kanal ID'
      }, { status: 400 });
    }

    // Validasyon
    const validated = updateChannelSchema.parse(body);

    await dbConnect();

    // Kanal var mı ve kullanıcıya ait mi kontrol et
    const existingChannel = await Channel.findOne({ _id: id, userId });
    if (!existingChannel) {
      return NextResponse.json({
        success: false,
        error: 'Kanal bulunamadı'
      }, { status: 404 });
    }

    // İsim değiştiyse, aynı isimde başka kanal var mı kontrol et
    if (validated.name && validated.name !== existingChannel.name) {
      const duplicateName = await Channel.findOne({ 
        userId, 
        name: validated.name,
        _id: { $ne: id }
      });
      if (duplicateName) {
        return NextResponse.json({
          success: false,
          error: 'Bu isimde bir kanal zaten mevcut'
        }, { status: 400 });
      }
    }

    // Eğer isDefault true yapılıyorsa, diğerlerini false yap
    if (validated.isDefault === true) {
      await Channel.updateMany(
        { userId, _id: { $ne: id } },
        { isDefault: false }
      );
    }

    // Güncelle
    const updatedChannel = await Channel.findByIdAndUpdate(
      id,
      { $set: validated },
      { new: true }
    ).lean();

    if (!updatedChannel) {
      return NextResponse.json({
        success: false,
        error: 'Kanal güncellenemedi'
      }, { status: 500 });
    }

    const storyCount = await Story.countDocuments({ channelId: updatedChannel._id });

    logger.info('Kanal güncellendi', {
      userId,
      channelId: id,
      updates: Object.keys(validated)
    });

    return NextResponse.json({
      success: true,
      channel: {
        _id: updatedChannel._id.toString(),
        name: updatedChannel.name,
        description: updatedChannel.description,
        color: updatedChannel.color,
        icon: updatedChannel.icon,
        youtubeChannelUrl: updatedChannel.youtubeChannelUrl,
        isDefault: updatedChannel.isDefault,
        storyCount,
        createdAt: updatedChannel.createdAt,
        updatedAt: updatedChannel.updatedAt
      }
    });

  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({
        success: false,
        error: 'Geçersiz veri',
        details: error.errors
      }, { status: 400 });
    }

    logger.error('Kanal güncelleme hatası', {
      error: error instanceof Error ? error.message : 'Bilinmeyen hata'
    });

    return NextResponse.json({
      success: false,
      error: 'Kanal güncellenemedi'
    }, { status: 500 });
  }
}

/**
 * DELETE - Kanal sil (hikayeleri gruptan çıkar)
 */
export async function DELETE(
  request: NextRequest,
  context: RouteParams
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({
        success: false,
        error: 'Yetkisiz erişim'
      }, { status: 401 });
    }

    const { id } = await context.params;
    const userId = session.user.id;

    // ID formatını kontrol et
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return NextResponse.json({
        success: false,
        error: 'Geçersiz kanal ID'
      }, { status: 400 });
    }

    await dbConnect();

    // Kanal var mı ve kullanıcıya ait mi kontrol et
    const channel = await Channel.findOne({ _id: id, userId });
    if (!channel) {
      return NextResponse.json({
        success: false,
        error: 'Kanal bulunamadı'
      }, { status: 404 });
    }

    // Bu kanala ait hikayelerin channelId'sini kaldır (hikayeleri silme)
    const updateResult = await Story.updateMany(
      { channelId: id },
      { $unset: { channelId: 1 } }
    );

    // Kanalı sil
    await Channel.findByIdAndDelete(id);

    logger.info('Kanal silindi', {
      userId,
      channelId: id,
      channelName: channel.name,
      ungroupedStories: updateResult.modifiedCount
    });

    return NextResponse.json({
      success: true,
      message: 'Kanal silindi',
      ungroupedStories: updateResult.modifiedCount
    });

  } catch (error) {
    logger.error('Kanal silme hatası', {
      error: error instanceof Error ? error.message : 'Bilinmeyen hata'
    });

    return NextResponse.json({
      success: false,
      error: 'Kanal silinemedi'
    }, { status: 500 });
  }
}
