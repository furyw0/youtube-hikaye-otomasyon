'use client';

/**
 * Global Navigation Bar
 * Tüm sayfalarda kullanılan üst menü
 */

import { Link } from '@/i18n/navigation';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useSession, signOut } from 'next-auth/react';
import { useState, useRef, useEffect } from 'react';

export function Navigation() {
  const pathname = usePathname();
  const t = useTranslations('nav');
  const { data: session, status } = useSession();
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Dropdown dışına tıklanınca kapat
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const isActive = (path: string) => {
    if (path === '/') {
      return pathname === '/' || pathname === '/tr' || pathname === '/en';
    }
    return pathname.includes(path);
  };

  const handleLogout = async () => {
    await signOut({ callbackUrl: '/' });
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
                isActive('/') && !isActive('/stories') && !isActive('/settings') && !isActive('/login') && !isActive('/register')
                  ? 'bg-white/25 shadow-inner' 
                  : 'bg-white/10 hover:bg-white/20'
              }`}
            >
              <span className="text-xl">🏠</span>
              <span className="hidden md:inline">{t('home')}</span>
            </Link>

            {/* Authenticated Links */}
            {status === 'authenticated' && session?.user && (
              <>
                <Link 
                  href="/stories" 
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-all font-medium ${
                    isActive('/stories') 
                      ? 'bg-white/25 shadow-inner' 
                      : 'bg-white/10 hover:bg-white/20'
                  }`}
                >
                  <span className="text-xl">📚</span>
                  <span className="hidden md:inline">{t('myStories')}</span>
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
                  <span className="hidden md:inline">{t('settings')}</span>
                </Link>

                {/* User Dropdown */}
                <div className="relative" ref={dropdownRef}>
                  <button
                    onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg bg-white/10 hover:bg-white/20 transition-all font-medium"
                  >
                    <div className="w-8 h-8 rounded-full bg-white/30 flex items-center justify-center">
                      {session.user.image ? (
                        <img 
                          src={session.user.image} 
                          alt={session.user.name || ''} 
                          className="w-8 h-8 rounded-full"
                        />
                      ) : (
                        <span className="text-sm font-bold">
                          {session.user.name?.charAt(0).toUpperCase() || '?'}
                        </span>
                      )}
                    </div>
                    <span className="hidden md:inline">{session.user.name}</span>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>

                  {/* Dropdown Menu */}
                  {isDropdownOpen && (
                    <div className="absolute right-0 mt-2 w-48 bg-white rounded-lg shadow-xl py-2 text-gray-800 z-50">
                      <div className="px-4 py-2 border-b border-gray-100">
                        <p className="text-sm font-medium truncate">{session.user.name}</p>
                        <p className="text-xs text-gray-500 truncate">{session.user.email}</p>
                      </div>
                      <Link
                        href="/profile"
                        onClick={() => setIsDropdownOpen(false)}
                        className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                        </svg>
                        {t('profile')}
                      </Link>
                      <button
                        onClick={handleLogout}
                        className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50 flex items-center gap-2"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                        </svg>
                        {t('logout')}
                      </button>
                    </div>
                  )}
                </div>
              </>
            )}

            {/* Guest Links */}
            {status === 'unauthenticated' && (
              <>
                <Link 
                  href="/login" 
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-all font-medium ${
                    isActive('/login') 
                      ? 'bg-white/25 shadow-inner' 
                      : 'bg-white/10 hover:bg-white/20'
                  }`}
                >
                  <span className="text-xl">🔐</span>
                  <span className="hidden md:inline">{t('login')}</span>
                </Link>
                <Link 
                  href="/register" 
                  className="flex items-center gap-2 px-4 py-2 rounded-lg bg-white text-blue-600 hover:bg-gray-100 transition-all font-medium"
                >
                  <span className="text-xl">✨</span>
                  <span className="hidden md:inline">{t('register')}</span>
                </Link>
              </>
            )}

            {/* Loading State */}
            {status === 'loading' && (
              <div className="flex items-center gap-2 px-4 py-2">
                <div className="w-6 h-6 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
              </div>
            )}
          </div>
        </div>
      </div>
    </nav>
  );
}
