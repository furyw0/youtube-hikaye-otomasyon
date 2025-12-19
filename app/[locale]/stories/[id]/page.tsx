/**
 * Hikaye Detay Sayfası
 * Orijinal, çeviri ve Türkçe metinlerle birlikte görsel ve ses dosyalarını gösterir
 */

'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useParams } from 'next/navigation';
import { Link } from '@/i18n/navigation';
import { AuthGuard } from '@/components/auth/AuthGuard';

interface SceneHook {
  hookType: 'intro' | 'subscribe' | 'like' | 'comment' | 'outro';
  text: string;
  position: 'before' | 'after';
}

interface Scene {
  _id: string;
  sceneNumber: number;
  sceneTextOriginal: string;
  sceneTextAdapted: string;
  sceneTextTurkish?: string; // Türkçe çeviri (eğer hedef dil Türkçe değilse)
  hasImage: boolean;
  imageIndex?: number;
  visualPrompt?: string;
  estimatedDuration: number;
  actualDuration?: number;
  hook?: SceneHook;
  blobUrls: {
    image?: string;
    audio?: string;
    textOriginal?: string;
    textAdapted?: string;
  };
}

interface Story {
  _id: string;
  originalTitle: string;
  adaptedTitle?: string;
  originalLanguage: string;
  targetLanguage: string;
  targetCountry: string;
  translationOnly?: boolean;
  enableHooks?: boolean;
  status: string;
  progress: number;
  totalScenes: number;
  totalImages: number;
  actualDuration?: number;
  openaiModel: string;
  voiceName?: string;
  ttsProvider?: string;
  coquiVoiceName?: string;
  // İçerikler
  originalContent?: string;
  translatedContent?: string;
  adaptedContent?: string;
  // YouTube Metadata
  originalYoutubeDescription?: string;
  originalCoverText?: string;
  adaptedYoutubeDescription?: string;
  adaptedCoverText?: string;
  // Stiller ve Senaryolar
  visualStyleId?: string;
  promptScenarioId?: string;
  // Karakter Sayıları
  originalContentLength?: number;
  translatedContentLength?: number;
  adaptedContentLength?: number;
  // Dosyalar
  blobUrls?: {
    zipFile?: string;
    thumbnail?: string;
  };
  // YouTube Yayın
  youtubeUrl?: string;
  youtubePublishedAt?: string;
  scenes: Scene[];
  createdAt: string;
  updatedAt: string;
}

type TabType = 'overview' | 'scenes' | 'metadata' | 'files';

export default function StoryDetailPage() {
  return (
    <AuthGuard>
      <StoryDetailContent />
    </AuthGuard>
  );
}

