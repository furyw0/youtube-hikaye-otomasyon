/**
 * ZIP Servisi
 * Hikaye içeriğini (sahne metinleri, görseller, sesler) ZIP dosyası olarak paketler
 */

import archiver from 'archiver';
import logger from '@/lib/logger';
import { AppError } from '@/lib/errors';
import type { IStory } from '@/types/story.types';
import type { IScene } from '@/types/scene.types';

interface DownloadedFile {
  filename: string;
  buffer: Buffer;
  type: 'image' | 'audio';
}

/**
 * URL'den dosya indir (arşive eklemeden)
 * Retry mekanizması ve boyut doğrulaması ile
 */
async function downloadFile(url: string, filename: string, type: 'image' | 'audio'): Promise<DownloadedFile | null> {
  const maxRetries = 3;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      logger.debug('Dosya indiriliyor', { url, filename, type, attempt });

      // AbortController ile timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 60000); // 60 saniye timeout

      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          'Accept': type === 'audio' ? 'audio/mpeg, audio/*' : 'image/*',
        }
      });
      
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      // Content-Length kontrolü
      const contentLength = response.headers.get('content-length');
      const expectedSize = contentLength ? parseInt(contentLength) : 0;
      
      // Dosyayı tamamen oku
      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      // Boyut doğrulaması
      if (expectedSize > 0 && buffer.length !== expectedSize) {
        throw new Error(`Boyut uyuşmazlığı: beklenen ${expectedSize}, alınan ${buffer.length}`);
      }

      logger.info('Dosya indirildi', {
        filename,
        type,
        size: buffer.length,
        expectedSize: expectedSize || 'unknown',
        attempt
      });

      // Boyut kontrolü - MP3 için minimum 1KB olmalı
      if (type === 'audio' && buffer.length < 1024) {
        logger.warn('MP3 dosyası çok küçük, atlanıyor', { filename, size: buffer.length });
        return null;
      }

      // Görsel için minimum 100 byte
      if (type === 'image' && buffer.length < 100) {
        logger.warn('Görsel dosyası çok küçük, atlanıyor', { filename, size: buffer.length });
        return null;
      }

      return { filename, buffer, type };

    } catch (error) {
      lastError = error instanceof Error ? error : new Error('Bilinmeyen hata');
      
      logger.warn(`Dosya indirme denemesi ${attempt}/${maxRetries} başarısız`, {
        url,
        filename,
        type,
        error: lastError.message
      });

      // Son deneme değilse bekle
      if (attempt < maxRetries) {
        await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
      }
    }
  }

  logger.error('Dosya indirme tamamen başarısız', {
    url,
    filename,
    type,
    error: lastError?.message
  });
  
  return null;
}

/**
 * ZIP dosyası oluşturur
 * ÖNEMLİ: Tüm dosyalar önce indirilir, sonra sırayla arşive eklenir
 */
