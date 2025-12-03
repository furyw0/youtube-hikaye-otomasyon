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
  status: string;
  progress: number;
  totalScenes: number;
  totalImages: number;
  actualDuration?: number;
  openaiModel: string;
  voiceName?: string;
  scenes: Scene[];
  createdAt: string;
  updatedAt: string;
}

type TabType = 'overview' | 'scenes' | 'files';

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

  useEffect(() => {
    if (storyId) {
      fetchStory();
    }
  }, [storyId]);

  const fetchStory = async () => {
    try {
      const response = await fetch(`/api/stories/${storyId}`);
      const data = await response.json();
      
      if (data.success) {
        setStory(data.story);
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
            <div className="flex items-center gap-3">
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
            </div>
          </div>
        </div>
      </header>

      {/* Tabs */}
      <div className="bg-white border-b">
        <div className="max-w-6xl mx-auto px-4">
          <nav className="flex gap-6">
            {(['overview', 'scenes', 'files'] as TabType[]).map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`py-4 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === tab 
                    ? 'border-blue-600 text-blue-600' 
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                {t(`tabs.${tab}`)}
              </button>
            ))}
          </nav>
        </div>
      </div>

      {/* Content */}
      <main className="max-w-6xl mx-auto px-4 py-6">
        {/* Overview Tab */}
        {activeTab === 'overview' && (
          <div className="bg-white rounded-lg shadow-sm p-6">
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
                <p className="font-medium">{story.voiceName || '-'}</p>
              </div>
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
                    <div className="flex items-center gap-3">
                      <span className="text-lg font-semibold text-gray-900">
                        Sahne {scene.sceneNumber}
                      </span>
                      {scene.hasImage && (
                        <span className="px-2 py-0.5 bg-purple-100 text-purple-700 text-xs rounded-full">
                          🖼️ Görsel {scene.imageIndex}
                        </span>
                      )}
                      {scene.actualDuration && (
                        <span className="px-2 py-0.5 bg-gray-100 text-gray-600 text-xs rounded-full">
                          ⏱️ {scene.actualDuration}s
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

                        {/* Adapted Text */}
                        <div className="bg-blue-50 rounded-lg p-4">
                          <h4 className="text-sm font-medium text-blue-700 mb-2 flex items-center gap-2">
                            <span className="w-2 h-2 bg-blue-500 rounded-full"></span>
                            {t('scene.adapted')} ({getLanguageName(story.targetLanguage)})
                          </h4>
                          <p className="text-gray-700 text-sm leading-relaxed">
                            {scene.sceneTextAdapted}
                          </p>
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
                            <a 
                              href={scene.blobUrls.image} 
                              download={`sahne-${scene.sceneNumber}.png`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="mt-2 inline-flex items-center text-sm text-blue-600 hover:text-blue-800"
                            >
                              ⬇️ {t('scene.download')}
                            </a>
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
                            <a 
                              href={scene.blobUrls.audio} 
                              download={`sahne-${scene.sceneNumber}.mp3`}
                              className="mt-2 inline-flex items-center text-sm text-blue-600 hover:text-blue-800"
                            >
                              ⬇️ {t('scene.download')}
                            </a>
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
                      <a 
                        href={scene.blobUrls.image}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-2 py-1 text-xs bg-purple-100 text-purple-700 rounded hover:bg-purple-200"
                      >
                        🖼️ Görsel
                      </a>
                    )}
                    {scene.blobUrls?.audio && (
                      <a 
                        href={scene.blobUrls.audio}
                        download={`sahne-${scene.sceneNumber}.mp3`}
                        className="px-2 py-1 text-xs bg-blue-100 text-blue-700 rounded hover:bg-blue-200"
                      >
                        🔊 Ses
                      </a>
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

