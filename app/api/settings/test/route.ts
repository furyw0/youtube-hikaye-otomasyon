/**
 * API Endpoint: API Bağlantı Testleri
 * POST /api/settings/test - OpenAI, ElevenLabs, ImageFX bağlantılarını test et
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import dbConnect from '@/lib/mongodb';
import Settings from '@/models/Settings';
import logger from '@/lib/logger';

// POST - API bağlantısını test et
export async function POST(request: NextRequest) {
  try {
    // Auth kontrolü
    const session = await auth();
    if (!session || !session.user?.id) {
      return NextResponse.json({
        success: false,
        error: 'Yetkisiz erişim'
      }, { status: 401 });
    }

    const userId = session.user.id;
    const { type } = await request.json();
    
    await dbConnect();
    
    // Kullanıcıya ait ayarları bul (userId ile filtrele)
    const settings = await Settings.findOne({ userId }).select('+openaiApiKey +elevenlabsApiKey +imagefxCookie');

    if (!settings) {
      return NextResponse.json({
        success: false,
        error: 'Ayarlar bulunamadı. Lütfen önce API anahtarını kaydedin.'
      }, { status: 404 });
    }

    switch (type) {
      case 'openai':
        return await testOpenAI(settings.openaiApiKey || process.env.OPENAI_API_KEY);
      case 'elevenlabs':
        return await testElevenLabs(settings.elevenlabsApiKey || process.env.ELEVENLABS_API_KEY);
      case 'imagefx':
        return await testImageFX(settings.imagefxCookie || process.env.GOOGLE_COOKIE);
      default:
        return NextResponse.json({
          success: false,
          error: 'Geçersiz test tipi'
        }, { status: 400 });
    }

  } catch (error) {
    logger.error('API test hatası', {
      error: error instanceof Error ? error.message : 'Bilinmeyen hata'
    });

    return NextResponse.json({
      success: false,
      error: 'Test başarısız oldu'
    }, { status: 500 });
  }
}

// OpenAI bağlantı testi
async function testOpenAI(apiKey: string | undefined) {
  if (!apiKey) {
    return NextResponse.json({
      success: false,
      error: 'OpenAI API Key tanımlanmamış'
    }, { status: 400 });
  }

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: 'Say "test successful" in 2 words.' }],
        max_tokens: 10
      })
    });

    if (!response.ok) {
      const errorData = await response.json();
      return NextResponse.json({
        success: false,
        error: `OpenAI hatası: ${errorData.error?.message || response.statusText}`
      }, { status: response.status });
    }

    const data = await response.json();
    
    return NextResponse.json({
      success: true,
      message: 'OpenAI bağlantısı başarılı!',
      details: {
        model: data.model,
        response: data.choices[0]?.message?.content
      }
    });

  } catch (error) {
    return NextResponse.json({
      success: false,
      error: `OpenAI bağlantı hatası: ${error instanceof Error ? error.message : 'Bilinmeyen hata'}`
    }, { status: 500 });
  }
}

// ElevenLabs bağlantı testi
async function testElevenLabs(apiKey: string | undefined) {
  if (!apiKey) {
    return NextResponse.json({
      success: false,
      error: 'ElevenLabs API Key tanımlanmamış'
    }, { status: 400 });
  }

  try {
    const response = await fetch('https://api.elevenlabs.io/v1/voices', {
      headers: {
        'xi-api-key': apiKey
      }
    });

    if (!response.ok) {
      const errorData = await response.json();
      return NextResponse.json({
        success: false,
        error: `ElevenLabs hatası: ${errorData.detail?.message || response.statusText}`
      }, { status: response.status });
    }

    const data = await response.json();
    const voiceCount = data.voices?.length || 0;

    return NextResponse.json({
      success: true,
      message: 'ElevenLabs bağlantısı başarılı!',
      details: {
        voiceCount,
        sampleVoices: data.voices?.slice(0, 3).map((v: { name: string }) => v.name)
      }
    });

  } catch (error) {
    return NextResponse.json({
      success: false,
      error: `ElevenLabs bağlantı hatası: ${error instanceof Error ? error.message : 'Bilinmeyen hata'}`
    }, { status: 500 });
  }
}

// ImageFX bağlantı testi
// Ref: https://github.com/rohitaryal/imageFX-api
async function testImageFX(cookie: string | undefined) {
  if (!cookie) {
    return NextResponse.json({
      success: false,
      error: 'ImageFX Google Cookie tanımlanmamış'
    }, { status: 400 });
  }

  try {
    // ImageFX API'yi yükle
    const { ImageFX, Prompt } = await import('@rohitaryal/imagefx-api');
    
    const client = new ImageFX(cookie);
    
    // Prompt objesi oluştur - dokümantasyona göre
    const testPrompt = new Prompt({
      prompt: 'A simple red circle on white background',
      aspectRatio: 'IMAGE_ASPECT_RATIO_SQUARE',
      generationModel: 'IMAGEN_3_5',
      numberOfImages: 1,
      seed: 0
    });
    
    // generateImage metodu - Image[] döner
    const images = await client.generateImage(testPrompt, 1);

    if (images && images.length > 0) {
      // Image nesnesinin seed ve mediaId özellikleri var
      const firstImage = images[0];
      
      return NextResponse.json({
        success: true,
        message: 'ImageFX bağlantısı başarılı!',
        details: {
          generatedImages: images.length,
          seed: firstImage.seed,
          mediaId: firstImage.mediaId,
          note: 'Test görseli başarıyla üretildi'
        }
      });
    } else {
      return NextResponse.json({
        success: false,
        error: 'ImageFX görsel üretemedi'
      }, { status: 500 });
    }

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Bilinmeyen hata';
    
    // Cookie geçersizse veya süresi dolmuşsa
    if (errorMessage.toLowerCase().includes('cookie') || 
        errorMessage.toLowerCase().includes('auth') || 
        errorMessage.includes('401') || 
        errorMessage.toLowerCase().includes('session') ||
        errorMessage.toLowerCase().includes('unauthorized')) {
      return NextResponse.json({
        success: false,
        error: 'ImageFX cookie geçersiz veya süresi dolmuş. Lütfen yeni cookie alın.'
      }, { status: 401 });
    }

    return NextResponse.json({
      success: false,
      error: `ImageFX bağlantı hatası: ${errorMessage}`
    }, { status: 500 });
  }
}

