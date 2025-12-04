/**
 * Inngest Webhook Endpoint
 * Inngest ile Next.js arasındaki köprü
 */

import { serve } from 'inngest/next';
import { inngest } from '@/inngest/client';
import { processStory } from '@/inngest/functions/process-story';

// Vercel Pro Plan - Maximum function duration (saniye)
// Pro: max 300s varsayılan, 900s'e kadar artırılabilir
export const maxDuration = 300; // 5 dakika

// Tüm Inngest function'larını kaydet
export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    processStory
  ],
  
  // Inngest dashboard'dan alınan signing key
  signingKey: process.env.INNGEST_SIGNING_KEY,
  
  // Geliştirme modu (production'da false olmalı)
  servePath: '/api/inngest',
});
