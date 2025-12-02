/**
 * Ana Sayfa
 * Hikaye oluşturma formu
 */

import { useTranslations } from 'next-intl';
import { StoryForm } from '@/components/story/StoryForm';

export default function HomePage() {
  const t = useTranslations('home');

  return (
    <div className="min-h-screen bg-gradient-to-b from-blue-50 to-white">
      {/* Header */}
      <header className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <h1 className="text-2xl font-bold text-gray-900">
            {t('title')}
          </h1>
          <p className="text-gray-600 mt-1">
            {t('subtitle')}
          </p>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Features */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-12">
          <FeatureCard
            icon="🌍"
            title={t('features.translation')}
            description={t('features.translationDesc')}
          />
          <FeatureCard
            icon="🎭"
            title={t('features.adaptation')}
            description={t('features.adaptationDesc')}
          />
          <FeatureCard
            icon="🎨"
            title={t('features.visuals')}
            description={t('features.visualsDesc')}
          />
          <FeatureCard
            icon="🎙️"
            title={t('features.audio')}
            description={t('features.audioDesc')}
          />
        </div>

        {/* Story Form */}
        <div className="bg-white rounded-xl shadow-lg p-6 md:p-8">
          <StoryForm />
        </div>
      </main>
    </div>
  );
}

function FeatureCard({
  icon,
  title,
  description
}: {
  icon: string;
  title: string;
  description: string;
}) {
  return (
    <div className="bg-white rounded-lg p-6 shadow-sm border border-gray-100 hover:shadow-md transition-shadow">
      <div className="text-4xl mb-3">{icon}</div>
      <h3 className="font-semibold text-gray-900 mb-2">{title}</h3>
      <p className="text-sm text-gray-600">{description}</p>
    </div>
  );
}

