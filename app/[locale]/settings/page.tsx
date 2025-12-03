/**
 * Ayarlar Sayfası
 * API Keys ve sistem ayarları
 */

'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { AuthGuard } from '@/components/auth/AuthGuard';

interface Settings {
  defaultOpenaiModel: string;
  defaultElevenlabsModel: string;
  defaultVoiceId?: string;
  defaultVoiceName?: string;
  defaultImagefxModel: string;
  defaultImagefxAspectRatio: string;
  maxDailyStories: number;
  maxConcurrentProcessing: number;
  hasOpenaiApiKey: boolean;
  hasElevenlabsApiKey: boolean;
  hasImagefxCookie: boolean;
  openaiApiKeyMasked?: string;
  elevenlabsApiKeyMasked?: string;
  imagefxCookieMasked?: string;
}

interface Voice {
  voice_id: string;
  name: string;
  description?: string;
  preview_url?: string;
}

export default function SettingsPage() {
  return (
    <AuthGuard>
      <SettingsContent />
    </AuthGuard>
  );
}

function SettingsContent() {
  const t = useTranslations('settings');
  
  const [settings, setSettings] = useState<Settings | null>(null);
  const [voices, setVoices] = useState<Voice[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Form state
  const [formData, setFormData] = useState({
    openaiApiKey: '',
    elevenlabsApiKey: '',
    imagefxCookie: '',
    defaultOpenaiModel: 'gpt-4o-mini',
    defaultElevenlabsModel: 'eleven_flash_v2_5',
    defaultVoiceId: '',
    defaultVoiceName: '',
    defaultImagefxModel: 'IMAGEN_4',
    defaultImagefxAspectRatio: 'LANDSCAPE',
    maxDailyStories: 10,
    maxConcurrentProcessing: 2
  });

  // Test states
  const [testingOpenai, setTestingOpenai] = useState(false);
  const [testingElevenlabs, setTestingElevenlabs] = useState(false);
  const [testingImagefx, setTestingImagefx] = useState(false);
  const [testResults, setTestResults] = useState<{
    openai?: { success: boolean; message: string };
    elevenlabs?: { success: boolean; message: string };
    imagefx?: { success: boolean; message: string };
  }>({});

  // Voice preview states
  const [playingVoice, setPlayingVoice] = useState<string | null>(null);
  const [audioElement, setAudioElement] = useState<HTMLAudioElement | null>(null);

  // Ses önizleme fonksiyonu
  const playVoicePreview = (voiceId: string, previewUrl?: string) => {
    // Önceki sesi durdur
    if (audioElement) {
      audioElement.pause();
      audioElement.currentTime = 0;
    }

    if (!previewUrl) {
      return;
    }

    // Aynı ses çalıyorsa durdur
    if (playingVoice === voiceId) {
      setPlayingVoice(null);
      return;
    }

    const audio = new Audio(previewUrl);
    audio.onended = () => setPlayingVoice(null);
    audio.onerror = () => setPlayingVoice(null);
    audio.play();
    
    setAudioElement(audio);
    setPlayingVoice(voiceId);
  };

  // Component unmount olduğunda sesi durdur
  useEffect(() => {
    return () => {
      if (audioElement) {
        audioElement.pause();
      }
    };
  }, [audioElement]);

  // Ayarları yükle
  useEffect(() => {
    fetchSettings();
    fetchVoices();
  }, []);

  const fetchSettings = async () => {
    try {
      const response = await fetch('/api/settings');
      const data = await response.json();
      
      if (data.success) {
        setSettings(data.settings);
        setFormData(prev => ({
          ...prev,
          defaultOpenaiModel: data.settings.defaultOpenaiModel || 'gpt-4o-mini',
          defaultElevenlabsModel: data.settings.defaultElevenlabsModel || 'eleven_flash_v2_5',
          defaultVoiceId: data.settings.defaultVoiceId || '',
          defaultVoiceName: data.settings.defaultVoiceName || '',
          defaultImagefxModel: data.settings.defaultImagefxModel || 'IMAGEN_4',
          defaultImagefxAspectRatio: data.settings.defaultImagefxAspectRatio || 'LANDSCAPE',
          maxDailyStories: data.settings.maxDailyStories || 10,
          maxConcurrentProcessing: data.settings.maxConcurrentProcessing || 2
        }));
      }
    } catch (error) {
      console.error('Ayarlar yüklenemedi:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchVoices = async () => {
    try {
      const response = await fetch('/api/elevenlabs/voices');
      const data = await response.json();
      if (data.success) {
        setVoices(data.voices || []);
      }
    } catch (error) {
      console.error('Sesler yüklenemedi:', error);
    }
  };

  // API Test fonksiyonları
  const testApi = async (type: 'openai' | 'elevenlabs' | 'imagefx') => {
    const setTesting = {
      openai: setTestingOpenai,
      elevenlabs: setTestingElevenlabs,
      imagefx: setTestingImagefx
    }[type];

    setTesting(true);
    setTestResults(prev => ({ ...prev, [type]: undefined }));

    try {
      const response = await fetch('/api/settings/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type })
      });

      const data = await response.json();

      setTestResults(prev => ({
        ...prev,
        [type]: {
          success: data.success,
          message: data.success ? data.message : data.error
        }
      }));
    } catch (error) {
      setTestResults(prev => ({
        ...prev,
        [type]: {
          success: false,
          message: 'Bağlantı hatası oluştu'
        }
      }));
    } finally {
      setTesting(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMessage(null);

    try {
      // Sadece dolu olan alanları gönder (boş string göndermemek için)
      const dataToSend: Record<string, string | number> = {};
      
      // API Keys - sadece girilmişse gönder
      if (formData.openaiApiKey.trim()) {
        dataToSend.openaiApiKey = formData.openaiApiKey.trim();
      }
      if (formData.elevenlabsApiKey.trim()) {
        dataToSend.elevenlabsApiKey = formData.elevenlabsApiKey.trim();
      }
      if (formData.imagefxCookie.trim()) {
        dataToSend.imagefxCookie = formData.imagefxCookie.trim();
      }
      
      // Varsayılan ayarlar - her zaman gönder
      dataToSend.defaultOpenaiModel = formData.defaultOpenaiModel;
      dataToSend.defaultElevenlabsModel = formData.defaultElevenlabsModel;
      dataToSend.defaultImagefxModel = formData.defaultImagefxModel;
      dataToSend.defaultImagefxAspectRatio = formData.defaultImagefxAspectRatio;
      dataToSend.maxDailyStories = formData.maxDailyStories;
      dataToSend.maxConcurrentProcessing = formData.maxConcurrentProcessing;
      
      // Voice - sadece seçilmişse gönder
      if (formData.defaultVoiceId) {
        dataToSend.defaultVoiceId = formData.defaultVoiceId;
        dataToSend.defaultVoiceName = formData.defaultVoiceName;
      }

      const response = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(dataToSend)
      });

      const data = await response.json();

      if (data.success) {
        setMessage({ type: 'success', text: t('saved') });
        // Ayarları yeniden yükle
        fetchSettings();
        // Form'daki key'leri temizle (güvenlik için)
        setFormData(prev => ({
          ...prev,
          openaiApiKey: '',
          elevenlabsApiKey: '',
          imagefxCookie: ''
        }));
      } else {
        setMessage({ type: 'error', text: data.error || t('error') });
      }
    } catch (error) {
      setMessage({ type: 'error', text: t('error') });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Page Header */}
      <header className="bg-white border-b shadow-sm">
        <div className="max-w-4xl mx-auto px-4 py-6">
          <h1 className="text-2xl font-bold text-gray-900">{t('title')}</h1>
          <p className="text-gray-600 mt-1">API anahtarlarını ve varsayılan ayarları yönetin</p>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-4xl mx-auto px-4 py-8">
        <form onSubmit={handleSubmit} className="space-y-8">
          
          {/* API Keys Section */}
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-lg font-bold mb-4 flex items-center gap-2 text-blue-700">
              <span className="text-2xl">🔑</span> {t('apiKeys')}
            </h2>
            
            {/* OpenAI API Key */}
            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                OpenAI API Key
              </label>
              <div className="flex gap-2">
                <input
                  type="password"
                  placeholder={settings?.hasOpenaiApiKey ? settings.openaiApiKeyMasked || '••••••••' : 'sk-... API anahtarınızı girin'}
                  value={formData.openaiApiKey}
                  onChange={(e) => setFormData({ ...formData, openaiApiKey: e.target.value })}
                  className="flex-1 px-3 py-3 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 placeholder:text-gray-500"
                />
                {settings?.hasOpenaiApiKey && (
                  <span className="px-3 py-2 bg-green-100 text-green-800 rounded-md text-sm flex items-center">
                    ✓ {t('configured')}
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => testApi('openai')}
                  disabled={testingOpenai || !settings?.hasOpenaiApiKey}
                  className="px-4 py-2 bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium flex items-center gap-2"
                >
                  {testingOpenai ? (
                    <>
                      <span className="animate-spin">⏳</span> Test...
                    </>
                  ) : (
                    <>🧪 Test</>
                  )}
                </button>
              </div>
              {testResults.openai && (
                <div className={`mt-2 p-2 rounded text-sm ${
                  testResults.openai.success 
                    ? 'bg-green-50 text-green-700 border border-green-200' 
                    : 'bg-red-50 text-red-700 border border-red-200'
                }`}>
                  {testResults.openai.success ? '✅' : '❌'} {testResults.openai.message}
                </div>
              )}
              <p className="text-xs text-gray-500 mt-1">
                <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener" className="text-blue-600 hover:underline">
                  OpenAI API Key al →
                </a>
              </p>
            </div>

            {/* ElevenLabs API Key */}
            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                ElevenLabs API Key
              </label>
              <div className="flex gap-2">
                <input
                  type="password"
                  placeholder={settings?.hasElevenlabsApiKey ? settings.elevenlabsApiKeyMasked || '••••••••' : 'ElevenLabs API anahtarınızı girin'}
                  value={formData.elevenlabsApiKey}
                  onChange={(e) => setFormData({ ...formData, elevenlabsApiKey: e.target.value })}
                  className="flex-1 px-3 py-3 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 placeholder:text-gray-500"
                />
                {settings?.hasElevenlabsApiKey && (
                  <span className="px-3 py-2 bg-green-100 text-green-800 rounded-md text-sm flex items-center">
                    ✓ {t('configured')}
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => testApi('elevenlabs')}
                  disabled={testingElevenlabs || !settings?.hasElevenlabsApiKey}
                  className="px-4 py-2 bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium flex items-center gap-2"
                >
                  {testingElevenlabs ? (
                    <>
                      <span className="animate-spin">⏳</span> Test...
                    </>
                  ) : (
                    <>🧪 Test</>
                  )}
                </button>
              </div>
              {testResults.elevenlabs && (
                <div className={`mt-2 p-2 rounded text-sm ${
                  testResults.elevenlabs.success 
                    ? 'bg-green-50 text-green-700 border border-green-200' 
                    : 'bg-red-50 text-red-700 border border-red-200'
                }`}>
                  {testResults.elevenlabs.success ? '✅' : '❌'} {testResults.elevenlabs.message}
                </div>
              )}
              <p className="text-xs text-gray-500 mt-1">
                <a href="https://elevenlabs.io/app/settings/api-keys" target="_blank" rel="noopener" className="text-blue-600 hover:underline">
                  ElevenLabs API Key al →
                </a>
              </p>
            </div>

            {/* ImageFX Cookie */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                ImageFX Google Cookie
              </label>
              <div className="flex gap-2">
                <textarea
                  placeholder={settings?.hasImagefxCookie ? settings.imagefxCookieMasked || '••••••••' : 'Google hesabınızdan alınan cookie değerini buraya yapıştırın...'}
                  value={formData.imagefxCookie}
                  onChange={(e) => setFormData({ ...formData, imagefxCookie: e.target.value })}
                  rows={3}
                  className="flex-1 px-3 py-3 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 text-sm placeholder:text-gray-500"
                />
                <div className="flex flex-col gap-2">
                  {settings?.hasImagefxCookie && (
                    <span className="px-3 py-2 bg-green-100 text-green-800 rounded-md text-sm text-center">
                      ✓ {t('configured')}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => testApi('imagefx')}
                    disabled={testingImagefx || !settings?.hasImagefxCookie}
                    className="px-4 py-2 bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium flex items-center gap-2"
                  >
                    {testingImagefx ? (
                      <>
                        <span className="animate-spin">⏳</span> Test...
                      </>
                    ) : (
                      <>🧪 Test</>
                    )}
                  </button>
                </div>
              </div>
              {testResults.imagefx && (
                <div className={`mt-2 p-2 rounded text-sm ${
                  testResults.imagefx.success 
                    ? 'bg-green-50 text-green-700 border border-green-200' 
                    : 'bg-red-50 text-red-700 border border-red-200'
                }`}>
                  {testResults.imagefx.success ? '✅' : '❌'} {testResults.imagefx.message}
                </div>
              )}
              <p className="text-xs text-gray-500 mt-1">
                <a href="https://github.com/rohitaryal/imageFX-api#help" target="_blank" rel="noopener" className="text-blue-600 hover:underline">
                  Cookie nasıl alınır? →
                </a>
                {' | '}
                <a href="https://labs.google/fx/tools/image-fx" target="_blank" rel="noopener" className="text-blue-600 hover:underline">
                  labs.google/fx →
                </a>
              </p>
            </div>
          </div>

          {/* Default Settings Section */}
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-lg font-bold mb-4 flex items-center gap-2 text-indigo-700">
              <span className="text-2xl">⚙️</span> {t('defaults')}
            </h2>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* OpenAI Model */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {t('defaultModel')}
                </label>
                <select
                  value={formData.defaultOpenaiModel}
                  onChange={(e) => setFormData({ ...formData, defaultOpenaiModel: e.target.value })}
                  className="w-full px-3 py-3 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 bg-white text-gray-900"
                >
                  <option value="gpt-4o-mini">GPT-4o Mini (Önerilen)</option>
                  <option value="gpt-4o">GPT-4o</option>
                  <option value="gpt-4-turbo">GPT-4 Turbo</option>
                </select>
              </div>

              {/* ElevenLabs Model */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  ElevenLabs Modeli
                </label>
                <select
                  value={formData.defaultElevenlabsModel}
                  onChange={(e) => setFormData({ ...formData, defaultElevenlabsModel: e.target.value })}
                  className="w-full px-3 py-3 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 bg-white text-gray-900"
                >
                  <option value="eleven_flash_v2_5">Flash v2.5 (Önerilen) - Ultra hızlı</option>
                  <option value="eleven_turbo_v2_5">Turbo v2.5 - Yüksek kalite</option>
                  <option value="eleven_multilingual_v2">Multilingual v2 - En doğal</option>
                  <option value="eleven_v3">Eleven v3 (Alpha) - En yeni</option>
                </select>
                <p className="text-xs text-gray-500 mt-1">
                  <a href="https://elevenlabs.io/docs/models" target="_blank" rel="noopener" className="text-blue-600 hover:underline">
                    Model karşılaştırması →
                  </a>
                </p>
              </div>

              {/* Default Voice with Preview */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {t('defaultVoice')}
                </label>
                <div className="flex gap-2">
                  <select
                    value={formData.defaultVoiceId}
                    onChange={(e) => {
                      const voice = voices.find(v => v.voice_id === e.target.value);
                      setFormData({ 
                        ...formData, 
                        defaultVoiceId: e.target.value,
                        defaultVoiceName: voice?.name || ''
                      });
                    }}
                    className="flex-1 px-3 py-3 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 bg-white text-gray-900"
                  >
                    <option value="">{t('selectVoice')}</option>
                    {voices.map(voice => (
                      <option key={voice.voice_id} value={voice.voice_id}>
                        {voice.name}
                      </option>
                    ))}
                  </select>
                  {/* Play Preview Button */}
                  {formData.defaultVoiceId && (
                    <button
                      type="button"
                      onClick={() => {
                        const voice = voices.find(v => v.voice_id === formData.defaultVoiceId);
                        playVoicePreview(formData.defaultVoiceId, voice?.preview_url);
                      }}
                      className={`px-4 py-2 rounded-md text-sm font-medium flex items-center gap-1 transition-all ${
                        playingVoice === formData.defaultVoiceId
                          ? 'bg-red-500 text-white hover:bg-red-600'
                          : 'bg-purple-100 text-purple-700 hover:bg-purple-200'
                      }`}
                      title="Sesi dinle"
                    >
                      {playingVoice === formData.defaultVoiceId ? (
                        <>⏹️ Durdur</>
                      ) : (
                        <>▶️ Dinle</>
                      )}
                    </button>
                  )}
                </div>
                {formData.defaultVoiceName && (
                  <p className="text-xs text-gray-500 mt-1">
                    Seçili: <span className="font-medium text-gray-700">{formData.defaultVoiceName}</span>
                  </p>
                )}
              </div>

              {/* ImageFX Model */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {t('imagefxModel')}
                </label>
                <select
                  value={formData.defaultImagefxModel}
                  onChange={(e) => setFormData({ ...formData, defaultImagefxModel: e.target.value })}
                  className="w-full px-3 py-3 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 bg-white text-gray-900"
                >
                  <option value="IMAGEN_4">Imagen 4 (En Yeni)</option>
                  <option value="IMAGEN_3_5">Imagen 3.5</option>
                </select>
              </div>

              {/* ImageFX Aspect Ratio */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {t('aspectRatio')}
                </label>
                <select
                  value={formData.defaultImagefxAspectRatio}
                  onChange={(e) => setFormData({ ...formData, defaultImagefxAspectRatio: e.target.value })}
                  className="w-full px-3 py-3 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 bg-white text-gray-900"
                >
                  <option value="LANDSCAPE">Yatay (16:9)</option>
                  <option value="SQUARE">Kare (1:1)</option>
                  <option value="PORTRAIT">Dikey (9:16)</option>
                </select>
              </div>
            </div>
          </div>

          {/* Message */}
          {message && (
            <div className={`p-4 rounded-md ${
              message.type === 'success' 
                ? 'bg-green-50 text-green-800 border border-green-200' 
                : 'bg-red-50 text-red-800 border border-red-200'
            }`}>
              {message.text}
            </div>
          )}

          {/* Submit Button */}
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={saving}
              className="px-6 py-3 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? t('saving') : t('save')}
            </button>
          </div>
        </form>
      </main>
    </div>
  );
}

