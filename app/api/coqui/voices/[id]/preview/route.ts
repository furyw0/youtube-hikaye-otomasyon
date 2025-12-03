/**
 * Coqui TTS Ses Önizleme API
 * GET /api/coqui/voices/[id]/preview - Sesin önizleme sesini getir
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { getCoquiVoicePreview } from '@/services/coqui.service';
import logger from '@/lib/logger';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session || !session.user?.id) {
      return NextResponse.json(
        { success: false, error: 'Yetkisiz erişim' },
        { status: 401 }
      );
    }

    const { id: voiceId } = await params;
    const { searchParams } = new URL(request.url);
    const tunnelUrl = searchParams.get('tunnelUrl');

    if (!tunnelUrl) {
      return NextResponse.json(
        { success: false, error: 'Tunnel URL gerekli' },
        { status: 400 }
      );
    }

    if (!voiceId) {
      return NextResponse.json(
        { success: false, error: 'Ses ID gerekli' },
        { status: 400 }
      );
    }

    logger.debug('Coqui TTS ses önizleme isteği', { 
      userId: session.user.id,
      voiceId,
      tunnelUrl 
    });

    const audioBuffer = await getCoquiVoicePreview(tunnelUrl, voiceId);

    // Buffer'ı ArrayBuffer'a, sonra Blob'a çevir (TypeScript uyumluluğu için)
    const arrayBuffer = audioBuffer.buffer.slice(
      audioBuffer.byteOffset,
      audioBuffer.byteOffset + audioBuffer.byteLength
    ) as ArrayBuffer;
    const blob = new Blob([arrayBuffer], { type: 'audio/wav' });

    return new Response(blob, {
      status: 200,
      headers: {
        'Content-Type': 'audio/wav',
        'Content-Length': audioBuffer.length.toString(),
        'Content-Disposition': `inline; filename="${voiceId}_preview.wav"`,
        'Cache-Control': 'public, max-age=3600', // 1 saat cache
      },
    });

  } catch (error) {
    logger.error('Coqui TTS ses önizleme hatası', {
      error: error instanceof Error ? error.message : 'Bilinmeyen hata'
    });

    return NextResponse.json(
      { success: false, error: 'Ses önizlemesi alınamadı. Coqui TTS sunucusunun çalıştığından emin olun.' },
      { status: 500 }
    );
  }
}

