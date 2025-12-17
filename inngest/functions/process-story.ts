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
import { generateYouTubeMetadata } from '@/services/metadata.service';
import { generateImage } from '@/services/imagefx.service';
import { generateSpeech } from '@/services/tts-router.service';
import { uploadImage, uploadAudio, uploadZip } from '@/services/blob.service';
import { createZipArchive } from '@/services/zip.service';
import { getLLMConfig } from '@/services/llm-router.service';
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

    // İşleme başlangıç zamanı
    const processingStartTime = Date.now();

    try {
      // --- 0. İŞLEME BAŞLANGICI ---
      await step.run('mark-processing-start', async () => {
        await dbConnect();
        await Story.findByIdAndUpdate(storyId, {
          processingStartedAt: new Date(),
          status: 'processing'
        });
        logger.info('İşleme başlangıç zamanı kaydedildi', { storyId });
      });

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

        // Settings'den LLM provider bilgisini al
        const settings = await Settings.findOne({ userId: story.userId });
        const llmConfig = settings ? getLLMConfig(settings) : { provider: 'openai' as const, model: story.openaiModel };

        logger.info('Dil algılandı', {
          storyId,
          detectedLanguage: detection.language,
          confidence: detection.confidence,
          llmProvider: llmConfig.provider,
          llmModel: llmConfig.model
        });

        // Plain object olarak dön (Inngest serialize edebilsin)
        return {
          _id: story._id.toString(),
          userId: story.userId?.toString(),
          originalContent: story.originalContent,
          originalTitle: story.originalTitle,
          originalYoutubeDescription: story.originalYoutubeDescription,
          originalCoverText: story.originalCoverText,
          originalLanguage: detection.language,
          targetLanguage: story.targetLanguage,
          targetCountry: story.targetCountry,
          openaiModel: story.openaiModel,
          llmProvider: llmConfig.provider,
          llmModel: llmConfig.model,
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
          model: storyData.llmModel,
          provider: storyData.llmProvider
        });

        // UZUNLUK KONTROLÜ - Çeviri orijinalin en az %70'i olmalı
        const lengthRatio = result.translatedLength / result.originalLength;
        if (lengthRatio < 0.70) {
          logger.error('⚠️ KRİTİK: Çeviri çok kısa! Hikaye kısaltılmış olabilir!', {
            storyId,
            originalLength: result.originalLength,
            translatedLength: result.translatedLength,
            ratio: Math.round(lengthRatio * 100) + '%',
            minExpected: Math.round(result.originalLength * 0.70)
          });
        }

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
          lengthRatio: Math.round(lengthRatio * 100) + '%',
          chunks: result.chunksUsed
        });

        return {
          adaptedTitle: result.title,
          adaptedContent: result.content,
          originalLength: result.originalLength
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

        // UZUNLUK KONTROLÜ - Adaptasyon çevirinin en az %80'i olmalı
        const adaptLengthRatio = result.adaptedLength / result.originalLength;
        if (adaptLengthRatio < 0.80) {
          logger.error('⚠️ KRİTİK: Adaptasyon çok kısa! Hikaye kısaltılmış olabilir!', {
            storyId,
            translatedLength: result.originalLength,
            adaptedLength: result.adaptedLength,
            ratio: Math.round(adaptLengthRatio * 100) + '%'
          });
        }

        // TOPLAM ORAN KONTROLÜ - Adaptasyon orijinalin en az %60'ı olmalı
        const totalRatio = result.adaptedLength / (translationData.originalLength || result.originalLength);
        if (totalRatio < 0.60) {
          logger.error('🚨 ALARM: Final metin orijinalden çok kısa! (<%60)', {
            storyId,
            originalLength: translationData.originalLength,
            finalLength: result.adaptedLength,
            totalRatio: Math.round(totalRatio * 100) + '%'
          });
        }

        // findByIdAndUpdate kullan
        await Story.findByIdAndUpdate(storyId, {
          adaptedTitle: result.title,
          adaptedContent: result.content
        });

        await updateProgress(30, 'Kültürel adaptasyon tamamlandı');

        logger.info('Adaptasyon tamamlandı', {
          storyId,
          adaptations: result.adaptations.length,
          adaptedLength: result.adaptedLength,
          totalRatio: Math.round(totalRatio * 100) + '%'
        });

        return {
          adaptedTitle: result.title,
          adaptedContent: result.content,
          adaptationNotes: result.adaptations
        };
      });

      // --- 3.5. YOUTUBE METADATA OLUŞTURMA (32%) ---
      const metadataData = await step.run('generate-metadata', async () => {
        await dbConnect();
        await updateProgress(32, 'YouTube metadata oluşturuluyor...');
        
        const story = await getStory();
        
        // Eğer orijinal YouTube bilgileri yoksa bu adımı atla
        if (!story.originalYoutubeDescription && !story.originalCoverText) {
          logger.info('Orijinal YouTube metadata yok, metadata oluşturma atlanıyor', { storyId });
          return null;
        }
        
        // Settings'den LLM provider/model bilgisini al
        const settings = await Settings.findOne({ userId: story.userId });
        if (!settings) {
          throw new Error('Kullanıcı ayarları bulunamadı');
        }
        
        const { provider, model } = getLLMConfig(settings);
        
        const result = await generateYouTubeMetadata({
          adaptedTitle: adaptationData.adaptedTitle,
          adaptedContent: adaptationData.adaptedContent,
          originalDescription: story.originalYoutubeDescription,
          originalCoverText: story.originalCoverText,
          targetLanguage: story.targetLanguage,
          targetCountry: story.targetCountry,
          model,
          provider,
          adaptationNotes: adaptationData.adaptationNotes || []
        });
        
        // Metadata'yı Story'ye kaydet
        await Story.findByIdAndUpdate(storyId, {
          adaptedYoutubeDescription: result.youtubeDescription,
          adaptedCoverText: result.coverText
        });
        
        logger.info('YouTube metadata oluşturuldu', {
          storyId,
          descriptionLength: result.youtubeDescription.length,
          coverTextLength: result.coverText.length
        });
        
        return result;
      });

      // --- 4. SAHNE OLUŞTURMA (50%) ---
      const scenesData = await step.run('generate-scenes', async () => {
        await dbConnect();
        await updateProgress(35, 'Sahneler oluşturuluyor...');

        const result = await generateScenes({
          originalContent: storyData.originalContent,
          adaptedContent: adaptationData.adaptedContent,
          model: storyData.llmModel,
          provider: storyData.llmProvider
        });

        // Sahneleri MongoDB'ye kaydet
        // NOT: blobUrls objesini baştan initialize et, yoksa nested update çalışmaz
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
            retryCount: 0,
            blobUrls: {
              image: null,
              audio: null,
              metadata: null
            }
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

        // Metin kapsama oranı kontrolü
        const coveragePercent = Math.round(result.textCoverageRatio * 100);
        
        if (result.textCoverageRatio < 0.50) {
          logger.error('🚨 KRİTİK: Sahne bölme sırasında hikaye %50\'den fazla kısaltılmış!', {
            storyId,
            textCoverageRatio: coveragePercent + '%',
            adaptedLength: adaptationData.adaptedContent.length
          });
        } else if (result.textCoverageRatio < 0.70) {
          logger.warn('⚠️ UYARI: Sahne bölme sırasında hikaye kısaltılmış olabilir', {
            storyId,
            textCoverageRatio: coveragePercent + '%'
          });
        }

        logger.info('Sahneler oluşturuldu', {
          storyId,
          totalScenes: result.totalScenes,
          totalImages: result.totalImages,
          textCoverageRatio: coveragePercent + '%'
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
          storyData.llmModel,
          storyData.llmProvider
        );

        // Promptları sahnelere kaydet
        for (const [sceneNumber, prompt] of prompts.entries()) {
          await Scene.findOneAndUpdate(
            { storyId: storyId, sceneNumber },
            { $set: { visualPrompt: prompt } }
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
      // Her görsel için ayrı step oluştur (timeout sorununu önlemek için)
      const imageSceneNumbers = await step.run('prepare-image-scenes', async () => {
        await dbConnect();
        await updateProgress(65, 'Görseller hazırlanıyor...');
        
        const scenes = await Scene.find({ storyId: storyId, hasImage: true })
          .sort({ sceneNumber: 1 })
          .select('sceneNumber imageIndex blobUrls');
        
        // Sadece görseli olmayan sahneleri işle (retry durumunda atlama)
        const pendingScenes = scenes.filter(s => !s.blobUrls?.image);
        
        logger.info('Görsel üretimi hazırlandı', {
          storyId,
          totalImageScenes: scenes.length,
          pendingScenes: pendingScenes.length,
          alreadyCompleted: scenes.length - pendingScenes.length
        });
        
        return pendingScenes.map(s => ({ 
          sceneNumber: s.sceneNumber, 
          imageIndex: s.imageIndex 
        }));
      });

      const totalImageScenes = imageSceneNumbers.length;
      let completedImages = 0;
      const failedImageScenes: number[] = [];

      // Her görsel için ayrı step (timeout önlemek için tek tek)
      for (const sceneInfo of imageSceneNumbers) {
        const imageResult = await step.run(`generate-image-scene-${sceneInfo.sceneNumber}`, async () => {
          await dbConnect();
          
          const prompt = visualPromptsData[sceneInfo.sceneNumber];
          
          if (!prompt) {
            logger.warn('Görsel prompt bulunamadı', {
              storyId,
              sceneNumber: sceneInfo.sceneNumber
            });
            return { success: false, sceneNumber: sceneInfo.sceneNumber };
          }

          const MAX_RETRIES = 3;
          let lastError: Error | null = null;

          for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
            try {
              logger.info(`Görsel üretiliyor (Deneme ${attempt}/${MAX_RETRIES})`, {
                storyId,
                sceneNumber: sceneInfo.sceneNumber
              });

              // Görsel üret
              const image = await generateImage({
                prompt,
                model: storyData.imagefxModel as any,
                aspectRatio: storyData.imagefxAspectRatio as any,
                seed: storyData.imagefxSeed
              });

              if (!image || !image.imageBuffer || image.imageBuffer.length === 0) {
                throw new Error('Görsel üretimi boş veya null döndü');
              }

              // Blob'a yükle
              const uploaded = await uploadImage(
                storyId,
                sceneInfo.sceneNumber,
                image.imageBuffer,
                sceneInfo.imageIndex!
              );

              // Scene'i güncelle
              const updateResult = await Scene.findOneAndUpdate(
                { storyId: storyId, sceneNumber: sceneInfo.sceneNumber },
                { 
                  $set: {
                    'blobUrls.image': uploaded.url,
                    status: 'processing'
                  }
                },
                { new: true }
              );
              
              if (!updateResult) {
                logger.warn(`Scene güncellenemedi`, { storyId, sceneNumber: sceneInfo.sceneNumber });
              } else {
                logger.debug(`Scene güncellendi`, {
                  sceneNumber: sceneInfo.sceneNumber,
                  imageUrl: updateResult.blobUrls?.image
                });
              }

              logger.info(`Görsel başarıyla üretildi (Deneme ${attempt})`, {
                storyId,
                sceneNumber: sceneInfo.sceneNumber,
                url: uploaded.url
              });

              return { success: true, sceneNumber: sceneInfo.sceneNumber, url: uploaded.url };

            } catch (error) {
              lastError = error instanceof Error ? error : new Error('Bilinmeyen hata');
              
              logger.warn(`Görsel üretimi başarısız (Deneme ${attempt}/${MAX_RETRIES})`, {
                storyId,
                sceneNumber: sceneInfo.sceneNumber,
                error: lastError.message,
                attempt
              });

              if (attempt < MAX_RETRIES) {
                const waitTime = attempt * 2000;
                await new Promise(resolve => setTimeout(resolve, waitTime));
              }
            }
          }

          logger.error(`Görsel üretimi ${MAX_RETRIES} denemede de başarısız`, {
            storyId,
            sceneNumber: sceneInfo.sceneNumber,
            lastError: lastError?.message
          });

          return { success: false, sceneNumber: sceneInfo.sceneNumber };
        });

        if (imageResult.success) {
          completedImages++;
        } else {
          failedImageScenes.push(imageResult.sceneNumber);
        }

        // Progress güncelle (her görsel sonrası)
        const imageProgress = 65 + ((completedImages + failedImageScenes.length) / Math.max(totalImageScenes, 1)) * 15;
        await step.run(`update-image-progress-${sceneInfo.sceneNumber}`, async () => {
          await dbConnect();
          await updateProgress(
            Math.round(imageProgress),
            `Görseller üretiliyor (${completedImages}/${totalImageScenes})...`
          );
        });
      }

      // Başarısız görseller için FALLBACK retry (basitleştirilmiş prompt ile)
      if (failedImageScenes.length > 0) {
        logger.info('Başarısız görseller için fallback retry başlatılıyor', {
          storyId,
          failedCount: failedImageScenes.length,
          failedScenes: failedImageScenes
        });

        for (const failedSceneNumber of failedImageScenes) {
          await step.run(`retry-failed-image-${failedSceneNumber}`, async () => {
            await dbConnect();
            
            const scene = await Scene.findOne({ storyId, sceneNumber: failedSceneNumber });
            if (!scene) return { success: false, sceneNumber: failedSceneNumber };
            
            // Basitleştirilmiş generic prompt oluştur (insan içermeyen)
            const fallbackPrompt = `Ultra realistic landscape photograph, cinematic lighting, professional photography, 8k resolution, dramatic atmosphere, beautiful scenery, no people, no text, no watermarks. Scene mood: dramatic storytelling moment.`;
            
            try {
              logger.info(`Fallback görsel üretiliyor`, {
                storyId,
                sceneNumber: failedSceneNumber,
                promptType: 'fallback-generic'
              });

              const image = await generateImage({
                prompt: fallbackPrompt,
                model: storyData.imagefxModel as any,
                aspectRatio: storyData.imagefxAspectRatio as any,
                seed: storyData.imagefxSeed
              });

              if (image?.imageBuffer && image.imageBuffer.length > 0) {
                const uploaded = await uploadImage(
                  storyId,
                  failedSceneNumber,
                  image.imageBuffer,
                  scene.imageIndex || failedSceneNumber
                );

                await Scene.findOneAndUpdate(
                  { storyId, sceneNumber: failedSceneNumber },
                  { $set: { 'blobUrls.image': uploaded.url } }
                );

                logger.info(`Fallback görsel başarılı`, {
                  storyId,
                  sceneNumber: failedSceneNumber,
                  url: uploaded.url
                });
                
                completedImages++;
                return { success: true, sceneNumber: failedSceneNumber };
              }
            } catch (error) {
              logger.warn(`Fallback görsel de başarısız`, {
                storyId,
                sceneNumber: failedSceneNumber,
                error: error instanceof Error ? error.message : 'Bilinmeyen'
              });
            }
            
            return { success: false, sceneNumber: failedSceneNumber };
          });
        }
      }

      // Görsel üretimi özeti
      await step.run('finalize-images', async () => {
        await dbConnect();
        await updateProgress(80, 'Görseller tamamlandı');
        
        // Güncel başarısız sayısını hesapla
        const scenes = await Scene.find({ storyId, hasImage: true });
        const stillFailed = scenes.filter(s => !s.blobUrls?.image).map(s => s.sceneNumber);
        
        logger.info('Görseller üretildi', {
          storyId,
          completed: completedImages,
          failed: stillFailed.length,
          failedScenes: stillFailed.length > 0 ? stillFailed : undefined,
          total: totalImageScenes
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

      // Her sahne için ayrı step (timeout önlemek için tek tek)
      const totalScenes = audioSceneNumbers.length;
      
      for (let i = 0; i < totalScenes; i++) {
        const sceneNumber = audioSceneNumbers[i];
        
        await step.run(`generate-audio-scene-${sceneNumber}`, async () => {
          await dbConnect();
          
          try {
            // Sahneyi kontrol et (zaten işlenmiş olabilir)
            const scene = await Scene.findOne({ storyId, sceneNumber });
            if (!scene) {
              logger.warn(`Sahne ${sceneNumber} bulunamadı`);
              return;
            }
            
            if (scene.blobUrls?.audio) {
              logger.debug(`Sahne ${sceneNumber} zaten işlenmiş, atlanıyor`);
              return;
            }

            logger.info(`Sahne ${sceneNumber}/${totalScenes} seslendiriliyor...`, {
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

            // Scene'i güncelle - $set operatörü ile explicit update
            const audioUpdateResult = await Scene.findOneAndUpdate(
              { storyId, sceneNumber },
              {
                $set: {
                  'blobUrls.audio': uploaded.url,
                  actualDuration: audio.duration,
                  status: 'completed'
                }
              },
              { new: true }
            );

            if (!audioUpdateResult) {
              logger.warn(`Audio Scene güncellenemedi`, { storyId, sceneNumber });
            }

            logger.info(`Sahne ${sceneNumber} seslendirme tamamlandı`, {
              duration: audio.duration,
              provider: audio.provider,
              audioUrl: audioUpdateResult?.blobUrls?.audio
            });

          } catch (error) {
            logger.error(`Sahne ${sceneNumber} seslendirme hatası`, {
              error: error instanceof Error ? error.message : 'Bilinmeyen hata'
            });
            // Bu sahneyi atla, hata fırlatma (diğer sahneler devam etsin)
          }

          // Progress güncelle
          const audioProgress = 85 + ((i + 1) / totalScenes) * 10;
          await updateProgress(
            Math.round(audioProgress),
            `Seslendirme (${i + 1}/${totalScenes})...`
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
                { $set: { sceneTextTurkish: turkishText } }
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

      // --- 10. TAMAMLANDI (100%) ---
      await step.run('complete', async () => {
        await dbConnect();
        
        // İşleme süresini hesapla
        const processingEndTime = Date.now();
        const processingDuration = Math.round((processingEndTime - processingStartTime) / 1000); // Saniye
        
        // findByIdAndUpdate kullan
        await Story.findByIdAndUpdate(storyId, {
          status: 'completed',
          progress: 100,
          currentStep: 'İşlem tamamlandı!',
          processingCompletedAt: new Date(),
          processingDuration: processingDuration
        });

        // Süreyi okunabilir formata çevir
        const minutes = Math.floor(processingDuration / 60);
        const seconds = processingDuration % 60;
        const durationText = minutes > 0 ? `${minutes}dk ${seconds}sn` : `${seconds}sn`;

        logger.info('Hikaye işleme tamamlandı', { 
          storyId,
          processingDuration,
          durationText
        });
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
