/**
 * ZIP Servisi
 * Hikaye içeriğini (sahne metinleri, görseller, sesler) ZIP dosyası olarak paketler
 */

import archiver from 'archiver';
import { Readable } from 'stream';
import logger from '@/lib/logger';
import { AppError } from '@/lib/errors';
import type { IStory } from '@/types/story.types';
import type { IScene } from '@/models/Scene';

/**
 * ZIP dosyası oluşturur
 */
export async function createZipArchive(
  story: IStory & { scenes: IScene[] }
): Promise<Buffer> {
  logger.info('ZIP arşivi oluşturuluyor', {
    storyId: story._id,
    scenesCount: story.scenes.length
  });

  return new Promise((resolve, reject) => {
    const archive = archiver('zip', {
      zlib: { level: 9 } // Maksimum sıkıştırma
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
        scenes: story.scenes.length
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

    // --- 1. Ana Metadata ---
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

    // --- 2. README ---
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
    - text-adapted.txt        # Adapte edilmiş metin
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

    // --- 3. Her Sahne için İçerik ---
    const downloadPromises: Promise<void>[] = [];

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
      archive.append(scene.sceneTextOriginal, {
        name: `${sceneDir}text-original.txt`
      });

      // Adapte metin
      archive.append(scene.sceneTextAdapted, {
        name: `${sceneDir}text-adapted.txt`
      });

      // Görsel (varsa) - Blob URL'den indir
      if (scene.hasImage && scene.blobUrls?.image) {
        downloadPromises.push(
          downloadAndAppendToArchive(
            archive,
            scene.blobUrls.image,
            `${sceneDir}image.png`
          )
        );
      }

      // Ses - Blob URL'den indir
      if (scene.blobUrls?.audio) {
        downloadPromises.push(
          downloadAndAppendToArchive(
            archive,
            scene.blobUrls.audio,
            `${sceneDir}audio.mp3`
          )
        );
      }
    }

    // Tüm indirmeleri bekle, sonra finalize et
    Promise.all(downloadPromises)
      .then(() => {
        logger.debug("Tüm dosyalar ZIP'e eklendi, finalize ediliyor...");
        archive.finalize();
      })
      .catch((error) => {
        logger.error('ZIP indirme hatası', { error: error.message });
        archive.abort();
        reject(error);
      });
  });
}

/**
 * URL'den dosya indir ve arşive ekle
 */
async function downloadAndAppendToArchive(
  archive: archiver.Archiver,
  url: string,
  filename: string
): Promise<void> {
  try {
    logger.debug('Dosya indiriliyor', { url, filename });

    const response = await fetch(url);
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    archive.append(buffer, { name: filename });

    logger.debug("Dosya ZIP'e eklendi", {
      filename,
      size: buffer.length
    });

  } catch (error) {
    logger.error('Dosya indirme/ekleme hatası', {
      url,
      filename,
      error: error instanceof Error ? error.message : 'Bilinmeyen hata'
    });
    
    // Hata olsa bile devam et (eksik dosya olabilir)
    archive.append(`Dosya indirilemedi: ${error instanceof Error ? error.message : 'Bilinmeyen hata'}`, {
      name: `${filename}.error.txt`
    });
  }
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
    }

    archive.finalize();
  });
}