export async function createZipArchive(
  story: IStory & { scenes: IScene[] }
): Promise<Buffer> {
  logger.info('ZIP arşivi oluşturuluyor', {
    storyId: story._id,
    scenesCount: story.scenes.length
  });

  // --- 1. ÖNCE TÜM DOSYALARI İNDİR ---
  const downloadTasks: Promise<{ sceneNumber: number; file: DownloadedFile | null }>[] = [];

  for (const scene of story.scenes) {
    const sceneDir = `scenes/scene-${scene.sceneNumber}/`;

    // Görsel indirme görevi
    if (scene.hasImage && scene.blobUrls?.image) {
      downloadTasks.push(
        downloadFile(scene.blobUrls.image, `${sceneDir}image.png`, 'image')
          .then(file => ({ sceneNumber: scene.sceneNumber, file }))
      );
    }

    // Ses indirme görevi
    if (scene.blobUrls?.audio) {
      downloadTasks.push(
        downloadFile(scene.blobUrls.audio, `${sceneDir}audio.mp3`, 'audio')
          .then(file => ({ sceneNumber: scene.sceneNumber, file }))
      );
    }
  }

  // Tüm indirmeleri bekle
  logger.info('Dosyalar indiriliyor...', { taskCount: downloadTasks.length });
  const downloadResults = await Promise.all(downloadTasks);
  
  // İndirilen dosyaları filtrele
  const downloadedFiles = downloadResults
    .filter(r => r.file !== null)
    .map(r => r.file as DownloadedFile);

  // Dosya boyutları özeti
  const audioFiles = downloadedFiles.filter(f => f.type === 'audio');
  const imageFiles = downloadedFiles.filter(f => f.type === 'image');
  const totalAudioSize = audioFiles.reduce((sum, f) => sum + f.buffer.length, 0);
  const totalImageSize = imageFiles.reduce((sum, f) => sum + f.buffer.length, 0);

  logger.info('Dosyalar indirildi - ÖZET', {
    total: downloadTasks.length,
    successful: downloadedFiles.length,
    failed: downloadTasks.length - downloadedFiles.length,
    audioCount: audioFiles.length,
    imageCount: imageFiles.length,
    totalAudioSizeMB: (totalAudioSize / 1024 / 1024).toFixed(2),
    totalImageSizeMB: (totalImageSize / 1024 / 1024).toFixed(2),
    avgAudioSizeKB: audioFiles.length > 0 ? Math.round(totalAudioSize / audioFiles.length / 1024) : 0,
    avgImageSizeKB: imageFiles.length > 0 ? Math.round(totalImageSize / imageFiles.length / 1024) : 0
  });

  // --- 2. ARŞIV OLUŞTUR ---
  return new Promise((resolve, reject) => {
    const archive = archiver('zip', {
      zlib: { level: 6 } // Orta seviye sıkıştırma (daha hızlı)
    });

    const buffers: Buffer[] = [];

    // Data eventlerini topla
    archive.on('data', (chunk: Buffer) => {
      buffers.push(chunk);
    });

    // Tamamlandığında resolve
    archive.on('end', () => {
      const zipBuffer = Buffer.concat(buffers);
      logger.info('ZIP arşivi oluşturuldu', {
        storyId: story._id,
        zipSize: zipBuffer.length,
        scenes: story.scenes.length,
        filesIncluded: downloadedFiles.length
      });
      resolve(zipBuffer);
    });

    // Hata durumunda reject
    archive.on('error', (error: Error) => {
      logger.error('ZIP oluşturma hatası', {
        storyId: story._id,
        error: error.message
      });
      reject(new AppError(`ZIP oluşturulamadı: ${error.message}`));
    });

    // --- 3. METADATA VE README EKLE ---
    const mainMetadata = {
      title: story.adaptedTitle || story.originalTitle,
      originalTitle: story.originalTitle,
      originalLanguage: story.originalLanguage,
      targetLanguage: story.targetLanguage,
      targetCountry: story.targetCountry,
      totalScenes: story.totalScenes,
      totalImages: story.totalImages,
      estimatedDuration: story.actualDuration,
      openaiModel: story.openaiModel,
      voiceName: story.voiceName,
      imagefxModel: story.imagefxModel,
      imagefxAspectRatio: story.imagefxAspectRatio,
      createdAt: story.createdAt,
      completedAt: story.updatedAt
    };

    archive.append(JSON.stringify(mainMetadata, null, 2), {
      name: 'metadata.json'
    });

    const readme = `# ${story.adaptedTitle || story.originalTitle}

## Hikaye Bilgileri

- **Orijinal Başlık**: ${story.originalTitle}
- **Adapte Başlık**: ${story.adaptedTitle || 'N/A'}
- **Orijinal Dil**: ${story.originalLanguage}
- **Hedef Dil**: ${story.targetLanguage}
- **Hedef Ülke**: ${story.targetCountry}
- **Toplam Sahne**: ${story.totalScenes}
- **Toplam Görsel**: ${story.totalImages}
- **Tahmini Süre**: ${story.actualDuration ? Math.floor(story.actualDuration / 60) + 'm ' + (story.actualDuration % 60) + 's' : 'N/A'}

## Klasör Yapısı

\`\`\`
/scenes
  /scene-1
    - text-original.txt       # Orijinal metin
    - text-adapted.txt        # Adapte edilmiş metin (hedef dil)
    - text-turkish.txt        # Türkçe çeviri (varsa)
    - image.png               # Sahne görseli (varsa)
    - audio.mp3               # Sahne sesi
    - metadata.json           # Sahne detayları
  /scene-2
  ...
/metadata.json                # Ana hikaye bilgileri
/README.md                    # Bu dosya
\`\`\`

## Kullanım

Bu ZIP dosyası YouTube video üretimi için tüm gerekli içeriği içermektedir:
- Her sahne için metin (orijinal ve adapte edilmiş)
- Görseller (10 adet, ilk 3 dakikada 5 tanesi)
- Seslendirmeler (MP3 format)

Video editörünüzde kullanabilirsiniz.

---
Üretim Tarihi: ${new Date().toISOString()}
`;

    archive.append(readme, { name: 'README.md' });

    // --- 4. HER SAHNE İÇİN METİN VE METADATA ---
    for (const scene of story.scenes) {
      const sceneDir = `scenes/scene-${scene.sceneNumber}/`;

      // Sahne metadata
      const sceneMetadata = {
        sceneNumber: scene.sceneNumber,
        hasImage: scene.hasImage,
        imageIndex: scene.imageIndex,
        isFirstThreeMinutes: scene.isFirstThreeMinutes,
        estimatedDuration: scene.estimatedDuration,
        actualDuration: scene.actualDuration,
        visualDescription: scene.visualDescription,
        visualPrompt: scene.visualPrompt
      };

      archive.append(JSON.stringify(sceneMetadata, null, 2), {
        name: `${sceneDir}metadata.json`
      });

      // Orijinal metin
      archive.append(scene.sceneTextOriginal || '', {
        name: `${sceneDir}text-original.txt`
      });

      // Adapte metin
      archive.append(scene.sceneTextAdapted || '', {
        name: `${sceneDir}text-adapted.txt`
      });

      // Türkçe metin (varsa)
      if (scene.sceneTextTurkish) {
        archive.append(scene.sceneTextTurkish, {
          name: `${sceneDir}text-turkish.txt`
        });
      }
    }

    // --- 5. İNDİRİLEN DOSYALARI SIRALI OLARAK EKLE ---
    // ÖNEMLİ: Sıralı ekleme yaparak stream karışmasını önle
    // MP3 dosyaları için store mode kullan (sıkıştırma yok - zaten sıkıştırılmış)
    for (const file of downloadedFiles) {
      if (file.type === 'audio') {
        // MP3 için sıkıştırma yapma - store mode
        archive.append(file.buffer, { 
          name: file.filename,
          store: true  // Sıkıştırma yok, olduğu gibi sakla
        });
      } else {
        // Görseller için normal sıkıştırma
        archive.append(file.buffer, { name: file.filename });
      }
      
      logger.debug("Dosya arşive eklendi", {
        filename: file.filename,
        size: file.buffer.length,
        type: file.type,
        store: file.type === 'audio'
      });
    }

    // --- 6. FİNALİZE ---
    archive.finalize();
  });
}

