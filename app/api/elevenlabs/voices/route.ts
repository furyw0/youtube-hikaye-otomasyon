/**
 * API Endpoint: ElevenLabs Sesleri Listele
 * GET /api/elevenlabs/voices
 */

import { NextResponse } from 'next/server';
import logger from '@/lib/logger';
import { listVoices } from '@/services/elevenlabs.service';

export async function GET() {
  try {
    logger.debug('ElevenLabs sesleri istendi');

    const voices = await listVoices();

    return NextResponse.json({
      success: true,
      voices
    });

  } catch (error) {
    logger.error('ElevenLabs sesleri getirme hatası', {
      error: error instanceof Error ? error.message : 'Bilinmeyen hata'
    });

    return NextResponse.json({
      success: false,
      error: 'Sesler yüklenemedi',
      message: error instanceof Error ? error.message : 'Bilinmeyen hata'
    }, { status: 500 });
  }
}

