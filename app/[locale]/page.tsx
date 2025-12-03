/**
 * Ana Sayfa
 * Hikaye oluşturma formu (sadece giriş yapmış kullanıcılar için)
 */

'use client';

import { useTranslations } from 'next-intl';
import { useSession } from 'next-auth/react';
import { StoryForm } from '@/components/story/StoryForm';
import { Link } from '@/i18n/navigation';

export default function HomePage() {
  const t = useTranslations('home');
  const tAuth = useTranslations('auth');
  const tNav = useTranslations('nav');
  const { data: session, status } = useSession();

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white">
      {/* Page Header */}
      <header className="bg-white border-b shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <h1 className="text-3xl font-bold text-gray-900">
            {t('title')}
          </h1>
          <p className="text-gray-600 mt-2 text-lg">
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

        {/* Conditional Content based on auth status */}
        {status === 'loading' ? (
          // Loading state
          <div className="bg-white rounded-xl shadow-lg p-8 text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          </div>
        ) : session ? (
          // Authenticated - Show Form
          <div className="bg-white rounded-xl shadow-lg p-6 md:p-8">
            <StoryForm />
          </div>
        ) : (
          // Not authenticated - Show CTA
          <div className="bg-white rounded-xl shadow-lg p-8 md:p-12 text-center">
            <div className="max-w-md mx-auto">
              <div className="text-6xl mb-6">🔐</div>
              <h2 className="text-2xl font-bold text-gray-900 mb-4">
                {tAuth('login.title')}
              </h2>
              <p className="text-gray-600 mb-8">
                Hikaye oluşturmak için giriş yapın veya yeni bir hesap oluşturun
              </p>
              <div className="flex flex-col sm:flex-row gap-4 justify-center">
                <Link
                  href="/login"
                  className="px-8 py-3 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 transition-colors"
                >
                  🔐 {tNav('login')}
                </Link>
                <Link
                  href="/register"
                  className="px-8 py-3 bg-white text-blue-600 font-semibold rounded-lg border-2 border-blue-600 hover:bg-blue-50 transition-colors"
                >
                  ✨ {tNav('register')}
                </Link>
              </div>
            </div>
          </div>
        )}
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