/**
 * Hızlı ZIP oluştur (sadece metinler, görseller/sesler hariç)
 */
export async function createQuickZip(
  story: IStory & { scenes: IScene[] }
): Promise<Buffer> {
  logger.info('Hızlı ZIP oluşturuluyor (sadece metinler)', {
    storyId: story._id
  });

  return new Promise((resolve, reject) => {
    const archive = archiver('zip', { zlib: { level: 5 } }); // Daha hızlı sıkıştırma
    const buffers: Buffer[] = [];

    archive.on('data', (chunk: Buffer) => buffers.push(chunk));
    archive.on('end', () => resolve(Buffer.concat(buffers)));
    archive.on('error', (error: Error) => reject(error));

    // Metadata
    archive.append(JSON.stringify({
      title: story.adaptedTitle,
      totalScenes: story.totalScenes
    }, null, 2), { name: 'metadata.json' });

    // Sadece metinler
    for (const scene of story.scenes) {
      const sceneDir = `scenes/scene-${scene.sceneNumber}/`;
      
      archive.append(scene.sceneTextOriginal, {
        name: `${sceneDir}text-original.txt`
      });
      
      archive.append(scene.sceneTextAdapted, {
        name: `${sceneDir}text-adapted.txt`
      });

      if (scene.sceneTextTurkish) {
        archive.append(scene.sceneTextTurkish, {
          name: `${sceneDir}text-turkish.txt`
        });
      }
    }

    archive.finalize();
  });
}

