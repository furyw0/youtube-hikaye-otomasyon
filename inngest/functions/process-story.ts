/**
 * Inngest Function: Hikaye İşleme Pipeline
 * Tüm hikaye işleme adımlarını sırayla yürütür
 */

import { inngest } from '../client';
import logger from '@/lib/logger';
import dbConnect from '@/lib/mongodb';
import Story from '@/models/Story';
import Scene from '@/models/Scene';
import type { IStory } from '@/types/story.types';
import type { IScene } from '@/types/scene.types';

// Servisler
import { detectLanguage } from '@/services/language-detection.service';
import { translateStory } from '@/services/translation.service';
import { adaptStory } from '@/services/adaptation.service';
import { generateScenes, generateVisualPrompts } from '@/services/scene.service';
import { generateImage } from '@/services/imagefx.service';
import { generateAudio } from '@/services/elevenlabs.service';
import { uploadImage, uploadAudio, uploadSceneMetadata, uploadZip } from '@/services/blob.service';
import { createZipArchive } from '@/services/zip.service';

export const processStory = inngest.createFunction(
  { 
    id: 'process-story',
    name: 'Process Story Pipeline'
  },
  { event: 'story/process' },
  async ({ event, step }) => {
    const { storyId } = event.data;

    logger.info('Hikaye işleme pipeline başlatıldı', { storyId });

    await dbConnect();

    /**
     * Helper: Progress güncelleme
     */
    const updateProgress = async (
      progress: number, 
      currentStep: string, 
      status: string = 'processing'
    ) => {
      await Story.findByIdAndUpdate(storyId, {
        progress,
        currentStep,
        status
      });
      
      logger.info('Progress güncellendi', { storyId, progress, currentStep });
    };

    try {
      // --- 1. DİL ALGILAMA (5%) ---
      const story = await step.run('detect-language', async (): Promise<any> => {
        await updateProgress(5, 'Dil algılanıyor...');
        
        const story = await Story.findById(storyId);
        if (!story) {
          throw new Error('Hikaye bulunamadı');
        }

        const detection = await detectLanguage(story.originalContent);
        story.originalLanguage = detection.language;
        await story.save();

        logger.info('Dil algılandı', {
          storyId,
          detectedLanguage: detection.language,
          confidence: detection.confidence
        });

        return story;
      });

      // --- 2. ÇEVİRİ (20%) ---
      await step.run('translate-story', async () => {
        await updateProgress(10, 'Hikaye çevriliyor...');

        const result = await translateStory({
          content: story.originalContent,
          title: story.originalTitle,
          sourceLang: story.originalLanguage,
          targetLang: story.targetLanguage,
          model: story.openaiModel
        });

        story.adaptedTitle = result.title;
        story.adaptedContent = result.content;
        await story.save();

        await updateProgress(20, 'Çeviri tamamlandı');

        logger.info('Çeviri tamamlandı', {
          storyId,
          originalLength: result.originalLength,
          translatedLength: result.translatedLength,
          chunks: result.chunksUsed
        });
      });

      // --- 3. KÜLTÜREL UYARLAMA (30%) ---
      await step.run('adapt-story', async () => {
        await updateProgress(25, 'Kültürel adaptasyon yapılıyor...');

        const result = await adaptStory({
          content: story.adaptedContent!,
          title: story.adaptedTitle!,
          targetCountry: story.targetCountry,
          targetLanguage: story.targetLanguage,
          model: story.openaiModel
        });

        story.adaptedTitle = result.title;
        story.adaptedContent = result.content;
        await story.save();

        await updateProgress(30, 'Kültürel adaptasyon tamamlandı');

        logger.info('Adaptasyon tamamlandı', {
          storyId,
          adaptations: result.adaptations.length
        });
      });

      // --- 4. SAHNE OLUŞTURMA (50%) ---
      const scenesData = await step.run('generate-scenes', async () => {
        await updateProgress(35, 'Sahneler oluşturuluyor...');

        const result = await generateScenes({
          originalContent: story.originalContent,
          adaptedContent: story.adaptedContent!,
          model: story.openaiModel
        });

        story.totalScenes = result.totalScenes;
        story.totalImages = result.totalImages;
        story.firstMinuteImages = result.firstThreeMinutesScenes;
        await story.save();

        // Sahneleri MongoDB'ye kaydet
        const scenePromises = result.scenes.map(sceneData =>
          Scene.create({
            storyId: story._id,
            sceneNumber: sceneData.sceneNumber,
            sceneTextOriginal: sceneData.text,
            sceneTextAdapted: (sceneData as any).textAdapted,
            hasImage: sceneData.hasImage,
            imageIndex: sceneData.imageIndex,
            visualDescription: sceneData.visualDescription,
            isFirstThreeMinutes: sceneData.isFirstThreeMinutes,
            estimatedDuration: sceneData.estimatedDuration,
            status: 'pending',
            retryCount: 0
          })
        );

        const scenes = await Promise.all(scenePromises);
        story.scenes = scenes.map(s => s._id);
        await story.save();

        await updateProgress(50, 'Sahneler oluşturuldu');

        logger.info('Sahneler oluşturuldu', {
          storyId,
          totalScenes: result.totalScenes,
          totalImages: result.totalImages
        });

        return result.scenes;
      });

      // --- 5. GÖRSEL PROMPTLARI (60%) ---
      const visualPrompts = await step.run('generate-visual-prompts', async (): Promise<Map<number, string>> => {
        await updateProgress(55, 'Görsel promptları hazırlanıyor...');

        const storyContext = `${story.adaptedTitle}\n\n${story.adaptedContent?.substring(0, 1000)}`;
        
        const prompts = await generateVisualPrompts(
          scenesData,
          storyContext,
          story.openaiModel
        );

        // Promptları sahnelere kaydet
        for (const [sceneNumber, prompt] of prompts.entries()) {
          await Scene.findOneAndUpdate(
            { storyId: story._id, sceneNumber },
            { visualPrompt: prompt }
          );
        }

        await updateProgress(60, 'Görsel promptları hazırlandı');

        logger.info('Görsel promptları oluşturuldu', {
          storyId,
          totalPrompts: prompts.size
        });

        return prompts;
      });

      // --- 6. GÖRSELLER ÜRET (80%) ---
      await step.run('generate-images', async () => {
        await updateProgress(65, 'Görseller üretiliyor...');

        const imageScenes = scenesData.filter(s => s.hasImage);
        let completedImages = 0;

        for (const scene of imageScenes) {
          const prompt = (visualPrompts as Map<number, string>).get(scene.sceneNumber);
          
          if (!prompt) {
            logger.warn('Görsel prompt bulunamadı', {
              storyId,
              sceneNumber: scene.sceneNumber
            });
            continue;
          }

          try {
            // Görsel üret
            const image = await generateImage({
              prompt,
              model: story.imagefxModel as any,
              aspectRatio: story.imagefxAspectRatio as any,
              seed: story.imagefxSeed
            });

            // Blob'a yükle
            const uploaded = await uploadImage(
              storyId,
              scene.sceneNumber,
              image.imageBuffer,
              scene.imageIndex!
            );

            // Scene'i güncelle
            await Scene.findOneAndUpdate(
              { storyId: story._id, sceneNumber: scene.sceneNumber },
              { 
                'blobUrls.image': uploaded.url,
                status: 'processing'
              }
            );

            completedImages++;
            const imageProgress = 65 + (completedImages / imageScenes.length) * 15;
            await updateProgress(
              Math.round(imageProgress),
              `Görseller üretiliyor (${completedImages}/${imageScenes.length})...`
            );

            logger.debug('Görsel üretildi', {
              storyId,
              sceneNumber: scene.sceneNumber,
              url: uploaded.url
            });

          } catch (error) {
            logger.error('Görsel üretimi başarısız', {
              storyId,
              sceneNumber: scene.sceneNumber,
              error: error instanceof Error ? error.message : 'Bilinmeyen hata'
            });
            // Devam et (diğer görselleri dene)
          }
        }

        await updateProgress(80, 'Görseller tamamlandı');

        logger.info('Görseller üretildi', {
          storyId,
          completed: completedImages,
          total: imageScenes.length
        });
      });

      // --- 7. SESLENDİRME (95%) ---
      await step.run('generate-audio', async () => {
        await updateProgress(85, 'Seslendirme yapılıyor...');

        const scenes = await Scene.find({ storyId: story._id }).sort({ sceneNumber: 1 });
        let completedAudios = 0;

        for (const scene of scenes) {
          try {
            // Ses üret
            const audio = await generateAudio({
              text: scene.sceneTextAdapted,
              voiceId: story.voiceId
            });

            // Blob'a yükle
            const uploaded = await uploadAudio(
              storyId,
              scene.sceneNumber,
              audio.audioBuffer
            );

            // Scene'i güncelle
            scene.blobUrls = scene.blobUrls || {};
            scene.blobUrls.audio = uploaded.url;
            scene.actualDuration = audio.duration;
            scene.status = 'completed';
            await scene.save();

            completedAudios++;
            const audioProgress = 85 + (completedAudios / scenes.length) * 10;
            await updateProgress(
              Math.round(audioProgress),
              `Seslendirme yapılıyor (${completedAudios}/${scenes.length})...`
            );

            logger.debug('Seslendirme tamamlandı', {
              storyId,
              sceneNumber: scene.sceneNumber,
              duration: audio.duration
            });

          } catch (error) {
            logger.error('Seslendirme başarısız', {
              storyId,
              sceneNumber: scene.sceneNumber,
              error: error instanceof Error ? error.message : 'Bilinmeyen hata'
            });
            // Devam et
          }
        }

        // Toplam süreyi hesapla
        const totalDuration = scenes.reduce((sum, s) => sum + (s.actualDuration || 0), 0);
        story.actualDuration = totalDuration;
        await story.save();

        await updateProgress(95, 'Seslendirme tamamlandı');

        logger.info('Seslendirmeler tamamlandı', {
          storyId,
          completed: completedAudios,
          total: scenes.length,
          totalDuration
        });
      });

      // --- 8. ZIP OLUŞTUR (98%) ---
      await step.run('create-zip', async () => {
        await updateProgress(97, 'ZIP dosyası oluşturuluyor...');

        const fullStory = await Story.findById(storyId).populate('scenes');
        const zipBuffer = await createZipArchive(fullStory as any);

        // Blob'a yükle
        const filename = `${story.adaptedTitle?.replace(/[^a-z0-9]/gi, '-') || 'story'}`;
        const uploaded = await uploadZip(storyId, zipBuffer, filename);

        story.blobUrls = story.blobUrls || {};
        story.blobUrls.zipFile = uploaded.url;
        await story.save();

        await updateProgress(98, 'ZIP dosyası oluşturuldu');

        logger.info('ZIP oluşturuldu', {
          storyId,
          zipUrl: uploaded.url,
          zipSize: uploaded.size
        });
      });

      // --- 9. TAMAMLANDI (100%) ---
      await step.run('complete', async () => {
        story.status = 'completed';
        story.progress = 100;
        story.currentStep = 'İşlem tamamlandı!';
        await story.save();

        logger.info('Hikaye işleme tamamlandı', { storyId });
      });

      return {
        success: true,
        storyId,
        message: 'Hikaye başarıyla işlendi'
      };

    } catch (error) {
      // Hata durumunda story'yi güncelle
      logger.error('Hikaye işleme hatası', {
        storyId,
        error: error instanceof Error ? error.message : 'Bilinmeyen hata',
        stack: error instanceof Error ? error.stack : undefined
      });

      await Story.findByIdAndUpdate(storyId, {
        status: 'failed',
        errorMessage: error instanceof Error ? error.message : 'Bilinmeyen hata',
        retryCount: { $inc: 1 }
      });

      throw error;
    }
  }
);

