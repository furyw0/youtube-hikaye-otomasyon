/**
 * Hikaye Listesi Sayfası
 * Tüm hikayeleri listeler ve filtreleme imkanı sunar
 */

'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { AuthGuard } from '@/components/auth/AuthGuard';

interface Channel {
  _id: string;
  name: string;
  color: string;
  icon: string;
}

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
  // YouTube
  youtubeUrl?: string;
  youtubePublishedAt?: string;
  // Kanal
  channel?: Channel;
  channelId?: string;
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
  const [channels, setChannels] = useState<(Channel & { storyCount: number })[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>('all');
  const [channelFilter, setChannelFilter] = useState<string>('all');
  const [sort, setSort] = useState<string>('newest');
  
  // Çoklu seçim state'leri
  const [selectedStories, setSelectedStories] = useState<Set<string>>(new Set());
  const [showChannelModal, setShowChannelModal] = useState(false);
  const [bulkLoading, setBulkLoading] = useState(false);

  useEffect(() => {
    // URL'den kanal filtresini al
    const params = new URLSearchParams(window.location.search);
    const channelId = params.get('channelId');
    if (channelId) {
      setChannelFilter(channelId);
    }
    
    fetchChannels();
    fetchStories(channelId || undefined);
  }, []);

  const fetchChannels = async () => {
    try {
      const response = await fetch('/api/channels');
      const data = await response.json();
      
      if (data.success) {
        setChannels(data.channels || []);
      }
    } catch (error) {
      console.error('Kanallar yüklenemedi:', error);
    }
  };

  const fetchStories = async (channelId?: string) => {
    try {
      let url = '/api/stories';
      if (channelId && channelId !== 'all') {
        url += `?channelId=${channelId}`;
      }
      const response = await fetch(url);
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

  const handleChannelFilterChange = (channelId: string) => {
    setChannelFilter(channelId);
    setLoading(true);
    
    // URL'i güncelle
    const url = new URL(window.location.href);
    if (channelId === 'all') {
      url.searchParams.delete('channelId');
    } else {
      url.searchParams.set('channelId', channelId);
    }
    window.history.pushState({}, '', url.toString());
    
    fetchStories(channelId === 'all' ? undefined : channelId);
  };

  const handleDelete = async (storyId: string) => {
    if (!confirm(t('card.delete') + '?')) return;

    try {
      const response = await fetch(`/api/stories/${storyId}`, {
        method: 'DELETE'
      });

      if (response.ok) {
        setStories(stories.filter(s => s._id !== storyId));
        // Seçimden de kaldır
        setSelectedStories(prev => {
          const next = new Set(prev);
          next.delete(storyId);
          return next;
        });
      }
    } catch (error) {
      console.error('Silme hatası:', error);
    }
  };

  // Hikaye seçimi toggle
  const toggleStorySelection = (storyId: string) => {
    setSelectedStories(prev => {
      const next = new Set(prev);
      if (next.has(storyId)) {
        next.delete(storyId);
      } else {
        next.add(storyId);
      }
      return next;
    });
  };

  // Tümünü seç/kaldır
  const toggleSelectAll = () => {
    if (selectedStories.size === filteredStories.length) {
      setSelectedStories(new Set());
    } else {
      setSelectedStories(new Set(filteredStories.map(s => s._id)));
    }
  };

  // Seçimi temizle
  const clearSelection = () => {
    setSelectedStories(new Set());
  };

  // Toplu kanal atama
  const handleBulkChannelAssign = async (channelId: string | null) => {
    if (selectedStories.size === 0) return;

    setBulkLoading(true);
    try {
      const response = await fetch('/api/stories/bulk-channel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          storyIds: Array.from(selectedStories),
          channelId
        })
      });

      const data = await response.json();

      if (data.success) {
        // Hikayeleri güncelle
        setStories(prev => prev.map(story => {
          if (selectedStories.has(story._id)) {
            return {
              ...story,
              channel: data.channel,
              channelId: data.channel?._id || undefined
            };
          }
          return story;
        }));
        
        // Kanal sayılarını güncelle
        fetchChannels();
        
        // Seçimi temizle ve modalı kapat
        clearSelection();
        setShowChannelModal(false);
        
        alert(data.message);
      } else {
        alert(data.error || 'Bir hata oluştu');
      }
    } catch (error) {
      console.error('Toplu kanal atama hatası:', error);
      alert('Bir hata oluştu');
    } finally {
      setBulkLoading(false);
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

      {/* Seçim Araç Çubuğu */}
      {selectedStories.size > 0 && (
        <div className="sticky top-0 z-20 bg-blue-600 text-white shadow-lg">
          <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <span className="font-medium">
                ✓ {selectedStories.size} {t('selection.selected')}
              </span>
              <button
                onClick={clearSelection}
                className="text-sm px-3 py-1 bg-white/20 rounded-md hover:bg-white/30"
              >
                {t('selection.clear')}
              </button>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowChannelModal(true)}
                className="flex items-center gap-2 px-4 py-2 bg-white text-blue-600 rounded-md hover:bg-blue-50 font-medium"
              >
                📺 {t('selection.assignChannel')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Kanal Seçim Modalı */}
      {showChannelModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md mx-4">
            <div className="p-6 border-b">
              <h3 className="text-lg font-semibold text-gray-900">
                {t('selection.assignChannelTitle')}
              </h3>
              <p className="text-sm text-gray-500 mt-1">
                {selectedStories.size} {t('selection.storiesWillBeAssigned')}
              </p>
            </div>
            <div className="p-4 max-h-80 overflow-y-auto">
              {/* Kanaldan çıkar */}
              <button
                onClick={() => handleBulkChannelAssign(null)}
                disabled={bulkLoading}
                className="w-full flex items-center gap-3 p-3 rounded-lg hover:bg-gray-100 text-left mb-2"
              >
                <span className="w-10 h-10 rounded-full bg-gray-200 flex items-center justify-center text-xl">
                  🚫
                </span>
                <div>
                  <div className="font-medium text-gray-900">{t('selection.removeFromChannel')}</div>
                  <div className="text-sm text-gray-500">{t('selection.removeFromChannelDesc')}</div>
                </div>
              </button>

              <div className="border-t my-3"></div>

              {/* Kanallar */}
              {channels.map(channel => (
                <button
                  key={channel._id}
                  onClick={() => handleBulkChannelAssign(channel._id)}
                  disabled={bulkLoading}
                  className="w-full flex items-center gap-3 p-3 rounded-lg hover:bg-gray-100 text-left"
                >
                  <span 
                    className="w-10 h-10 rounded-full flex items-center justify-center text-xl text-white"
                    style={{ backgroundColor: channel.color }}
                  >
                    {channel.icon}
                  </span>
                  <div className="flex-1">
                    <div className="font-medium text-gray-900">{channel.name}</div>
                    <div className="text-sm text-gray-500">{channel.storyCount} hikaye</div>
                  </div>
                </button>
              ))}

              {channels.length === 0 && (
                <div className="text-center py-6 text-gray-500">
                  <p>{t('selection.noChannels')}</p>
                  <Link 
                    href="/channels" 
                    className="text-blue-600 hover:underline text-sm mt-2 inline-block"
                  >
                    {t('manageChannels')}
                  </Link>
                </div>
              )}
            </div>
            <div className="p-4 border-t bg-gray-50 rounded-b-xl">
              <button
                onClick={() => setShowChannelModal(false)}
                disabled={bulkLoading}
                className="w-full px-4 py-2 bg-gray-200 text-gray-700 rounded-md hover:bg-gray-300"
              >
                {t('selection.cancel')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="max-w-6xl mx-auto px-4 py-4">
        <div className="bg-white p-4 rounded-lg shadow-sm space-y-4">
          {/* Channel Filter */}
          {channels.length > 0 && (
            <div className="flex flex-wrap gap-2 pb-4 border-b">
              <button
                onClick={() => handleChannelFilterChange('all')}
                className={`px-3 py-1.5 rounded-md text-sm flex items-center gap-1 ${
                  channelFilter === 'all'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                📚 {t('filter.allChannels')}
              </button>
              {channels.map(channel => (
                <button
                  key={channel._id}
                  onClick={() => handleChannelFilterChange(channel._id)}
                  className={`px-3 py-1.5 rounded-md text-sm flex items-center gap-1 ${
                    channelFilter === channel._id
                      ? 'text-white'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                  style={channelFilter === channel._id ? { backgroundColor: channel.color } : undefined}
                >
                  {channel.icon} {channel.name}
                  <span className="text-xs opacity-75">({channel.storyCount})</span>
                </button>
              ))}
              <button
                onClick={() => handleChannelFilterChange('ungrouped')}
                className={`px-3 py-1.5 rounded-md text-sm flex items-center gap-1 ${
                  channelFilter === 'ungrouped'
                    ? 'bg-orange-500 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                📁 {t('filter.ungrouped')}
              </button>
              <Link
                href="/channels"
                className="px-3 py-1.5 rounded-md text-sm flex items-center gap-1 bg-gray-100 text-gray-700 hover:bg-gray-200 ml-auto"
              >
                ⚙️ {t('manageChannels')}
              </Link>
            </div>
          )}
          
          {/* Status Filter & Sort */}
          <div className="flex flex-wrap gap-4 items-center justify-between">
            <div className="flex gap-2 items-center">
              {/* Tümünü Seç Checkbox */}
              {filteredStories.length > 0 && (
                <button
                  onClick={toggleSelectAll}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm border ${
                    selectedStories.size === filteredStories.length && filteredStories.length > 0
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                  }`}
                >
                  <span className="text-base">
                    {selectedStories.size === filteredStories.length && filteredStories.length > 0 ? '☑️' : '☐'}
                  </span>
                  {t('selection.selectAll')}
                </button>
              )}
              
              <div className="w-px h-6 bg-gray-300 mx-1"></div>
              
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
              <div 
                key={story._id} 
                className={`bg-white rounded-lg shadow-sm overflow-hidden transition-all ${
                  selectedStories.has(story._id) ? 'ring-2 ring-blue-500 ring-offset-2' : ''
                }`}
              >
                {/* Card Header */}
                <div className="p-4 border-b">
                  <div className="flex items-start justify-between">
                    {/* Seçim Checkbox */}
                    <button
                      onClick={(e) => {
                        e.preventDefault();
                        toggleStorySelection(story._id);
                      }}
                      className={`flex-shrink-0 w-6 h-6 rounded border-2 mr-3 mt-0.5 flex items-center justify-center transition-all ${
                        selectedStories.has(story._id)
                          ? 'bg-blue-600 border-blue-600 text-white'
                          : 'border-gray-300 hover:border-blue-400'
                      }`}
                    >
                      {selectedStories.has(story._id) && (
                        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                        </svg>
                      )}
                    </button>
                    
                    <div className="flex-1 min-w-0">
                      {/* Channel Badge */}
                      {story.channel && (
                        <div 
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs text-white mb-2"
                          style={{ backgroundColor: story.channel.color }}
                        >
                          {story.channel.icon} {story.channel.name}
                        </div>
                      )}
                      <h3 className="font-semibold text-gray-900 truncate">
                        {story.adaptedTitle || story.originalTitle}
                      </h3>
                      <p className="text-sm text-gray-500 truncate">
                        {story.originalTitle}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 ml-2 flex-wrap">
                      {story.youtubeUrl && (
                        <a 
                          href={story.youtubeUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="px-2 py-1 text-xs rounded-full bg-red-100 text-red-700 hover:bg-red-200 flex items-center gap-1"
                          onClick={(e) => e.stopPropagation()}
                        >
                          ▶️ YouTube
                        </a>
                      )}
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

