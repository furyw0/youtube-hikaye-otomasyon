/**
 * Inngest Function: Hikaye İşleme Pipeline
 * Tüm hikaye işleme adımlarını sırayla yürütür
 */

import { inngest } from '../client';
import logger from '@/lib/logger';
import dbConnect from '@/lib/mongodb';
import Story from '@/models/Story';
import Scene from '@/models/Scene';

// Servisler
import { detectLanguage } from '@/services/language-detection.service';
import { translateStory } from '@/services/translation.service';
import { adaptStory } from '@/services/adaptation.service';
import { generateScenes, generateVisualPrompts } from '@/services/scene.service';
import { generateImage } from '@/services/imagefx.service';
import { generateSpeech } from '@/services/tts-router.service';
import { uploadImage, uploadAudio, uploadZip } from '@/services/blob.service';
import { createZipArchive } from '@/services/zip.service';
import Settings from '@/models/Settings';

export const processStory = inngest.createFunction(
  { 
    id: 'process-story',
    name: 'Process Story Pipeline'
  },
  { event: 'story/process' },
  async ({ event, step }) => {
    const { storyId } = event.data;

    logger.info('Hikaye işleme pipeline başlatıldı', { storyId });

    /**
     * Helper: Progress güncelleme
     */
    const updateProgress = async (
      progress: number, 
      currentStep: string, 
      status: string = 'processing'
    ) => {
      await dbConnect();
      await Story.findByIdAndUpdate(storyId, {
        progress,
        currentStep,
        status
      });
      
      logger.info('Progress güncellendi', { storyId, progress, currentStep });
    };

    /**
     * Helper: Story'yi yeniden fetch et (Mongoose document olarak)
     */
    const getStory = async () => {
      await dbConnect();
      const story = await Story.findById(storyId);
      if (!story) {
        throw new Error('Hikaye bulunamadı');
      }
      return story;
    };

    try {
      // --- 1. DİL ALGILAMA (5%) ---
      const storyData = await step.run('detect-language', async () => {
        await dbConnect();
        await updateProgress(5, 'Dil algılanıyor...');
        
        const story = await getStory();

        const detection = await detectLanguage(story.originalContent);
        
        // findByIdAndUpdate kullan (save() yerine)
        await Story.findByIdAndUpdate(storyId, {
          originalLanguage: detection.language
        });

        logger.info('Dil algılandı', {
          storyId,
          detectedLanguage: detection.language,
          confidence: detection.confidence
        });

        // Plain object olarak dön (Inngest serialize edebilsin)
        return {
          _id: story._id.toString(),
          userId: story.userId?.toString(),
          originalContent: story.originalContent,
          originalTitle: story.originalTitle,
          originalLanguage: detection.language,
          targetLanguage: story.targetLanguage,
          targetCountry: story.targetCountry,
          openaiModel: story.openaiModel,
          // TTS Ayarları
          ttsProvider: story.ttsProvider || 'elevenlabs',
          // ElevenLabs
          elevenlabsModel: story.elevenlabsModel,
          voiceId: story.voiceId,
          voiceName: story.voiceName,
          // Coqui TTS
          coquiTunnelUrl: story.coquiTunnelUrl,
          coquiLanguage: story.coquiLanguage,
          coquiVoiceId: story.coquiVoiceId,
          coquiVoiceName: story.coquiVoiceName,
          // ImageFX
          imagefxModel: story.imagefxModel,
          imagefxAspectRatio: story.imagefxAspectRatio,
          imagefxSeed: story.imagefxSeed
        };
      });

      // --- 2. ÇEVİRİ (20%) ---
      const translationData = await step.run('translate-story', async () => {
        await dbConnect();
        await updateProgress(10, 'Hikaye çevriliyor...');

        const result = await translateStory({
          content: storyData.originalContent,
          title: storyData.originalTitle,
          sourceLang: storyData.originalLanguage,
          targetLang: storyData.targetLanguage,
          model: storyData.openaiModel
        });

        // findByIdAndUpdate kullan
        await Story.findByIdAndUpdate(storyId, {
          adaptedTitle: result.title,
          adaptedContent: result.content
        });

        await updateProgress(20, 'Çeviri tamamlandı');

        logger.info('Çeviri tamamlandı', {
          storyId,
          originalLength: result.originalLength,
          translatedLength: result.translatedLength,
          chunks: result.chunksUsed
        });

        return {
          adaptedTitle: result.title,
          adaptedContent: result.content
        };
      });

      // --- 3. KÜLTÜREL UYARLAMA (30%) ---
      const adaptationData = await step.run('adapt-story', async () => {
        await dbConnect();
        await updateProgress(25, 'Kültürel adaptasyon yapılıyor...');

        const result = await adaptStory({
          content: translationData.adaptedContent,
          title: translationData.adaptedTitle,
          targetCountry: storyData.targetCountry,
          targetLanguage: storyData.targetLanguage,
          model: storyData.openaiModel
        });

        // findByIdAndUpdate kullan
        await Story.findByIdAndUpdate(storyId, {
          adaptedTitle: result.title,
          adaptedContent: result.content
        });

        await updateProgress(30, 'Kültürel adaptasyon tamamlandı');

        logger.info('Adaptasyon tamamlandı', {
          storyId,
          adaptations: result.adaptations.length
        });

        return {
          adaptedTitle: result.title,
          adaptedContent: result.content
        };
      });

      // --- 4. SAHNE OLUŞTURMA (50%) ---
      const scenesData = await step.run('generate-scenes', async () => {
        await dbConnect();
        await updateProgress(35, 'Sahneler oluşturuluyor...');

        const result = await generateScenes({
          originalContent: storyData.originalContent,
          adaptedContent: adaptationData.adaptedContent,
          model: storyData.openaiModel
        });

        // Sahneleri MongoDB'ye kaydet
        const scenePromises = result.scenes.map(sceneData =>
          Scene.create({
            storyId: storyId,
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
        
        // findByIdAndUpdate kullan
        await Story.findByIdAndUpdate(storyId, {
          totalScenes: result.totalScenes,
          totalImages: result.totalImages,
          firstMinuteImages: result.firstThreeMinutesScenes,
          scenes: scenes.map(s => s._id)
        });

        await updateProgress(50, 'Sahneler oluşturuldu');

        logger.info('Sahneler oluşturuldu', {
          storyId,
          totalScenes: result.totalScenes,
          totalImages: result.totalImages
        });

        // Plain array olarak dön
        return result.scenes.map(s => ({
          sceneNumber: s.sceneNumber,
          text: s.text,
          hasImage: s.hasImage,
          imageIndex: s.imageIndex,
          visualDescription: s.visualDescription,
          isFirstThreeMinutes: s.isFirstThreeMinutes,
          estimatedDuration: s.estimatedDuration
        }));
      });

      // --- 5. GÖRSEL PROMPTLARI (60%) ---
      const visualPromptsData = await step.run('generate-visual-prompts', async () => {
        await dbConnect();
        await updateProgress(55, 'Görsel promptları hazırlanıyor...');

        const storyContext = `${adaptationData.adaptedTitle}\n\n${adaptationData.adaptedContent?.substring(0, 1000)}`;
        
        const prompts = await generateVisualPrompts(
          scenesData,
          storyContext,
          storyData.openaiModel
        );

        // Promptları sahnelere kaydet
        for (const [sceneNumber, prompt] of prompts.entries()) {
          await Scene.findOneAndUpdate(
            { storyId: storyId, sceneNumber },
            { visualPrompt: prompt }
          );
        }

        await updateProgress(60, 'Görsel promptları hazırlandı');

        logger.info('Görsel promptları oluşturuldu', {
          storyId,
          totalPrompts: prompts.size
        });

        // Map'i plain object'e çevir
        const promptsObj: Record<number, string> = {};
        for (const [key, value] of prompts.entries()) {
          promptsObj[key] = value;
        }
        return promptsObj;
      });

      // --- 6. GÖRSELLER ÜRET (80%) ---
      await step.run('generate-images', async () => {
        await dbConnect();
        await updateProgress(65, 'Görseller üretiliyor...');

        const imageScenes = scenesData.filter(s => s.hasImage);
        let completedImages = 0;

        for (const scene of imageScenes) {
          const prompt = visualPromptsData[scene.sceneNumber];
          
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
              model: storyData.imagefxModel as any,
              aspectRatio: storyData.imagefxAspectRatio as any,
              seed: storyData.imagefxSeed
            });

            // Blob'a yükle
            const uploaded = await uploadImage(
              storyId,
              scene.sceneNumber,
              image.imageBuffer,
              scene.imageIndex!
            );

            // Scene'i güncelle (findOneAndUpdate kullan)
            await Scene.findOneAndUpdate(
              { storyId: storyId, sceneNumber: scene.sceneNumber },
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
      // Her sahne için ayrı step oluştur (timeout sorununu önlemek için)
      const audioSceneNumbers = await step.run('prepare-audio-scenes', async () => {
        await dbConnect();
        await updateProgress(85, 'Seslendirme hazırlanıyor...');
        
        const scenes = await Scene.find({ storyId: storyId }).sort({ sceneNumber: 1 });
        
        // Sadece sesi olmayan sahneleri işle (retry durumunda atlama)
        const pendingScenes = scenes.filter(s => !s.blobUrls?.audio);
        
        logger.info('Seslendirme bekleyen sahneler', {
          storyId,
          total: scenes.length,
          pending: pendingScenes.length,
          alreadyCompleted: scenes.length - pendingScenes.length
        });
        
        return pendingScenes.map(s => s.sceneNumber);
      });

      // TTS ayarlarını hazırla
      const ttsSettings = {
        ttsProvider: storyData.ttsProvider || 'elevenlabs',
        defaultVoiceId: storyData.voiceId,
        defaultElevenlabsModel: storyData.elevenlabsModel || 'eleven_flash_v2_5',
        coquiTunnelUrl: storyData.coquiTunnelUrl,
        coquiLanguage: storyData.coquiLanguage,
        coquiSelectedVoiceId: storyData.coquiVoiceId
      };

      // Her sahne için ayrı step (5'erli gruplar halinde)
      const BATCH_SIZE = 5;
      for (let i = 0; i < audioSceneNumbers.length; i += BATCH_SIZE) {
        const batchSceneNumbers = audioSceneNumbers.slice(i, i + BATCH_SIZE);
        const batchIndex = Math.floor(i / BATCH_SIZE) + 1;
        const totalBatches = Math.ceil(audioSceneNumbers.length / BATCH_SIZE);
        
        await step.run(`generate-audio-batch-${batchIndex}`, async () => {
          await dbConnect();
          
          for (const sceneNumber of batchSceneNumbers) {
            try {
              // Sahneyi tekrar kontrol et (başka bir batch'te işlenmiş olabilir)
              const scene = await Scene.findOne({ storyId, sceneNumber });
              if (!scene || scene.blobUrls?.audio) {
                logger.debug(`Sahne ${sceneNumber} zaten işlenmiş, atlanıyor`);
                continue;
              }

              logger.info(`Sahne ${sceneNumber} seslendiriliyor...`, {
                textLength: scene.sceneTextAdapted.length,
                provider: ttsSettings.ttsProvider
              });

              // TTS Router ile ses üret
              const audio = await generateSpeech({
                text: scene.sceneTextAdapted,
                settings: ttsSettings as any,
                language: storyData.targetLanguage
              });

              // Blob'a yükle
              const uploaded = await uploadAudio(
                storyId,
                sceneNumber,
                audio.audioBuffer
              );

              // Scene'i güncelle
              await Scene.findOneAndUpdate(
                { storyId, sceneNumber },
                {
                  'blobUrls.audio': uploaded.url,
                  actualDuration: audio.duration,
                  status: 'completed'
                }
              );

              logger.info(`Sahne ${sceneNumber} seslendirme tamamlandı`, {
                duration: audio.duration,
                provider: audio.provider
              });

            } catch (error) {
              logger.error(`Sahne ${sceneNumber} seslendirme hatası`, {
                error: error instanceof Error ? error.message : 'Bilinmeyen hata'
              });
              // Bu sahneyi atla, devam et
            }
          }

          // Progress güncelle
          const completedCount = i + batchSceneNumbers.length;
          const audioProgress = 85 + (completedCount / audioSceneNumbers.length) * 10;
          await updateProgress(
            Math.round(audioProgress),
            `Seslendirme (${batchIndex}/${totalBatches})...`
          );
        });
      }

      // Toplam süreyi hesapla
      await step.run('finalize-audio', async () => {
        await dbConnect();
        
        const scenes = await Scene.find({ storyId }).select('actualDuration blobUrls');
        const totalDuration = scenes.reduce((sum, s) => sum + (s.actualDuration || 0), 0);
        const completedAudios = scenes.filter(s => s.blobUrls?.audio).length;

        await Story.findByIdAndUpdate(storyId, { actualDuration: totalDuration });
        await updateProgress(95, 'Seslendirme tamamlandı');

        logger.info('Seslendirmeler tamamlandı', {
          storyId,
          completed: completedAudios,
          total: scenes.length,
          totalDuration
        });
      });

      // --- 8. TÜRKÇE ÇEVİRİ (96%) ---
      // Eğer hedef dil Türkçe değilse, sahneleri Türkçe'ye çevir
      if (storyData.targetLanguage !== 'tr') {
        await step.run('translate-to-turkish', async () => {
          await dbConnect();
          await updateProgress(95, 'Türkçe çeviri yapılıyor...');

          const { translateText } = await import('@/services/translation.service');
          const scenes = await Scene.find({ storyId: storyId }).sort({ sceneNumber: 1 });
          let completedTranslations = 0;

          for (const scene of scenes) {
            try {
              const turkishText = await translateText(
                scene.sceneTextAdapted,
                storyData.targetLanguage,
                'tr',
                storyData.openaiModel
              );

              await Scene.findOneAndUpdate(
                { storyId: storyId, sceneNumber: scene.sceneNumber },
                { sceneTextTurkish: turkishText }
              );

              completedTranslations++;
              const translationProgress = 95 + (completedTranslations / scenes.length) * 2;
              await updateProgress(
                Math.round(translationProgress),
                `Türkçe çeviri (${completedTranslations}/${scenes.length})...`
              );

            } catch (error) {
              logger.warn('Türkçe çeviri başarısız', {
                storyId,
                sceneNumber: scene.sceneNumber,
                error: error instanceof Error ? error.message : 'Bilinmeyen hata'
              });
              // Devam et, kritik değil
            }
          }

          logger.info('Türkçe çeviriler tamamlandı', {
            storyId,
            completed: completedTranslations,
            total: scenes.length
          });
        });
      }

      // --- 9. ZIP OLUŞTUR (98%) ---
      await step.run('create-zip', async () => {
        await dbConnect();
        await updateProgress(97, 'ZIP dosyası oluşturuluyor...');

        const fullStory = await Story.findById(storyId).populate('scenes');
        if (!fullStory) {
          throw new Error('Hikaye bulunamadı');
        }
        
        const zipBuffer = await createZipArchive(fullStory as any);

        // Blob'a yükle
        const filename = `${adaptationData.adaptedTitle?.replace(/[^a-z0-9]/gi, '-') || 'story'}`;
        const uploaded = await uploadZip(storyId, zipBuffer, filename);

        // findByIdAndUpdate kullan
        await Story.findByIdAndUpdate(storyId, {
          'blobUrls.zipFile': uploaded.url
        });

        await updateProgress(98, 'ZIP dosyası oluşturuldu');

        logger.info('ZIP oluşturuldu', {
          storyId,
          zipUrl: uploaded.url,
          zipSize: uploaded.size
        });
      });

      // --- 9. TAMAMLANDI (100%) ---
      await step.run('complete', async () => {
        await dbConnect();
        
        // findByIdAndUpdate kullan
        await Story.findByIdAndUpdate(storyId, {
          status: 'completed',
          progress: 100,
          currentStep: 'İşlem tamamlandı!'
        });

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

      await dbConnect();
      await Story.findByIdAndUpdate(storyId, {
        status: 'failed',
        errorMessage: error instanceof Error ? error.message : 'Bilinmeyen hata'
      });

      // retryCount'u ayrı $inc operatörü ile güncelle
      await Story.findByIdAndUpdate(storyId, {
        $inc: { retryCount: 1 }
      });

      throw error;
    }
  }
);
