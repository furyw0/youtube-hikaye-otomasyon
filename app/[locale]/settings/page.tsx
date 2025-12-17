/**
 * Ayarlar Sayfası
 * API Keys, TTS Sağlayıcı ve sistem ayarları
 */

'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { AuthGuard } from '@/components/auth/AuthGuard';

interface Settings {
  llmProvider: 'openai' | 'claude';
  ttsProvider: 'elevenlabs' | 'coqui';
  coquiTunnelUrl: string;
  coquiLanguage: string;
  coquiSelectedVoiceId: string;
  defaultOpenaiModel: string;
  defaultClaudeModel: string;
  defaultElevenlabsModel: string;
  defaultVoiceId?: string;
  defaultVoiceName?: string;
  defaultImagefxModel: string;
  defaultImagefxAspectRatio: string;
  maxDailyStories: number;
  maxConcurrentProcessing: number;
  hasOpenaiApiKey: boolean;
  hasClaudeApiKey: boolean;
  hasElevenlabsApiKey: boolean;
  hasImagefxCookie: boolean;
  openaiApiKeyMasked?: string;
  claudeApiKeyMasked?: string;
  elevenlabsApiKeyMasked?: string;
  imagefxCookieMasked?: string;
}

interface ElevenLabsVoice {
  voice_id: string;
  name: string;
  description?: string;
  preview_url?: string;
}

interface CoquiVoice {
  id: string;
  name: string;
  language?: string;
  gender?: string;
  type?: 'builtin' | 'custom';
  description?: string;
  preview_text?: string;
  available?: boolean;
  createdAt?: string;
}

