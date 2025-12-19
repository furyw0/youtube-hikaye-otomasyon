/**
 * API Endpoint: Ayarlar Yönetimi
 * GET /api/settings - Ayarları getir
 * PUT /api/settings - Ayarları güncelle
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import dbConnect from '@/lib/mongodb';
import Settings from '@/models/Settings';
import logger from '@/lib/logger';

// GET - Ayarları getir (API key'leri maskelenmiş)
export async function GET() {
  try {
    const session = await auth();
    if (!session || !session.user?.id) {
      return NextResponse.json(
        { success: false, error: 'Yetkisiz erişim' },
        { status: 401 }
      );
    }

    await dbConnect();

    // Kullanıcının ayarlarını getir (API key'leri dahil et ama maskele)
    let settings = await Settings.findOne({ userId: session.user.id })
      .select('+openaiApiKey +claudeApiKey +elevenlabsApiKey +imagefxCookie');

    // Eğer ayar yoksa varsayılan oluştur
    if (!settings) {
      settings = await Settings.create({ userId: session.user.id });
      logger.info('Varsayılan ayarlar oluşturuldu', { userId: session.user.id });
    }

    // API key'leri maskele
    const maskedSettings = {
      _id: settings._id,
      // LLM Sağlayıcı
      llmProvider: settings.llmProvider || 'openai',
      // TTS Sağlayıcı
      ttsProvider: settings.ttsProvider || 'elevenlabs',
      // Coqui TTS Ayarları
      coquiTunnelUrl: settings.coquiTunnelUrl || '',
      coquiLanguage: settings.coquiLanguage || 'tr',
      coquiSelectedVoiceId: settings.coquiSelectedVoiceId || '',
      // Dil konuşma hızları
      languageSpeeds: settings.languageSpeeds || [],
      // Varsayılan ayarlar
      defaultOpenaiModel: settings.defaultOpenaiModel,
      defaultClaudeModel: settings.defaultClaudeModel || 'claude-sonnet-4-20250514',
      defaultElevenlabsModel: settings.defaultElevenlabsModel,
      defaultVoiceId: settings.defaultVoiceId,
      defaultVoiceName: settings.defaultVoiceName,
      defaultImagefxModel: settings.defaultImagefxModel,
      defaultImagefxAspectRatio: settings.defaultImagefxAspectRatio,
      maxDailyStories: settings.maxDailyStories,
      maxConcurrentProcessing: settings.maxConcurrentProcessing,
      // API key'leri maskele (sadece var/yok bilgisi)
      hasOpenaiApiKey: !!settings.openaiApiKey,
      hasClaudeApiKey: !!settings.claudeApiKey,
      hasElevenlabsApiKey: !!settings.elevenlabsApiKey,
      hasImagefxCookie: !!settings.imagefxCookie,
      // Maskelenmiş değerler (son 4 karakter)
      openaiApiKeyMasked: settings.openaiApiKey 
        ? `sk-...${settings.openaiApiKey.slice(-4)}` 
        : null,
      claudeApiKeyMasked: settings.claudeApiKey 
        ? `sk-ant-...${settings.claudeApiKey.slice(-4)}` 
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
    const session = await auth();
    if (!session || !session.user?.id) {
      return NextResponse.json(
        { success: false, error: 'Yetkisiz erişim' },
        { status: 401 }
      );
    }

    const body = await request.json();
    
    await dbConnect();

    // Kullanıcının ayarlarını getir veya oluştur
    let settings = await Settings.findOne({ userId: session.user.id });
    if (!settings) {
      settings = new Settings({ userId: session.user.id });
    }

    // Güncellenecek alanlar
    const updateFields: Record<string, any> = {};

    // LLM Sağlayıcı
    if (body.llmProvider !== undefined) {
      if (['openai', 'claude'].includes(body.llmProvider)) {
        updateFields.llmProvider = body.llmProvider;
      }
    }

    // TTS Sağlayıcı
    if (body.ttsProvider !== undefined) {
      if (['elevenlabs', 'coqui'].includes(body.ttsProvider)) {
        updateFields.ttsProvider = body.ttsProvider;
      }
    }

    // Coqui TTS Ayarları
    if (body.coquiTunnelUrl !== undefined) {
      updateFields.coquiTunnelUrl = body.coquiTunnelUrl || undefined;
    }
    if (body.coquiLanguage !== undefined) {
      updateFields.coquiLanguage = body.coquiLanguage;
    }
    if (body.coquiSelectedVoiceId !== undefined) {
      updateFields.coquiSelectedVoiceId = body.coquiSelectedVoiceId || undefined;
    }
    
    // Dil konuşma hızları
    if (body.languageSpeeds !== undefined) {
      updateFields.languageSpeeds = body.languageSpeeds;
    }

    // API Keys (boş string gönderilirse silme)
    if (body.openaiApiKey !== undefined) {
      updateFields.openaiApiKey = body.openaiApiKey || undefined;
    }
    if (body.claudeApiKey !== undefined) {
      updateFields.claudeApiKey = body.claudeApiKey || undefined;
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
    if (body.defaultClaudeModel) {
      updateFields.defaultClaudeModel = body.defaultClaudeModel;
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
      userId: session.user.id,
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
