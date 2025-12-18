/**
 * next-intl Request Configuration
 */

import { getRequestConfig } from 'next-intl/server';
import { routing } from './routing';

export default getRequestConfig(async ({ requestLocale }) => {
  // requestLocale parametresi next-intl 3.22+ için gerekli
  let locale = await requestLocale;

  // Geçerli bir locale değilse varsayılan kullan
  if (!locale || !routing.locales.includes(locale as 'tr' | 'en')) {
    locale = routing.defaultLocale;
  }

  return {
    locale,
    messages: (await import(`./locales/${locale}.json`)).default
  };
});

