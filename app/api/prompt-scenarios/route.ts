/**
 * API Endpoint: Prompt Senaryoları
 * GET /api/prompt-scenarios - Kullanıcının senaryolarını listele
 * POST /api/prompt-scenarios - Yeni senaryo oluştur
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import dbConnect from '@/lib/mongodb';
import PromptScenario, { DEFAULT_PROMPT_SCENARIOS } from '@/models/PromptScenario';
import { auth } from '@/auth';
import logger from '@/lib/logger';

// Validation schema
const createScenarioSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  // Çeviri (İçerik)
  translationSystemPrompt: z.string().min(1).max(15000),
  translationUserPrompt: z.string().min(1).max(2000),
  // Çeviri (Başlık)
  titleTranslationSystemPrompt: z.string().min(1).max(5000),
  titleTranslationUserPrompt: z.string().min(1).max(1000),
  // Adaptasyon (İçerik)
  adaptationSystemPrompt: z.string().min(1).max(15000),
  adaptationUserPrompt: z.string().min(1).max(2000),
  // Adaptasyon (Başlık)
  titleAdaptationSystemPrompt: z.string().min(1).max(5000),
  titleAdaptationUserPrompt: z.string().min(1).max(1000),
  // Sahne (İlk 3 Dakika)
  sceneFirstThreeSystemPrompt: z.string().min(1).max(15000),
  sceneFirstThreeUserPrompt: z.string().min(1).max(2000),
  // Sahne (Kalan)
  sceneRemainingSystemPrompt: z.string().min(1).max(15000),
  sceneRemainingUserPrompt: z.string().min(1).max(2000),
  // Görsel Prompt
  visualPromptSystemPrompt: z.string().min(1).max(10000),
  visualPromptUserPrompt: z.string().min(1).max(3000),
  // YouTube Açıklaması
  youtubeDescriptionSystemPrompt: z.string().min(1).max(10000),
  youtubeDescriptionUserPrompt: z.string().min(1).max(2000),
  // Kapak Yazısı
  coverTextSystemPrompt: z.string().min(1).max(10000),
  coverTextUserPrompt: z.string().min(1).max(2000)
});

/**
 * GET - Kullanıcının tüm prompt senaryolarını getir
 * Eğer hiç senaryo yoksa varsayılanları oluştur
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

    // Kullanıcının senaryolarını getir
    let scenarios = await PromptScenario.find({ userId }).sort({ isDefault: -1, name: 1 });

    // Eğer hiç senaryo yoksa varsayılanları oluştur
    if (scenarios.length === 0) {
      logger.info('Kullanıcı için varsayılan prompt senaryoları oluşturuluyor', { userId });
      
      const defaultScenarios = DEFAULT_PROMPT_SCENARIOS.map(scenario => ({
        ...scenario,
        userId
      }));

      await PromptScenario.insertMany(defaultScenarios);
      scenarios = await PromptScenario.find({ userId }).sort({ isDefault: -1, name: 1 });
      
      logger.info('Varsayılan prompt senaryoları oluşturuldu', { userId, count: scenarios.length });
    }

    return NextResponse.json({
      success: true,
      scenarios: scenarios.map(s => ({
        _id: s._id.toString(),
        name: s.name,
        description: s.description,
        isDefault: s.isDefault,
        // Çeviri
        translationSystemPrompt: s.translationSystemPrompt,
        translationUserPrompt: s.translationUserPrompt,
        titleTranslationSystemPrompt: s.titleTranslationSystemPrompt,
        titleTranslationUserPrompt: s.titleTranslationUserPrompt,
        // Adaptasyon
        adaptationSystemPrompt: s.adaptationSystemPrompt,
        adaptationUserPrompt: s.adaptationUserPrompt,
        titleAdaptationSystemPrompt: s.titleAdaptationSystemPrompt,
        titleAdaptationUserPrompt: s.titleAdaptationUserPrompt,
        // Sahne
        sceneFirstThreeSystemPrompt: s.sceneFirstThreeSystemPrompt,
        sceneFirstThreeUserPrompt: s.sceneFirstThreeUserPrompt,
        sceneRemainingSystemPrompt: s.sceneRemainingSystemPrompt,
        sceneRemainingUserPrompt: s.sceneRemainingUserPrompt,
        // Görsel
        visualPromptSystemPrompt: s.visualPromptSystemPrompt,
        visualPromptUserPrompt: s.visualPromptUserPrompt,
        // YouTube
        youtubeDescriptionSystemPrompt: s.youtubeDescriptionSystemPrompt,
        youtubeDescriptionUserPrompt: s.youtubeDescriptionUserPrompt,
        // Kapak
        coverTextSystemPrompt: s.coverTextSystemPrompt,
        coverTextUserPrompt: s.coverTextUserPrompt,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt
      }))
    });

  } catch (error) {
    logger.error('Prompt senaryoları getirme hatası', {
      error: error instanceof Error ? error.message : 'Bilinmeyen hata'
    });

    return NextResponse.json({
      success: false,
      error: 'Senaryolar yüklenemedi'
    }, { status: 500 });
  }
}

/**
 * POST - Yeni prompt senaryosu oluştur
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
    const validated = createScenarioSchema.parse(body);

    await dbConnect();

    // Aynı isimde senaryo var mı kontrol et
    const existingScenario = await PromptScenario.findOne({ userId, name: validated.name });
    if (existingScenario) {
      return NextResponse.json({
        success: false,
        error: 'Bu isimde bir senaryo zaten mevcut'
      }, { status: 400 });
    }

    // Yeni senaryo oluştur
    const scenario = await PromptScenario.create({
      userId,
      name: validated.name,
      description: validated.description,
      isDefault: false,
      // Çeviri
      translationSystemPrompt: validated.translationSystemPrompt,
      translationUserPrompt: validated.translationUserPrompt,
      titleTranslationSystemPrompt: validated.titleTranslationSystemPrompt,
      titleTranslationUserPrompt: validated.titleTranslationUserPrompt,
      // Adaptasyon
      adaptationSystemPrompt: validated.adaptationSystemPrompt,
      adaptationUserPrompt: validated.adaptationUserPrompt,
      titleAdaptationSystemPrompt: validated.titleAdaptationSystemPrompt,
      titleAdaptationUserPrompt: validated.titleAdaptationUserPrompt,
      // Sahne
      sceneFirstThreeSystemPrompt: validated.sceneFirstThreeSystemPrompt,
      sceneFirstThreeUserPrompt: validated.sceneFirstThreeUserPrompt,
      sceneRemainingSystemPrompt: validated.sceneRemainingSystemPrompt,
      sceneRemainingUserPrompt: validated.sceneRemainingUserPrompt,
      // Görsel
      visualPromptSystemPrompt: validated.visualPromptSystemPrompt,
      visualPromptUserPrompt: validated.visualPromptUserPrompt,
      // YouTube
      youtubeDescriptionSystemPrompt: validated.youtubeDescriptionSystemPrompt,
      youtubeDescriptionUserPrompt: validated.youtubeDescriptionUserPrompt,
      // Kapak
      coverTextSystemPrompt: validated.coverTextSystemPrompt,
      coverTextUserPrompt: validated.coverTextUserPrompt
    });

    logger.info('Yeni prompt senaryosu oluşturuldu', {
      userId,
      scenarioId: scenario._id,
      name: scenario.name
    });

    return NextResponse.json({
      success: true,
      scenario: {
        _id: scenario._id.toString(),
        name: scenario.name,
        description: scenario.description,
        isDefault: scenario.isDefault,
        translationSystemPrompt: scenario.translationSystemPrompt,
        translationUserPrompt: scenario.translationUserPrompt,
        titleTranslationSystemPrompt: scenario.titleTranslationSystemPrompt,
        titleTranslationUserPrompt: scenario.titleTranslationUserPrompt,
        adaptationSystemPrompt: scenario.adaptationSystemPrompt,
        adaptationUserPrompt: scenario.adaptationUserPrompt,
        titleAdaptationSystemPrompt: scenario.titleAdaptationSystemPrompt,
        titleAdaptationUserPrompt: scenario.titleAdaptationUserPrompt,
        sceneFirstThreeSystemPrompt: scenario.sceneFirstThreeSystemPrompt,
        sceneFirstThreeUserPrompt: scenario.sceneFirstThreeUserPrompt,
        sceneRemainingSystemPrompt: scenario.sceneRemainingSystemPrompt,
        sceneRemainingUserPrompt: scenario.sceneRemainingUserPrompt,
        visualPromptSystemPrompt: scenario.visualPromptSystemPrompt,
        visualPromptUserPrompt: scenario.visualPromptUserPrompt,
        youtubeDescriptionSystemPrompt: scenario.youtubeDescriptionSystemPrompt,
        youtubeDescriptionUserPrompt: scenario.youtubeDescriptionUserPrompt,
        coverTextSystemPrompt: scenario.coverTextSystemPrompt,
        coverTextUserPrompt: scenario.coverTextUserPrompt,
        createdAt: scenario.createdAt,
        updatedAt: scenario.updatedAt
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

    logger.error('Prompt senaryosu oluşturma hatası', {
      error: error instanceof Error ? error.message : 'Bilinmeyen hata'
    });

    return NextResponse.json({
      success: false,
      error: 'Senaryo oluşturulamadı'
    }, { status: 500 });
  }
}
