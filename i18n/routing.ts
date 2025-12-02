/**
 * next-intl Routing Configuration
 */

import { defineRouting } from 'next-intl/routing';
import { createSharedPathnamesNavigation } from 'next-intl/navigation';

export const routing = defineRouting({
  locales: ['tr', 'en'],
  defaultLocale: 'tr'
});

export const { Link, redirect, usePathname, useRouter } =
  createSharedPathnamesNavigation(routing);

