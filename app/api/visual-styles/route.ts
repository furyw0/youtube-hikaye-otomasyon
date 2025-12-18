/**
 * API Endpoint: Görsel Stiller
 * GET /api/visual-styles - Kullanıcının stillerini listele
 * POST /api/visual-styles - Yeni stil oluştur
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import dbConnect from '@/lib/mongodb';
import VisualStyle, { DEFAULT_VISUAL_STYLES } from '@/models/VisualStyle';
import { auth } from '@/auth';
import logger from '@/lib/logger';

// Validation schema
const createStyleSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  systemPrompt: z.string().min(1).max(1000),
  technicalPrefix: z.string().min(1).max(1000),
  styleSuffix: z.string().min(1).max(500)
});

/**
 * GET - Kullanıcının tüm görsel stillerini getir
 * Eğer hiç stil yoksa varsayılanları oluştur
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

    // Kullanıcının stillerini getir
    let styles = await VisualStyle.find({ userId }).sort({ isDefault: -1, name: 1 });

    // Eğer hiç stil yoksa varsayılanları oluştur
    if (styles.length === 0) {
      logger.info('Kullanıcı için varsayılan stiller oluşturuluyor', { userId });
      
      const defaultStyles = DEFAULT_VISUAL_STYLES.map(style => ({
        ...style,
        userId
      }));

      await VisualStyle.insertMany(defaultStyles);
      styles = await VisualStyle.find({ userId }).sort({ isDefault: -1, name: 1 });
      
      logger.info('Varsayılan stiller oluşturuldu', { userId, count: styles.length });
    }

    return NextResponse.json({
      success: true,
      styles: styles.map(s => ({
        _id: s._id.toString(),
        name: s.name,
        description: s.description,
        isDefault: s.isDefault,
        systemPrompt: s.systemPrompt,
        technicalPrefix: s.technicalPrefix,
        styleSuffix: s.styleSuffix,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt
      }))
    });

  } catch (error) {
    logger.error('Görsel stiller getirme hatası', {
      error: error instanceof Error ? error.message : 'Bilinmeyen hata'
    });

    return NextResponse.json({
      success: false,
      error: 'Stiller yüklenemedi'
    }, { status: 500 });
  }
}

/**
 * POST - Yeni görsel stil oluştur
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
    const validated = createStyleSchema.parse(body);

    await dbConnect();

    // Aynı isimde stil var mı kontrol et
    const existingStyle = await VisualStyle.findOne({ userId, name: validated.name });
    if (existingStyle) {
      return NextResponse.json({
        success: false,
        error: 'Bu isimde bir stil zaten mevcut'
      }, { status: 400 });
    }

    // Yeni stil oluştur
    const style = await VisualStyle.create({
      userId,
      name: validated.name,
      description: validated.description,
      isDefault: false,
      systemPrompt: validated.systemPrompt,
      technicalPrefix: validated.technicalPrefix,
      styleSuffix: validated.styleSuffix
    });

    logger.info('Yeni görsel stil oluşturuldu', {
      userId,
      styleId: style._id,
      name: style.name
    });

    return NextResponse.json({
      success: true,
      style: {
        _id: style._id.toString(),
        name: style.name,
        description: style.description,
        isDefault: style.isDefault,
        systemPrompt: style.systemPrompt,
        technicalPrefix: style.technicalPrefix,
        styleSuffix: style.styleSuffix,
        createdAt: style.createdAt,
        updatedAt: style.updatedAt
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

    logger.error('Görsel stil oluşturma hatası', {
      error: error instanceof Error ? error.message : 'Bilinmeyen hata'
    });

    return NextResponse.json({
      success: false,
      error: 'Stil oluşturulamadı'
    }, { status: 500 });
  }
}
