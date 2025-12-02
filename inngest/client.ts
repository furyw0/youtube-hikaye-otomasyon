/**
 * Inngest İstemcisi
 * Background job sistemi için yapılandırma
 */

import { Inngest } from 'inngest';
import logger from '@/lib/logger';

// Inngest istemcisini oluştur
export const inngest = new Inngest({
  id: 'youtube-hikaye-otomasyon',
  name: 'YouTube Hikaye Otomasyon',
  
  // Event key (Inngest dashboard'dan al)
  eventKey: process.env.INNGEST_EVENT_KEY,
  
  // Logger entegrasyonu
  logger: {
    info: (msg: string, data?: unknown) => logger.info(msg, data),
    error: (msg: string, data?: unknown) => logger.error(msg, data),
    warn: (msg: string, data?: unknown) => logger.warn(msg, data),
    debug: (msg: string, data?: unknown) => logger.debug(msg, data)
  }
});

logger.info('Inngest istemcisi oluşturuldu');