function StoryDetailContent() {
  const t = useTranslations('storyDetail');
  const params = useParams();
  const storyId = params.id as string;

  const [story, setStory] = useState<Story | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<TabType>('scenes');
  const [expandedScenes, setExpandedScenes] = useState<Set<number>>(new Set());
  const [showOriginal, setShowOriginal] = useState(true);
  const [showTurkish, setShowTurkish] = useState(true);
  const [markingComplete, setMarkingComplete] = useState(false);
  // YouTube URL state
  const [youtubeUrlInput, setYoutubeUrlInput] = useState('');
  const [savingYoutubeUrl, setSavingYoutubeUrl] = useState(false);
  const [showYoutubeInput, setShowYoutubeInput] = useState(false);

  useEffect(() => {
    if (storyId) {
      fetchStory();
    }
  }, [storyId]);

  // Manuel olarak tamamla
  const markAsComplete = async () => {
    if (!confirm('Hikayeyi manuel olarak tamamlandı olarak işaretlemek istediğinize emin misiniz?')) {
      return;
    }
    
    setMarkingComplete(true);
    try {
      const response = await fetch(`/api/stories/${storyId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'complete' })
      });
      
      const data = await response.json();
      
      if (data.success) {
        // Story'yi yeniden yükle
        fetchStory();
      } else {
        alert('Hata: ' + (data.error || 'Bilinmeyen hata'));
      }
    } catch (error) {
      alert('İşlem başarısız oldu');
    } finally {
      setMarkingComplete(false);
    }
  };

  // YouTube URL kaydet
  const saveYoutubeUrl = async () => {
    if (!youtubeUrlInput.trim()) {
      alert('YouTube URL girmelisiniz');
      return;
    }

    setSavingYoutubeUrl(true);
    try {
      const response = await fetch(`/api/stories/${storyId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'setYoutubeUrl', youtubeUrl: youtubeUrlInput.trim() })
      });
      
      const data = await response.json();
      
      if (data.success) {
        fetchStory();
        setShowYoutubeInput(false);
        setYoutubeUrlInput('');
      } else {
        alert('Hata: ' + (data.error || 'Bilinmeyen hata'));
      }
    } catch (error) {
      alert('İşlem başarısız oldu');
    } finally {
      setSavingYoutubeUrl(false);
    }
  };

  // YouTube URL kaldır
  const removeYoutubeUrl = async () => {
    if (!confirm('YouTube linkini kaldırmak istediğinize emin misiniz?')) {
      return;
    }

    try {
      const response = await fetch(`/api/stories/${storyId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'removeYoutubeUrl' })
      });
      
      const data = await response.json();
      
      if (data.success) {
        fetchStory();
      } else {
        alert('Hata: ' + (data.error || 'Bilinmeyen hata'));
      }
    } catch (error) {
      alert('İşlem başarısız oldu');
    }
  };

  const fetchStory = async () => {
    try {
      const response = await fetch(`/api/stories/${storyId}`);
      const data = await response.json();
      
      if (data.success) {
        setStory(data.story);
        // DEBUG: Scenes ve blobUrls kontrolü
        console.log('📊 Story data:', {
          storyId: data.story._id,
          status: data.story.status,
          totalScenes: data.story.scenes?.length,
          scenesWithImages: data.story.scenes?.filter((s: any) => s.blobUrls?.image).length,
          scenesWithAudio: data.story.scenes?.filter((s: any) => s.blobUrls?.audio).length,
          firstSceneBlobUrls: data.story.scenes?.[0]?.blobUrls,
          adaptedYoutubeDescription: data.story.adaptedYoutubeDescription,
          adaptedCoverText: data.story.adaptedCoverText
        });
      }
    } catch (error) {
      console.error('Hikaye yüklenemedi:', error);
    } finally {
      setLoading(false);
    }
  };

  const toggleScene = (sceneNumber: number) => {
    const newExpanded = new Set(expandedScenes);
    if (newExpanded.has(sceneNumber)) {
      newExpanded.delete(sceneNumber);
    } else {
      newExpanded.add(sceneNumber);
    }
    setExpandedScenes(newExpanded);
  };

  // Dosya indirme fonksiyonu (cross-origin blob URL'ler için)
  const handleDownload = async (url: string, filename: string) => {
    try {
      const response = await fetch(url);
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      
      // Cleanup
      URL.revokeObjectURL(objectUrl);
    } catch (error) {
      console.error('İndirme hatası:', error);
      // Fallback: yeni sekmede aç
      window.open(url, '_blank');
    }
  };

  // Metin kopyalama fonksiyonu
  const copyToClipboard = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      alert(`${label} kopyalandı!`);
    } catch (err) {
      console.error('Kopyalama hatası:', err);
    }
  };

  const getLanguageName = (code: string) => {
    const languages: Record<string, string> = {
      'tr': 'Türkçe',
      'en': 'İngilizce',
      'de': 'Almanca',
      'fr': 'Fransızca',
      'es': 'İspanyolca',
      'ar': 'Arapça',
      'ru': 'Rusça',
      'ja': 'Japonca',
      'ko': 'Korece',
      'zh': 'Çince'
    };
    return languages[code] || code.toUpperCase();
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed': return 'bg-green-100 text-green-800';
      case 'processing': return 'bg-blue-100 text-blue-800';
      case 'queued': return 'bg-yellow-100 text-yellow-800';
      case 'failed': return 'bg-red-100 text-red-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (!story) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="text-6xl mb-4">😕</div>
          <h2 className="text-xl font-semibold text-gray-700 mb-4">Hikaye bulunamadı</h2>
          <Link href="/stories" className="text-blue-600 hover:underline">
            ← Hikayelere Dön
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm">
        <div className="max-w-6xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div>
              <Link href="/stories" className="text-sm text-gray-500 hover:text-gray-700">
                ← {t('back')}
              </Link>
              <h1 className="text-xl font-bold text-gray-900 mt-1">
                {story.adaptedTitle || story.originalTitle}
              </h1>
              {story.adaptedTitle && (
                <p className="text-sm text-gray-500">{story.originalTitle}</p>
              )}
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              {/* YouTube Badge */}
              {story.youtubeUrl && (
                <a 
                  href={story.youtubeUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-3 py-1 text-sm rounded-full bg-red-100 text-red-700 hover:bg-red-200 flex items-center gap-1"
                >
                  ▶️ YouTube&apos;da İzle
                </a>
              )}
              {story.translationOnly && (
                <span className="px-3 py-1 text-sm rounded-full bg-purple-100 text-purple-800">
                  🌐 Sadece Çeviri
                </span>
              )}
              {story.enableHooks && (
                <span className="px-3 py-1 text-sm rounded-full bg-green-100 text-green-800">
                  📢 Hook&apos;lar Aktif
                </span>
              )}
              <span className={`px-3 py-1 text-sm rounded-full ${getStatusColor(story.status)}`}>
                {story.status === 'completed' ? '✓ Tamamlandı' : 
                 story.status === 'processing' ? `İşleniyor ${story.progress}%` : 
                 story.status}
              </span>
              {story.status === 'completed' && (
                <a 
                  href={`/api/download/${story._id}`}
                  className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700"
                >
                  ⬇️ {t('downloadAll')}
                </a>
              )}
              {/* Manuel Tamamla butonu - sadece processing durumunda ve %90+ ilerleme */}
              {story.status === 'processing' && story.progress >= 90 && (
                <button
                  onClick={markAsComplete}
                  disabled={markingComplete}
                  className="px-4 py-2 bg-orange-500 text-white rounded-md hover:bg-orange-600 disabled:opacity-50"
                  title="Inngest&apos;te tamamlanmış ama panelde takılı kalmış hikayeler için"
                >
                  {markingComplete ? '⏳ İşleniyor...' : '✅ Manuel Tamamla'}
                </button>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Tabs */}
      <div className="bg-white border-b">
        <div className="max-w-6xl mx-auto px-4">
          <nav className="flex gap-6">
            {(['overview', 'scenes', 'metadata', 'files'] as TabType[]).map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`py-4 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === tab 
                    ? 'border-blue-600 text-blue-600' 
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                {tab === 'overview' && '📋 Genel Bakış'}
                {tab === 'scenes' && '🎬 Sahneler'}
                {tab === 'metadata' && '📝 YouTube Metadata'}
                {tab === 'files' && '📁 Dosyalar'}
              </button>
            ))}
          </nav>
        </div>
      </div>

      {/* Content */}
      <main className="max-w-6xl mx-auto px-4 py-6">
        {/* Overview Tab */}
        {activeTab === 'overview' && (
          <div className="space-y-6">
            {/* YouTube Yayın Durumu */}
            <div className={`rounded-lg shadow-sm p-6 ${story.youtubeUrl ? 'bg-red-50 border border-red-200' : 'bg-white'}`}>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                  📺 YouTube Yayın Durumu
                  {story.youtubeUrl && (
                    <span className="px-2 py-0.5 text-xs rounded-full bg-red-100 text-red-700">
                      Yayınlandı
                    </span>
                  )}
                </h3>
              </div>
              
              {story.youtubeUrl ? (
                <div className="space-y-3">
                  <div className="flex items-center gap-3 p-3 bg-white rounded-lg border border-red-200">
                    <span className="text-2xl">▶️</span>
                    <div className="flex-1 min-w-0">
                      <a 
                        href={story.youtubeUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-red-600 hover:text-red-800 font-medium truncate block"
                      >
                        {story.youtubeUrl}
                      </a>
                      {story.youtubePublishedAt && (
                        <p className="text-xs text-gray-500 mt-1">
                          Eklendi: {new Date(story.youtubePublishedAt).toLocaleDateString('tr-TR', {
                            day: 'numeric',
                            month: 'long',
                            year: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit'
                          })}
                        </p>
                      )}
                    </div>
                    <button
                      onClick={removeYoutubeUrl}
                      className="px-3 py-1.5 text-sm bg-gray-100 text-gray-600 hover:bg-gray-200 rounded-md"
                    >
                      Kaldır
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  {showYoutubeInput ? (
                    <div className="flex gap-2">
                      <input
                        type="url"
                        value={youtubeUrlInput}
                        onChange={(e) => setYoutubeUrlInput(e.target.value)}
                        placeholder="https://youtube.com/watch?v=... veya https://youtu.be/..."
                        className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent text-gray-900"
                      />
                      <button
                        onClick={saveYoutubeUrl}
                        disabled={savingYoutubeUrl}
                        className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50"
                      >
                        {savingYoutubeUrl ? '⏳' : '💾 Kaydet'}
                      </button>
                      <button
                        onClick={() => { setShowYoutubeInput(false); setYoutubeUrlInput(''); }}
                        className="px-4 py-2 bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200"
                      >
                        İptal
                      </button>
                    </div>
                  ) : (
                    <div className="text-center py-4">
                      <p className="text-gray-500 mb-3">Bu hikaye henüz YouTube&apos;a yüklenmedi</p>
                      <button
                        onClick={() => setShowYoutubeInput(true)}
                        className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 flex items-center gap-2 mx-auto"
                      >
                        ▶️ YouTube Linki Ekle
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Genel Bilgiler */}
            <div className="bg-white rounded-lg shadow-sm p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Hikaye Bilgileri</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
                <div>
                  <span className="text-sm text-gray-500">{t('overview.originalLanguage')}</span>
                  <p className="font-medium">{getLanguageName(story.originalLanguage)}</p>
                </div>
                <div>
                  <span className="text-sm text-gray-500">{t('overview.targetLanguage')}</span>
                  <p className="font-medium">{getLanguageName(story.targetLanguage)}</p>
                </div>
                <div>
                  <span className="text-sm text-gray-500">{t('overview.targetCountry')}</span>
                  <p className="font-medium">{story.targetCountry}</p>
                </div>
                <div>
                  <span className="text-sm text-gray-500">Model</span>
                  <p className="font-medium">{story.openaiModel}</p>
                </div>
                <div>
                  <span className="text-sm text-gray-500">{t('overview.totalScenes')}</span>
                  <p className="font-medium">{story.totalScenes || story.scenes?.length || 0}</p>
                </div>
                <div>
                  <span className="text-sm text-gray-500">{t('overview.totalImages')}</span>
                  <p className="font-medium">{story.totalImages || 0}</p>
                </div>
                <div>
                  <span className="text-sm text-gray-500">{t('overview.totalDuration')}</span>
                  <p className="font-medium">
                    {story.actualDuration ? `${Math.round(story.actualDuration / 60)} dk` : '-'}
                  </p>
                </div>
                <div>
                  <span className="text-sm text-gray-500">Ses</span>
                  <p className="font-medium">
                    {story.ttsProvider === 'coqui' 
                      ? `Coqui: ${story.coquiVoiceName || '-'}` 
                      : story.voiceName || '-'}
                  </p>
                </div>
                <div>
                  <span className="text-sm text-gray-500">Çeviri Modu</span>
                  <p className="font-medium">
                    {story.translationOnly ? '🌐 Sadece Çeviri' : '🎭 Adaptasyonlu'}
                  </p>
                </div>
                <div>
                  <span className="text-sm text-gray-500">YouTube Hook&apos;ları</span>
                  <p className="font-medium">
                    {story.enableHooks ? '📢 Aktif' : '❌ Kapalı'}
                  </p>
                </div>
              </div>
            </div>

            {/* Hook Özeti (eğer aktifse) */}
            {story.enableHooks && story.scenes && story.scenes.length > 0 && (
              <div className="bg-white rounded-lg shadow p-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">📢 Hook Özeti</h3>
                <div className="space-y-2">
                  {story.scenes.filter(s => s.hook).map(scene => (
                    <div
                      key={scene._id}
                      className={`flex items-center justify-between p-3 rounded-lg ${getHookBgColor(scene.hook?.hookType || '')}`}
                    >
                      <div className="flex items-center gap-3">
                        <span className="text-lg">{getHookEmoji(scene.hook?.hookType || '')}</span>
                        <div>
                          <span className="font-medium text-sm">
                            Sahne {scene.sceneNumber} - {getHookLabel(scene.hook?.hookType || '')}
                          </span>
                          <p className="text-xs text-gray-600 mt-0.5">
                            {scene.hook?.position === 'before' ? 'Sahne öncesi' : 'Sahne sonrası'}
                          </p>
                        </div>
                      </div>
                      <p className="text-sm text-gray-700 italic max-w-md truncate">
                        &ldquo;{scene.hook?.text}&rdquo;
                      </p>
                    </div>
                  ))}
                  {story.scenes.filter(s => s.hook).length === 0 && (
                    <p className="text-gray-500 text-sm">Henüz hook eklenmemiş</p>
                  )}
                </div>
              </div>
            )}

            {/* Karakter Sayıları Kartı */}
            {(() => {
              // Karakter sayılarını hesapla (kaydedilmiş veya içerikten)
              const originalLen = story.originalContentLength || (story.originalContent?.length ?? 0);
              const translatedLen = story.translatedContentLength || (story.translatedContent?.length ?? 0);
              const adaptedLen = story.adaptedContentLength || (story.adaptedContent?.length ?? 0);
              
              // En az orijinal içerik varsa göster
              if (originalLen === 0 && !story.originalContent) {
                return null;
              }

              return (
                <div className="bg-white rounded-lg shadow-sm p-6">
                  <h3 className="text-lg font-semibold text-gray-900 mb-4">📊 Karakter Sayıları</h3>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {/* Orijinal */}
                    <div className="bg-gray-50 rounded-lg p-4 text-center">
                      <div className="text-3xl font-bold text-gray-900">
                        {originalLen.toLocaleString('tr-TR')}
                      </div>
                      <div className="text-sm text-gray-500 mt-1">Orijinal Hikaye</div>
                      <div className="text-xs text-gray-400 mt-1">
                        ~{Math.round(originalLen / 5).toLocaleString('tr-TR')} kelime
                      </div>
                    </div>

                    {/* Çeviri */}
                    {translatedLen > 0 && (
                      <div className="bg-blue-50 rounded-lg p-4 text-center">
                        <div className="text-3xl font-bold text-blue-900">
                          {translatedLen.toLocaleString('tr-TR')}
                        </div>
                        <div className="text-sm text-blue-600 mt-1">Çeviri Sonrası</div>
                        <div className="text-xs mt-1">
                          {(() => {
                            const diff = ((translatedLen - originalLen) / originalLen * 100);
                            const isPositive = diff >= 0;
                            return (
                              <span className={isPositive ? 'text-green-600' : 'text-red-600'}>
                                {isPositive ? '+' : ''}{diff.toFixed(1)}% fark
                              </span>
                            );
                          })()}
                        </div>
                      </div>
                    )}

                    {/* Adaptasyon / Final */}
                    {adaptedLen > 0 && (
                      <div className="bg-purple-50 rounded-lg p-4 text-center">
                        <div className="text-3xl font-bold text-purple-900">
                          {adaptedLen.toLocaleString('tr-TR')}
                        </div>
                        <div className="text-sm text-purple-600 mt-1">
                          {story.translationOnly ? 'Final (Çeviri)' : 'Adaptasyon Sonrası'}
                        </div>
                        <div className="text-xs mt-1">
                          {(() => {
                            const diff = ((adaptedLen - originalLen) / originalLen * 100);
                            const isWithinTolerance = Math.abs(diff) <= 5;
                            return (
                              <span className={isWithinTolerance ? 'text-green-600' : 'text-orange-600'}>
                                {diff >= 0 ? '+' : ''}{diff.toFixed(1)}% fark
                                {isWithinTolerance && ' ✓'}
                              </span>
                            );
                          })()}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Tolerans Bilgisi */}
                  <div className="mt-4 text-xs text-gray-500 text-center">
                    💡 Hedef: Orijinal hikaye ile final hikaye arasında maksimum %5 fark
                  </div>
                </div>
              );
            })()}

            {/* Kapak Yazısı Kartı */}
            {story.adaptedCoverText && (
              <div className="bg-gradient-to-r from-purple-500 to-pink-500 rounded-lg shadow-sm p-6 text-white">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-semibold">🖼️ Kapak Yazısı (Thumbnail)</h3>
                  <button
                    onClick={() => copyToClipboard(story.adaptedCoverText!, 'Kapak yazısı')}
                    className="px-3 py-1 bg-white/20 hover:bg-white/30 rounded-lg text-sm"
                  >
                    📋 Kopyala
                  </button>
                </div>
                <p className="text-2xl font-bold">{story.adaptedCoverText}</p>
                {story.originalCoverText && (
                  <p className="text-sm opacity-75 mt-2">
                    Orijinal: {story.originalCoverText}
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {/* Metadata Tab */}
        {activeTab === 'metadata' && (
          <div className="space-y-6">
            {/* YouTube Thumbnail (Kapak Görseli) */}
            <div className="bg-white rounded-lg shadow-sm p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-gray-900">🎬 YouTube Kapak Görseli</h3>
                {story.blobUrls?.thumbnail && (
                  <button
                    onClick={() => handleDownload(story.blobUrls!.thumbnail!, 'thumbnail.png')}
                    className="px-3 py-1.5 bg-blue-100 text-blue-700 hover:bg-blue-200 rounded-lg text-sm flex items-center gap-1"
                  >
                    ⬇️ İndir
                  </button>
                )}
              </div>
              
              {story.blobUrls?.thumbnail ? (
                <div className="relative">
                  <img 
                    src={story.blobUrls.thumbnail} 
                    alt="YouTube Thumbnail"
                    className="w-full max-w-2xl rounded-lg shadow-lg mx-auto"
                  />
                  {story.adaptedCoverText && (
                    <div className="absolute bottom-4 left-4 right-4 bg-black/70 text-white p-3 rounded-lg">
                      <p className="text-lg font-bold text-center">{story.adaptedCoverText}</p>
                    </div>
                  )}
                </div>
              ) : (
                <div className="bg-gray-100 rounded-lg p-12 text-center text-gray-500">
                  <div className="text-4xl mb-2">🖼️</div>
                  <p>Kapak görseli henüz oluşturulmamış</p>
                  <p className="text-xs mt-1">Hikaye işlendikten sonra otomatik oluşturulacak</p>
                </div>
              )}
              
              <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-800">
                💡 Bu görsel YouTube video kapağı olarak kullanılabilir. Üzerine metin ekleyerek daha dikkat çekici hale getirebilirsiniz.
              </div>
            </div>

            {/* Kapak Yazısı */}
            <div className="bg-white rounded-lg shadow-sm p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-gray-900">✏️ Kapak Yazısı (Thumbnail Text)</h3>
                {story.adaptedCoverText && (
                  <button
                    onClick={() => copyToClipboard(story.adaptedCoverText!, 'Kapak yazısı')}
                    className="px-3 py-1.5 bg-purple-100 text-purple-700 hover:bg-purple-200 rounded-lg text-sm flex items-center gap-1"
                  >
                    📋 Kopyala
                  </button>
                )}
              </div>

              {story.adaptedCoverText ? (
                <div className="bg-gradient-to-r from-purple-500 to-pink-500 rounded-lg p-6 text-white">
                  <p className="text-xl font-bold">{story.adaptedCoverText}</p>
                </div>
              ) : (
                <div className="bg-gray-100 rounded-lg p-6 text-center text-gray-500">
                  Kapak yazısı henüz oluşturulmamış
                </div>
              )}

              {story.originalCoverText && (
                <div className="mt-4 p-4 bg-gray-50 rounded-lg">
                  <p className="text-sm text-gray-500 mb-1">Orijinal Kapak Yazısı:</p>
                  <p className="text-gray-700">{story.originalCoverText}</p>
                </div>
              )}
            </div>

            {/* YouTube Açıklaması */}
            <div className="bg-white rounded-lg shadow-sm p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-gray-900">📺 YouTube Açıklaması</h3>
                {story.adaptedYoutubeDescription && (
                  <button
                    onClick={() => copyToClipboard(story.adaptedYoutubeDescription!, 'YouTube açıklaması')}
                    className="px-3 py-1.5 bg-red-100 text-red-700 hover:bg-red-200 rounded-lg text-sm flex items-center gap-1"
                  >
                    📋 Kopyala
                  </button>
                )}
              </div>
              
              {story.adaptedYoutubeDescription ? (
                <div className="bg-gray-50 rounded-lg p-4">
                  <pre className="whitespace-pre-wrap text-sm text-gray-700 font-sans">
                    {story.adaptedYoutubeDescription}
                  </pre>
                </div>
              ) : (
                <div className="bg-gray-100 rounded-lg p-6 text-center text-gray-500">
                  YouTube açıklaması henüz oluşturulmamış
                </div>
              )}
              
              {story.originalYoutubeDescription && (
                <div className="mt-4 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-sm font-medium text-yellow-800">Orijinal YouTube Açıklaması:</p>
                    <button
                      onClick={() => copyToClipboard(story.originalYoutubeDescription!, 'Orijinal açıklama')}
                      className="text-xs text-yellow-700 hover:underline"
                    >
                      Kopyala
                    </button>
                  </div>
                  <pre className="whitespace-pre-wrap text-sm text-gray-700 font-sans">
                    {story.originalYoutubeDescription}
                  </pre>
                </div>
              )}
            </div>

            {/* Kullanım İpuçları */}
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <h4 className="font-medium text-blue-900 mb-2">💡 Kullanım İpuçları</h4>
              <ul className="text-sm text-blue-800 space-y-1">
                <li>• <strong>Kapak yazısını</strong> YouTube thumbnail&apos;ınıza ekleyin</li>
                <li>• <strong>YouTube açıklamasını</strong> video açıklamanıza yapıştırın</li>
                <li>• Hashtag&apos;leri düzenlemeniz gerekebilir</li>
              </ul>
            </div>
          </div>
        )}

        {/* Scenes Tab */}
        {activeTab === 'scenes' && (
          <div className="space-y-4">
            {/* Controls */}
            <div className="flex flex-wrap gap-4 items-center justify-between bg-white p-4 rounded-lg shadow-sm">
              <div className="flex gap-3">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={showOriginal}
                    onChange={(e) => setShowOriginal(e.target.checked)}
                    className="rounded border-gray-300"
                  />
                  <span>Orijinal ({getLanguageName(story.originalLanguage)})</span>
                </label>
                {story.targetLanguage !== 'tr' && (
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={showTurkish}
                      onChange={(e) => setShowTurkish(e.target.checked)}
                      className="rounded border-gray-300"
                    />
                    <span>Türkçe</span>
                  </label>
                )}
              </div>
              <button
                onClick={() => setExpandedScenes(
                  expandedScenes.size === (story.scenes?.length || 0) 
                    ? new Set() 
                    : new Set(story.scenes?.map(s => s.sceneNumber) || [])
                )}
                className="text-sm text-blue-600 hover:text-blue-800"
              >
                {expandedScenes.size === (story.scenes?.length || 0) 
                  ? 'Tümünü Daralt' 
                  : 'Tümünü Genişlet'}
              </button>
            </div>

            {/* Scenes List */}
            {story.scenes?.map((scene) => (
              <div 
                key={scene._id || scene.sceneNumber} 
                className="bg-white rounded-lg shadow-sm overflow-hidden"
              >
                {/* Scene Header */}
                <div 
                  className="p-4 border-b cursor-pointer hover:bg-gray-50"
                  onClick={() => toggleScene(scene.sceneNumber)}
                >
                    <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3 flex-wrap">
                      <span className="text-lg font-semibold text-gray-900">
                        Sahne {scene.sceneNumber}
                      </span>
                      {scene.hasImage && (
                        <span className="px-2 py-0.5 bg-purple-100 text-purple-700 text-xs rounded-full">
                          🖼️ Görsel {scene.imageIndex}
                        </span>
                      )}
                      {scene.hook && (
                        <span className={`px-2 py-0.5 text-xs rounded-full ${getHookBadgeColor(scene.hook.hookType)}`}>
                          {getHookEmoji(scene.hook.hookType)} {getHookLabel(scene.hook.hookType)}
                        </span>
                      )}
                      {scene.actualDuration && (
                        <span className="px-2 py-0.5 bg-gray-100 text-gray-600 text-xs rounded-full">
                          ⏱️ {Math.round(scene.actualDuration)}s
                        </span>
                      )}
                    </div>
                    <span className="text-gray-400">
                      {expandedScenes.has(scene.sceneNumber) ? '▼' : '▶'}
                    </span>
                  </div>
                </div>

                {/* Scene Content (expanded) */}
                {expandedScenes.has(scene.sceneNumber) && (
                  <div className="p-4">
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                      {/* Left: Texts */}
                      <div className="lg:col-span-2 space-y-4">
                        {/* Original Text */}
                        {showOriginal && (
                          <div className="bg-gray-50 rounded-lg p-4">
                            <h4 className="text-sm font-medium text-gray-500 mb-2 flex items-center gap-2">
                              <span className="w-2 h-2 bg-gray-400 rounded-full"></span>
                              {t('scene.original')} ({getLanguageName(story.originalLanguage)})
                            </h4>
                            <p className="text-gray-700 text-sm leading-relaxed">
                              {scene.sceneTextOriginal}
                            </p>
                          </div>
                        )}

                        {/* Adapted Text with Hook */}
                        <div className="bg-blue-50 rounded-lg p-4">
                          <h4 className="text-sm font-medium text-blue-700 mb-2 flex items-center gap-2">
                            <span className="w-2 h-2 bg-blue-500 rounded-full"></span>
                            {t('scene.adapted')} ({getLanguageName(story.targetLanguage)})
                            {scene.hook && (
                              <span className={`ml-2 px-2 py-0.5 text-xs rounded-full ${getHookBadgeColor(scene.hook.hookType)}`}>
                                {getHookEmoji(scene.hook.hookType)} {getHookLabel(scene.hook.hookType)}
                              </span>
                            )}
                          </h4>
                          
                          {/* Hook Before (if position is 'before') */}
                          {scene.hook && scene.hook.position === 'before' && (
                            <div className={`mb-3 p-3 rounded-lg border-l-4 ${getHookStyleClasses(scene.hook.hookType)}`}>
                              <div className="flex items-center gap-2 mb-1">
                                <span>{getHookEmoji(scene.hook.hookType)}</span>
                                <span className="text-xs font-medium opacity-75">{getHookLabel(scene.hook.hookType)} (Sahne Öncesi)</span>
                              </div>
                              <p className="text-sm italic">&ldquo;{scene.hook.text}&rdquo;</p>
                            </div>
                          )}
                          
                          {/* Main Adapted Text */}
                          <p className="text-gray-700 text-sm leading-relaxed">
                            {scene.sceneTextAdapted}
                          </p>
                          
                          {/* Hook After (if position is 'after') */}
                          {scene.hook && scene.hook.position === 'after' && (
                            <div className={`mt-3 p-3 rounded-lg border-l-4 ${getHookStyleClasses(scene.hook.hookType)}`}>
                              <div className="flex items-center gap-2 mb-1">
                                <span>{getHookEmoji(scene.hook.hookType)}</span>
                                <span className="text-xs font-medium opacity-75">{getHookLabel(scene.hook.hookType)} (Sahne Sonrası)</span>
                              </div>
                              <p className="text-sm italic">&ldquo;{scene.hook.text}&rdquo;</p>
                            </div>
                          )}
                        </div>

                        {/* Turkish Text (if target is not Turkish) */}
                        {showTurkish && story.targetLanguage !== 'tr' && scene.sceneTextTurkish && (
                          <div className="bg-green-50 rounded-lg p-4">
                            <h4 className="text-sm font-medium text-green-700 mb-2 flex items-center gap-2">
                              <span className="w-2 h-2 bg-green-500 rounded-full"></span>
                              {t('scene.turkish')}
                            </h4>
                            <p className="text-gray-700 text-sm leading-relaxed">
                              {scene.sceneTextTurkish}
                            </p>
                          </div>
                        )}
                      </div>

                      {/* Right: Media */}
                      <div className="space-y-4">
                        {/* Image */}
                        {scene.hasImage && scene.blobUrls?.image ? (
                          <div>
                            <h4 className="text-sm font-medium text-gray-500 mb-2">
                              {t('scene.image')}
                            </h4>
                            <img 
                              src={scene.blobUrls.image} 
                              alt={`Sahne ${scene.sceneNumber}`}
                              className="w-full rounded-lg"
                            />
                            <button 
                              onClick={() => handleDownload(scene.blobUrls.image!, `sahne-${scene.sceneNumber}.png`)}
                              className="mt-2 inline-flex items-center text-sm text-blue-600 hover:text-blue-800 cursor-pointer"
                            >
                              ⬇️ {t('scene.download')}
                            </button>
                          </div>
                        ) : scene.hasImage ? (
                          <div className="bg-gray-100 rounded-lg p-8 text-center text-gray-400">
                            🖼️ {t('scene.noImage')}
                          </div>
                        ) : null}

                        {/* Audio */}
                        {scene.blobUrls?.audio ? (
                          <div>
                            <h4 className="text-sm font-medium text-gray-500 mb-2">
                              {t('scene.audio')}
                            </h4>
                            <audio 
                              controls 
                              className="w-full"
                              preload="metadata"
                            >
                              <source src={scene.blobUrls.audio} type="audio/mpeg" />
                            </audio>
                            <button 
                              onClick={() => handleDownload(scene.blobUrls.audio!, `sahne-${scene.sceneNumber}.mp3`)}
                              className="mt-2 inline-flex items-center text-sm text-blue-600 hover:text-blue-800 cursor-pointer"
                            >
                              ⬇️ {t('scene.download')}
                            </button>
                          </div>
                        ) : (
                          <div className="bg-gray-100 rounded-lg p-4 text-center text-gray-400 text-sm">
                            🔇 {t('scene.noAudio')}
                          </div>
                        )}

                        {/* Visual Prompt */}
                        {scene.visualPrompt && (
                          <div className="bg-purple-50 rounded-lg p-3">
                            <h4 className="text-xs font-medium text-purple-600 mb-1">
                              Görsel Prompt
                            </h4>
                            <p className="text-xs text-gray-600 leading-relaxed">
                              {scene.visualPrompt.substring(0, 200)}...
                            </p>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Files Tab */}
        {activeTab === 'files' && (
          <div className="bg-white rounded-lg shadow-sm p-6">
            <h3 className="font-semibold mb-4">Tüm Dosyalar</h3>
            <div className="space-y-2">
              {story.scenes?.map((scene) => (
                <div key={scene.sceneNumber} className="flex items-center justify-between py-2 border-b last:border-b-0">
                  <span className="text-sm">Sahne {scene.sceneNumber}</span>
                  <div className="flex gap-2">
                    {scene.blobUrls?.image && (
                      <button 
                        onClick={() => handleDownload(scene.blobUrls.image!, `sahne-${scene.sceneNumber}.png`)}
                        className="px-2 py-1 text-xs bg-purple-100 text-purple-700 rounded hover:bg-purple-200 cursor-pointer"
                      >
                        🖼️ Görsel
                      </button>
                    )}
                    {scene.blobUrls?.audio && (
                      <button 
                        onClick={() => handleDownload(scene.blobUrls.audio!, `sahne-${scene.sceneNumber}.mp3`)}
                        className="px-2 py-1 text-xs bg-blue-100 text-blue-700 rounded hover:bg-blue-200 cursor-pointer"
                      >
                        🔊 Ses
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
            
            {/* Download All */}
            {story.status === 'completed' && (
              <div className="mt-6 pt-6 border-t text-center">
                <a 
                  href={`/api/download/${story._id}`}
                  className="inline-flex items-center gap-2 px-6 py-3 bg-green-600 text-white rounded-md hover:bg-green-700"
                >
                  ⬇️ Tüm Dosyaları ZIP Olarak İndir
                </a>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

// Hook helper fonksiyonları
function getHookEmoji(hookType: string): string {
  const emojis: Record<string, string> = {
    intro: '🎬',
    subscribe: '🔔',
    like: '👍',
    comment: '💬',
    outro: '🎯'
  };
  return emojis[hookType] || '📢';
}

function getHookLabel(hookType: string): string {
  const labels: Record<string, string> = {
    intro: 'Giriş Hook',
    subscribe: 'Abone Hook',
    like: 'Beğeni Hook',
    comment: 'Yorum Hook',
    outro: 'Çıkış Hook'
  };
  return labels[hookType] || 'Hook';
}

function getHookBgColor(hookType: string): string {
  const colors: Record<string, string> = {
    intro: 'bg-purple-50',
    subscribe: 'bg-red-50',
    like: 'bg-green-50',
    comment: 'bg-blue-50',
    outro: 'bg-orange-50'
  };
  return colors[hookType] || 'bg-gray-50';
}

function getHookBadgeColor(hookType: string): string {
  const colors: Record<string, string> = {
    intro: 'bg-purple-100 text-purple-700',
    subscribe: 'bg-red-100 text-red-700',
    like: 'bg-green-100 text-green-700',
    comment: 'bg-cyan-100 text-cyan-700',
    outro: 'bg-orange-100 text-orange-700'
  };
  return colors[hookType] || 'bg-gray-100 text-gray-700';
}

function getHookStyleClasses(hookType: string): string {
  const styles: Record<string, string> = {
    intro: 'bg-purple-50 border-purple-400 text-purple-800',
    subscribe: 'bg-red-50 border-red-400 text-red-800',
    like: 'bg-green-50 border-green-400 text-green-800',
    comment: 'bg-cyan-50 border-cyan-400 text-cyan-800',
    outro: 'bg-orange-50 border-orange-400 text-orange-800'
  };
  return styles[hookType] || 'bg-gray-50 border-gray-400 text-gray-800';
}
