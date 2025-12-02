/**
 * Inngest Webhook Endpoint
 * Inngest ile Next.js arasındaki köprü
 */

import { serve } from 'inngest/next';
import { inngest } from '@/inngest/client';
import { processStory } from '@/inngest/functions/process-story';

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

