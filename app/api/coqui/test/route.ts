/**
 * Coqui TTS Bağlantı Testi API
 * POST /api/coqui/test
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { testCoquiConnection } from '@/services/coqui.service';
import logger from '@/lib/logger';
import { z } from 'zod';

const testSchema = z.object({
  tunnelUrl: z.string().min(1, 'Tunnel URL gerekli')
});

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session || !session.user?.id) {
      return NextResponse.json(
        { success: false, error: 'Yetkisiz erişim' },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { tunnelUrl } = testSchema.parse(body);

    logger.info('Coqui TTS bağlantı testi isteği', { 
      userId: session.user.id,
      tunnelUrl 
    });

    const result = await testCoquiConnection(tunnelUrl);

    if (!result.ok) {
      return NextResponse.json({
        success: false,
        error: 'Coqui TTS sunucusuna bağlanılamadı. Lütfen EXE uygulamasının çalıştığından ve Tunnel URL\'in doğru olduğundan emin olun.',
        details: result
      });
    }

    return NextResponse.json({
      success: true,
      message: 'Bağlantı başarılı',
      gpu: result.gpu,
      modelLoaded: result.modelLoaded,
      version: result.version
    });

  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: error.errors[0].message },
        { status: 400 }
      );
    }

    logger.error('Coqui TTS bağlantı testi hatası', {
      error: error instanceof Error ? error.message : 'Bilinmeyen hata'
    });

    return NextResponse.json(
      { success: false, error: 'Bağlantı testi başarısız' },
      { status: 500 }
    );
  }
}
