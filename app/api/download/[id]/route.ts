/**
 * API Endpoint: Hikaye ZIP İndir
 * GET /api/download/[id]
 */

import { NextRequest, NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import Story from '@/models/Story';
import logger from '@/lib/logger';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: storyId } = await params;

    logger.info('ZIP indirme isteği', { storyId });

    await dbConnect();

    // Story kontrol
    const story = await Story.findById(storyId).populate('scenes');

    if (!story) {
      logger.warn('Hikaye bulunamadı', { storyId });
      
      return NextResponse.json({
        success: false,
        error: 'Hikaye bulunamadı'
      }, { status: 404 });
    }

    // Tamamlanmış mı kontrol
    if (story.status !== 'completed') {
      logger.warn('Hikaye henüz tamamlanmamış', {
        storyId,
        status: story.status
      });
      
      return NextResponse.json({
        success: false,
        error: 'Hikaye henüz tamamlanmadı',
        status: story.status,
        progress: story.progress
      }, { status: 400 });
    }

    // ZIP URL kontrolü
    if (!story.blobUrls?.zipFile) {
      logger.warn('ZIP dosyası bulunamadı', { storyId });
      
      return NextResponse.json({
        success: false,
        error: 'ZIP dosyası bulunamadı'
      }, { status: 404 });
    }

    // ZIP dosyasını Blob'dan indir
    const zipUrl = story.blobUrls.zipFile;
    
    logger.info('ZIP indiriliyor', {
      storyId,
      zipUrl
    });

    const response = await fetch(zipUrl);
    
    if (!response.ok) {
      throw new Error(`ZIP indirme hatası: ${response.statusText}`);
    }

    const zipBuffer = await response.arrayBuffer();

    // ZIP dosyasını döndür
    const filename = `${story.adaptedTitle?.replace(/[^a-z0-9]/gi, '-') || 'story'}.zip`;

    logger.info('ZIP indirme tamamlandı', {
      storyId,
      filename,
      size: zipBuffer.byteLength
    });

    return new NextResponse(zipBuffer, {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': zipBuffer.byteLength.toString()
      }
    });

  } catch (error) {
    logger.error('ZIP indirme hatası', {
      storyId: params.id,
      error: error instanceof Error ? error.message : 'Bilinmeyen hata'
    });

    return NextResponse.json({
      success: false,
      error: 'ZIP indirilemedi',
      message: error instanceof Error ? error.message : 'Bilinmeyen hata'
    }, { status: 500 });
  }
}

