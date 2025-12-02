/**
 * Vercel Blob Storage Servisi
 * Görseller, sesler ve metadata için cloud storage
 */

import { put, del, list, head } from '@vercel/blob';
import logger from '@/lib/logger';
import { BlobStorageError } from '@/lib/errors';

export interface UploadOptions {
  path: string;
  data: Buffer | string;
  contentType?: string;
  addRandomSuffix?: boolean;
}

export interface UploadResult {
  url: string;
  pathname: string;
  contentType: string;
  size: number;
  uploadedAt: Date;
}

/**
 * Dosya yükler
 */
export async function uploadFile(options: UploadOptions): Promise<UploadResult> {
  const { path, data, contentType, addRandomSuffix = true } = options;

  logger.debug("Blob storage'a yükleniyor", {
    path,
    size: Buffer.isBuffer(data) ? data.length : data.length,
    contentType
  });

  try {
    const blob = await put(path, data, {
      access: 'public',
      contentType,
      addRandomSuffix
    });

    logger.info("Blob storage'a yüklendi", {
      url: blob.url,
      pathname: blob.pathname,
      size: blob.size
    });

    return {
      url: blob.url,
      pathname: blob.pathname,
      contentType: blob.contentType || contentType || 'application/octet-stream',
      size: blob.size,
      uploadedAt: new Date()
    };

  } catch (error) {
    logger.error('Blob storage yükleme hatası', {
      path,
      error: error instanceof Error ? error.message : 'Bilinmeyen hata'
    });

    throw new BlobStorageError(
      `Dosya yüklenemedi: ${error instanceof Error ? error.message : 'Bilinmeyen hata'}`,
      { path }
    );
  }
}

/**
 * Görsel yükler
 */
export async function uploadImage(
  storyId: string,
  sceneNumber: number,
  imageBuffer: Buffer,
  imageIndex: number
): Promise<UploadResult> {
  const path = `stories/${storyId}/images/scene-${sceneNumber}-img-${imageIndex}.png`;
  
  return await uploadFile({
    path,
    data: imageBuffer,
    contentType: 'image/png',
    addRandomSuffix: false // Tutarlı isimler için
  });
}

/**
 * Ses yükler
 */
export async function uploadAudio(
  storyId: string,
  sceneNumber: number,
  audioBuffer: Buffer
): Promise<UploadResult> {
  const path = `stories/${storyId}/audio/scene-${sceneNumber}.mp3`;
  
  return await uploadFile({
    path,
    data: audioBuffer,
    contentType: 'audio/mpeg',
    addRandomSuffix: false
  });
}

/**
 * Sahne metadata yükler
 */
export async function uploadSceneMetadata(
  storyId: string,
  sceneNumber: number,
  metadata: any
): Promise<UploadResult> {
  const path = `stories/${storyId}/metadata/scene-${sceneNumber}.json`;
  
  return await uploadFile({
    path,
    data: JSON.stringify(metadata, null, 2),
    contentType: 'application/json',
    addRandomSuffix: false
  });
}

/**
 * ZIP dosyası yükler
 */
export async function uploadZip(
  storyId: string,
  zipBuffer: Buffer,
  filename: string
): Promise<UploadResult> {
  const path = `stories/${storyId}/${filename}.zip`;
  
  return await uploadFile({
    path,
    data: zipBuffer,
    contentType: 'application/zip',
    addRandomSuffix: false
  });
}

/**
 * Dosya siler
 */
export async function deleteFile(url: string): Promise<void> {
  logger.debug("Blob storage'dan siliniyor", { url });

  try {
    await del(url);
    
    logger.info("Blob storage'dan silindi", { url });

  } catch (error) {
    logger.error('Blob storage silme hatası', {
      url,
      error: error instanceof Error ? error.message : 'Bilinmeyen hata'
    });

    throw new BlobStorageError(
      `Dosya silinemedi: ${error instanceof Error ? error.message : 'Bilinmeyen hata'}`,
      { url }
    );
  }
}

/**
 * Hikayeye ait tüm dosyaları siler
 */
export async function deleteStoryFiles(storyId: string): Promise<void> {
  logger.info('Hikaye dosyaları siliniyor', { storyId });

  try {
    // Hikayeye ait tüm dosyaları listele
    const { blobs } = await list({
      prefix: `stories/${storyId}/`
    });

    // Tümünü sil
    const deletePromises = blobs.map(blob => deleteFile(blob.url));
    await Promise.all(deletePromises);

    logger.info('Hikaye dosyaları silindi', {
      storyId,
      deletedCount: blobs.length
    });

  } catch (error) {
    logger.error('Hikaye dosyaları silme hatası', {
      storyId,
      error: error instanceof Error ? error.message : 'Bilinmeyen hata'
    });

    throw new BlobStorageError(
      `Hikaye dosyaları silinemedi: ${error instanceof Error ? error.message : 'Bilinmeyen hata'}`,
      { storyId }
    );
  }
}

/**
 * Dosya bilgilerini getirir
 */
export async function getFileInfo(url: string) {
  try {
    const info = await head(url);
    
    return {
      url: info.url,
      size: info.size,
      uploadedAt: info.uploadedAt,
      contentType: info.contentType
    };

  } catch (error) {
    logger.error('Blob storage dosya bilgisi hatası', {
      url,
      error: error instanceof Error ? error.message : 'Bilinmeyen hata'
    });

    throw new BlobStorageError(
      `Dosya bilgisi alınamadı: ${error instanceof Error ? error.message : 'Bilinmeyen hata'}`,
      { url }
    );
  }
}

/**
 * Hikayeye ait dosyaları listeler
 */
export async function listStoryFiles(storyId: string) {
  try {
    const { blobs } = await list({
      prefix: `stories/${storyId}/`
    });

    logger.info('Hikaye dosyaları listelendi', {
      storyId,
      count: blobs.length
    });

    return blobs.map(blob => ({
      url: blob.url,
      pathname: blob.pathname,
      size: blob.size,
      uploadedAt: blob.uploadedAt
    }));

  } catch (error) {
    logger.error('Blob storage listeleme hatası', {
      storyId,
      error: error instanceof Error ? error.message : 'Bilinmeyen hata'
    });

    throw new BlobStorageError(
      `Dosyalar listelenemedi: ${error instanceof Error ? error.message : 'Bilinmeyen hata'}`,
      { storyId }
    );
  }
}

/**
 * Sağlık kontrolü
 */
export async function healthCheck(): Promise<boolean> {
  try {
    // Test dosyası yükle
    const testPath = `health-check-${Date.now()}.txt`;
    const testData = 'Health check test';

    const blob = await put(testPath, testData, {
      access: 'public',
      addRandomSuffix: false
    });

    // Test dosyasını sil
    await del(blob.url);

    logger.info('Blob storage sağlık kontrolü başarılı');
    return true;

  } catch (error) {
    logger.error('Blob storage sağlık kontrolü başarısız', {
      error: error instanceof Error ? error.message : 'Bilinmeyen hata'
    });
    return false;
  }
}

