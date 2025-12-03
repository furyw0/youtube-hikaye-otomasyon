/**
 * Coqui TTS Sesler API
 * GET /api/coqui/voices - Ses listesi
 * POST /api/coqui/voices - Yeni ses yükle
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { getCoquiVoices, uploadCoquiVoice } from '@/services/coqui.service';
import logger from '@/lib/logger';

// GET - Ses listesi al
export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session || !session.user?.id) {
      return NextResponse.json(
        { success: false, error: 'Yetkisiz erişim' },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(request.url);
    const tunnelUrl = searchParams.get('tunnelUrl');

    if (!tunnelUrl) {
      return NextResponse.json(
        { success: false, error: 'Tunnel URL gerekli' },
        { status: 400 }
      );
    }

    logger.debug('Coqui TTS ses listesi isteği', { 
      userId: session.user.id,
      tunnelUrl 
    });

    const voices = await getCoquiVoices(tunnelUrl);

    return NextResponse.json({
      success: true,
      voices
    });

  } catch (error) {
    logger.error('Coqui TTS ses listesi hatası', {
      error: error instanceof Error ? error.message : 'Bilinmeyen hata'
    });

    return NextResponse.json(
      { success: false, error: 'Ses listesi alınamadı. Coqui TTS sunucusunun çalıştığından emin olun.' },
      { status: 500 }
    );
  }
}

// POST - Yeni ses yükle
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session || !session.user?.id) {
      return NextResponse.json(
        { success: false, error: 'Yetkisiz erişim' },
        { status: 401 }
      );
    }

    const formData = await request.formData();
    const tunnelUrl = formData.get('tunnelUrl') as string;
    const name = formData.get('name') as string;
    const audioFile = formData.get('audio') as File;

    if (!tunnelUrl || !name || !audioFile) {
      return NextResponse.json(
        { success: false, error: 'Tunnel URL, isim ve ses dosyası gerekli' },
        { status: 400 }
      );
    }

    // Dosya boyutu kontrolü (max 10MB)
    if (audioFile.size > 10 * 1024 * 1024) {
      return NextResponse.json(
        { success: false, error: 'Ses dosyası 10MB\'dan küçük olmalı' },
        { status: 400 }
      );
    }

    // Dosya tipi kontrolü
    const allowedTypes = ['audio/wav', 'audio/wave', 'audio/x-wav', 'audio/mp3', 'audio/mpeg'];
    if (!allowedTypes.includes(audioFile.type)) {
      return NextResponse.json(
        { success: false, error: 'Sadece WAV ve MP3 dosyaları kabul edilir' },
        { status: 400 }
      );
    }

    logger.info('Coqui TTS ses yükleme isteği', { 
      userId: session.user.id,
      name,
      size: audioFile.size,
      type: audioFile.type
    });

    const arrayBuffer = await audioFile.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const voice = await uploadCoquiVoice(tunnelUrl, buffer, name);

    return NextResponse.json({
      success: true,
      voice,
      message: 'Referans ses başarıyla yüklendi'
    });

  } catch (error) {
    logger.error('Coqui TTS ses yükleme hatası', {
      error: error instanceof Error ? error.message : 'Bilinmeyen hata'
    });

    return NextResponse.json(
      { success: false, error: 'Ses yüklenemedi. Coqui TTS sunucusunun çalıştığından emin olun.' },
      { status: 500 }
    );
  }
}
