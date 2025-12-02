/**
 * Retry Servisi
 * API çağrıları için üstel geri çekilme (exponential backoff) ile yeniden deneme
 */

import logger from '@/lib/logger';
import { MaxRetriesExceededError } from '@/lib/errors';
import { sleep } from '@/lib/utils';

export interface RetryOptions {
  maxRetries: number;
  initialBackoffMs: number;
  maxBackoffMs?: number;
  backoffMultiplier?: number;
  onRetry?: (attempt: number, error: Error) => void | Promise<void>;
  shouldRetry?: (error: Error) => boolean;
}

const DEFAULT_OPTIONS: Required<Omit<RetryOptions, 'onRetry' | 'shouldRetry'>> = {
  maxRetries: 3,
  initialBackoffMs: 1000,
  maxBackoffMs: 30000,
  backoffMultiplier: 2
};

/**
 * Üstel geri çekilme ile yeniden deneme
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options: Partial<RetryOptions> = {}
): Promise<T> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  
  let lastError: Error | undefined;
  
  for (let attempt = 1; attempt <= opts.maxRetries; attempt++) {
    try {
      logger.debug('API çağrısı yapılıyor', { attempt, maxRetries: opts.maxRetries });
      return await fn();
      
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      
      // Yeniden denenmemeli hatalar
      if (opts.shouldRetry && !opts.shouldRetry(lastError)) {
        logger.error('Yeniden denenmeyen hata', { 
          error: lastError.message,
          attempt 
        });
        throw lastError;
      }
      
      // Son deneme başarısız
      if (attempt === opts.maxRetries) {
        logger.error('Maksimum deneme sayısına ulaşıldı', {
          maxRetries: opts.maxRetries,
          error: lastError.message
        });
        throw new MaxRetriesExceededError(
          `${opts.maxRetries} denemeden sonra başarısız: ${lastError.message}`,
          { originalError: lastError }
        );
      }
      
      // Callback çağır
      if (opts.onRetry) {
        await opts.onRetry(attempt, lastError);
      }
      
      // Bekleme süresi hesapla (exponential backoff)
      const backoffMs = Math.min(
        opts.initialBackoffMs * Math.pow(opts.backoffMultiplier, attempt - 1),
        opts.maxBackoffMs
      );
      
      // Jitter ekle (rastgele +/- %25)
      const jitter = backoffMs * 0.25 * (Math.random() * 2 - 1);
      const delayMs = Math.max(0, backoffMs + jitter);
      
      logger.warn('Yeniden deneniyor', {
        attempt,
        maxRetries: opts.maxRetries,
        delayMs: Math.round(delayMs),
        error: lastError.message
      });
      
      await sleep(delayMs);
    }
  }
  
  // Bu noktaya ulaşılmamalı
  throw lastError || new Error('Bilinmeyen hata');
}

/**
 * Rate limit hatalarını kontrol eder
 */
export function isRateLimitError(error: Error): boolean {
  const message = error.message.toLowerCase();
  return (
    message.includes('rate limit') ||
    message.includes('too many requests') ||
    message.includes('429')
  );
}

/**
 * Ağ hatalarını kontrol eder
 */
export function isNetworkError(error: Error): boolean {
  const message = error.message.toLowerCase();
  return (
    message.includes('network') ||
    message.includes('timeout') ||
    message.includes('econnrefused') ||
    message.includes('enotfound')
  );
}

/**
 * Yeniden denenebilir hataları kontrol eder
 */
export function isRetryableError(error: Error): boolean {
  // Rate limit ve ağ hataları yeniden denenebilir
  if (isRateLimitError(error) || isNetworkError(error)) {
    return true;
  }
  
  // HTTP durum kodlarına göre
  const statusMatch = error.message.match(/status:?\s*(\d{3})/i);
  if (statusMatch) {
    const status = parseInt(statusMatch[1]);
    // 5xx ve 429 yeniden denenebilir
    return status >= 500 || status === 429;
  }
  
  return false;
}

/**
 * OpenAI API için özelleştirilmiş retry
 */
export async function retryOpenAI<T>(
  fn: () => Promise<T>,
  context?: string
): Promise<T> {
  return retryWithBackoff(fn, {
    maxRetries: 5,
    initialBackoffMs: 2000,
    maxBackoffMs: 60000,
    shouldRetry: isRetryableError,
    onRetry: (attempt, error) => {
      logger.warn('OpenAI çağrısı yeniden deneniyor', {
        context,
        attempt,
        error: error.message
      });
    }
  });
}

/**
 * ElevenLabs API için özelleştirilmiş retry
 */
export async function retryElevenLabs<T>(
  fn: () => Promise<T>,
  context?: string
): Promise<T> {
  return retryWithBackoff(fn, {
    maxRetries: 3,
    initialBackoffMs: 1000,
    maxBackoffMs: 10000,
    shouldRetry: isRetryableError,
    onRetry: (attempt, error) => {
      logger.warn('ElevenLabs çağrısı yeniden deneniyor', {
        context,
        attempt,
        error: error.message
      });
    }
  });
}

/**
 * ImageFX API için özelleştirilmiş retry
 */
export async function retryImageFX<T>(
  fn: () => Promise<T>,
  context?: string
): Promise<T> {
  return retryWithBackoff(fn, {
    maxRetries: 4,
    initialBackoffMs: 3000,
    maxBackoffMs: 30000,
    shouldRetry: isRetryableError,
    onRetry: (attempt, error) => {
      logger.warn('ImageFX çağrısı yeniden deneniyor', {
        context,
        attempt,
        error: error.message
      });
    }
  });
}

