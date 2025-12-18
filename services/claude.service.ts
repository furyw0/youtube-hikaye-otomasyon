/**
 * Claude (Anthropic) AI Servisi
 * Prompt Caching destekli Claude API entegrasyonu
 */

import logger from '@/lib/logger';
import { OpenAIError } from '@/lib/errors';
import dbConnect from '@/lib/mongodb';
import Settings from '@/models/Settings';

// Claude API types
interface ClaudeMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface ClaudeSystemBlock {
  type: 'text';
  text: string;
  cache_control?: {
    type: 'ephemeral';
    ttl?: '5m' | '1h';
  };
}

interface ClaudeResponse {
  id: string;
  type: 'message';
  role: 'assistant';
  content: Array<{
    type: 'text';
    text: string;
  }>;
  model: string;
  stop_reason: string;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
}

// Claude API key cache
let cachedApiKey: string | null = null;

/**
 * Settings'den Claude API Key'i al
 */
async function getApiKeyFromSettings(): Promise<string | null> {
  try {
    await dbConnect();
    const settings = await Settings.findOne().select('+claudeApiKey');
    return settings?.claudeApiKey || null;
  } catch (error) {
    logger.warn('Settings\'ten Claude API key alınamadı', { error });
    return null;
  }
}

/**
 * Claude API key'i getir
 */
async function getClaudeApiKey(): Promise<string> {
  // Önce Settings'den kontrol et
  const settingsApiKey = await getApiKeyFromSettings();
  const apiKey = settingsApiKey || process.env.CLAUDE_API_KEY;
  
  if (!apiKey) {
    throw new OpenAIError('Claude API Key tanımlanmamış. Lütfen Ayarlar sayfasından veya CLAUDE_API_KEY ortam değişkeninden girin.');
  }

  cachedApiKey = apiKey;
  
  logger.info('Claude API key alındı', { 
    source: settingsApiKey ? 'settings' : 'env' 
  });
  
  return apiKey;
}

/**
 * Token sayısını tahmin eder (Claude için)
 * Claude tokenizer OpenAI'ye benzer
 */
export function estimateClaudeTokens(text: string): number {
  // Basit tahmin: 1 token ≈ 3.5 karakter
  return Math.ceil(text.length / 3.5);
}

/**
 * Model token limitini kontrol eder (Claude)
 */
export function getClaudeTokenLimit(modelId: string): number {
  const limits: Record<string, number> = {
    'claude-sonnet-4-20250514': 200000,
    'claude-opus-4-20250514': 200000,
    'claude-3-5-sonnet-20241022': 200000,
    'claude-3-5-haiku-20241022': 200000,
  };
  
  return limits[modelId] || 200000;
}

/**
 * Metni Claude token limitine göre böler
 */
export function chunkByClaudeTokenLimit(
  text: string, 
  modelId: string, 
  reserveTokens: number = 1000
): string[] {
  const maxTokens = getClaudeTokenLimit(modelId) - reserveTokens;
  const estimatedChunkSize = Math.floor(maxTokens * 3.5); // Token -> karakter
  
  // Paragraflara böl
  const paragraphs = text.split('\n\n');
  const chunks: string[] = [];
  let currentChunk = '';
  
  for (const paragraph of paragraphs) {
    const testChunk = currentChunk + (currentChunk ? '\n\n' : '') + paragraph;
    
    if (testChunk.length > estimatedChunkSize && currentChunk) {
      chunks.push(currentChunk.trim());
      currentChunk = paragraph;
    } else {
      currentChunk = testChunk;
    }
  }
  
  if (currentChunk) {
    chunks.push(currentChunk.trim());
  }
  
  logger.info('Metin Claude token limitine göre bölündü', {
    modelId,
    maxTokens,
    chunks: chunks.length,
    totalLength: text.length
  });
  
  return chunks;
}

/**
 * JSON yanıtını parse eder
 */
export function parseClaudeJSONResponse<T>(content: string, expectedFields?: string[]): T {
  try {
    const parsed = JSON.parse(content);
    
    // Beklenen alanları kontrol et
    if (expectedFields) {
      for (const field of expectedFields) {
        if (!(field in parsed)) {
          throw new OpenAIError(
            `JSON yanıtında beklenen alan bulunamadı: ${field}. Beklenen alanlar: ${expectedFields.join(', ')}`
          );
        }
      }
    }
    
    return parsed as T;
    
  } catch (error) {
    if (error instanceof OpenAIError) {
      throw error;
    }
    
    logger.error('Claude JSON parse hatası', { 
      content: content.substring(0, 500),
      error: error instanceof Error ? error.message : 'Bilinmeyen hata'
    });
    
    throw new OpenAIError(
      `Claude yanıtı geçerli JSON formatında değil: ${content.substring(0, 200)}...`
    );
  }
}

/**
 * Claude API ile completion isteği (Prompt Caching destekli)
 * @param timeout - Milisaniye cinsinden timeout (varsayılan: 120000 = 2 dakika)
 */
