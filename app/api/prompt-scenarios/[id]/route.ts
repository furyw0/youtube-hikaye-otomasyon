/**
 * API Endpoint: Prompt Senaryo İşlemleri
 * GET /api/prompt-scenarios/[id] - Tek senaryo getir
 * PUT /api/prompt-scenarios/[id] - Senaryo güncelle
 * DELETE /api/prompt-scenarios/[id] - Senaryo sil
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import dbConnect from '@/lib/mongodb';
import PromptScenario from '@/models/PromptScenario';
import { auth } from '@/auth';
import logger from '@/lib/logger';

// Validation schema
const updateScenarioSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  // Çeviri
  translationSystemPrompt: z.string().min(1).max(15000).optional(),
  translationUserPrompt: z.string().min(1).max(2000).optional(),
  titleTranslationSystemPrompt: z.string().min(1).max(5000).optional(),
  titleTranslationUserPrompt: z.string().min(1).max(1000).optional(),
  // Adaptasyon
  adaptationSystemPrompt: z.string().min(1).max(15000).optional(),
  adaptationUserPrompt: z.string().min(1).max(2000).optional(),
  titleAdaptationSystemPrompt: z.string().min(1).max(5000).optional(),
  titleAdaptationUserPrompt: z.string().min(1).max(1000).optional(),
  // Sahne
  sceneFirstThreeSystemPrompt: z.string().min(1).max(15000).optional(),
  sceneFirstThreeUserPrompt: z.string().min(1).max(2000).optional(),
  sceneRemainingSystemPrompt: z.string().min(1).max(15000).optional(),
  sceneRemainingUserPrompt: z.string().min(1).max(2000).optional(),
  // Görsel
  visualPromptSystemPrompt: z.string().min(1).max(10000).optional(),
  visualPromptUserPrompt: z.string().min(1).max(3000).optional(),
  // YouTube
  youtubeDescriptionSystemPrompt: z.string().min(1).max(10000).optional(),
  youtubeDescriptionUserPrompt: z.string().min(1).max(2000).optional(),
  // Kapak
  coverTextSystemPrompt: z.string().min(1).max(10000).optional(),
  coverTextUserPrompt: z.string().min(1).max(2000).optional()
});

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET - Tek bir senaryo getir
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

    const scenario = await PromptScenario.findOne({ _id: id, userId });
    
    if (!scenario) {
      return NextResponse.json({
        success: false,
        error: 'Senaryo bulunamadı'
      }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      scenario: {
        _id: scenario._id.toString(),
        name: scenario.name,
        description: scenario.description,
        isDefault: scenario.isDefault,
        // Çeviri
        translationSystemPrompt: scenario.translationSystemPrompt,
        translationUserPrompt: scenario.translationUserPrompt,
        titleTranslationSystemPrompt: scenario.titleTranslationSystemPrompt,
        titleTranslationUserPrompt: scenario.titleTranslationUserPrompt,
        // Adaptasyon
        adaptationSystemPrompt: scenario.adaptationSystemPrompt,
        adaptationUserPrompt: scenario.adaptationUserPrompt,
        titleAdaptationSystemPrompt: scenario.titleAdaptationSystemPrompt,
        titleAdaptationUserPrompt: scenario.titleAdaptationUserPrompt,
        // Sahne
        sceneFirstThreeSystemPrompt: scenario.sceneFirstThreeSystemPrompt,
        sceneFirstThreeUserPrompt: scenario.sceneFirstThreeUserPrompt,
        sceneRemainingSystemPrompt: scenario.sceneRemainingSystemPrompt,
        sceneRemainingUserPrompt: scenario.sceneRemainingUserPrompt,
        // Görsel
        visualPromptSystemPrompt: scenario.visualPromptSystemPrompt,
        visualPromptUserPrompt: scenario.visualPromptUserPrompt,
        // YouTube
        youtubeDescriptionSystemPrompt: scenario.youtubeDescriptionSystemPrompt,
        youtubeDescriptionUserPrompt: scenario.youtubeDescriptionUserPrompt,
        // Kapak
        coverTextSystemPrompt: scenario.coverTextSystemPrompt,
        coverTextUserPrompt: scenario.coverTextUserPrompt,
        createdAt: scenario.createdAt,
        updatedAt: scenario.updatedAt
      }
    });

  } catch (error) {
    logger.error('Prompt senaryosu getirme hatası', {
      error: error instanceof Error ? error.message : 'Bilinmeyen hata'
    });

    return NextResponse.json({
      success: false,
      error: 'Senaryo yüklenemedi'
    }, { status: 500 });
  }
}

/**
 * PUT - Senaryo güncelle
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
    const validated = updateScenarioSchema.parse(body);

    await dbConnect();

    // Senaryo var mı ve kullanıcıya ait mi kontrol et
    const existingScenario = await PromptScenario.findOne({ _id: id, userId });
    
    if (!existingScenario) {
      return NextResponse.json({
        success: false,
        error: 'Senaryo bulunamadı'
      }, { status: 404 });
    }

    // İsim değişiyorsa, aynı isimde başka senaryo var mı kontrol et
    if (validated.name && validated.name !== existingScenario.name) {
      const duplicateName = await PromptScenario.findOne({ 
        userId, 
        name: validated.name,
        _id: { $ne: id }
      });
      
      if (duplicateName) {
        return NextResponse.json({
          success: false,
          error: 'Bu isimde bir senaryo zaten mevcut'
        }, { status: 400 });
      }
    }

    // Güncelle
    const updatedScenario = await PromptScenario.findByIdAndUpdate(
      id,
      { $set: validated },
      { new: true }
    );

    logger.info('Prompt senaryosu güncellendi', {
      userId,
      scenarioId: id,
      name: updatedScenario?.name
    });

    return NextResponse.json({
      success: true,
      scenario: {
        _id: updatedScenario!._id.toString(),
        name: updatedScenario!.name,
        description: updatedScenario!.description,
        isDefault: updatedScenario!.isDefault,
        translationSystemPrompt: updatedScenario!.translationSystemPrompt,
        translationUserPrompt: updatedScenario!.translationUserPrompt,
        titleTranslationSystemPrompt: updatedScenario!.titleTranslationSystemPrompt,
        titleTranslationUserPrompt: updatedScenario!.titleTranslationUserPrompt,
        adaptationSystemPrompt: updatedScenario!.adaptationSystemPrompt,
        adaptationUserPrompt: updatedScenario!.adaptationUserPrompt,
        titleAdaptationSystemPrompt: updatedScenario!.titleAdaptationSystemPrompt,
        titleAdaptationUserPrompt: updatedScenario!.titleAdaptationUserPrompt,
        sceneFirstThreeSystemPrompt: updatedScenario!.sceneFirstThreeSystemPrompt,
        sceneFirstThreeUserPrompt: updatedScenario!.sceneFirstThreeUserPrompt,
        sceneRemainingSystemPrompt: updatedScenario!.sceneRemainingSystemPrompt,
        sceneRemainingUserPrompt: updatedScenario!.sceneRemainingUserPrompt,
        visualPromptSystemPrompt: updatedScenario!.visualPromptSystemPrompt,
        visualPromptUserPrompt: updatedScenario!.visualPromptUserPrompt,
        youtubeDescriptionSystemPrompt: updatedScenario!.youtubeDescriptionSystemPrompt,
        youtubeDescriptionUserPrompt: updatedScenario!.youtubeDescriptionUserPrompt,
        coverTextSystemPrompt: updatedScenario!.coverTextSystemPrompt,
        coverTextUserPrompt: updatedScenario!.coverTextUserPrompt,
        createdAt: updatedScenario!.createdAt,
        updatedAt: updatedScenario!.updatedAt
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

    logger.error('Prompt senaryosu güncelleme hatası', {
      error: error instanceof Error ? error.message : 'Bilinmeyen hata'
    });

    return NextResponse.json({
      success: false,
      error: 'Senaryo güncellenemedi'
    }, { status: 500 });
  }
}

/**
 * DELETE - Senaryo sil
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

    // Senaryo var mı ve kullanıcıya ait mi kontrol et
    const scenario = await PromptScenario.findOne({ _id: id, userId });
    
    if (!scenario) {
      return NextResponse.json({
        success: false,
        error: 'Senaryo bulunamadı'
      }, { status: 404 });
    }

    // Varsayılan senaryolar silinemez
    if (scenario.isDefault) {
      return NextResponse.json({
        success: false,
        error: 'Varsayılan senaryolar silinemez'
      }, { status: 400 });
    }

    // Sil
    await PromptScenario.findByIdAndDelete(id);

    logger.info('Prompt senaryosu silindi', {
      userId,
      scenarioId: id,
      name: scenario.name
    });

    return NextResponse.json({
      success: true,
      message: 'Senaryo başarıyla silindi'
    });

  } catch (error) {
    logger.error('Prompt senaryosu silme hatası', {
      error: error instanceof Error ? error.message : 'Bilinmeyen hata'
    });

    return NextResponse.json({
      success: false,
      error: 'Senaryo silinemedi'
    }, { status: 500 });
  }
}
