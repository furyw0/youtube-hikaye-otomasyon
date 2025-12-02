import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

// Rate limiter için Upstash Redis kullan
// Eğer env variables yoksa, geliştirme modunda dummy rate limiter kullan
let rateLimit: Ratelimit;

if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
  rateLimit = new Ratelimit({
    redis: Redis.fromEnv(),
    limiter: Ratelimit.slidingWindow(10, '1 m'), // 10 requests per minute
    analytics: true,
    prefix: 'youtube-hikaye'
  });
} else {
  // Development mode: No rate limiting
  rateLimit = {
    limit: async () => ({
      success: true,
      limit: 10,
      remaining: 10,
      reset: Date.now() + 60000,
      pending: Promise.resolve()
    })
  } as any;
}

export { rateLimit };

