/**
 * API Endpoint: Hikaye Listesi
 * GET /api/stories - Kullanıcının hikayelerini listele
 */

import { NextRequest, NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import Story from '@/models/Story';
import Channel from '@/models/Channel';
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
    const channelId = searchParams.get('channelId');
    const limit = parseInt(searchParams.get('limit') || '50');
    const skip = parseInt(searchParams.get('skip') || '0');
    const sort = searchParams.get('sort') || 'newest';

    // Filter - sadece kullanıcının hikayeleri
    const filter: Record<string, unknown> = { userId };
    
    // Status filter
    if (status && status !== 'all') {
      filter.status = status;
    }

    // Channel filter
    if (channelId) {
      if (channelId === 'ungrouped') {
        // Gruplanmamış hikayeler
        filter.channelId = { $exists: false };
      } else {
        filter.channelId = channelId;
      }
    }

    // Sort
    const sortOption: Record<string, 1 | -1> = sort === 'oldest' 
      ? { createdAt: 1 } 
      : { createdAt: -1 };

    // Query - Channel bilgisini de getir
    const stories = await Story.find(filter)
      .select('-originalContent -adaptedContent') // Büyük alanları hariç tut
      .populate({
        path: 'channelId',
        select: 'name color icon',
        model: Channel
      })
      .sort(sortOption)
      .skip(skip)
      .limit(limit)
      .lean();

    const total = await Story.countDocuments(filter);

    // Stories'i formatla ve channel bilgisini düzgün şekilde ekle
    interface PopulatedChannel {
      _id: string;
      name: string;
      color: string;
      icon: string;
    }
    
    const formattedStories = stories.map(story => {
      // channelId populated olmuşsa obje olacak, olmamışsa ObjectId
      const populatedChannel = story.channelId && typeof story.channelId === 'object' && 'name' in story.channelId
        ? story.channelId as unknown as PopulatedChannel
        : null;
      
      return {
        ...story,
        channel: populatedChannel ? {
          _id: populatedChannel._id,
          name: populatedChannel.name,
          color: populatedChannel.color,
          icon: populatedChannel.icon
        } : null,
        channelId: populatedChannel ? populatedChannel._id : story.channelId?.toString()
      };
    });

    return NextResponse.json({
      success: true,
      stories: formattedStories,
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