export async function createClaudeCompletion(params: {
  model: string;
  systemPrompt: string;
  cacheableContent?: string;  // Cache'lenecek büyük içerik (hikaye metni vs)
  cacheTTL?: '5m' | '1h';     // Cache süresi
  messages: ClaudeMessage[];
  temperature?: number;
  maxTokens?: number;
  responseFormat?: 'text' | 'json';
  timeout?: number;           // Timeout (ms)
}): Promise<string> {
  const apiKey = await getClaudeApiKey();
  const timeoutMs = params.timeout || 120000; // 2 dakika varsayılan
  
  // AbortController ile timeout yönetimi
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
    logger.warn('Claude API isteği timeout nedeniyle iptal edildi', {
      model: params.model,
      timeoutMs
    });
  }, timeoutMs);
  
  try {
    logger.debug('Claude completion başlatılıyor', {
      model: params.model,
      messageCount: params.messages.length,
      temperature: params.temperature,
      responseFormat: params.responseFormat,
      hasCacheableContent: !!params.cacheableContent,
      cacheTTL: params.cacheTTL,
      timeoutMs
    });
    
    // System prompt'u hazırla (cache destekli)
    const system: ClaudeSystemBlock[] = [
      {
        type: 'text',
        text: params.systemPrompt,
      }
    ];
    
    // Eğer cache'lenecek içerik varsa ekle
    if (params.cacheableContent) {
      system.push({
        type: 'text',
        text: params.cacheableContent,
        cache_control: {
          type: 'ephemeral',
          ttl: params.cacheTTL || '1h'
        }
      });
      
      logger.debug('Prompt caching etkinleştirildi', {
        contentLength: params.cacheableContent.length,
        ttl: params.cacheTTL || '1h'
      });
    }
    
    // API isteği hazırla
    const requestBody = {
      model: params.model,
      max_tokens: params.maxTokens || 4096,
      system,
      messages: params.messages,
      temperature: params.temperature ?? 0.3,
    };
    
    // JSON response istiyorsak system prompt'a ekle
    if (params.responseFormat === 'json') {
      system[0].text += '\n\nYanıtını JSON formatında ver.';
    }
    
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });
    
    // Timeout'u temizle
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      logger.error('Claude API hatası', {
        status: response.status,
        error: errorData
      });
      
      throw new OpenAIError(
        `Claude API hatası (${response.status}): ${JSON.stringify(errorData)}`
      );
    }
    
    const data = await response.json() as ClaudeResponse;
    
    const content = data.content[0]?.text;
    
    if (!content) {
      throw new OpenAIError('Claude yanıtı boş');
    }
    
    // Usage bilgilerini logla (cache metrics dahil)
    logger.debug('Claude completion tamamlandı', {
      model: params.model,
      inputTokens: data.usage.input_tokens,
      outputTokens: data.usage.output_tokens,
      cacheCreationTokens: data.usage.cache_creation_input_tokens,
      cacheReadTokens: data.usage.cache_read_input_tokens,
      stopReason: data.stop_reason
    });
    
    // Cache hit/miss bilgisi
    if (data.usage.cache_read_input_tokens) {
      logger.info('✅ Cache HIT - Token tasarrufu sağlandı', {
        cacheReadTokens: data.usage.cache_read_input_tokens,
        savedTokens: data.usage.cache_read_input_tokens,
        savingsPercentage: Math.round(
          (data.usage.cache_read_input_tokens / data.usage.input_tokens) * 100
        )
      });
    }
    
    return content;
    
  } catch (error) {
    // Timeout'u temizle (hata durumunda da)
    clearTimeout(timeoutId);
    
    // AbortError'u daha anlamlı hata mesajına çevir
    if (error instanceof Error && error.name === 'AbortError') {
      throw new OpenAIError(
        `Claude API isteği zaman aşımına uğradı (${timeoutMs / 1000} saniye). Daha kısa bir metin deneyin veya modeli değiştirin.`
      );
    }
    
    logger.error('Claude API hatası', {
      error: error instanceof Error ? error.message : 'Bilinmeyen hata',
      model: params.model
    });
    
    throw error;
  }
}

/**
 * Claude bağlantı testi
 */
export async function testClaudeConnection(): Promise<{
  success: boolean;
  model?: string;
  error?: string;
}> {
  try {
    const response = await createClaudeCompletion({
      model: 'claude-3-5-haiku-20241022', // En hızlı model ile test
      systemPrompt: 'Sen yardımcı bir asistansın.',
      messages: [
        {
          role: 'user',
          content: 'Merhaba, bu bir bağlantı testidir. Sadece "Test başarılı" yanıtını ver.'
        }
      ],
      temperature: 0.1,
      maxTokens: 50
    });
    
    return {
      success: true,
      model: 'claude-3-5-haiku-20241022'
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Bilinmeyen hata'
    };
  }
}
