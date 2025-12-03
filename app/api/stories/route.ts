/**
 * API Endpoint: Hikaye Listesi
 * GET /api/stories - Kullanıcının hikayelerini listele
 */

import { NextRequest, NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import Story from '@/models/Story';
import logger from '@/lib/logger';
import { auth } from '@/auth';

// GET - Kullanıcının hikayelerini listele
export async function GET(request: NextRequest) {
  try {
    // Auth kontrolü
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({
        success: false,
        error: 'Yetkisiz erişim'
      }, { status: 401 });
    }

    const userId = session.user.id;

    await dbConnect();

    // Query parametreleri
    const searchParams = request.nextUrl.searchParams;
    const status = searchParams.get('status');
    const limit = parseInt(searchParams.get('limit') || '50');
    const skip = parseInt(searchParams.get('skip') || '0');
    const sort = searchParams.get('sort') || 'newest';

    // Filter - sadece kullanıcının hikayeleri
    const filter: Record<string, unknown> = { userId };
    if (status && status !== 'all') {
      filter.status = status;
    }

    // Sort
    const sortOption: Record<string, 1 | -1> = sort === 'oldest' 
      ? { createdAt: 1 } 
      : { createdAt: -1 };

    // Query
    const stories = await Story.find(filter)
      .select('-originalContent -adaptedContent') // Büyük alanları hariç tut
      .sort(sortOption)
      .skip(skip)
      .limit(limit)
      .lean();

    const total = await Story.countDocuments(filter);

    return NextResponse.json({
      success: true,
      stories,
      pagination: {
        total,
        limit,
        skip,
        hasMore: skip + stories.length < total
      }
    });

  } catch (error) {
    logger.error('Hikaye listesi hatası', {
      error: error instanceof Error ? error.message : 'Bilinmeyen hata'
    });

    return NextResponse.json({
      success: false,
      error: 'Hikayeler listelenemedi'
    }, { status: 500 });
  }
}
