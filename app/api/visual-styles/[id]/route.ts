/**
 * API Endpoint: Görsel Stil İşlemleri
 * GET /api/visual-styles/[id] - Tek stil getir
 * PUT /api/visual-styles/[id] - Stil güncelle
 * DELETE /api/visual-styles/[id] - Stil sil
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import dbConnect from '@/lib/mongodb';
import VisualStyle from '@/models/VisualStyle';
import { auth } from '@/auth';
import logger from '@/lib/logger';

// Validation schema
const updateStyleSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  systemPrompt: z.string().min(1).max(1000).optional(),
  technicalPrefix: z.string().min(1).max(1000).optional(),
  styleSuffix: z.string().min(1).max(500).optional()
});

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET - Tek bir stil getir
 */
export async function GET(
  request: NextRequest,
  { params }: RouteParams
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({
        success: false,
        error: 'Yetkisiz erişim'
      }, { status: 401 });
    }

    const { id } = await params;
    const userId = session.user.id;
    
    await dbConnect();

    const style = await VisualStyle.findOne({ _id: id, userId });
    
    if (!style) {
      return NextResponse.json({
        success: false,
        error: 'Stil bulunamadı'
      }, { status: 404 });
    }

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
    });

  } catch (error) {
    logger.error('Görsel stil getirme hatası', {
      error: error instanceof Error ? error.message : 'Bilinmeyen hata'
    });

    return NextResponse.json({
      success: false,
      error: 'Stil yüklenemedi'
    }, { status: 500 });
  }
}

/**
 * PUT - Stil güncelle
 */
export async function PUT(
  request: NextRequest,
  { params }: RouteParams
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({
        success: false,
        error: 'Yetkisiz erişim'
      }, { status: 401 });
    }

    const { id } = await params;
    const userId = session.user.id;
    const body = await request.json();

    // Validasyon
    const validated = updateStyleSchema.parse(body);

    await dbConnect();

    // Stil var mı ve kullanıcıya ait mi kontrol et
    const existingStyle = await VisualStyle.findOne({ _id: id, userId });
    
    if (!existingStyle) {
      return NextResponse.json({
        success: false,
        error: 'Stil bulunamadı'
      }, { status: 404 });
    }

    // İsim değişiyorsa, aynı isimde başka stil var mı kontrol et
    if (validated.name && validated.name !== existingStyle.name) {
      const duplicateName = await VisualStyle.findOne({ 
        userId, 
        name: validated.name,
        _id: { $ne: id }
      });
      
      if (duplicateName) {
        return NextResponse.json({
          success: false,
          error: 'Bu isimde bir stil zaten mevcut'
        }, { status: 400 });
      }
    }

    // Güncelle
    const updatedStyle = await VisualStyle.findByIdAndUpdate(
      id,
      { $set: validated },
      { new: true }
    );

    logger.info('Görsel stil güncellendi', {
      userId,
      styleId: id,
      name: updatedStyle?.name
    });

    return NextResponse.json({
      success: true,
      style: {
        _id: updatedStyle!._id.toString(),
        name: updatedStyle!.name,
        description: updatedStyle!.description,
        isDefault: updatedStyle!.isDefault,
        systemPrompt: updatedStyle!.systemPrompt,
        technicalPrefix: updatedStyle!.technicalPrefix,
        styleSuffix: updatedStyle!.styleSuffix,
        createdAt: updatedStyle!.createdAt,
        updatedAt: updatedStyle!.updatedAt
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

    logger.error('Görsel stil güncelleme hatası', {
      error: error instanceof Error ? error.message : 'Bilinmeyen hata'
    });

    return NextResponse.json({
      success: false,
      error: 'Stil güncellenemedi'
    }, { status: 500 });
  }
}

/**
 * DELETE - Stil sil
 */
export async function DELETE(
  request: NextRequest,
  { params }: RouteParams
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({
        success: false,
        error: 'Yetkisiz erişim'
      }, { status: 401 });
    }

    const { id } = await params;
    const userId = session.user.id;
    
    await dbConnect();

    // Stil var mı ve kullanıcıya ait mi kontrol et
    const style = await VisualStyle.findOne({ _id: id, userId });
    
    if (!style) {
      return NextResponse.json({
        success: false,
        error: 'Stil bulunamadı'
      }, { status: 404 });
    }

    // Varsayılan stiller silinemez
    if (style.isDefault) {
      return NextResponse.json({
        success: false,
        error: 'Varsayılan stiller silinemez'
      }, { status: 400 });
    }

    // Sil
    await VisualStyle.findByIdAndDelete(id);

    logger.info('Görsel stil silindi', {
      userId,
      styleId: id,
      name: style.name
    });

    return NextResponse.json({
      success: true,
      message: 'Stil başarıyla silindi'
    });

  } catch (error) {
    logger.error('Görsel stil silme hatası', {
      error: error instanceof Error ? error.message : 'Bilinmeyen hata'
    });

    return NextResponse.json({
      success: false,
      error: 'Stil silinemedi'
    }, { status: 500 });
  }
}
