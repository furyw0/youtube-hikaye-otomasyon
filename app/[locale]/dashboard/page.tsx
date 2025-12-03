/**
 * Dashboard Sayfası
 * Hikaye detayları ve progress tracking
 */

'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { ProgressTracker } from '@/components/ui/ProgressTracker';
import { SceneViewer } from '@/components/scene/SceneViewer';
import { AuthGuard } from '@/components/auth/AuthGuard';

interface Story {
  _id: string;
  originalTitle: string;
  adaptedTitle?: string;
  originalLanguage: string;
  targetLanguage: string;
  targetCountry: string;
  status: string;
  progress: number;
  currentStep?: string;
  errorMessage?: string;
  totalScenes: number;
  totalImages: number;
  actualDuration?: number;
  scenes: any[];
  blobUrls?: {
    zipFile?: string;
  };
}

export default function DashboardPage() {
  return (
    <AuthGuard>
      <DashboardContent />
    </AuthGuard>
  );
}

function DashboardContent() {
  const t = useTranslations('dashboard');
  const tCommon = useTranslations('common');
  const searchParams = useSearchParams();
  const storyId = searchParams.get('storyId');

  const [story, setStory] = useState<Story | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!storyId) {
      setError('Story ID bulunamadı');
      setLoading(false);
      return;
    }

    // İlk yükleme
    fetchStory();

    // Polling (her 3 saniyede bir güncelle)
    const interval = setInterval(() => {
      if (story?.status !== 'completed' && story?.status !== 'failed') {
        fetchStory();
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [storyId, story?.status]);

  async function fetchStory() {
    try {
      const response = await fetch(`/api/stories/${storyId}`);
      const data = await response.json();

      if (data.success) {
        setStory(data.story);
      } else {
        setError(data.error || 'Hikaye yüklenemedi');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Bir hata oluştu');
    } finally {
      setLoading(false);
    }
  }

  const handleDownload = () => {
    if (story?._id) {
      window.open(`/api/download/${story._id}`, '_blank');
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="text-gray-600 mt-4">{tCommon('loading')}</p>
        </div>
      </div>
    );
  }

  if (error || !story) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="bg-white rounded-lg shadow-lg p-8 max-w-md">
          <div className="text-red-600 text-5xl mb-4">⚠️</div>
          <h2 className="text-xl font-bold text-gray-900 mb-2">
            {tCommon('error')}
          </h2>
          <p className="text-gray-600">{error || 'Hikaye bulunamadı'}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">
                {story.adaptedTitle || story.originalTitle}
              </h1>
              <p className="text-gray-600 mt-1">
                {story.originalLanguage.toUpperCase()} → {story.targetLanguage.toUpperCase()} 
                {' • '}
                {story.targetCountry}
              </p>
            </div>
            
            {story.status === 'completed' && (
              <button
                onClick={handleDownload}
                className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-lg font-semibold transition-colors flex items-center gap-2"
              >
                <span>📥</span>
                {tCommon('download')} ZIP
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Progress */}
        <div className="bg-white rounded-lg shadow-sm p-6 mb-8">
          <ProgressTracker
            status={story.status}
            progress={story.progress}
            currentStep={story.currentStep}
            errorMessage={story.errorMessage}
          />
        </div>

        {/* Stats */}
        {story.status === 'completed' && (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
            <StatCard
              icon="🎬"
              label="Toplam Sahne"
              value={story.totalScenes.toString()}
            />
            <StatCard
              icon="🖼️"
              label="Görsel"
              value={story.totalImages.toString()}
            />
            <StatCard
              icon="⏱️"
              label="Süre"
              value={story.actualDuration ? formatDuration(story.actualDuration) : 'N/A'}
            />
            <StatCard
              icon="✅"
              label="Durum"
              value="Tamamlandı"
            />
          </div>
        )}

        {/* Scenes */}
        {story.scenes && story.scenes.length > 0 && (
          <div className="bg-white rounded-lg shadow-sm p-6">
            <SceneViewer scenes={story.scenes} />
          </div>
        )}
      </main>
    </div>
  );
}

function StatCard({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4">
      <div className="text-2xl mb-2">{icon}</div>
      <div className="text-sm text-gray-600">{label}</div>
      <div className="text-xl font-bold text-gray-900">{value}</div>
    </div>
  );
}

function formatDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${minutes}m ${secs}s`;
}

