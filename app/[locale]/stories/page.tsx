/**
 * Hikaye Listesi Sayfası
 * Tüm hikayeleri listeler ve filtreleme imkanı sunar
 */

'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { AuthGuard } from '@/components/auth/AuthGuard';

interface Story {
  _id: string;
  originalTitle: string;
  adaptedTitle?: string;
  originalLanguage: string;
  targetLanguage: string;
  targetCountry: string;
  translationOnly?: boolean;
  status: 'created' | 'queued' | 'processing' | 'completed' | 'failed';
  progress: number;
  totalScenes: number;
  totalImages: number;
  actualDuration?: number;
  processingDuration?: number; // Saniye cinsinden üretim süresi
  // İçerikler
  originalContent?: string;
  adaptedContent?: string;
  // Karakter Sayıları
  originalContentLength?: number;
  translatedContentLength?: number;
  adaptedContentLength?: number;
  createdAt: string;
  updatedAt: string;
}

export default function StoriesPage() {
  return (
    <AuthGuard>
      <StoriesContent />
    </AuthGuard>
  );
}

function StoriesContent() {
  const t = useTranslations('stories');
  
  const [stories, setStories] = useState<Story[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>('all');
  const [sort, setSort] = useState<string>('newest');

  useEffect(() => {
    fetchStories();
  }, []);

  const fetchStories = async () => {
    try {
      const response = await fetch('/api/stories');
      const data = await response.json();
      
      if (data.success) {
        setStories(data.stories || []);
      }
    } catch (error) {
      console.error('Hikayeler yüklenemedi:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (storyId: string) => {
    if (!confirm(t('card.delete') + '?')) return;

    try {
      const response = await fetch(`/api/stories/${storyId}`, {
        method: 'DELETE'
      });

      if (response.ok) {
        setStories(stories.filter(s => s._id !== storyId));
      }
    } catch (error) {
      console.error('Silme hatası:', error);
    }
  };

  // Filtreleme
  const filteredStories = stories
    .filter(story => {
      if (filter === 'all') return true;
      return story.status === filter;
    })
    .sort((a, b) => {
      if (sort === 'newest') {
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      }
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    });

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed': return 'bg-green-100 text-green-800';
      case 'processing': return 'bg-blue-100 text-blue-800';
      case 'queued': return 'bg-yellow-100 text-yellow-800';
      case 'failed': return 'bg-red-100 text-red-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case 'completed': return 'Tamamlandı';
      case 'processing': return 'İşleniyor';
      case 'queued': return 'Sırada';
      case 'failed': return 'Başarısız';
      default: return 'Oluşturuldu';
    }
  };

  // Süreyi okunabilir formata çevir
  const formatDuration = (seconds?: number) => {
    if (!seconds) return '-';
    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;
    if (minutes > 0) {
      return `${minutes}dk ${secs}sn`;
    }
    return `${secs}sn`;
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
        <div className="max-w-6xl mx-auto px-4 py-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{t('title')}</h1>
            <p className="text-gray-600 mt-1">Oluşturduğunuz tüm hikayeler burada</p>
          </div>
          <Link 
            href="/" 
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 flex items-center gap-2"
          >
            <span>+</span> {t('createNew')}
          </Link>
        </div>
      </header>

      {/* Filters */}
      <div className="max-w-6xl mx-auto px-4 py-4">
        <div className="flex flex-wrap gap-4 items-center justify-between bg-white p-4 rounded-lg shadow-sm">
          <div className="flex gap-2">
            {['all', 'completed', 'processing', 'failed'].map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-3 py-1.5 rounded-md text-sm ${
                  filter === f 
                    ? 'bg-blue-600 text-white' 
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                {t(`filter.${f}`)}
              </button>
            ))}
          </div>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value)}
            className="px-4 py-2 border border-gray-300 rounded-md text-sm bg-white text-gray-900"
          >
            <option value="newest">{t('sort.newest')}</option>
            <option value="oldest">{t('sort.oldest')}</option>
          </select>
        </div>
      </div>

      {/* Content */}
      <main className="max-w-6xl mx-auto px-4 py-4">
        {filteredStories.length === 0 ? (
          <div className="text-center py-16 bg-white rounded-lg shadow-sm">
            <div className="text-6xl mb-4">📚</div>
            <h2 className="text-xl font-semibold text-gray-700 mb-2">{t('empty')}</h2>
            <p className="text-gray-500 mb-6">{t('createFirst')}</p>
            <Link 
              href="/" 
              className="px-6 py-3 bg-blue-600 text-white rounded-md hover:bg-blue-700"
            >
              {t('createNew')}
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredStories.map(story => (
              <div key={story._id} className="bg-white rounded-lg shadow-sm overflow-hidden">
                {/* Card Header */}
                <div className="p-4 border-b">
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold text-gray-900 truncate">
                        {story.adaptedTitle || story.originalTitle}
                      </h3>
                      <p className="text-sm text-gray-500 truncate">
                        {story.originalTitle}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 ml-2">
                      {story.translationOnly && (
                        <span className="px-2 py-1 text-xs rounded-full bg-purple-100 text-purple-800">
                          🌐 Çeviri
                        </span>
                      )}
                      <span className={`px-2 py-1 text-xs rounded-full ${getStatusColor(story.status)}`}>
                        {getStatusText(story.status)}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Progress Bar (if processing) */}
                {story.status === 'processing' && (
                  <div className="px-4 py-2 bg-blue-50">
                    <div className="w-full bg-blue-200 rounded-full h-2">
                      <div 
                        className="bg-blue-600 h-2 rounded-full transition-all"
                        style={{ width: `${story.progress}%` }}
                      />
                    </div>
                    <p className="text-xs text-blue-600 mt-1">{story.progress}%</p>
                  </div>
                )}

                {/* Card Body */}
                <div className="p-4">
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <span className="text-gray-500">Diller:</span>
                      <p className="font-medium">
                        {story.originalLanguage.toUpperCase()} → {story.targetLanguage.toUpperCase()}
                      </p>
                    </div>
                    <div>
                      <span className="text-gray-500">Ülke:</span>
                      <p className="font-medium">{story.targetCountry}</p>
                    </div>
                    <div>
                      <span className="text-gray-500">Sahneler:</span>
                      <p className="font-medium">{story.totalScenes || '-'}</p>
                    </div>
                    <div>
                      <span className="text-gray-500">Görseller:</span>
                      <p className="font-medium">{story.totalImages || '-'}</p>
                    </div>
                    {story.status === 'completed' && story.processingDuration && (
                      <div className="col-span-2">
                        <span className="text-gray-500">⏱️ Üretim Süresi:</span>
                        <p className="font-medium text-green-600">{formatDuration(story.processingDuration)}</p>
                      </div>
                    )}
                  </div>
                  
                  {/* Karakter Sayıları */}
                  {(() => {
                    const originalLen = story.originalContentLength || (story.originalContent?.length ?? 0);
                    const adaptedLen = story.adaptedContentLength || (story.adaptedContent?.length ?? 0);
                    
                    if (originalLen === 0) return null;
                    
                    return (
                      <div className="mt-3 pt-3 border-t border-gray-100">
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-gray-500">📝 Karakter:</span>
                          <div className="flex items-center gap-2">
                            <span className="text-gray-700">{originalLen.toLocaleString('tr-TR')}</span>
                            {adaptedLen > 0 && (
                              <>
                                <span className="text-gray-400">→</span>
                                <span className={`font-medium ${
                                  Math.abs((adaptedLen - originalLen) / originalLen * 100) <= 5 
                                    ? 'text-green-600' 
                                    : 'text-orange-600'
                                }`}>
                                  {adaptedLen.toLocaleString('tr-TR')}
                                  <span className="ml-1">
                                    ({((adaptedLen - originalLen) / originalLen * 100) >= 0 ? '+' : ''}
                                    {((adaptedLen - originalLen) / originalLen * 100).toFixed(1)}%)
                                  </span>
                                </span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })()}

                  <p className="text-xs text-gray-400 mt-3">
                    {new Date(story.createdAt).toLocaleDateString('tr-TR', {
                      day: 'numeric',
                      month: 'short',
                      year: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit'
                    })}
                  </p>
                </div>

                {/* Card Actions */}
                <div className="px-4 py-3 bg-gray-50 flex gap-2">
                  <Link 
                    href={`/stories/${story._id}`}
                    className="flex-1 px-3 py-2 text-center text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700"
                  >
                    {t('card.view')}
                  </Link>
                  {story.status === 'completed' && (
                    <a 
                      href={`/api/download/${story._id}`}
                      className="px-3 py-2 text-sm bg-green-600 text-white rounded-md hover:bg-green-700"
                    >
                      ⬇️
                    </a>
                  )}
                  <button
                    onClick={() => handleDelete(story._id)}
                    className="px-3 py-2 text-sm bg-red-100 text-red-600 rounded-md hover:bg-red-200"
                  >
                    🗑️
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

