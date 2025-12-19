/**
 * Coqui TTS Önizleme API
 * Konuşma hızı testi için kısa ses üretir
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import dbConnect from '@/lib/mongodb';
import Settings from '@/models/Settings';
import logger from '@/lib/logger';

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Yetkisiz erişim' }, { status: 401 });
    }

    const body = await request.json();
    const { text, language, speed } = body;

    if (!text || !language) {
      return NextResponse.json(
        { error: 'text ve language gerekli' },
        { status: 400 }
      );
    }

    await dbConnect();
    const settings = await Settings.findOne({ userId: session.user.id });

    if (!settings?.coquiTunnelUrl) {
      return NextResponse.json(
        { error: 'Coqui TTS URL ayarlanmamış' },
        { status: 400 }
      );
    }

    if (!settings?.coquiSelectedVoiceId) {
      return NextResponse.json(
        { error: 'Coqui TTS sesi seçilmemiş' },
        { status: 400 }
      );
    }

    // Coqui TTS'e istek gönder
    const tunnelUrl = settings.coquiTunnelUrl.replace(/\/$/, '');
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000);

    const response = await fetch(`${tunnelUrl}/api/tts`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'audio/wav'
      },
      body: JSON.stringify({
        text,
        language,
        voice_id: settings.coquiSelectedVoiceId,
        speed: speed || 1.0
      })
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('Coqui önizleme hatası', { error: errorText });
      return NextResponse.json(
        { error: 'Ses üretilemedi: ' + errorText },
        { status: 500 }
      );
    }

    const audioBuffer = await response.arrayBuffer();

    logger.info('Coqui önizleme oluşturuldu', {
      language,
      speed,
      size: audioBuffer.byteLength
    });

    return new NextResponse(audioBuffer, {
      headers: {
        'Content-Type': 'audio/wav',
        'Content-Length': audioBuffer.byteLength.toString()
      }
    });

  } catch (error) {
    logger.error('Coqui önizleme API hatası', {
      error: error instanceof Error ? error.message : 'Bilinmeyen hata'
    });

    if (error instanceof Error && error.name === 'AbortError') {
      return NextResponse.json(
        { error: 'Zaman aşımı - Coqui sunucusu yanıt vermedi' },
        { status: 504 }
      );
    }

    return NextResponse.json(
      { error: 'Sunucu hatası' },
      { status: 500 }
    );
  }
}
