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
import { translateStory, translateText } from '@/services/translation.service';
import { adaptStory, adaptText } from '@/services/adaptation.service';
import { generateScenes, generateVisualPrompts } from '@/services/scene.service';
import { generateYouTubeMetadata, generateThumbnailPrompt } from '@/services/metadata.service';
import { generateImage } from '@/services/imagefx.service';
import { generateSpeech } from '@/services/tts-router.service';
import { uploadImage, uploadAudio, uploadZip, uploadThumbnail } from '@/services/blob.service';
import { createZipArchive } from '@/services/zip.service';
import { getLLMConfig } from '@/services/llm-router.service';
import { addEngagementHooks, mergeHookWithSceneText } from '@/services/hook.service';
import { 
  processTimestampedTranscript, 
  applyAdaptedTextsToScenes,
  type TimestampedScene 
} from '@/services/transcript-parser.service';
import { batchTranslateAndAdaptScenes, batchAdaptScenes } from '@/services/batch-translate-adapt.service';
import { 
  batchTranscreateScenes, 
  transcreateTitle,
  getStyleById
} from '@/services/transcreation.service';
import type { TranscreationPresetId, TranscreationStyleId } from '@/types/transcreation.types';
import Settings from '@/models/Settings';
import VisualStyle from '@/models/VisualStyle';
import PromptScenario from '@/models/PromptScenario';
import { IMAGE_SETTINGS } from '@/lib/constants';

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
          translationOnly: story.translationOnly || false,
          enableHooks: story.enableHooks || false,
          // Zaman Damgalı İçerik Modu
          useTimestampedContent: story.useTimestampedContent || false,
          timestampedContent: story.timestampedContent || undefined,
          totalOriginalDuration: story.totalOriginalDuration || undefined,
          // Transcreation (Yeniden Yazım) Modu
          useTranscreation: story.useTranscreation || false,
          transcreationPreset: story.transcreationPreset || 'medium',
          transcreationStyle: story.transcreationStyle || 'storyteller',
          skipAdaptation: story.skipAdaptation || false,
          targetCharacterCount: story.targetCharacterCount || undefined,
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
          imagefxSeed: story.imagefxSeed,
          // Visual Style
          visualStyleId: story.visualStyleId?.toString() || undefined,
          // Prompt Scenario
          promptScenarioId: story.promptScenarioId?.toString() || undefined
        };
      });

      // --- 2. ÇEVİRİ (20%) ---
      // Zaman damgalı modda farklı işlem yapılır
      let translationData: {
        adaptedTitle: string;
        adaptedContent: string;
        originalLength: number;
        translatedLength: number;
        timestampedScenes?: TimestampedScene[];
      };

      if (storyData.useTimestampedContent && storyData.timestampedContent) {
        // --- ZAMAN DAMGALI MOD ---
        
        // Transcreation modu aktifse farklı işlem yap
        if (storyData.useTranscreation) {
          // --- TRANSCREATION MODU: Akıcı Yeniden Yazım (%5 tolerans) ---
          // NOT: batchTranslateAndAdaptScenes ile aynı basit yapı kullanılıyor
          translationData = await step.run('transcreate-timestamped-batch', async () => {
            await dbConnect();
            await updateProgress(10, 'Transcreation: Zaman damgalı transkript işleniyor...');

            logger.info('transcreate-timestamped-batch başladı', {
              storyId,
              contentLength: storyData.timestampedContent?.length || 0,
              originalLanguage: storyData.originalLanguage,
              targetLanguage: storyData.targetLanguage,
              transcreationPreset: storyData.transcreationPreset,
              transcreationStyle: storyData.transcreationStyle,
              llmModel: storyData.llmModel,
              llmProvider: storyData.llmProvider
            });

            // 1. Transkripti parse et ve sahnelere ayır
            const parsedTranscript = processTimestampedTranscript(storyData.timestampedContent!);
            
            // Boş sahne kontrolü
            if (parsedTranscript.scenes.length === 0) {
              logger.error('transcreate-timestamped-batch: Transkriptten sahne üretilemedi', { storyId });
              throw new Error('Transkriptten sahne üretilemedi. Format kontrol edin.');
            }
            
            logger.info('Transkript parse edildi (Transcreation)', {
              storyId,
              totalSegments: parsedTranscript.totalSegments,
              totalScenes: parsedTranscript.totalScenes,
              totalDuration: parsedTranscript.totalDuration
            });

            // Orijinal toplam karakter sayısını kaydet
            const originalLength = parsedTranscript.scenes.reduce((sum, s) => sum + s.text.length, 0);

            await updateProgress(15, `${parsedTranscript.totalScenes} sahne transcreation yapılıyor...`);

            // 2. Transcreation: Basit batch işlemi (batchTranslateAndAdaptScenes gibi)
            // NOT: skipAdaptation = true ise kültürel adaptasyon UYGULANIR (UI'da "Kültürel adaptasyon da uygula" checkbox'ı)
            const batchResult = await batchTranscreateScenes({
              scenes: parsedTranscript.scenes,
              sourceLang: storyData.originalLanguage,
              targetLang: storyData.targetLanguage,
              presetId: (storyData.transcreationPreset || 'medium') as TranscreationPresetId,
              styleId: (storyData.transcreationStyle || 'storyteller') as TranscreationStyleId,
              model: storyData.llmModel,
              provider: storyData.llmProvider,
              applyCulturalAdaptation: storyData.skipAdaptation, // UI checkbox: "Kültürel adaptasyon da uygula"
              targetCharacterCount: storyData.targetCharacterCount // Hedef karakter sayısı (opsiyonel)
            });

            // 3. Başlığı transcreate et
            const style = getStyleById((storyData.transcreationStyle || 'storyteller') as TranscreationStyleId);
            const transcreatedTitle = await transcreateTitle(
              storyData.originalTitle,
              storyData.originalLanguage,
              storyData.targetLanguage,
              style,
              storyData.llmModel,
              storyData.llmProvider
            );

            // 4. Sonuçları hesapla (batchResult.scenes zaten textAdapted dolu)
            const translatedContent = batchResult.scenes.map(s => s.textAdapted || s.text).join('\n\n');
            const translatedLength = batchResult.validation.actualCharacterCount;

            // Süre kontrolü logu
            const ratio = translatedLength / originalLength;
            logger.info('Transcreation tamamlandı', {
              storyId,
              scenesProcessed: batchResult.scenes.length,
              originalLength,
              translatedLength,
              ratio: `${(ratio * 100).toFixed(1)}%`,
              targetCharacterCount: storyData.targetCharacterCount || 'yok',
              isWithinTarget: batchResult.validation.isWithinTarget
            });

            // DB güncelle (targetCharacterCountAchieved dahil)
            await Story.findByIdAndUpdate(storyId, {
              adaptedTitle: transcreatedTitle,
              adaptedContent: translatedContent,
              originalContentLength: originalLength,
              translatedContentLength: translatedLength,
              targetCharacterCountAchieved: batchResult.validation.isWithinTarget
            });

            await updateProgress(20, 'Transcreation tamamlandı');

            return {
              adaptedTitle: transcreatedTitle,
              adaptedContent: translatedContent,
              originalLength,
              translatedLength,
              timestampedScenes: batchResult.scenes,
              targetCharacterCountAchieved: batchResult.validation.isWithinTarget
            };
          });
        } else {
          // --- STANDART ZAMAN DAMGALI MOD: Batch Çeviri ---
          translationData = await step.run('translate-timestamped-batch', async () => {
            await dbConnect();
            await updateProgress(10, 'Zaman damgalı transkript işleniyor...');

            logger.info('translate-timestamped-batch başladı', {
              storyId,
              contentLength: storyData.timestampedContent?.length || 0,
              originalLanguage: storyData.originalLanguage,
              targetLanguage: storyData.targetLanguage,
              targetCountry: storyData.targetCountry,
              llmModel: storyData.llmModel,
              llmProvider: storyData.llmProvider
            });

            // 1. Transkripti parse et ve sahnelere ayır
            const parsedTranscript = processTimestampedTranscript(storyData.timestampedContent!);
            
            // Boş sahne kontrolü
            if (parsedTranscript.scenes.length === 0) {
              logger.error('translate-timestamped-batch: Transkriptten sahne üretilemedi', { storyId });
              throw new Error('Transkriptten sahne üretilemedi. Format kontrol edin.');
            }
            
            logger.info('Transkript parse edildi', {
              storyId,
              totalSegments: parsedTranscript.totalSegments,
              totalScenes: parsedTranscript.totalScenes,
              totalDuration: parsedTranscript.totalDuration
            });

            await updateProgress(15, `${parsedTranscript.totalScenes} sahne batch çeviri yapılıyor...`);

            // 2. Batch çeviri (sadece çeviri, adaptasyon sonra)
            const batchResult = await batchTranslateAndAdaptScenes(
              parsedTranscript.scenes,
              storyData.originalTitle,
              storyData.originalLanguage,
              storyData.targetLanguage,
              storyData.targetCountry,
              storyData.llmModel,
              storyData.llmProvider,
              true // translationOnly = true (sadece çeviri)
            );

            // 3. Sonuçları hesapla
            const translatedContent = batchResult.scenes.map(s => s.textAdapted).join('\n\n');
            const originalLength = parsedTranscript.scenes.reduce((sum, s) => sum + s.text.length, 0);
            const translatedLength = translatedContent.length;

            // DB güncelle
            await Story.findByIdAndUpdate(storyId, {
              adaptedTitle: batchResult.title,
              adaptedContent: translatedContent,
              originalContentLength: originalLength,
              translatedContentLength: translatedLength
            });

            await updateProgress(20, 'Zaman damgalı batch çeviri tamamlandı');

            logger.info('Zaman damgalı batch çeviri tamamlandı', {
              storyId,
              scenesTranslated: batchResult.scenes.length,
              originalLength,
              translatedLength
            });

            return {
              adaptedTitle: batchResult.title,
              adaptedContent: translatedContent,
              originalLength,
              translatedLength,
              timestampedScenes: batchResult.scenes
            };
          });
        }
      } else {
        // --- STANDART MOD: Mevcut çeviri akışı ---
        translationData = await step.run('translate-story', async () => {
          await dbConnect();
          await updateProgress(10, 'Hikaye çevriliyor...');

          // Prompt senaryosunu yükle (varsa)
          let promptScenario = null;
          if (storyData.promptScenarioId) {
            promptScenario = await PromptScenario.findById(storyData.promptScenarioId);
            if (promptScenario) {
              logger.info('Çeviri için prompt senaryosu yüklendi', {
                storyId,
                scenarioName: promptScenario.name
              });
            }
          }

          const result = await translateStory({
            content: storyData.originalContent,
            title: storyData.originalTitle,
            sourceLang: storyData.originalLanguage,
            targetLang: storyData.targetLanguage,
            model: storyData.llmModel,
            provider: storyData.llmProvider,
            promptScenario: promptScenario ? {
              translationSystemPrompt: promptScenario.translationSystemPrompt,
              translationUserPrompt: promptScenario.translationUserPrompt,
              titleTranslationSystemPrompt: promptScenario.titleTranslationSystemPrompt,
              titleTranslationUserPrompt: promptScenario.titleTranslationUserPrompt
            } : null
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

          // findByIdAndUpdate kullan - karakter sayılarını da kaydet
          await Story.findByIdAndUpdate(storyId, {
            adaptedTitle: result.title,
            adaptedContent: result.content,
            originalContentLength: result.originalLength,
            translatedContentLength: result.translatedLength
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
            originalLength: result.originalLength,
            translatedLength: result.translatedLength
          };
        });
      }

      // --- 3. KÜLTÜREL UYARLAMA (30%) ---
      let adaptationData: {
        adaptedTitle: string;
        adaptedContent: string;
        adaptationNotes: string[];
        adaptedLength: number;
        timestampedScenes?: TimestampedScene[];
      };

      if (storyData.useTimestampedContent && translationData.timestampedScenes && translationData.timestampedScenes.length > 0) {
        // --- ZAMAN DAMGALI MOD: Batch Adaptasyon ---
        adaptationData = await step.run('adapt-timestamped-batch', async () => {
          await dbConnect();
          
          logger.info('adapt-timestamped-batch başladı', {
            storyId,
            sceneCount: translationData.timestampedScenes?.length || 0,
            translationOnly: storyData.translationOnly,
            useTranscreation: storyData.useTranscreation,
            skipAdaptation: storyData.skipAdaptation
          });
          
          // Adaptasyon atlama koşulları:
          // 1. translationOnly modu aktif
          // 2. Transcreation modu aktif VE skipAdaptation true
          const shouldSkipAdaptation = storyData.translationOnly || 
            (storyData.useTranscreation && storyData.skipAdaptation);
          
          if (shouldSkipAdaptation) {
            const skipReason = storyData.translationOnly 
              ? 'Sadece çeviri modu' 
              : 'Transcreation modu - adaptasyon atlandı';
            
            await updateProgress(30, `${skipReason}...`);

            logger.info('Zaman damgalı - adaptasyon atlanıyor', {
              storyId,
              reason: skipReason,
              translationOnly: storyData.translationOnly,
              useTranscreation: storyData.useTranscreation,
              skipAdaptation: storyData.skipAdaptation
            });

            await Story.findByIdAndUpdate(storyId, {
              adaptedContentLength: translationData.translatedLength
            });

            return {
              adaptedTitle: translationData.adaptedTitle,
              adaptedContent: translationData.adaptedContent,
              adaptationNotes: [] as string[],
              adaptedLength: translationData.translatedLength,
              timestampedScenes: translationData.timestampedScenes
            };
          }

          await updateProgress(25, `${translationData.timestampedScenes!.length} sahne batch adaptasyon yapılıyor...`);

          logger.info('adapt-timestamped-batch: Adaptasyon başlıyor', {
            storyId,
            sceneCount: translationData.timestampedScenes!.length,
            targetLanguage: storyData.targetLanguage,
            targetCountry: storyData.targetCountry,
            useTranscreation: storyData.useTranscreation
          });

          // Batch adaptasyon (sadece adaptasyon, çeviri yok - zaten çevrilmiş)
          const batchResult = await batchAdaptScenes({
            scenes: translationData.timestampedScenes!,
            title: translationData.adaptedTitle,
            targetCountry: storyData.targetCountry,
            targetLang: storyData.targetLanguage,
            model: storyData.llmModel,
            provider: storyData.llmProvider
          });

          const adaptedContent = batchResult.scenes.map(s => s.textAdapted).join('\n\n');
          const adaptedLength = adaptedContent.length;

          // DB güncelle
          await Story.findByIdAndUpdate(storyId, {
            adaptedTitle: batchResult.title,
            adaptedContent,
            adaptedContentLength: adaptedLength
          });

          await updateProgress(30, 'Zaman damgalı batch adaptasyon tamamlandı');

          logger.info('Zaman damgalı batch adaptasyon tamamlandı', {
            storyId,
            scenesAdapted: batchResult.scenes.length,
            adaptedLength
          });

          return {
            adaptedTitle: batchResult.title,
            adaptedContent,
            adaptationNotes: [] as string[],
            adaptedLength,
            timestampedScenes: batchResult.scenes
          };
        });
      } else {
        // --- STANDART MOD: Mevcut adaptasyon akışı ---
        adaptationData = await step.run('adapt-story', async () => {
          await dbConnect();
          
          // translationOnly modunda adaptasyon ATLANIYOR
          if (storyData.translationOnly) {
            await updateProgress(30, 'Sadece çeviri modu - adaptasyon atlanıyor...');

            logger.info('Sadece çeviri modu - kültürel adaptasyon atlanıyor', {
              storyId,
              translationOnly: true
            });

            // translationOnly modunda adaptedContentLength = translatedContentLength
            await Story.findByIdAndUpdate(storyId, {
              adaptedContentLength: translationData.translatedLength
            });

            return {
              adaptedTitle: translationData.adaptedTitle,
              adaptedContent: translationData.adaptedContent,
              adaptationNotes: [] as string[],
              adaptedLength: translationData.translatedLength
            };
          }
          
          await updateProgress(25, 'Kültürel adaptasyon yapılıyor...');

          // Prompt senaryosunu yükle (varsa)
          let promptScenario = null;
          if (storyData.promptScenarioId) {
            promptScenario = await PromptScenario.findById(storyData.promptScenarioId);
            if (promptScenario) {
              logger.info('Adaptasyon için prompt senaryosu yüklendi', {
                storyId,
                scenarioName: promptScenario.name
              });
            }
          }

          const result = await adaptStory({
            content: translationData.adaptedContent,
            title: translationData.adaptedTitle,
            targetCountry: storyData.targetCountry,
            targetLanguage: storyData.targetLanguage,
            model: storyData.openaiModel,
            promptScenario: promptScenario ? {
              adaptationSystemPrompt: promptScenario.adaptationSystemPrompt,
              adaptationUserPrompt: promptScenario.adaptationUserPrompt,
              titleAdaptationSystemPrompt: promptScenario.titleAdaptationSystemPrompt,
              titleAdaptationUserPrompt: promptScenario.titleAdaptationUserPrompt
            } : null
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

          // findByIdAndUpdate kullan - karakter sayısını da kaydet
          await Story.findByIdAndUpdate(storyId, {
            adaptedTitle: result.title,
            adaptedContent: result.content,
            adaptedContentLength: result.adaptedLength
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
            adaptationNotes: result.adaptations,
            adaptedLength: result.adaptedLength
          };
        });
      }

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

        // Prompt senaryosunu yükle (varsa)
        let promptScenario = null;
        if (storyData.promptScenarioId) {
          promptScenario = await PromptScenario.findById(storyData.promptScenarioId);
          if (promptScenario) {
            logger.info('Metadata için prompt senaryosu yüklendi', {
              storyId,
              scenarioName: promptScenario.name
            });
          }
        }

        const result = await generateYouTubeMetadata({
          adaptedTitle: adaptationData.adaptedTitle,
          adaptedContent: adaptationData.adaptedContent,
          originalDescription: story.originalYoutubeDescription,
          originalCoverText: story.originalCoverText,
          targetLanguage: story.targetLanguage,
          targetCountry: story.targetCountry,
          model,
          provider,
          adaptationNotes: adaptationData.adaptationNotes || [],
          promptScenario: promptScenario ? {
            youtubeDescriptionSystemPrompt: promptScenario.youtubeDescriptionSystemPrompt,
            youtubeDescriptionUserPrompt: promptScenario.youtubeDescriptionUserPrompt,
            coverTextSystemPrompt: promptScenario.coverTextSystemPrompt,
            coverTextUserPrompt: promptScenario.coverTextUserPrompt
          } : null
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

      // --- 3.6. YOUTUBE THUMBNAIL (KAPAK GÖRSELİ) OLUŞTURMA (34%) ---
      await step.run('generate-thumbnail', async () => {
        await dbConnect();
        await updateProgress(34, 'Kapak görseli oluşturuluyor...');

        const story = await getStory();
        
        // Settings'den LLM ve ImageFX ayarlarını al
        const settings = await Settings.findOne({ userId: story.userId });
        if (!settings) {
          throw new Error('Kullanıcı ayarları bulunamadı');
        }

        const { provider, model } = getLLMConfig(settings);

        // Visual Style'ı yükle (varsa) - Kapak görseli için
        let visualStyle = null;
        if (storyData.visualStyleId) {
          visualStyle = await VisualStyle.findById(storyData.visualStyleId);
          if (visualStyle) {
            logger.info('Thumbnail için Visual Style yüklendi', {
              storyId,
              styleName: visualStyle.name
            });
          }
        }

        try {
          // 1. Thumbnail için prompt oluştur (görsel stili ile)
          const thumbnailPrompt = await generateThumbnailPrompt({
            adaptedTitle: adaptationData.adaptedTitle,
            adaptedContent: adaptationData.adaptedContent,
            coverText: metadataData?.coverText || adaptationData.adaptedTitle,
            targetLanguage: story.targetLanguage,
            model,
            provider,
            visualStyle: visualStyle ? {
              name: visualStyle.name,
              description: visualStyle.description,
              systemPrompt: visualStyle.systemPrompt,
              technicalPrefix: visualStyle.technicalPrefix,
              styleSuffix: visualStyle.styleSuffix
            } : null
          });

          logger.info('Thumbnail prompt oluşturuldu', {
            storyId,
            promptLength: thumbnailPrompt.length
          });

          // 2. ImageFX ile görsel üret (16:9 landscape)
          const imagefxModel = (story.imagefxModel === 'IMAGEN_4' || story.imagefxModel === 'IMAGEN_3_5') 
            ? story.imagefxModel 
            : 'IMAGEN_4';
            
          const imageResult = await generateImage({
            prompt: thumbnailPrompt,
            model: imagefxModel,
            aspectRatio: 'LANDSCAPE', // 16:9 YouTube thumbnail
            seed: story.imagefxSeed || Math.floor(Math.random() * 1000000)
          });

          logger.info('Thumbnail görseli üretildi', {
            storyId,
            imageSize: imageResult.imageBuffer.length
          });

          // 3. Blob'a yükle
          const uploaded = await uploadThumbnail(storyId, imageResult.imageBuffer);

          // 4. Story'ye kaydet
          await Story.findByIdAndUpdate(storyId, {
            'blobUrls.thumbnail': uploaded.url
          });

          logger.info('Thumbnail kaydedildi', {
            storyId,
            thumbnailUrl: uploaded.url
          });

          return { thumbnailUrl: uploaded.url };
        } catch (error) {
          // Thumbnail hatası kritik değil, devam et
          logger.warn('Thumbnail oluşturulamadı, devam ediliyor', {
            storyId,
            error: error instanceof Error ? error.message : 'Bilinmeyen hata'
          });
          return null;
        }
      });

      // --- 4. SAHNE OLUŞTURMA (50%) ---
      let scenesData: Array<{
        sceneNumber: number;
        text: string;
        hasImage: boolean;
        imageIndex?: number;
        visualDescription?: string;
        isFirstThreeMinutes: boolean;
        estimatedDuration: number;
        originalStartTime?: number;
        originalEndTime?: number;
        originalDuration?: number;
      }>;

      if (storyData.useTimestampedContent && adaptationData.timestampedScenes && adaptationData.timestampedScenes.length > 0) {
        // --- ZAMAN DAMGALI MOD: Önceden parse edilmiş sahneleri kullan ---
        scenesData = await step.run('create-timestamped-scenes', async () => {
          await dbConnect();
          await updateProgress(35, 'Zaman damgalı sahneler kaydediliyor...');

          const timestampedScenes = adaptationData.timestampedScenes!;
          
          logger.info('create-timestamped-scenes başladı', {
            storyId,
            sceneCount: timestampedScenes.length
          });

          // Sahneleri MongoDB'ye kaydet
          const scenePromises = timestampedScenes.map(sceneData =>
            Scene.create({
              storyId: storyId,
              sceneNumber: sceneData.sceneNumber,
              sceneTextOriginal: sceneData.text,
              sceneTextAdapted: sceneData.textAdapted,
              hasImage: sceneData.hasImage,
              imageIndex: sceneData.imageIndex,
              visualDescription: sceneData.visualDescription,
              isFirstThreeMinutes: sceneData.isFirstThreeMinutes,
              estimatedDuration: sceneData.estimatedDuration,
              // Zaman damgalı özel alanlar
              originalStartTime: sceneData.originalStartTime,
              originalEndTime: sceneData.originalEndTime,
              originalDuration: sceneData.originalDuration,
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
          
          const totalImages = timestampedScenes.filter(s => s.hasImage).length;
          const firstThreeMinutesScenes = timestampedScenes.filter(s => s.isFirstThreeMinutes).length;
          
          // findByIdAndUpdate kullan
          await Story.findByIdAndUpdate(storyId, {
            totalScenes: timestampedScenes.length,
            totalImages,
            firstMinuteImages: firstThreeMinutesScenes,
            scenes: scenes.map(s => s._id)
          });

          await updateProgress(50, 'Zaman damgalı sahneler oluşturuldu');

          logger.info('Zaman damgalı sahneler oluşturuldu', {
            storyId,
            totalScenes: timestampedScenes.length,
            totalImages,
            totalDuration: storyData.totalOriginalDuration,
            textCoverageRatio: '100%' // Zaman damgalı modda %100 kapsam
          });

          // Plain array olarak dön
          return timestampedScenes.map(s => ({
            sceneNumber: s.sceneNumber,
            text: s.textAdapted || s.text,
            hasImage: s.hasImage,
            imageIndex: s.imageIndex,
            visualDescription: s.visualDescription,
            isFirstThreeMinutes: s.isFirstThreeMinutes,
            estimatedDuration: s.estimatedDuration,
            originalStartTime: s.originalStartTime,
            originalEndTime: s.originalEndTime,
            originalDuration: s.originalDuration
          }));
        });
      } else {
        // --- STANDART MOD: Mevcut sahne oluşturma akışı ---
        scenesData = await step.run('generate-scenes', async () => {
          await dbConnect();
          await updateProgress(35, 'Sahneler oluşturuluyor...');

          // Prompt senaryosunu yükle (varsa)
          let promptScenario = null;
          if (storyData.promptScenarioId) {
            promptScenario = await PromptScenario.findById(storyData.promptScenarioId);
            if (promptScenario) {
              logger.info('Sahne oluşturma için prompt senaryosu yüklendi', {
                storyId,
                scenarioName: promptScenario.name
              });
            }
          }

          const result = await generateScenes({
            originalContent: storyData.originalContent,
            adaptedContent: adaptationData.adaptedContent,
            model: storyData.llmModel,
            provider: storyData.llmProvider,
            promptScenario: promptScenario ? {
              sceneFirstThreeSystemPrompt: promptScenario.sceneFirstThreeSystemPrompt,
              sceneFirstThreeUserPrompt: promptScenario.sceneFirstThreeUserPrompt,
              sceneRemainingSystemPrompt: promptScenario.sceneRemainingSystemPrompt,
              sceneRemainingUserPrompt: promptScenario.sceneRemainingUserPrompt
            } : null
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
      }

      // --- 4.5. ENGAGEMENT HOOKS (52%) ---
      const scenesWithHooksData = await step.run('add-engagement-hooks', async () => {
        await dbConnect();
        
        // enableHooks kapalıysa hook ekleme adımını atla
        if (!storyData.enableHooks) {
          logger.info('Hook sistemi devre dışı, atlaniyor', { storyId });
          return scenesData;
        }
        
        await updateProgress(52, 'Engagement hook\'ları ekleniyor...');
        
        try {
          const scenesWithHooks = await addEngagementHooks(scenesData, {
            storyContext: adaptationData.adaptedContent,
            targetLanguage: storyData.targetLanguage,
            model: storyData.llmModel,
            provider: storyData.llmProvider,
            sceneCount: scenesData.length
          });
          
          // Hook'ları Scene modellerine kaydet
          for (const scene of scenesWithHooks) {
            if (scene.hook) {
              await Scene.findOneAndUpdate(
                { storyId: storyId, sceneNumber: scene.sceneNumber },
                { $set: { hook: scene.hook } }
              );
            }
          }
          
          const hooksAdded = scenesWithHooks.filter(s => s.hook).length;
          logger.info('Engagement hook\'ları eklendi', {
            storyId,
            totalHooks: hooksAdded,
            hookTypes: scenesWithHooks
              .filter(s => s.hook)
              .map(s => ({ scene: s.sceneNumber, hookType: s.hook?.hookType }))
          });
          
          return scenesWithHooks.map(s => ({
            sceneNumber: s.sceneNumber,
            text: s.text,
            hasImage: s.hasImage,
            imageIndex: s.imageIndex,
            visualDescription: s.visualDescription,
            isFirstThreeMinutes: s.isFirstThreeMinutes,
            estimatedDuration: s.estimatedDuration,
            hook: s.hook
          }));
        } catch (error) {
          // Hook ekleme hatası kritik değil, devam et
          logger.warn('Hook ekleme başarısız, sahneler hook\'suz devam ediyor', {
            storyId,
            error: error instanceof Error ? error.message : 'Bilinmeyen hata'
          });
          return scenesData;
        }
      });

      // --- 5. GÖRSEL PROMPTLARI (60%) ---
      const visualPromptsData = await step.run('generate-visual-prompts', async () => {
        await dbConnect();
        await updateProgress(55, 'Görsel promptları hazırlanıyor...');

        const storyContext = `${adaptationData.adaptedTitle}\n\n${adaptationData.adaptedContent?.substring(0, 1000)}`;

        // Visual Style'ı yükle (varsa)
        let visualStyle = null;
        if (storyData.visualStyleId) {
          visualStyle = await VisualStyle.findById(storyData.visualStyleId);
          if (visualStyle) {
            logger.info('Visual Style yüklendi', {
              storyId,
              styleName: visualStyle.name,
              styleId: visualStyle._id
            });
          }
        }

        // Prompt senaryosunu yükle (varsa)
        let promptScenario = null;
        if (storyData.promptScenarioId) {
          promptScenario = await PromptScenario.findById(storyData.promptScenarioId);
          if (promptScenario) {
            logger.info('Görsel prompt için senaryo yüklendi', {
              storyId,
              scenarioName: promptScenario.name
            });
          }
        }

        // Type assertion - Inngest serialize ettiği için tip bilgisi kayboluyor
        const scenesTyped = scenesWithHooksData as Array<{
          sceneNumber: number;
          text: string;
          hasImage: boolean;
          imageIndex?: number;
          visualDescription?: string;
          isFirstThreeMinutes: boolean;
          estimatedDuration: number;
          hook?: {
            hookType: 'intro' | 'subscribe' | 'like' | 'comment' | 'outro';
            text: string;
            position: 'before' | 'after';
          };
        }>;

        const prompts = await generateVisualPrompts(
          scenesTyped,
          storyContext,
          storyData.llmModel,
          storyData.llmProvider,
          visualStyle,
          promptScenario ? {
            visualPromptSystemPrompt: promptScenario.visualPromptSystemPrompt,
            visualPromptUserPrompt: promptScenario.visualPromptUserPrompt
          } : null
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

            // Hook varsa sahne metnine dahil et
            let textForTTS = scene.sceneTextAdapted;
            if (scene.hook?.text) {
              textForTTS = mergeHookWithSceneText(scene.sceneTextAdapted, scene.hook);
              logger.debug(`Sahne ${sceneNumber} için hook eklendi`, {
                hookType: scene.hook.hookType,
                hookPosition: scene.hook.position
              });
            }

            logger.info(`Sahne ${sceneNumber}/${totalScenes} seslendiriliyor...`, {
              textLength: textForTTS.length,
              originalLength: scene.sceneTextAdapted.length,
              hasHook: !!scene.hook,
              provider: ttsSettings.ttsProvider
            });

            // TTS Router ile ses üret
            const audio = await generateSpeech({
              text: textForTTS,
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
      const audioFinalResult = await step.run('finalize-audio', async () => {
        await dbConnect();

        try {
          const scenes = await Scene.find({ storyId }).select('actualDuration blobUrls').lean();
          
          if (!scenes || scenes.length === 0) {
            logger.warn('finalize-audio: Sahne bulunamadı', { storyId });
            return { totalDuration: 0, completedAudios: 0, total: 0 };
          }

          let totalDuration = 0;
          let completedAudios = 0;

          for (const scene of scenes) {
            if (scene.actualDuration && typeof scene.actualDuration === 'number') {
              totalDuration += scene.actualDuration;
            }
            if (scene.blobUrls && scene.blobUrls.audio) {
              completedAudios++;
            }
          }

          // Story güncelle
          await Story.findByIdAndUpdate(storyId, { 
            actualDuration: totalDuration 
          });

          logger.info('Seslendirmeler tamamlandı', {
            storyId,
            completed: completedAudios,
            total: scenes.length,
            totalDuration: Math.round(totalDuration * 100) / 100
          });

          return { 
            totalDuration: Math.round(totalDuration * 100) / 100, 
            completedAudios, 
            total: scenes.length 
          };
        } catch (innerError) {
          logger.error('finalize-audio iç hata', {
            storyId,
            error: innerError instanceof Error ? innerError.message : 'Bilinmeyen hata'
          });
          // Hata olsa bile işleme devam etsin
          return { totalDuration: 0, completedAudios: 0, total: 0 };
        }
      });

      // Progress güncelle (step dışında)
      await updateProgress(95, 'Seslendirme tamamlandı');
      
      logger.info('finalize-audio sonuç', { storyId, result: audioFinalResult });

      // --- 8. TÜRKÇE ÇEVİRİ (96%) ---
      // Eğer hedef dil Türkçe değilse, sahneleri Türkçe'ye çevir
      if (storyData.targetLanguage !== 'tr') {
        // Önce sahne numaralarını al
        const turkishSceneNumbers = await step.run('prepare-turkish-translations', async () => {
          try {
            await dbConnect();
            await updateProgress(95, 'Türkçe çeviri hazırlanıyor...');
            
            const scenes = await Scene.find({ storyId: storyId }).sort({ sceneNumber: 1 }).lean();
            
            if (!scenes || scenes.length === 0) {
              logger.warn('prepare-turkish-translations: Sahne bulunamadı', { storyId });
              return [];
            }
            
            const sceneNumbers = scenes.map(s => s.sceneNumber).filter(n => n !== undefined && n !== null);
            logger.info('prepare-turkish-translations: Sahne numaraları alındı', { 
              storyId, 
              count: sceneNumbers.length 
            });
            
            return sceneNumbers;
          } catch (error) {
            logger.error('prepare-turkish-translations hatası', {
              storyId,
              error: error instanceof Error ? error.message : 'Bilinmeyen hata'
            });
            return [];
          }
        });

        // Null/undefined kontrolü
        const sceneNumbersToTranslate = turkishSceneNumbers || [];
        
        if (sceneNumbersToTranslate.length === 0) {
          logger.warn('Türkçe çeviri atlandı: Sahne numarası bulunamadı', { storyId });
        }

        // Her sahne için ayrı step (Vercel timeout'unu önle)
        let completedTurkish = 0;
        for (const sceneNumber of sceneNumbersToTranslate) {
          await step.run(`translate-turkish-scene-${sceneNumber}`, async () => {
            await dbConnect();
            
            const { translateText } = await import('@/services/translation.service');
            const scene = await Scene.findOne({ storyId: storyId, sceneNumber });
            
            if (!scene) {
              logger.warn('Türkçe çeviri: Sahne bulunamadı', { storyId, sceneNumber });
              return;
            }

            try {
              const turkishText = await translateText(
                scene.sceneTextAdapted,
                storyData.targetLanguage,
                'tr',
                storyData.openaiModel
              );

              await Scene.findOneAndUpdate(
                { storyId: storyId, sceneNumber: sceneNumber },
                { $set: { sceneTextTurkish: turkishText } }
              );

              logger.info('Türkçe çeviri tamamlandı', { storyId, sceneNumber });
            } catch (error) {
              logger.warn('Türkçe çeviri başarısız', {
                storyId,
                sceneNumber,
                error: error instanceof Error ? error.message : 'Bilinmeyen hata'
              });
              // Devam et, kritik değil
            }
          });

          completedTurkish++;
          if (sceneNumbersToTranslate.length > 0) {
            const translationProgress = 95 + (completedTurkish / sceneNumbersToTranslate.length) * 2;
            await updateProgress(
              Math.round(translationProgress),
              `Türkçe çeviri (${completedTurkish}/${sceneNumbersToTranslate.length})...`
            );
          }
        }

        logger.info('Tüm Türkçe çeviriler tamamlandı', {
          storyId,
          total: sceneNumbersToTranslate.length
        });
      }

      // --- 9. ZIP OLUŞTUR (98%) ---
      await step.run('create-zip', async () => {
        try {
          await dbConnect();
          await updateProgress(97, 'ZIP dosyası oluşturuluyor...');

          const fullStory = await Story.findById(storyId).populate('scenes');
          if (!fullStory) {
            logger.warn('ZIP oluşturma: Hikaye bulunamadı', { storyId });
            return { success: false, error: 'Hikaye bulunamadı' };
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
          
          return { success: true, url: uploaded.url };
        } catch (error) {
          logger.error('ZIP oluşturma hatası', {
            storyId,
            error: error instanceof Error ? error.message : 'Bilinmeyen hata'
          });
          // ZIP oluşturulamazsa bile devam et - kritik değil
          return { success: false, error: error instanceof Error ? error.message : 'Bilinmeyen hata' };
        }
      });

      // --- 10. TAMAMLANDI (100%) ---
      const completeResult = await step.run('complete', async () => {
        // Fresh connection ile başla
        const { dbConnectFresh } = await import('@/lib/mongodb');
        await dbConnectFresh();

        // Story'den gerçek başlangıç zamanını al
        const story = await Story.findById(storyId).lean();
        if (!story) {
          logger.error('Complete: Story bulunamadı', { storyId });
          return { success: false, error: 'Story bulunamadı', duration: 0 };
        }

        // İşleme süresini hesapla - DB'deki gerçek başlangıç zamanından
        const processingEndTime = new Date();
        let processingDuration = 0;
        
        if (story.processingStartedAt) {
          const startTime = new Date(story.processingStartedAt).getTime();
          processingDuration = Math.round((processingEndTime.getTime() - startTime) / 1000); // Saniye
        }

        // Süreyi okunabilir formata çevir
        const minutes = Math.floor(processingDuration / 60);
        const seconds = processingDuration % 60;
        const durationText = minutes > 0 ? `${minutes}dk ${seconds}sn` : `${seconds}sn`;

        logger.info('Complete: Süre hesaplandı', {
          storyId,
          processingStartedAt: story.processingStartedAt,
          processingEndTime: processingEndTime.toISOString(),
          processingDuration,
          durationText
        });

        // Retry mekanizması ile güncelleme
        const maxRetries = 5;
        let lastErrorMessage = '';
        let updateVerified = false;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
          try {
            // Her denemede fresh connection kullan
            await dbConnectFresh();

            logger.info('Complete: Güncelleme deneniyor', { 
              storyId, 
              attempt, 
              maxRetries 
            });

            // updateOne kullan - daha düşük seviye, daha güvenilir
            const updateResult = await Story.updateOne(
              { _id: storyId },
              {
                $set: {
                  status: 'completed',
                  progress: 100,
                  currentStep: 'İşlem tamamlandı!',
                  processingCompletedAt: processingEndTime,
                  processingDuration: processingDuration
                }
              }
            );

            logger.info('Complete: updateOne sonucu', {
              storyId,
              matchedCount: updateResult.matchedCount,
              modifiedCount: updateResult.modifiedCount,
              acknowledged: updateResult.acknowledged
            });

            if (updateResult.matchedCount === 0) {
              logger.error('Complete: Story bulunamadı (updateOne)', { storyId });
              lastErrorMessage = 'Story not found in updateOne';
              continue;
            }

            // Güncellemeyi doğrula - yeni connection ile
            await dbConnectFresh();
            const verifyStory = await Story.findById(storyId).lean();
            
            if (verifyStory && verifyStory.status === 'completed' && verifyStory.progress === 100) {
              updateVerified = true;
              logger.info('Hikaye işleme tamamlandı - DOĞRULANDI', {
                storyId,
                processingDuration,
                durationText,
                finalStatus: verifyStory.status,
                finalProgress: verifyStory.progress,
                attempt
              });
              
              return { 
                success: true, 
                duration: processingDuration, 
                status: verifyStory.status,
                verified: true
              };
            } else {
              lastErrorMessage = `Verification failed: status=${verifyStory?.status}, progress=${verifyStory?.progress}`;
              logger.warn('Complete: Güncelleme doğrulanamadı', {
                storyId,
                expectedStatus: 'completed',
                actualStatus: verifyStory?.status,
                expectedProgress: 100,
                actualProgress: verifyStory?.progress,
                attempt
              });
            }
          } catch (error) {
            lastErrorMessage = error instanceof Error ? error.message : 'Unknown error';
            logger.warn(`Complete: Deneme ${attempt}/${maxRetries} başarısız`, {
              storyId,
              error: lastErrorMessage,
              attempt
            });
          }

          // Son deneme değilse bekle ve tekrar dene
          if (attempt < maxRetries) {
            const waitTime = 1000 * attempt * 2; // 2s, 4s, 6s, 8s
            logger.info(`Complete: ${waitTime}ms bekleniyor...`, { storyId, attempt });
            await new Promise(resolve => setTimeout(resolve, waitTime));
          }
        }

        // Tüm denemeler başarısız veya doğrulanamadı
        logger.error('Complete: Tüm denemeler başarısız veya doğrulanamadı', {
          storyId,
          error: lastErrorMessage,
          attempts: maxRetries,
          updateVerified
        });
        
        return { success: false, duration: processingDuration, error: lastErrorMessage || 'All retries failed', verified: false };
      });

      // Son kontrol - eğer complete step başarısız olduysa veya doğrulanamadıysa, bir kez daha dene
      const shouldForceComplete = !completeResult || 
        completeResult.success === false || 
        ('verified' in completeResult && completeResult.verified === false);
      
      if (shouldForceComplete) {
        await step.run('force-complete', async () => {
          logger.warn('Force complete çalıştırılıyor', { 
            storyId,
            completeResult: JSON.stringify(completeResult)
          });
          
          // Mongoose connection'ı tamamen kapat ve yeniden bağlan
          const mongoose = await import('mongoose');
          if (mongoose.connection.readyState !== 0) {
            await mongoose.connection.close();
          }
          
          // Yeni connection
          const { dbConnectFresh } = await import('@/lib/mongodb');
          await dbConnectFresh();
          
          // Native MongoDB driver kullan
          const result = await Story.collection.updateOne(
            { _id: new mongoose.Types.ObjectId(storyId) },
            {
              $set: {
                status: 'completed',
                progress: 100,
                currentStep: 'İşlem tamamlandı (force)',
                processingCompletedAt: new Date()
              }
            }
          );
          
          logger.info('Force complete sonucu', { 
            storyId,
            matchedCount: result.matchedCount,
            modifiedCount: result.modifiedCount
          });

          // Doğrula
          const verifyDoc = await Story.collection.findOne({ _id: new mongoose.Types.ObjectId(storyId) });
          logger.info('Force complete doğrulama', {
            storyId,
            status: verifyDoc?.status,
            progress: verifyDoc?.progress
          });
        });
      }

      // --- 11. FİNALİZASYON - Son kontrol ve doğrulama ---
      await step.run('finalization', async () => {
        // 2 saniye bekle - önceki write işlemlerinin tamamlanmasını garantile
        await new Promise(resolve => setTimeout(resolve, 2000));

        const mongoose = await import('mongoose');
        const { nativeUpdate } = await import('@/lib/mongodb');
        
        // Native driver ile final kontrol
        const { dbConnectFresh } = await import('@/lib/mongodb');
        await dbConnectFresh();
        
        const finalDoc = await Story.collection.findOne({ 
          _id: new mongoose.Types.ObjectId(storyId) 
        });

        if (!finalDoc) {
          logger.error('Finalization: Story bulunamadı', { storyId });
          return { success: false, error: 'Story not found' };
        }

        logger.info('Finalization: Mevcut durum', {
          storyId,
          status: finalDoc.status,
          progress: finalDoc.progress
        });

        // Eğer hala completed değilse, native driver ile güncelle
        if (finalDoc.status !== 'completed' || finalDoc.progress !== 100) {
          logger.warn('Finalization: Story hala completed değil, native update yapılıyor', {
            storyId,
            currentStatus: finalDoc.status,
            currentProgress: finalDoc.progress
          });

          // Süre hesapla
          let duration = 0;
          if (finalDoc.processingStartedAt) {
            const startTime = new Date(finalDoc.processingStartedAt).getTime();
            duration = Math.round((Date.now() - startTime) / 1000);
          }

          await nativeUpdate('stories', 
            { _id: new mongoose.Types.ObjectId(storyId) },
            {
              status: 'completed',
              progress: 100,
              currentStep: 'İşlem tamamlandı!',
              processingCompletedAt: new Date(),
              processingDuration: duration
            }
          );

          // Son doğrulama
          const verifyFinal = await Story.collection.findOne({ 
            _id: new mongoose.Types.ObjectId(storyId) 
          });
          
          logger.info('Finalization: Native update sonrası durum', {
            storyId,
            status: verifyFinal?.status,
            progress: verifyFinal?.progress,
            duration: verifyFinal?.processingDuration
          });

          return { 
            success: verifyFinal?.status === 'completed',
            nativeUpdateApplied: true,
            finalStatus: verifyFinal?.status,
            finalProgress: verifyFinal?.progress
          };
        }

        return { 
          success: true, 
          alreadyCompleted: true,
          finalStatus: finalDoc.status,
          finalProgress: finalDoc.progress,
          processingDuration: finalDoc.processingDuration
        };
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

      // Fresh connection ile güncelle
      try {
        const { dbConnectFresh } = await import('@/lib/mongodb');
        await dbConnectFresh();
        
        await Story.findByIdAndUpdate(storyId, {
          status: 'failed',
          errorMessage: error instanceof Error ? error.message : 'Bilinmeyen hata'
        });

        // retryCount'u ayrı $inc operatörü ile güncelle
        await Story.findByIdAndUpdate(storyId, {
          $inc: { retryCount: 1 }
        });
      } catch (dbError) {
        logger.error('Hata durumunda DB güncelleme başarısız', {
          storyId,
          dbError: dbError instanceof Error ? dbError.message : 'Bilinmeyen hata'
        });
      }

      throw error;
    }
  }
);
