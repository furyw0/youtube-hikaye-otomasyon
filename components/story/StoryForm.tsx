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

interface CoquiVoice {
  id: string;
  name: string;
  language?: string;
  gender?: string;
  type?: 'builtin' | 'custom';
  available?: boolean;
}

interface CoquiLanguage {
  code: string;
  name: string;
}

interface Model {
  id: string;
  name: string;
  description: string;
}

interface VisualStyle {
  _id: string;
  name: string;
  description?: string;
  isDefault: boolean;
}

interface PromptScenario {
  _id: string;
  name: string;
  description?: string;
  isDefault: boolean;
}

export function StoryForm() {
  const t = useTranslations('storyForm');
  const tCommon = useTranslations('common');
  const router = useRouter();

  // Providers state
  const [llmProvider, setLlmProvider] = useState<'openai' | 'claude'>('openai');
  const [ttsProvider, setTtsProvider] = useState<'elevenlabs' | 'coqui'>('elevenlabs');
  const [coquiTunnelUrl, setCoquiTunnelUrl] = useState('');

  // Form state
  const [formData, setFormData] = useState({
    title: '',
    content: '',
    youtubeDescription: '',
    coverText: '',
    targetLanguage: 'en',
    targetCountry: 'USA',
    translationOnly: false,
    // LLM
    openaiModel: 'gpt-4o-mini',
    claudeModel: 'claude-sonnet-4-20250514',
    // ElevenLabs
    elevenlabsModel: 'eleven_flash_v2_5',
    voiceId: '',
    voiceName: '',
    // Coqui TTS
    coquiLanguage: 'tr',
    coquiVoiceId: '',
    coquiVoiceName: '',
    // ImageFX
    imagefxModel: 'IMAGEN_4',
    imagefxAspectRatio: 'LANDSCAPE',
    imagefxSeed: undefined as number | undefined,
    // Visual Style
    visualStyleId: '',
    // Prompt Scenario
    promptScenarioId: ''
  });

  // UI state
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorDetails, setErrorDetails] = useState<Array<{ field: string; message: string }> | null>(null);
  const [voices, setVoices] = useState<Voice[]>([]);
  const [coquiVoices, setCoquiVoices] = useState<CoquiVoice[]>([]);
  const [coquiLanguages, setCoquiLanguages] = useState<CoquiLanguage[]>([]);
  const [models, setModels] = useState<Model[]>([]);
  const [visualStyles, setVisualStyles] = useState<VisualStyle[]>([]);
  const [promptScenarios, setPromptScenarios] = useState<PromptScenario[]>([]);
  const [loadingVoices, setLoadingVoices] = useState(true);
  const [loadingCoquiVoices, setLoadingCoquiVoices] = useState(false);
  const [loadingModels, setLoadingModels] = useState(true);
  const [loadingSettings, setLoadingSettings] = useState(true);
  const [loadingVisualStyles, setLoadingVisualStyles] = useState(true);
  const [loadingPromptScenarios, setLoadingPromptScenarios] = useState(true);

  // Load default settings from Settings API
  useEffect(() => {
    async function fetchSettings() {
      try {
        const response = await fetch('/api/settings');
        const data = await response.json();
        
        if (data.success && data.settings) {
          const settings = data.settings;
          
          // LLM Provider ayarla
          setLlmProvider(settings.llmProvider || 'openai');
          
          // TTS Provider ayarla
          setTtsProvider(settings.ttsProvider || 'elevenlabs');
          setCoquiTunnelUrl(settings.coquiTunnelUrl || '');
          
          setFormData(prev => ({
            ...prev,
            openaiModel: settings.defaultOpenaiModel || prev.openaiModel,
            claudeModel: settings.defaultClaudeModel || prev.claudeModel,
            elevenlabsModel: settings.defaultElevenlabsModel || prev.elevenlabsModel,
            imagefxModel: settings.defaultImagefxModel || prev.imagefxModel,
            imagefxAspectRatio: settings.defaultImagefxAspectRatio || prev.imagefxAspectRatio,
            // ElevenLabs - Ses ayarlardan gelirse, voices yüklendikten sonra kontrol edilecek
            voiceId: settings.defaultVoiceId || prev.voiceId,
            voiceName: settings.defaultVoiceName || prev.voiceName,
            // Coqui TTS
            coquiLanguage: settings.coquiLanguage || prev.coquiLanguage,
            coquiVoiceId: settings.coquiSelectedVoiceId || prev.coquiVoiceId
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

  // Load Visual Styles
  useEffect(() => {
    async function fetchVisualStyles() {
      try {
        const response = await fetch('/api/visual-styles');
        const data = await response.json();
        
        if (data.success && data.styles) {
          setVisualStyles(data.styles);
          // İlk stili varsayılan olarak seç
          if (data.styles.length > 0) {
            setFormData(prev => ({
              ...prev,
              visualStyleId: prev.visualStyleId || data.styles[0]._id
            }));
          }
        }
      } catch (err) {
        console.error('Görsel stiller yüklenemedi:', err);
      } finally {
        setLoadingVisualStyles(false);
      }
    }

    fetchVisualStyles();
  }, []);

  // Load Prompt Scenarios
  useEffect(() => {
    async function fetchPromptScenarios() {
      try {
        const response = await fetch('/api/prompt-scenarios');
        const data = await response.json();
        
        if (data.success && data.scenarios) {
          setPromptScenarios(data.scenarios);
          // İlk senaryoyu varsayılan olarak seç
          if (data.scenarios.length > 0) {
            setFormData(prev => ({
              ...prev,
              promptScenarioId: prev.promptScenarioId || data.scenarios[0]._id
            }));
          }
        }
      } catch (err) {
        console.error('Prompt senaryoları yüklenemedi:', err);
      } finally {
        setLoadingPromptScenarios(false);
      }
    }

    fetchPromptScenarios();
  }, []);

  // Load ElevenLabs voices
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
        console.error('ElevenLabs sesler yüklenemedi:', err);
      } finally {
        setLoadingVoices(false);
      }
    }

    fetchVoices();
  }, []);

  // Load Coqui languages when settings are loaded
  useEffect(() => {
    async function fetchCoquiLanguages() {
      try {
        const response = await fetch('/api/coqui/languages');
        const data = await response.json();
        
        if (data.success && data.languages) {
          setCoquiLanguages(data.languages);
        }
      } catch (err) {
        console.error('Coqui dilleri yüklenemedi:', err);
      }
    }

    // Settings yüklenene kadar bekle
    if (!loadingSettings && ttsProvider === 'coqui') {
      fetchCoquiLanguages();
    }
  }, [ttsProvider, loadingSettings]);

  // Load Coqui voices when tunnel URL is available and settings are loaded
  useEffect(() => {
    async function fetchCoquiVoices() {
      if (!coquiTunnelUrl) {
        console.log('Coqui voices: tunnelUrl boş');
        return;
      }
      
      console.log('Coqui voices yükleniyor...', { ttsProvider, coquiTunnelUrl });
      setLoadingCoquiVoices(true);
      try {
        const response = await fetch(`/api/coqui/voices?tunnelUrl=${encodeURIComponent(coquiTunnelUrl)}`);
        const data = await response.json();
        
        console.log('Coqui voices API yanıtı:', data);
        
        if (data.success) {
          // API'den gelen voices array'ini kullan
          const allVoices = data.voices || [...(data.builtin || []), ...(data.custom || [])];
          // available false olmayan sesleri filtrele (undefined da kabul et)
          const availableVoices = allVoices.filter((v: CoquiVoice) => v.available !== false);
          console.log('Kullanılabilir sesler:', availableVoices.length, availableVoices);
          setCoquiVoices(availableVoices);
          
          // İlk sesi varsayılan olarak seç
          setFormData(prev => {
            if (prev.coquiVoiceId && availableVoices.some((v: CoquiVoice) => v.id === prev.coquiVoiceId)) {
              const voice = availableVoices.find((v: CoquiVoice) => v.id === prev.coquiVoiceId);
              return { ...prev, coquiVoiceName: voice?.name || prev.coquiVoiceName };
            }
            if (availableVoices.length > 0) {
              return {
                ...prev,
                coquiVoiceId: availableVoices[0].id,
                coquiVoiceName: availableVoices[0].name
              };
            }
            return prev;
          });
        } else {
          console.error('Coqui voices API hatası:', data.error);
        }
      } catch (err) {
        console.error('Coqui sesleri yüklenemedi:', err);
      } finally {
        setLoadingCoquiVoices(false);
      }
    }

    // Settings yüklenene kadar bekle, sonra ttsProvider ve tunnelUrl kontrol et
    if (!loadingSettings && ttsProvider === 'coqui' && coquiTunnelUrl) {
      fetchCoquiVoices();
    }
  }, [ttsProvider, coquiTunnelUrl, loadingSettings]);

  // Load LLM models (OpenAI or Claude based on provider)
  useEffect(() => {
    async function fetchModels() {
      try {
        const endpoint = llmProvider === 'claude' ? '/api/claude/models' : '/api/openai/models';
        const response = await fetch(endpoint);
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
  }, [llmProvider]); // Provider değiştiğinde modelleri yeniden yükle

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);
    setErrorDetails(null);

    try {
      // Kullanılan model'i belirle (LLM provider'a göre)
      const selectedModel = llmProvider === 'claude' ? formData.claudeModel : formData.openaiModel;
      
      // Provider bilgilerini ekle
      const submitData = {
        ...formData,
        openaiModel: selectedModel, // Backend hala openaiModel field'ını kullanıyor, ikisi için de buraya yazıyoruz
        translationOnly: formData.translationOnly,
        ttsProvider,
        coquiTunnelUrl: ttsProvider === 'coqui' ? coquiTunnelUrl : undefined,
        visualStyleId: formData.visualStyleId || undefined,
        promptScenarioId: formData.promptScenarioId || undefined
      };

      // 1. Hikaye oluştur
      const createResponse = await fetch('/api/stories/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(submitData)
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

  const handleCoquiVoiceChange = (voiceId: string) => {
    const voice = coquiVoices.find(v => v.id === voiceId);
    if (voice) {
      setFormData(prev => ({
        ...prev,
        coquiVoiceId: voice.id,
        coquiVoiceName: voice.name
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

      {/* Translation Only Mode Toggle */}
      <div className={`border rounded-lg p-4 ${formData.translationOnly ? 'bg-purple-50 border-purple-200' : 'bg-gray-50 border-gray-200'}`}>
        <div className="flex items-center justify-between">
          <div className="flex-1">
            <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
              🌐 {t('fields.translationOnly')}
              {formData.translationOnly && (
                <span className="px-2 py-0.5 text-xs rounded-full bg-purple-100 text-purple-800">
                  Aktif
                </span>
              )}
            </h3>
            <p className="text-xs text-gray-600 mt-1">
              {t('fields.translationOnlyHint')}
            </p>
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={formData.translationOnly}
              onChange={(e) => setFormData({ ...formData, translationOnly: e.target.checked })}
              className="sr-only peer"
            />
            <div className="w-11 h-6 bg-gray-300 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-purple-300 rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-purple-600"></div>
          </label>
        </div>
        {formData.translationOnly && (
          <div className="mt-3 p-2 bg-purple-100 rounded text-xs text-purple-800">
            ⚡ Bu modda metin kültürel adaptasyon yapılmadan birebir çevrilecektir. İsimler, yerler ve kültürel unsurlar değiştirilmeyecektir.
          </div>
        )}
      </div>

      {/* YouTube Metadata (Optional) */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <h3 className="text-sm font-semibold text-blue-900 mb-3 flex items-center">
          📺 YouTube Metadata (İsteğe Bağlı)
        </h3>
        <p className="text-xs text-blue-700 mb-3">
          Orjinal YouTube açıklaması ve kapak yazısı verin, adapte edilmiş versiyonları otomatik oluşturulsun.
        </p>
        
        {/* YouTube Description */}
        <div className="mb-3">
          <label className="block text-sm font-medium text-gray-700 mb-1">
            YouTube Açıklaması (Orijinal)
          </label>
          <textarea
            value={formData.youtubeDescription}
            onChange={(e) => setFormData({ ...formData, youtubeDescription: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent h-24 text-sm bg-white text-gray-900 placeholder:text-gray-400"
            placeholder="Opsiyonel: Orijinal hikayenin YouTube açıklaması..."
            maxLength={5000}
          />
          <p className="text-xs text-gray-500 mt-1">
            {formData.youtubeDescription.length} / 5,000 karakter
          </p>
        </div>

        {/* Cover Text */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Kapak Görseli Yazısı (Orijinal)
          </label>
          <input
            type="text"
            value={formData.coverText}
            onChange={(e) => setFormData({ ...formData, coverText: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm bg-white text-gray-900 placeholder:text-gray-400"
            placeholder="Opsiyonel: Orijinal kapak görseli yazısı..."
            maxLength={100}
          />
          <p className="text-xs text-gray-500 mt-1">
            {formData.coverText.length} / 100 karakter · Yeni yazı dikkat çekici ve clickbait tarzı olacak
          </p>
        </div>
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

      {/* Prompt Scenario Selection */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          📝 {t('fields.promptScenario')}
        </label>
        {loadingPromptScenarios ? (
          <div className="text-sm text-gray-500">{tCommon('loading')}</div>
        ) : promptScenarios.length === 0 ? (
          <div className="text-sm text-gray-500">Henüz prompt senaryosu tanımlanmamış</div>
        ) : (
          <select
            value={formData.promptScenarioId}
            onChange={(e) => setFormData({ ...formData, promptScenarioId: e.target.value })}
            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 bg-white text-gray-900"
          >
            {promptScenarios.map(scenario => (
              <option key={scenario._id} value={scenario._id}>
                {scenario.name} {scenario.isDefault ? '⭐' : ''} {scenario.description ? `- ${scenario.description}` : ''}
              </option>
            ))}
          </select>
        )}
        <p className="text-xs text-gray-500 mt-1">
          Çeviri ve adaptasyon için kullanılacak prompt şablonu. Ayarlar sayfasından yeni senaryolar ekleyebilirsiniz.
        </p>
      </div>

      {/* LLM Model Selection */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          {llmProvider === 'claude' ? 'Claude Modeli' : 'OpenAI Modeli'}
        </label>
        {loadingModels ? (
          <div className="text-sm text-gray-500">{tCommon('loading')}</div>
        ) : (
          <select
            value={llmProvider === 'claude' ? formData.claudeModel : formData.openaiModel}
            onChange={(e) => setFormData({ 
              ...formData, 
              [llmProvider === 'claude' ? 'claudeModel' : 'openaiModel']: e.target.value 
            })}
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
        <p className="text-xs text-gray-500 mt-1">
          {llmProvider === 'claude' 
            ? '✨ Prompt Caching ile %90 maliyet tasarrufu' 
            : 'Çeviri, adaptasyon ve sahne oluşturma için kullanılacak'}
        </p>
      </div>

      {/* TTS Settings - Conditional based on provider */}
      {ttsProvider === 'elevenlabs' ? (
        /* ElevenLabs Settings */
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
      ) : (
        /* Coqui TTS Settings */
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-sm text-purple-700 bg-purple-50 px-3 py-2 rounded-lg">
            <span>🐸</span>
            <span>{t('fields.coquiProvider')}</span>
          </div>
          
          {!coquiTunnelUrl ? (
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
              <p className="text-yellow-800 text-sm">
                ⚠️ {t('fields.coquiNotConfigured')}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Coqui Language */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  {t('fields.coquiLanguage')}
                </label>
                <select
                  value={formData.coquiLanguage}
                  onChange={(e) => setFormData({ ...formData, coquiLanguage: e.target.value })}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 bg-white text-gray-900"
                >
                  {coquiLanguages.length > 0 ? (
                    coquiLanguages.map(lang => (
                      <option key={lang.code} value={lang.code}>
                        {lang.name}
                      </option>
                    ))
                  ) : (
                    <>
                      <option value="tr">🇹🇷 Türkçe</option>
                      <option value="en">🇬🇧 English</option>
                      <option value="de">🇩🇪 Deutsch</option>
                      <option value="es">🇪🇸 Español</option>
                      <option value="fr">🇫🇷 Français</option>
                    </>
                  )}
                </select>
              </div>

              {/* Coqui Voice */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  {t('fields.coquiVoice')}
                </label>
                {loadingCoquiVoices ? (
                  <div className="text-sm text-gray-500">{tCommon('loading')}</div>
                ) : coquiVoices.length === 0 ? (
                  <div className="text-sm text-gray-500">{t('fields.coquiNoVoices')}</div>
                ) : (
                  <select
                    value={formData.coquiVoiceId}
                    onChange={(e) => handleCoquiVoiceChange(e.target.value)}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 bg-white text-gray-900"
                    required
                  >
                    {/* Dahili Sesler */}
                    {coquiVoices.filter(v => v.type === 'builtin').length > 0 && (
                      <optgroup label="📦 Dahili Sesler">
                        {coquiVoices.filter(v => v.type === 'builtin').map(voice => (
                          <option key={voice.id} value={voice.id}>
                            {voice.name} ({voice.language?.toUpperCase()})
                          </option>
                        ))}
                      </optgroup>
                    )}
                    {/* Özel Sesler */}
                    {coquiVoices.filter(v => v.type === 'custom').length > 0 && (
                      <optgroup label="👤 Özel Sesler">
                        {coquiVoices.filter(v => v.type === 'custom').map(voice => (
                          <option key={voice.id} value={voice.id}>
                            {voice.name} ({voice.language?.toUpperCase()})
                          </option>
                        ))}
                      </optgroup>
                    )}
                  </select>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ImageFX Settings */}
      <div className="space-y-4">
        {/* Visual Style Selection */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            🎨 {t('fields.visualStyle')}
          </label>
          {loadingVisualStyles ? (
            <div className="text-sm text-gray-500">{tCommon('loading')}</div>
          ) : visualStyles.length === 0 ? (
            <div className="text-sm text-gray-500">Henüz görsel stil tanımlanmamış</div>
          ) : (
            <select
              value={formData.visualStyleId}
              onChange={(e) => setFormData({ ...formData, visualStyleId: e.target.value })}
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 bg-white text-gray-900"
            >
              {visualStyles.map(style => (
                <option key={style._id} value={style._id}>
                  {style.name} {style.isDefault ? '⭐' : ''} {style.description ? `- ${style.description}` : ''}
                </option>
              ))}
            </select>
          )}
          <p className="text-xs text-gray-500 mt-1">
            Üretilecek görsellerin tarzını belirler. Ayarlar sayfasından yeni stiller ekleyebilirsiniz.
          </p>
        </div>

        {/* Model & Aspect Ratio */}
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
        disabled={
          isSubmitting || 
          loadingModels || 
          loadingSettings || 
          (ttsProvider === 'elevenlabs' && loadingVoices) ||
          (ttsProvider === 'coqui' && (loadingCoquiVoices || !coquiTunnelUrl))
        }
        className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 px-6 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {isSubmitting ? t('submitting') : t('submit')}
      </button>
    </form>
  );
}

