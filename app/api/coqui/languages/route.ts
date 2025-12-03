/**
 * Coqui TTS Desteklenen Diller API
 * GET /api/coqui/languages
 */

import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { getCoquiLanguages } from '@/services/coqui.service';

export async function GET() {
  try {
    const session = await auth();
    if (!session || !session.user?.id) {
      return NextResponse.json(
        { success: false, error: 'Yetkisiz erişim' },
        { status: 401 }
      );
    }

    const languages = getCoquiLanguages();

    return NextResponse.json({
      success: true,
      languages
    });

  } catch (error) {
    return NextResponse.json(
      { success: false, error: 'Dil listesi alınamadı' },
      { status: 500 }
    );
  }
}
