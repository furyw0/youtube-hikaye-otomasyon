/**
 * API Endpoint: Ayarlar Yönetimi
 * GET /api/settings - Ayarları getir
 * PUT /api/settings - Ayarları güncelle
 */

import { NextRequest, NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import Settings from '@/models/Settings';
import logger from '@/lib/logger';

// GET - Ayarları getir (API key'leri maskelenmiş)
export async function GET() {
  try {
    await dbConnect();

    // Ayarları getir (API key'leri dahil et ama maskele)
    let settings = await Settings.findOne().select('+openaiApiKey +elevenlabsApiKey +imagefxCookie');

    // Eğer ayar yoksa varsayılan oluştur
    if (!settings) {
      settings = await Settings.create({});
      logger.info('Varsayılan ayarlar oluşturuldu');
    }

    // API key'leri maskele
    const maskedSettings = {
      _id: settings._id,
      defaultOpenaiModel: settings.defaultOpenaiModel,
      defaultElevenlabsModel: settings.defaultElevenlabsModel,
      defaultVoiceId: settings.defaultVoiceId,
      defaultVoiceName: settings.defaultVoiceName,
      defaultImagefxModel: settings.defaultImagefxModel,
      defaultImagefxAspectRatio: settings.defaultImagefxAspectRatio,
      maxDailyStories: settings.maxDailyStories,
      maxConcurrentProcessing: settings.maxConcurrentProcessing,
      // API key'leri maskele (sadece var/yok bilgisi)
      hasOpenaiApiKey: !!settings.openaiApiKey,
      hasElevenlabsApiKey: !!settings.elevenlabsApiKey,
      hasImagefxCookie: !!settings.imagefxCookie,
      // Maskelenmiş değerler (son 4 karakter)
      openaiApiKeyMasked: settings.openaiApiKey 
        ? `sk-...${settings.openaiApiKey.slice(-4)}` 
        : null,
      elevenlabsApiKeyMasked: settings.elevenlabsApiKey 
        ? `...${settings.elevenlabsApiKey.slice(-4)}` 
        : null,
      imagefxCookieMasked: settings.imagefxCookie 
        ? `Cookie ayarlı (${settings.imagefxCookie.length} karakter)` 
        : null,
      updatedAt: settings.updatedAt
    };

    return NextResponse.json({
      success: true,
      settings: maskedSettings
    });

  } catch (error) {
    logger.error('Ayarlar getirme hatası', {
      error: error instanceof Error ? error.message : 'Bilinmeyen hata'
    });

    return NextResponse.json({
      success: false,
      error: 'Ayarlar getirilemedi'
    }, { status: 500 });
  }
}

// PUT - Ayarları güncelle
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    
    await dbConnect();

    // Mevcut ayarları getir veya oluştur
    let settings = await Settings.findOne();
    if (!settings) {
      settings = new Settings({});
    }

    // Güncellenecek alanlar
    const updateFields: Record<string, any> = {};

    // API Keys (boş string gönderilirse silme)
    if (body.openaiApiKey !== undefined) {
      updateFields.openaiApiKey = body.openaiApiKey || undefined;
    }
    if (body.elevenlabsApiKey !== undefined) {
      updateFields.elevenlabsApiKey = body.elevenlabsApiKey || undefined;
    }
    if (body.imagefxCookie !== undefined) {
      updateFields.imagefxCookie = body.imagefxCookie || undefined;
    }

    // Varsayılan ayarlar
    if (body.defaultOpenaiModel) {
      updateFields.defaultOpenaiModel = body.defaultOpenaiModel;
    }
    if (body.defaultElevenlabsModel) {
      updateFields.defaultElevenlabsModel = body.defaultElevenlabsModel;
    }
    if (body.defaultVoiceId !== undefined) {
      updateFields.defaultVoiceId = body.defaultVoiceId;
      updateFields.defaultVoiceName = body.defaultVoiceName;
    }
    if (body.defaultImagefxModel) {
      updateFields.defaultImagefxModel = body.defaultImagefxModel;
    }
    if (body.defaultImagefxAspectRatio) {
      updateFields.defaultImagefxAspectRatio = body.defaultImagefxAspectRatio;
    }

    // Rate limiting
    if (body.maxDailyStories) {
      updateFields.maxDailyStories = body.maxDailyStories;
    }
    if (body.maxConcurrentProcessing) {
      updateFields.maxConcurrentProcessing = body.maxConcurrentProcessing;
    }

    // Güncelle
    Object.assign(settings, updateFields);
    await settings.save();

    logger.info('Ayarlar güncellendi', {
      updatedFields: Object.keys(updateFields)
    });

    return NextResponse.json({
      success: true,
      message: 'Ayarlar güncellendi'
    });

  } catch (error) {
    logger.error('Ayarlar güncelleme hatası', {
      error: error instanceof Error ? error.message : 'Bilinmeyen hata'
    });

    return NextResponse.json({
      success: false,
      error: 'Ayarlar güncellenemedi'
    }, { status: 500 });
  }
}

