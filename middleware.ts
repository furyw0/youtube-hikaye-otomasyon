/**
 * Next.js Middleware
 * next-intl routing için
 * 
 * Not: Auth kontrolü sayfa seviyesinde yapılır (Mongoose edge runtime uyumsuzluğu nedeniyle)
 */

import createMiddleware from 'next-intl/middleware';
import { routing } from './i18n/routing';

export default createMiddleware(routing);

export const config = {
  // API routes ve static files hariç tüm routes
  matcher: ['/', '/(tr|en)/:path*']
};
