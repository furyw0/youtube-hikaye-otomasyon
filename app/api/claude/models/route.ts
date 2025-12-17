/**
 * API Endpoint: Claude Modelleri Listele
 * GET /api/claude/models
 */

import { NextResponse } from 'next/server';
import { CLAUDE_MODELS } from '@/lib/constants';
import logger from '@/lib/logger';

export async function GET() {
  try {
    logger.debug('Claude modelleri istendi');

    return NextResponse.json({
      success: true,
      models: CLAUDE_MODELS
    });

  } catch (error) {
    logger.error('Claude modelleri getirme hatası', {
      error: error instanceof Error ? error.message : 'Bilinmeyen hata'
    });

    return NextResponse.json({
      success: false,
      error: 'Sunucu hatası'
    }, { status: 500 });
  }
}
