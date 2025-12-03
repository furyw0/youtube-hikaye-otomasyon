/**
 * Coqui TTS Tek Ses API
 * DELETE /api/coqui/voices/[id] - Ses sil
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { deleteCoquiVoice } from '@/services/coqui.service';
import logger from '@/lib/logger';

// DELETE - Ses sil
export async function DELETE(
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

    logger.info('Coqui TTS ses silme isteği', { 
      userId: session.user.id,
      voiceId,
      tunnelUrl 
    });

    await deleteCoquiVoice(tunnelUrl, voiceId);

    return NextResponse.json({
      success: true,
      message: 'Referans ses silindi'
    });

  } catch (error) {
    logger.error('Coqui TTS ses silme hatası', {
      error: error instanceof Error ? error.message : 'Bilinmeyen hata'
    });

    return NextResponse.json(
      { success: false, error: 'Ses silinemedi' },
      { status: 500 }
    );
  }
}
