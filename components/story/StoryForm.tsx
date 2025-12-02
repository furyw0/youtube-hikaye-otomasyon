/**
 * Hikaye Oluşturma Formu
 */

'use client';

import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/routing';
import { TARGET_LANGUAGES, TARGET_COUNTRIES, IMAGEFX_ASPECT_RATIOS, ELEVENLABS_MODELS } from '@/lib/constants';

interface Voice {
  voice_id: string;
  name: string;
  preview_url?: string;
}

interface Model {
  id: string;
  name: string;
  description: string;
}

export function StoryForm() {
  const t = useTranslations('storyForm');
  const tCommon = useTranslations('common');
  const router = useRouter();

  // Form state
  const [formData, setFormData] = useState({
    title: '',
    content: '',
    targetLanguage: 'en',
    targetCountry: 'USA',
    openaiModel: 'gpt-4o-mini',
    elevenlabsModel: 'eleven_flash_v2_5',
    voiceId: '',
    voiceName: '',
    imagefxModel: 'IMAGEN_4',
    imagefxAspectRatio: 'LANDSCAPE',
    imagefxSeed: undefined as number | undefined
  });

  // UI state
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorDetails, setErrorDetails] = useState<Array<{ field: string; message: string }> | null>(null);
  const [voices, setVoices] = useState<Voice[]>([]);
  const [models, setModels] = useState<Model[]>([]);
  const [loadingVoices, setLoadingVoices] = useState(true);
  const [loadingModels, setLoadingModels] = useState(true);
  const [loadingSettings, setLoadingSettings] = useState(true);

  // Load default settings from Settings API
  useEffect(() => {
    async function fetchSettings() {
      try {
        const response = await fetch('/api/settings');
        const data = await response.json();
        
        if (data.success && data.settings) {
          const settings = data.settings;
          setFormData(prev => ({
            ...prev,
            openaiModel: settings.defaultOpenaiModel || prev.openaiModel,
            elevenlabsModel: settings.defaultElevenlabsModel || prev.elevenlabsModel,
            imagefxModel: settings.defaultImagefxModel || prev.imagefxModel,
            imagefxAspectRatio: settings.defaultImagefxAspectRatio || prev.imagefxAspectRatio,
            // Ses ayarlardan gelirse, voices yüklendikten sonra kontrol edilecek
            voiceId: settings.defaultVoiceId || prev.voiceId,
            voiceName: settings.defaultVoiceName || prev.voiceName
          }));
        }
      } catch (err) {
        console.error('Ayarlar yüklenemedi:', err);
      } finally {
        setLoadingSettings(false);
      }
    }

    fetchSettings();
  }, []);

  // Load voices
  useEffect(() => {
    async function fetchVoices() {
      try {
        const response = await fetch('/api/elevenlabs/voices');
        const data = await response.json();
        
        if (data.success) {
          setVoices(data.voices);
          // Eğer ayarlardan ses seçilmediyse, ilk sesi varsayılan olarak seç
          setFormData(prev => {
            // Ayarlardan gelen ses geçerliyse onu koru
            if (prev.voiceId && data.voices.some((v: Voice) => v.voice_id === prev.voiceId)) {
              return prev;
            }
            // Yoksa ilk sesi seç
            if (data.voices.length > 0) {
              return {
                ...prev,
                voiceId: data.voices[0].voice_id,
                voiceName: data.voices[0].name
              };
            }
            return prev;
          });
        }
      } catch (err) {
        console.error('Sesler yüklenemedi:', err);
      } finally {
        setLoadingVoices(false);
      }
    }

    fetchVoices();
  }, []);

  // Load OpenAI models
  useEffect(() => {
    async function fetchModels() {
      try {
        const response = await fetch('/api/openai/models');
        const data = await response.json();
        
        if (data.success) {
          setModels(data.models);
        }
      } catch (err) {
        console.error('Modeller yüklenemedi:', err);
      } finally {
        setLoadingModels(false);
      }
    }

    fetchModels();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);
    setErrorDetails(null);

    try {
      // 1. Hikaye oluştur
      const createResponse = await fetch('/api/stories/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      });

      const createData = await createResponse.json();

      if (!createData.success) {
        // Hata detaylarını kaydet
        if (createData.details) {
          setErrorDetails(createData.details);
        }
        throw new Error(createData.error || 'Hikaye oluşturulamadı');
      }

      // 2. İşleme başlat
      const processResponse = await fetch('/api/stories/process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storyId: createData.storyId })
      });

      const processData = await processResponse.json();

      if (!processData.success) {
        throw new Error(processData.error || 'İşlem başlatılamadı');
      }

      // 3. Dashboard'a yönlendir
      router.push(`/dashboard?storyId=${createData.storyId}`);

    } catch (err) {
      setError(err instanceof Error ? err.message : 'Bir hata oluştu');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleVoiceChange = (voiceId: string) => {
    const voice = voices.find(v => v.voice_id === voiceId);
    if (voice) {
      setFormData(prev => ({
        ...prev,
        voiceId: voice.voice_id,
        voiceName: voice.name
      }));
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="text-center mb-8">
        <h2 className="text-2xl font-bold text-gray-900">
          {t('title')}
        </h2>
        <p className="text-gray-600 mt-2">
          {t('subtitle')}
        </p>
      </div>

      {/* Error Alert */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-red-800 font-medium">{error}</p>
          {errorDetails && errorDetails.length > 0 && (
            <ul className="mt-2 text-red-700 text-sm list-disc list-inside">
              {errorDetails.map((detail, index) => (
                <li key={index}>
                  <strong>{detail.field}:</strong> {detail.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Title */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          {t('fields.title')}
        </label>
        <input
          type="text"
          value={formData.title}
          onChange={(e) => setFormData({ ...formData, title: e.target.value })}
          className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white text-gray-900 placeholder:text-gray-400"
          placeholder={t('fields.titlePlaceholder')}
          required
          minLength={3}
          maxLength={200}
        />
      </div>

      {/* Content */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          {t('fields.content')}
        </label>
        <textarea
          value={formData.content}
          onChange={(e) => setFormData({ ...formData, content: e.target.value })}
          className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent h-64 font-mono text-sm bg-white text-gray-900 placeholder:text-gray-400"
          placeholder={t('fields.contentPlaceholder')}
          required
          minLength={1000}
          maxLength={100000}
        />
        <p className="text-sm text-gray-500 mt-1">
          {formData.content.length.toLocaleString()} / 100,000 {t('hints.characters')}
        </p>
      </div>

      {/* Target Language & Country */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            {t('fields.targetLanguage')}
          </label>
          <select
            value={formData.targetLanguage}
            onChange={(e) => setFormData({ ...formData, targetLanguage: e.target.value })}
            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 bg-white text-gray-900"
            required
          >
            {TARGET_LANGUAGES.map(lang => (
              <option key={lang.code} value={lang.code}>
                {lang.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            {t('fields.targetCountry')}
          </label>
          <select
            value={formData.targetCountry}
            onChange={(e) => setFormData({ ...formData, targetCountry: e.target.value })}
            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 bg-white text-gray-900"
            required
          >
            {TARGET_COUNTRIES.map(country => (
              <option key={country.code} value={country.code}>
                {country.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* OpenAI Model */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          {t('fields.openaiModel')}
        </label>
        {loadingModels ? (
          <div className="text-sm text-gray-500">{tCommon('loading')}</div>
        ) : (
          <select
            value={formData.openaiModel}
            onChange={(e) => setFormData({ ...formData, openaiModel: e.target.value })}
            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 bg-white text-gray-900"
            required
          >
            {models.map(model => (
              <option key={model.id} value={model.id}>
                {model.name} - {model.description}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* ElevenLabs Settings */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* ElevenLabs Model */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            {t('fields.elevenlabsModel')}
          </label>
          <select
            value={formData.elevenlabsModel}
            onChange={(e) => setFormData({ ...formData, elevenlabsModel: e.target.value })}
            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 bg-white text-gray-900"
          >
            {ELEVENLABS_MODELS.map(model => (
              <option key={model.id} value={model.id}>
                {model.name}
              </option>
            ))}
          </select>
        </div>

        {/* Voice */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            {t('fields.voice')}
          </label>
          {loadingVoices ? (
            <div className="text-sm text-gray-500">{tCommon('loading')}</div>
          ) : (
            <select
              value={formData.voiceId}
              onChange={(e) => handleVoiceChange(e.target.value)}
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 bg-white text-gray-900"
              required
            >
              {voices.map(voice => (
                <option key={voice.voice_id} value={voice.voice_id}>
                  {voice.name}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      {/* ImageFX Settings */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            {t('fields.imagefxModel')}
          </label>
          <select
            value={formData.imagefxModel}
            onChange={(e) => setFormData({ ...formData, imagefxModel: e.target.value })}
            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 bg-white text-gray-900"
          >
            <option value="IMAGEN_4">Imagen 4 (En Yeni)</option>
            <option value="IMAGEN_3_5">Imagen 3.5</option>
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            {t('fields.aspectRatio')}
          </label>
          <select
            value={formData.imagefxAspectRatio}
            onChange={(e) => setFormData({ ...formData, imagefxAspectRatio: e.target.value })}
            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 bg-white text-gray-900"
          >
            {IMAGEFX_ASPECT_RATIOS.map(ratio => (
              <option key={ratio.id} value={ratio.id}>
                {ratio.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Seed (Optional) */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          {t('fields.seed')}
        </label>
        <input
          type="number"
          value={formData.imagefxSeed || ''}
          onChange={(e) => setFormData({ 
            ...formData, 
            imagefxSeed: e.target.value ? parseInt(e.target.value) : undefined 
          })}
          className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 bg-white text-gray-900 placeholder:text-gray-400"
          placeholder="0-2147483647 (boş bırakılırsa rastgele)"
          min={0}
          max={2147483647}
        />
      </div>

      {/* Submit Button */}
      <button
        type="submit"
        disabled={isSubmitting || loadingVoices || loadingModels || loadingSettings}
        className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 px-6 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {isSubmitting ? t('submitting') : t('submit')}
      </button>
    </form>
  );
}

