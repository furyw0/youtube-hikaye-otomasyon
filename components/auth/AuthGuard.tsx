/**
 * Auth Guard Component
 * Korunan sayfalar için authentication kontrolü
 */

'use client';

import { useSession } from 'next-auth/react';
import { useRouter, usePathname } from 'next/navigation';
import { useEffect } from 'react';
import { useTranslations } from 'next-intl';

interface AuthGuardProps {
  children: React.ReactNode;
}

export function AuthGuard({ children }: AuthGuardProps) {
  const { status } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const t = useTranslations('common');

  useEffect(() => {
    if (status === 'unauthenticated') {
      // Locale'i pathname'den al
      const locale = pathname.match(/^\/(tr|en)/)?.[1] || 'tr';
      router.push(`/${locale}/login?callbackUrl=${encodeURIComponent(pathname)}`);
    }
  }, [status, router, pathname]);

  // Loading state
  if (status === 'loading') {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="text-gray-600 mt-4">{t('loading')}</p>
        </div>
      </div>
    );
  }

  // Unauthenticated - redirect yapılacak
  if (status === 'unauthenticated') {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="text-gray-600 mt-4">Yönlendiriliyorsunuz...</p>
        </div>
      </div>
    );
  }

  // Authenticated - içeriği göster
  return <>{children}</>;
}