interface CoquiLanguage {
  code: string;
  name: string;
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
  const [elevenLabsVoices, setElevenLabsVoices] = useState<ElevenLabsVoice[]>([]);
  const [coquiVoices, setCoquiVoices] = useState<CoquiVoice[]>([]);
  const [coquiBuiltinVoices, setCoquiBuiltinVoices] = useState<CoquiVoice[]>([]);
  const [coquiCustomVoices, setCoquiCustomVoices] = useState<CoquiVoice[]>([]);
  const [coquiLanguages, setCoquiLanguages] = useState<CoquiLanguage[]>([]);
  const [loadingCoquiPreview, setLoadingCoquiPreview] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Form state
  const [formData, setFormData] = useState({
    llmProvider: 'openai' as 'openai' | 'claude',
    ttsProvider: 'elevenlabs' as 'elevenlabs' | 'coqui',
    coquiTunnelUrl: '',
    coquiLanguage: 'tr',
    coquiSelectedVoiceId: '',
    openaiApiKey: '',
    claudeApiKey: '',
    elevenlabsApiKey: '',
    imagefxCookie: '',
    defaultOpenaiModel: 'gpt-4o-mini',
    defaultClaudeModel: 'claude-sonnet-4-20250514',
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
  const [testingCoqui, setTestingCoqui] = useState(false);
  const [testResults, setTestResults] = useState<{
    openai?: { success: boolean; message: string };
    elevenlabs?: { success: boolean; message: string };
    imagefx?: { success: boolean; message: string };
    coqui?: { success: boolean; message: string; gpu?: boolean };
  }>({});

  // Individual save states for API keys
  const [savingOpenai, setSavingOpenai] = useState(false);
  const [savingElevenlabs, setSavingElevenlabs] = useState(false);
  const [savingImagefx, setSavingImagefx] = useState(false);
  const [apiSaveMessage, setApiSaveMessage] = useState<{
    openai?: { type: 'success' | 'error'; text: string };
    elevenlabs?: { type: 'success' | 'error'; text: string };
    imagefx?: { type: 'success' | 'error'; text: string };
  }>({});

  // Voice upload state
  const [uploadingVoice, setUploadingVoice] = useState(false);
  const [newVoiceName, setNewVoiceName] = useState('');
  const [newVoiceLanguage, setNewVoiceLanguage] = useState('tr');
  const [newVoiceGender, setNewVoiceGender] = useState('unknown');

  // Voice preview states
  const [playingVoice, setPlayingVoice] = useState<string | null>(null);
  const [audioElement, setAudioElement] = useState<HTMLAudioElement | null>(null);

  // Ses önizleme fonksiyonu
  const playVoicePreview = (voiceId: string, previewUrl?: string) => {
    if (audioElement) {
      audioElement.pause();
      audioElement.currentTime = 0;
    }
    if (!previewUrl) return;
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

  useEffect(() => {
    return () => {
      if (audioElement) audioElement.pause();
    };
  }, [audioElement]);

  useEffect(() => {
    fetchSettings();
    fetchElevenLabsVoices();
    fetchCoquiLanguages();
  }, []);

  // Coqui Tunnel URL değiştiğinde sesleri çek
  useEffect(() => {
    if (formData.coquiTunnelUrl && formData.ttsProvider === 'coqui') {
      fetchCoquiVoices();
    }
  }, [formData.coquiTunnelUrl, formData.ttsProvider]);

  const fetchSettings = async () => {
    try {
      const response = await fetch('/api/settings');
      const data = await response.json();
      
      if (data.success) {
        setSettings(data.settings);
        setFormData(prev => ({
          ...prev,
          ttsProvider: data.settings.ttsProvider || 'elevenlabs',
          coquiTunnelUrl: data.settings.coquiTunnelUrl || '',
          coquiLanguage: data.settings.coquiLanguage || 'tr',
          coquiSelectedVoiceId: data.settings.coquiSelectedVoiceId || '',
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

  const fetchElevenLabsVoices = async () => {
    try {
      const response = await fetch('/api/elevenlabs/voices');
      const data = await response.json();
      if (data.success) {
        setElevenLabsVoices(data.voices || []);
      }
    } catch (error) {
      console.error('ElevenLabs sesleri yüklenemedi:', error);
    }
  };

  const fetchCoquiLanguages = async () => {
    try {
      const response = await fetch('/api/coqui/languages');
      const data = await response.json();
      if (data.success) {
        setCoquiLanguages(data.languages || []);
      }
    } catch (error) {
      console.error('Coqui dilleri yüklenemedi:', error);
    }
  };

  const fetchCoquiVoices = async () => {
    if (!formData.coquiTunnelUrl) return;
    try {
      const response = await fetch(`/api/coqui/voices?tunnelUrl=${encodeURIComponent(formData.coquiTunnelUrl)}`);
      const data = await response.json();
      if (data.success) {
        const allVoices = data.voices || [];
        setCoquiVoices(allVoices);
        // Dahili ve özel sesleri ayır
        setCoquiBuiltinVoices(data.builtin || allVoices.filter((v: CoquiVoice) => v.type === 'builtin'));
        setCoquiCustomVoices(data.custom || allVoices.filter((v: CoquiVoice) => v.type === 'custom'));
      }
    } catch (error) {
      console.error('Coqui sesleri yüklenemedi:', error);
    }
  };

  // Coqui ses önizleme
  const playCoquiPreview = async (voiceId: string) => {
    if (!formData.coquiTunnelUrl) return;
    
    // Zaten çalıyorsa durdur
    if (playingVoice === voiceId) {
      if (audioElement) {
        audioElement.pause();
        audioElement.currentTime = 0;
      }
      setPlayingVoice(null);
      return;
    }
    
    // Önceki sesi durdur
    if (audioElement) {
      audioElement.pause();
      audioElement.currentTime = 0;
    }
    
    setLoadingCoquiPreview(voiceId);
    
    try {
      const response = await fetch(
        `/api/coqui/voices/${voiceId}/preview?tunnelUrl=${encodeURIComponent(formData.coquiTunnelUrl)}`
      );
      
      if (!response.ok) {
        throw new Error('Önizleme alınamadı');
      }
      
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      
      audio.onended = () => {
        setPlayingVoice(null);
        URL.revokeObjectURL(url);
      };
      audio.onerror = () => {
        setPlayingVoice(null);
        URL.revokeObjectURL(url);
      };
      
      await audio.play();
      setAudioElement(audio);
      setPlayingVoice(voiceId);
      
    } catch (error) {
      console.error('Coqui önizleme hatası:', error);
      setMessage({ type: 'error', text: 'Ses önizlemesi alınamadı' });
    } finally {
      setLoadingCoquiPreview(null);
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

  // Coqui bağlantı testi
  const testCoquiConnection = async () => {
    if (!formData.coquiTunnelUrl) {
      setTestResults(prev => ({
        ...prev,
        coqui: { success: false, message: 'Tunnel URL girilmemiş' }
      }));
      return;
    }

    setTestingCoqui(true);
    setTestResults(prev => ({ ...prev, coqui: undefined }));

    try {
      const response = await fetch('/api/coqui/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tunnelUrl: formData.coquiTunnelUrl })
      });

      const data = await response.json();

      setTestResults(prev => ({
        ...prev,
        coqui: {
          success: data.success,
          message: data.success 
            ? `Bağlantı başarılı! ${data.gpu ? '🚀 GPU aktif' : '💻 CPU modu'}` 
            : data.error,
          gpu: data.gpu
        }
      }));

      // Başarılıysa sesleri yeniden çek
      if (data.success) {
        fetchCoquiVoices();
      }
    } catch (error) {
      setTestResults(prev => ({
        ...prev,
        coqui: {
          success: false,
          message: 'Bağlantı hatası oluştu'
        }
      }));
    } finally {
      setTestingCoqui(false);
    }
  };

  // Coqui ses yükleme
  const uploadCoquiVoice = async (file: File) => {
    if (!formData.coquiTunnelUrl || !newVoiceName.trim()) {
      setMessage({ type: 'error', text: 'Tunnel URL ve ses adı gerekli' });
      return;
    }

    setUploadingVoice(true);
    setMessage(null);

    try {
      const formDataToSend = new FormData();
      formDataToSend.append('tunnelUrl', formData.coquiTunnelUrl);
      formDataToSend.append('name', newVoiceName.trim());
      formDataToSend.append('language', newVoiceLanguage);
      formDataToSend.append('gender', newVoiceGender);
      formDataToSend.append('audio', file);

      const response = await fetch('/api/coqui/voices', {
        method: 'POST',
        body: formDataToSend
      });

      const data = await response.json();

      if (data.success) {
        setMessage({ type: 'success', text: 'Referans ses başarıyla yüklendi' });
        setNewVoiceName('');
        setNewVoiceLanguage('tr');
        setNewVoiceGender('unknown');
        fetchCoquiVoices();
      } else {
        setMessage({ type: 'error', text: data.error || 'Ses yüklenemedi' });
      }
    } catch (error) {
      setMessage({ type: 'error', text: 'Ses yükleme hatası' });
    } finally {
      setUploadingVoice(false);
    }
  };

  // Coqui ses silme
  const deleteCoquiVoice = async (voiceId: string) => {
    if (!formData.coquiTunnelUrl) return;
    if (!confirm('Bu referans sesi silmek istediğinize emin misiniz?')) return;

    try {
      const response = await fetch(
        `/api/coqui/voices/${voiceId}?tunnelUrl=${encodeURIComponent(formData.coquiTunnelUrl)}`,
        { method: 'DELETE' }
      );

      const data = await response.json();

      if (data.success) {
        setMessage({ type: 'success', text: 'Referans ses silindi' });
        fetchCoquiVoices();
        if (formData.coquiSelectedVoiceId === voiceId) {
          setFormData(prev => ({ ...prev, coquiSelectedVoiceId: '' }));
        }
      } else {
        setMessage({ type: 'error', text: data.error || 'Ses silinemedi' });
      }
    } catch (error) {
      setMessage({ type: 'error', text: 'Ses silme hatası' });
    }
  };

  // Tek bir API key'i kaydet
  const saveApiKey = async (type: 'openai' | 'claude' | 'elevenlabs' | 'imagefx') => {
    const setterMap = {
      openai: setSavingOpenai,
      claude: setSavingOpenai,
      elevenlabs: setSavingElevenlabs,
      imagefx: setSavingImagefx
    };
    
    const valueMap = {
      openai: formData.openaiApiKey,
      claude: formData.claudeApiKey,
      elevenlabs: formData.elevenlabsApiKey,
      imagefx: formData.imagefxCookie
    };

    const keyMap = {
      openai: 'openaiApiKey',
      claude: 'claudeApiKey',
      elevenlabs: 'elevenlabsApiKey',
      imagefx: 'imagefxCookie'
    };

    const value = valueMap[type];
    if (!value.trim()) {
      setApiSaveMessage(prev => ({
        ...prev,
        [type]: { type: 'error', text: t('enterApiValue') }
      }));
      return;
    }

    setterMap[type](true);
    setApiSaveMessage(prev => ({ ...prev, [type]: undefined }));

    try {
      const dataToSend: Record<string, string> = {
        [keyMap[type]]: value.trim()
      };

      const response = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(dataToSend)
      });

      const data = await response.json();

      if (data.success) {
        setApiSaveMessage(prev => ({
          ...prev,
          [type]: { type: 'success', text: t('saved') }
        }));
        // Input'u temizle ve ayarları yenile
        setFormData(prev => ({
          ...prev,
          [type === 'openai' ? 'openaiApiKey' : 
           type === 'claude' ? 'claudeApiKey' :
           type === 'elevenlabs' ? 'elevenlabsApiKey' : 'imagefxCookie']: ''
        }));
        fetchSettings();
        // 3 saniye sonra mesajı temizle
        setTimeout(() => {
          setApiSaveMessage(prev => ({ ...prev, [type]: undefined }));
        }, 3000);
      } else {
        setApiSaveMessage(prev => ({
          ...prev,
          [type]: { type: 'error', text: data.error || t('error') }
        }));
      }
    } catch (error) {
      setApiSaveMessage(prev => ({
        ...prev,
        [type]: { type: 'error', text: t('error') }
      }));
    } finally {
      setterMap[type](false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMessage(null);

    try {
      const dataToSend: Record<string, string | number> = {};
      
      // TTS Sağlayıcı
      dataToSend.ttsProvider = formData.ttsProvider;
      
      // Coqui TTS Ayarları
      if (formData.coquiTunnelUrl.trim()) {
        dataToSend.coquiTunnelUrl = formData.coquiTunnelUrl.trim();
      }
      dataToSend.coquiLanguage = formData.coquiLanguage;
      if (formData.coquiSelectedVoiceId) {
        dataToSend.coquiSelectedVoiceId = formData.coquiSelectedVoiceId;
      }
      
      // LLM Provider
      dataToSend.llmProvider = formData.llmProvider;
      
      // API Keys
      if (formData.openaiApiKey.trim()) {
        dataToSend.openaiApiKey = formData.openaiApiKey.trim();
      }
      if (formData.claudeApiKey.trim()) {
        dataToSend.claudeApiKey = formData.claudeApiKey.trim();
      }
      if (formData.elevenlabsApiKey.trim()) {
        dataToSend.elevenlabsApiKey = formData.elevenlabsApiKey.trim();
      }
      if (formData.imagefxCookie.trim()) {
        dataToSend.imagefxCookie = formData.imagefxCookie.trim();
      }
      
      // Varsayılan ayarlar
      dataToSend.defaultOpenaiModel = formData.defaultOpenaiModel;
      dataToSend.defaultClaudeModel = formData.defaultClaudeModel;
      dataToSend.defaultElevenlabsModel = formData.defaultElevenlabsModel;
      dataToSend.defaultImagefxModel = formData.defaultImagefxModel;
      dataToSend.defaultImagefxAspectRatio = formData.defaultImagefxAspectRatio;
      dataToSend.maxDailyStories = formData.maxDailyStories;
      dataToSend.maxConcurrentProcessing = formData.maxConcurrentProcessing;
      
      // ElevenLabs Voice
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
        fetchSettings();
        setFormData(prev => ({
          ...prev,
          openaiApiKey: '',
          claudeApiKey: '',
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
      <header className="bg-white border-b shadow-sm">
        <div className="max-w-4xl mx-auto px-4 py-6">
          <h1 className="text-2xl font-bold text-gray-900">{t('title')}</h1>
          <p className="text-gray-600 mt-1">API anahtarlarını, TTS sağlayıcısını ve varsayılan ayarları yönetin</p>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-8">
        <form onSubmit={handleSubmit} className="space-y-8">
          
          {/* TTS Provider Section */}
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-lg font-bold mb-4 flex items-center gap-2 text-purple-700">
              <span className="text-2xl">🎙️</span> {t('ttsProvider') || 'Seslendirme Sağlayıcısı'}
            </h2>
            
            {/* Provider Selection */}
            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-700 mb-3">
                {t('selectProvider') || 'Sağlayıcı Seçin'}
              </label>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* ElevenLabs Option */}
                <label 
                  className={`relative flex items-start p-4 border-2 rounded-lg cursor-pointer transition-all ${
                    formData.ttsProvider === 'elevenlabs' 
                      ? 'border-purple-500 bg-purple-50' 
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <input
                    type="radio"
                    name="ttsProvider"
                    value="elevenlabs"
                    checked={formData.ttsProvider === 'elevenlabs'}
                    onChange={(e) => setFormData({ ...formData, ttsProvider: e.target.value as 'elevenlabs' | 'coqui' })}
                    className="sr-only"
                  />
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-2xl">☁️</span>
                      <span className="font-semibold text-gray-900">ElevenLabs</span>
                      {formData.ttsProvider === 'elevenlabs' && (
                        <span className="ml-auto text-purple-600">✓</span>
                      )}
                    </div>
                    <p className="text-sm text-gray-500 mt-1">
                      Bulut tabanlı, yüksek kaliteli sesler. API key gerektirir.
                    </p>
                  </div>
                </label>

                {/* Coqui TTS Option */}
                <label 
                  className={`relative flex items-start p-4 border-2 rounded-lg cursor-pointer transition-all ${
                    formData.ttsProvider === 'coqui' 
                      ? 'border-purple-500 bg-purple-50' 
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <input
                    type="radio"
                    name="ttsProvider"
                    value="coqui"
                    checked={formData.ttsProvider === 'coqui'}
                    onChange={(e) => setFormData({ ...formData, ttsProvider: e.target.value as 'elevenlabs' | 'coqui' })}
                    className="sr-only"
                  />
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-2xl">🐸</span>
                      <span className="font-semibold text-gray-900">Coqui TTS</span>
                      <span className="text-xs px-2 py-0.5 bg-green-100 text-green-700 rounded">Ücretsiz</span>
                      {formData.ttsProvider === 'coqui' && (
                        <span className="ml-auto text-purple-600">✓</span>
                      )}
                    </div>
                    <p className="text-sm text-gray-500 mt-1">
                      Açık kaynak, bilgisayarınızda çalışır. XTTS v2 modeli.
                    </p>
                  </div>
                </label>
              </div>
            </div>

            {/* Coqui TTS Settings */}
            {formData.ttsProvider === 'coqui' && (
              <div className="border-t pt-6 mt-6 space-y-4">
                <h3 className="font-medium text-gray-900 flex items-center gap-2">
                  <span>🐸</span> Coqui TTS Ayarları
                </h3>
                
                {/* Tunnel URL */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Cloudflare Tunnel URL
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      placeholder="https://your-tunnel.trycloudflare.com"
                      value={formData.coquiTunnelUrl}
                      onChange={(e) => setFormData({ ...formData, coquiTunnelUrl: e.target.value })}
                      className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:ring-purple-500 focus:border-purple-500"
                    />
                    <button
                      type="button"
                      onClick={testCoquiConnection}
                      disabled={testingCoqui || !formData.coquiTunnelUrl}
                      className="px-4 py-2 bg-purple-100 text-purple-700 rounded-md hover:bg-purple-200 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium flex items-center gap-2"
                    >
                      {testingCoqui ? (
                        <><span className="animate-spin">⏳</span> Test...</>
                      ) : (
                        <>🧪 Bağlantı Testi</>
                      )}
                    </button>
                  </div>
                  {testResults.coqui && (
                    <div className={`mt-2 p-2 rounded text-sm ${
                      testResults.coqui.success 
                        ? 'bg-green-50 text-green-700 border border-green-200' 
                        : 'bg-red-50 text-red-700 border border-red-200'
                    }`}>
                      {testResults.coqui.success ? '✅' : '❌'} {testResults.coqui.message}
                    </div>
                  )}
                  <p className="text-xs text-gray-500 mt-1">
                    Windows uygulamasını çalıştırdığınızda görüntülenen Tunnel URL&apos;ini girin
                  </p>
                </div>

                {/* Language Selection */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Dil
                  </label>
                  <select
                    value={formData.coquiLanguage}
                    onChange={(e) => setFormData({ ...formData, coquiLanguage: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-purple-500 focus:border-purple-500 bg-white"
                  >
                    {coquiLanguages.map(lang => (
                      <option key={lang.code} value={lang.code}>
                        {lang.name}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Voice Selection */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    🎤 Ses Seçimi
                  </label>
                  
                  {coquiVoices.length > 0 ? (
                    <div className="space-y-4">
                      {/* Quick Select Dropdown */}
                      <select
                        value={formData.coquiSelectedVoiceId}
                        onChange={(e) => setFormData({ ...formData, coquiSelectedVoiceId: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-purple-500 focus:border-purple-500 bg-white"
                      >
                        <option value="">Ses seçin...</option>
                        {coquiBuiltinVoices.length > 0 && (
                          <optgroup label="📦 Dahili Sesler">
                            {coquiBuiltinVoices.filter(v => v.available).map(voice => (
                              <option key={voice.id} value={voice.id}>
                                {voice.name} ({voice.language?.toUpperCase()})
                              </option>
                            ))}
                          </optgroup>
                        )}
                        {coquiCustomVoices.length > 0 && (
                          <optgroup label="👤 Özel Seslerim">
                            {coquiCustomVoices.map(voice => (
                              <option key={voice.id} value={voice.id}>
                                {voice.name}
                              </option>
                            ))}
                          </optgroup>
                        )}
                      </select>

                      {/* Builtin Voices */}
                      {coquiBuiltinVoices.length > 0 && (
                        <div>
                          <h4 className="text-sm font-medium text-gray-600 mb-2 flex items-center gap-2">
                            <span>📦</span> Dahili Sesler
                            <span className="text-xs text-gray-400">({coquiBuiltinVoices.filter(v => v.available).length} mevcut)</span>
                          </h4>
                          <div className="border rounded-lg divide-y max-h-60 overflow-y-auto">
                            {coquiBuiltinVoices.map(voice => (
                              <div 
                                key={voice.id} 
                                className={`flex items-center justify-between p-3 text-sm hover:bg-gray-50 transition-colors ${
                                  formData.coquiSelectedVoiceId === voice.id ? 'bg-purple-50 border-l-4 border-l-purple-500' : ''
                                } ${!voice.available ? 'opacity-50' : ''}`}
                              >
                                <div className="flex items-center gap-3">
                                  <input
                                    type="radio"
                                    name="coquiVoice"
                                    value={voice.id}
                                    checked={formData.coquiSelectedVoiceId === voice.id}
                                    onChange={(e) => setFormData({ ...formData, coquiSelectedVoiceId: e.target.value })}
                                    disabled={!voice.available}
                                    className="text-purple-600 focus:ring-purple-500"
                                  />
                                  <div>
                                    <div className="font-medium text-gray-900">{voice.name}</div>
                                    <div className="text-xs text-gray-500">
                                      {voice.language?.toUpperCase()} • {voice.gender === 'male' ? '👨' : voice.gender === 'female' ? '👩' : '🧑'}
                                      {!voice.available && <span className="ml-2 text-orange-500">⚠️ Ses dosyası eksik</span>}
                                    </div>
                                  </div>
                                </div>
                                {voice.available && (
                                  <button
                                    type="button"
                                    onClick={() => playCoquiPreview(voice.id)}
                                    disabled={loadingCoquiPreview === voice.id}
                                    className={`px-3 py-1.5 rounded-md text-xs font-medium flex items-center gap-1 transition-all ${
                                      playingVoice === voice.id
                                        ? 'bg-red-500 text-white hover:bg-red-600'
                                        : loadingCoquiPreview === voice.id
                                        ? 'bg-gray-200 text-gray-500'
                                        : 'bg-purple-100 text-purple-700 hover:bg-purple-200'
                                    }`}
                                  >
                                    {loadingCoquiPreview === voice.id ? (
                                      <><span className="animate-spin">⏳</span> Yükleniyor</>
                                    ) : playingVoice === voice.id ? (
                                      <>⏹️ Durdur</>
                                    ) : (
                                      <>▶️ Dinle</>
                                    )}
                                  </button>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Custom Voices */}
                      <div>
                        <h4 className="text-sm font-medium text-gray-600 mb-2 flex items-center gap-2">
                          <span>👤</span> Özel Seslerim
                          <span className="text-xs text-gray-400">({coquiCustomVoices.length} ses)</span>
                        </h4>
                        {coquiCustomVoices.length > 0 ? (
                          <div className="border rounded-lg divide-y">
                            {coquiCustomVoices.map(voice => (
                              <div 
                                key={voice.id} 
                                className={`flex items-center justify-between p-3 text-sm hover:bg-gray-50 transition-colors ${
                                  formData.coquiSelectedVoiceId === voice.id ? 'bg-purple-50 border-l-4 border-l-purple-500' : ''
                                }`}
                              >
                                <div className="flex items-center gap-3">
                                  <input
                                    type="radio"
                                    name="coquiVoice"
                                    value={voice.id}
                                    checked={formData.coquiSelectedVoiceId === voice.id}
                                    onChange={(e) => setFormData({ ...formData, coquiSelectedVoiceId: e.target.value })}
                                    className="text-purple-600 focus:ring-purple-500"
                                  />
                                  <div>
                                    <div className="font-medium text-gray-900">{voice.name}</div>
                                    <div className="text-xs text-gray-500">
                                      {voice.language?.toUpperCase() || 'TR'} • Özel Ses
                                    </div>
                                  </div>
                                </div>
                                <div className="flex items-center gap-2">
                                  <button
                                    type="button"
                                    onClick={() => playCoquiPreview(voice.id)}
                                    disabled={loadingCoquiPreview === voice.id}
                                    className={`px-3 py-1.5 rounded-md text-xs font-medium flex items-center gap-1 transition-all ${
                                      playingVoice === voice.id
                                        ? 'bg-red-500 text-white hover:bg-red-600'
                                        : loadingCoquiPreview === voice.id
                                        ? 'bg-gray-200 text-gray-500'
                                        : 'bg-purple-100 text-purple-700 hover:bg-purple-200'
                                    }`}
                                  >
                                    {loadingCoquiPreview === voice.id ? (
                                      <><span className="animate-spin">⏳</span></>
                                    ) : playingVoice === voice.id ? (
                                      <>⏹️</>
                                    ) : (
                                      <>▶️</>
                                    )}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => deleteCoquiVoice(voice.id)}
                                    className="px-2 py-1.5 text-red-500 hover:text-red-700 hover:bg-red-50 rounded-md text-xs"
                                  >
                                    🗑️
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="text-sm text-gray-400 italic p-3 border rounded-lg bg-gray-50">
                            Henüz özel ses eklenmemiş. Aşağıdan kendi sesinizi yükleyebilirsiniz.
                          </p>
                        )}
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm text-gray-500 italic p-4 border rounded-lg bg-gray-50">
                      {formData.coquiTunnelUrl 
                        ? '⏳ Sesler yükleniyor veya bağlantı kurulamadı. Bağlantıyı test edin.' 
                        : '👆 Önce Tunnel URL girin ve bağlantıyı test edin.'}
                    </p>
                  )}
                </div>

                {/* Upload New Voice */}
                {formData.coquiTunnelUrl && (
                  <div className="border-t pt-4">
                    <h4 className="text-sm font-medium text-gray-700 mb-3 flex items-center gap-2">
                      <span>📤</span> Yeni Referans Ses Yükle
                    </h4>
                    <div className="bg-gray-50 rounded-lg p-4 space-y-3">
                      {/* Ses Adı */}
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Ses Adı</label>
                        <input
                          type="text"
                          placeholder="Örn: Benim Sesim"
                          value={newVoiceName}
                          onChange={(e) => setNewVoiceName(e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-purple-500 focus:border-purple-500 text-sm"
                        />
                      </div>
                      
                      {/* Dil ve Cinsiyet */}
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs font-medium text-gray-600 mb-1">Dil</label>
                          <select
                            value={newVoiceLanguage}
                            onChange={(e) => setNewVoiceLanguage(e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-purple-500 focus:border-purple-500 text-sm bg-white"
                          >
                            {coquiLanguages.map(lang => (
                              <option key={lang.code} value={lang.code}>{lang.name}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-600 mb-1">Cinsiyet</label>
                          <select
                            value={newVoiceGender}
                            onChange={(e) => setNewVoiceGender(e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-purple-500 focus:border-purple-500 text-sm bg-white"
                          >
                            <option value="male">👨 Erkek</option>
                            <option value="female">👩 Kadın</option>
                            <option value="unknown">🧑 Belirtilmemiş</option>
                          </select>
                        </div>
                      </div>
                      
                      {/* Dosya Yükleme */}
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Ses Dosyası</label>
                        <input
                          type="file"
                          accept="audio/wav,audio/mp3,audio/mpeg"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) uploadCoquiVoice(file);
                          }}
                          disabled={uploadingVoice || !newVoiceName.trim()}
                          className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-medium file:bg-purple-100 file:text-purple-700 hover:file:bg-purple-200 disabled:opacity-50 cursor-pointer"
                        />
                      </div>
                      
                      {uploadingVoice && (
                        <p className="text-sm text-purple-600 flex items-center gap-2">
                          <span className="animate-spin">⏳</span> Yükleniyor...
                        </p>
                      )}
                      
                      <p className="text-xs text-gray-500">
                        💡 3-10 saniyelik net bir ses kaydı yükleyin (WAV veya MP3). Ses klonlama için kullanılacak.
                      </p>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ElevenLabs Settings (show when ElevenLabs selected) */}
            {formData.ttsProvider === 'elevenlabs' && (
              <div className="border-t pt-6 mt-6">
                <h3 className="font-medium text-gray-900 flex items-center gap-2 mb-4">
                  <span>☁️</span> ElevenLabs Ayarları
                </h3>
                
                {/* Default Voice with Preview */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {t('defaultVoice')}
                  </label>
                  <div className="flex gap-2">
                    <select
                      value={formData.defaultVoiceId}
                      onChange={(e) => {
                        const voice = elevenLabsVoices.find(v => v.voice_id === e.target.value);
                        setFormData({ 
                          ...formData, 
                          defaultVoiceId: e.target.value,
                          defaultVoiceName: voice?.name || ''
                        });
                      }}
                      className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 bg-white"
                    >
                      <option value="">{t('selectVoice')}</option>
                      {elevenLabsVoices.map(voice => (
                        <option key={voice.voice_id} value={voice.voice_id}>
                          {voice.name}
                        </option>
                      ))}
                    </select>
                    {formData.defaultVoiceId && (
                      <button
                        type="button"
                        onClick={() => {
                          const voice = elevenLabsVoices.find(v => v.voice_id === formData.defaultVoiceId);
                          playVoicePreview(formData.defaultVoiceId, voice?.preview_url);
                        }}
                        className={`px-4 py-2 rounded-md text-sm font-medium flex items-center gap-1 transition-all ${
                          playingVoice === formData.defaultVoiceId
                            ? 'bg-red-500 text-white hover:bg-red-600'
                            : 'bg-purple-100 text-purple-700 hover:bg-purple-200'
                        }`}
                      >
                        {playingVoice === formData.defaultVoiceId ? <>⏹️ Durdur</> : <>▶️ Dinle</>}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* API Keys Section */}
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-lg font-bold mb-4 flex items-center gap-2 text-blue-700">
              <span className="text-2xl">🔑</span> {t('apiKeys')}
            </h2>
            
            {/* LLM Provider Seçimi */}
            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                🤖 LLM Provider (Çeviri, Adaptasyon, Sahne)
              </label>
              <div className="flex gap-4">
                <label className="flex items-center">
                  <input
                    type="radio"
                    name="llmProvider"
                    value="openai"
                    checked={formData.llmProvider === 'openai'}
                    onChange={(e) => setFormData({ ...formData, llmProvider: 'openai' })}
                    className="mr-2"
                  />
                  <span className="text-sm">OpenAI (GPT-4o)</span>
                </label>
                <label className="flex items-center">
                  <input
                    type="radio"
                    name="llmProvider"
                    value="claude"
                    checked={formData.llmProvider === 'claude'}
                    onChange={(e) => setFormData({ ...formData, llmProvider: 'claude' })}
                    className="mr-2"
                  />
                  <span className="text-sm">Claude (Prompt Caching 🚀)</span>
                </label>
              </div>
              <p className="text-xs text-gray-500 mt-1">
                {formData.llmProvider === 'claude' ? '✨ Prompt Caching: %90 maliyet, %80 gecikme azaltma' : 'Hızlı ve güvenilir'}
              </p>
            </div>

            {/* OpenAI API Key */}
            {formData.llmProvider === 'openai' && (
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
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                  />
                  {settings?.hasOpenaiApiKey && (
                    <span className="px-3 py-2 bg-green-100 text-green-800 rounded-md text-sm flex items-center">
                      ✓ {t('configured')}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => saveApiKey('openai')}
                    disabled={savingOpenai || !formData.openaiApiKey.trim()}
                    className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 text-sm font-medium"
                  >
                    {savingOpenai ? '⏳...' : '💾 Kaydet'}
                  </button>
                  <button
                    type="button"
                    onClick={() => testApi('openai')}
                    disabled={testingOpenai || !settings?.hasOpenaiApiKey}
                    className="px-4 py-2 bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200 disabled:opacity-50 text-sm font-medium"
                  >
                    {testingOpenai ? '⏳ Test...' : '🧪 Test'}
                  </button>
                </div>
                {apiSaveMessage.openai && (
                  <div className={`mt-2 p-2 rounded text-sm ${apiSaveMessage.openai.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                    {apiSaveMessage.openai.type === 'success' ? '✅' : '❌'} {apiSaveMessage.openai.text}
                  </div>
                )}
                {testResults.openai && (
                  <div className={`mt-2 p-2 rounded text-sm ${testResults.openai.success ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                    {testResults.openai.success ? '✅' : '❌'} {testResults.openai.message}
                  </div>
                )}
              </div>
            )}

            {/* Claude API Key */}
            {formData.llmProvider === 'claude' && (
              <div className="mb-6">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Claude API Key
                </label>
                <div className="flex gap-2">
                  <input
                    type="password"
                    placeholder={settings?.hasClaudeApiKey ? settings.claudeApiKeyMasked || '••••••••' : 'sk-ant-... API anahtarınızı girin'}
                    value={formData.claudeApiKey}
                    onChange={(e) => setFormData({ ...formData, claudeApiKey: e.target.value })}
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                  />
                  {settings?.hasClaudeApiKey && (
                    <span className="px-3 py-2 bg-green-100 text-green-800 rounded-md text-sm flex items-center">
                      ✓ {t('configured')}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => saveApiKey('claude')}
                    disabled={savingOpenai || !formData.claudeApiKey.trim()}
                    className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 text-sm font-medium"
                  >
                    {savingOpenai ? '⏳...' : '💾 Kaydet'}
                  </button>
                </div>
                {apiSaveMessage.claude && (
                  <div className={`mt-2 p-2 rounded text-sm ${apiSaveMessage.claude.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                    {apiSaveMessage.claude.type === 'success' ? '✅' : '❌'} {apiSaveMessage.claude.text}
                  </div>
                )}
                <p className="text-xs text-gray-500 mt-2">
                  💡 Claude API Key almak için: <a href="https://console.anthropic.com/" target="_blank" rel="noopener" className="text-blue-600 hover:underline">console.anthropic.com</a>
                </p>
              </div>
            )}

            {/* ElevenLabs API Key */}
            {formData.ttsProvider === 'elevenlabs' && (
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
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                  />
                  {settings?.hasElevenlabsApiKey && (
                    <span className="px-3 py-2 bg-green-100 text-green-800 rounded-md text-sm flex items-center">
                      ✓ {t('configured')}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => saveApiKey('elevenlabs')}
                    disabled={savingElevenlabs || !formData.elevenlabsApiKey.trim()}
                    className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 text-sm font-medium"
                  >
                    {savingElevenlabs ? '⏳...' : '💾 Kaydet'}
                  </button>
                  <button
                    type="button"
                    onClick={() => testApi('elevenlabs')}
                    disabled={testingElevenlabs || !settings?.hasElevenlabsApiKey}
                    className="px-4 py-2 bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200 disabled:opacity-50 text-sm font-medium"
                  >
                    {testingElevenlabs ? '⏳ Test...' : '🧪 Test'}
                  </button>
                </div>
                {apiSaveMessage.elevenlabs && (
                  <div className={`mt-2 p-2 rounded text-sm ${apiSaveMessage.elevenlabs.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                    {apiSaveMessage.elevenlabs.type === 'success' ? '✅' : '❌'} {apiSaveMessage.elevenlabs.text}
                  </div>
                )}
                {testResults.elevenlabs && (
                  <div className={`mt-2 p-2 rounded text-sm ${testResults.elevenlabs.success ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                    {testResults.elevenlabs.success ? '✅' : '❌'} {testResults.elevenlabs.message}
                  </div>
                )}
              </div>
            )}

            {/* ImageFX Cookie */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                ImageFX Google Cookie
              </label>
              <div className="flex gap-2">
                <textarea
                  placeholder={settings?.hasImagefxCookie ? settings.imagefxCookieMasked || '••••••••' : 'Google cookie değeri...'}
                  value={formData.imagefxCookie}
                  onChange={(e) => setFormData({ ...formData, imagefxCookie: e.target.value })}
                  rows={2}
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 text-sm"
                />
                <div className="flex flex-col gap-2">
                  {settings?.hasImagefxCookie && (
                    <span className="px-3 py-2 bg-green-100 text-green-800 rounded-md text-sm text-center">
                      ✓ {t('configured')}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => saveApiKey('imagefx')}
                    disabled={savingImagefx || !formData.imagefxCookie.trim()}
                    className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 text-sm font-medium"
                  >
                    {savingImagefx ? '⏳...' : '💾 Kaydet'}
                  </button>
                  <button
                    type="button"
                    onClick={() => testApi('imagefx')}
                    disabled={testingImagefx || !settings?.hasImagefxCookie}
                    className="px-4 py-2 bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200 disabled:opacity-50 text-sm font-medium"
                  >
                    {testingImagefx ? '⏳ Test...' : '🧪 Test'}
                  </button>
                </div>
              </div>
              {apiSaveMessage.imagefx && (
                <div className={`mt-2 p-2 rounded text-sm ${apiSaveMessage.imagefx.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                  {apiSaveMessage.imagefx.type === 'success' ? '✅' : '❌'} {apiSaveMessage.imagefx.text}
                </div>
              )}
              {testResults.imagefx && (
                <div className={`mt-2 p-2 rounded text-sm ${testResults.imagefx.success ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                  {testResults.imagefx.success ? '✅' : '❌'} {testResults.imagefx.message}
                </div>
              )}
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
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 bg-white"
                >
                  <option value="gpt-4o-mini">GPT-4o Mini (Önerilen)</option>
                  <option value="gpt-4o">GPT-4o</option>
                  <option value="gpt-4-turbo">GPT-4 Turbo</option>
                </select>
              </div>

              {/* ElevenLabs Model (only when ElevenLabs selected) */}
              {formData.ttsProvider === 'elevenlabs' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    ElevenLabs Modeli
                  </label>
                  <select
                    value={formData.defaultElevenlabsModel}
                    onChange={(e) => setFormData({ ...formData, defaultElevenlabsModel: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 bg-white"
                  >
                    <option value="eleven_flash_v2_5">Flash v2.5 (Önerilen)</option>
                    <option value="eleven_turbo_v2_5">Turbo v2.5</option>
                    <option value="eleven_multilingual_v2">Multilingual v2</option>
                  </select>
                </div>
              )}

              {/* ImageFX Model */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {t('imagefxModel')}
                </label>
                <select
                  value={formData.defaultImagefxModel}
                  onChange={(e) => setFormData({ ...formData, defaultImagefxModel: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 bg-white"
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
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 bg-white"
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
