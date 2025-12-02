'use client';

/**
 * Global Navigation Bar
 * Tüm sayfalarda kullanılan üst menü
 */

import { Link } from '@/i18n/navigation';
import { usePathname } from 'next/navigation';

export function Navigation() {
  const pathname = usePathname();

  const isActive = (path: string) => {
    if (path === '/') {
      return pathname === '/' || pathname === '/tr' || pathname === '/en';
    }
    return pathname.includes(path);
  };

  return (
    <nav className="bg-gradient-to-r from-blue-600 to-indigo-700 text-white shadow-lg sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2 hover:opacity-90 transition-opacity">
            <span className="text-2xl">🎬</span>
            <span className="font-bold text-lg hidden sm:block">YouTube Hikaye Otomasyon</span>
          </Link>
          
          {/* Navigation Links */}
          <div className="flex items-center gap-2">
            <Link 
              href="/" 
              className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-all font-medium ${
                isActive('/') && !isActive('/stories') && !isActive('/settings')
                  ? 'bg-white/25 shadow-inner' 
                  : 'bg-white/10 hover:bg-white/20'
              }`}
            >
              <span className="text-xl">🏠</span>
              <span className="hidden md:inline">Ana Sayfa</span>
            </Link>
            <Link 
              href="/stories" 
              className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-all font-medium ${
                isActive('/stories') 
                  ? 'bg-white/25 shadow-inner' 
                  : 'bg-white/10 hover:bg-white/20'
              }`}
            >
              <span className="text-xl">📚</span>
              <span className="hidden md:inline">Hikayelerim</span>
            </Link>
            <Link 
              href="/settings" 
              className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-all font-medium ${
                isActive('/settings') 
                  ? 'bg-white/25 shadow-inner' 
                  : 'bg-white/10 hover:bg-white/20'
              }`}
            >
              <span className="text-xl">⚙️</span>
              <span className="hidden md:inline">Ayarlar</span>
            </Link>
          </div>
        </div>
      </div>
    </nav>
  );
}

