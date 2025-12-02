/**
 * API Endpoint: OpenAI Modelleri Listele
 * GET /api/openai/models
 */

import { NextResponse } from 'next/server';
import { OPENAI_MODELS } from '@/lib/constants';
import logger from '@/lib/logger';

export async function GET() {
  try {
    logger.debug('OpenAI modelleri istendi');

    return NextResponse.json({
      success: true,
      models: OPENAI_MODELS
    });

  } catch (error) {
    logger.error('OpenAI modelleri getirme hatası', {
      error: error instanceof Error ? error.message : 'Bilinmeyen hata'
    });

    return NextResponse.json({
      success: false,
      error: 'Sunucu hatası'
    }, { status: 500 });
  }
}

