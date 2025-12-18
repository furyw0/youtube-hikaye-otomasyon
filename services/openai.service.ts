/**
 * OpenAI Servisi
 * OpenAI API bağlantısı ve temel yapılandırma
 */

import OpenAI from 'openai';
import logger from '@/lib/logger';
import { OpenAIError } from '@/lib/errors';
import dbConnect from '@/lib/mongodb';
import Settings from '@/models/Settings';

// OpenAI istemcisi ve kullanılan API key (cache için)
let openaiClient: OpenAI | null = null;
let cachedApiKey: string | null = null;

/**
 * Settings'den OpenAI API Key'i al
 */
async function getApiKeyFromSettings(): Promise<string | null> {
  try {
    await dbConnect();
    const settings = await Settings.findOne().select('+openaiApiKey');
    return settings?.openaiApiKey || null;
  } catch (error) {
    logger.warn('Settings\'den OpenAI API key alınamadı', { error });
    return null;
  }
}

/**
 * OpenAI istemcisini başlat (async - Settings'den okur)
 */
export async function getOpenAIClient(): Promise<OpenAI> {
  // Önce Settings'den API key'i kontrol et
  const settingsApiKey = await getApiKeyFromSettings();
  const apiKey = settingsApiKey || process.env.OPENAI_API_KEY;
  
  if (!apiKey) {
    throw new OpenAIError('OpenAI API Key tanımlanmamış. Lütfen Ayarlar sayfasından veya OPENAI_API_KEY ortam değişkeninden girin.');
  }

  // API key değişmişse yeni client oluştur
  if (openaiClient && cachedApiKey === apiKey) {
    return openaiClient;
  }

  openaiClient = new OpenAI({
    apiKey,
    maxRetries: 0, // Retry'ı manuel olarak yönetiyoruz
  });
  cachedApiKey = apiKey;

  logger.info('OpenAI istemcisi başlatıldı', { 
    source: settingsApiKey ? 'settings' : 'env' 
  });
  
  return openaiClient;
}

/**
 * Token sayısını tahmin eder
 * (Gerçek tokenizer kullanmak için tiktoken kütüphanesi eklenebilir)
 */
export function estimateTokens(text: string): number {
  // Basit tahmin: 1 token ≈ 4 karakter
  // GPT-4 için daha kesin: ~3.5 karakter
  return Math.ceil(text.length / 3.5);
}

/**
 * Model token limitini kontrol eder
 */
export function getModelTokenLimit(modelId: string): number {
  const limits: Record<string, number> = {
    'gpt-4o-mini': 128000,
    'gpt-4o': 128000,
    'gpt-4-turbo': 128000,
    'gpt-3.5-turbo': 16385,
  };
  
  return limits[modelId] || 4096;
}

/**
 * Metni model token limitine göre böler
 */
export function chunkByTokenLimit(text: string, modelId: string, reserveTokens: number = 1000): string[] {
  const maxTokens = getModelTokenLimit(modelId) - reserveTokens;
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
  
  logger.info('Metin token limitine göre bölündü', {
    modelId,
    maxTokens,
    chunks: chunks.length,
    totalLength: text.length
  });
  
  return chunks;
}

/**
 * JSON yanıtını parse eder ve doğrular
 */
export function parseJSONResponse<T>(content: string, expectedFields?: string[]): T {
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
    
    logger.error('JSON parse hatası', { 
      content: content.substring(0, 500),
      error: error instanceof Error ? error.message : 'Bilinmeyen hata'
    });
    
    throw new OpenAIError(
      `OpenAI yanıtı geçerli JSON formatında değil: ${content.substring(0, 200)}...`
    );
  }
}

/**
 * Chat completion isteği gönderir
 * @param params.timeout - İstek timeout süresi (ms), varsayılan 120000 (2 dakika)
 */
export async function createChatCompletion(params: {
  model: string;
  messages: OpenAI.Chat.ChatCompletionMessageParam[];
  temperature?: number;
  maxTokens?: number;
  responseFormat?: 'text' | 'json_object';
  timeout?: number;
}): Promise<string> {
  const client = await getOpenAIClient();
  const timeoutMs = params.timeout ?? 120000; // 2 dakika varsayılan
  
  // AbortController ile timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, timeoutMs);
  
  try {
    logger.debug('Chat completion başlatılıyor', {
      model: params.model,
      messageCount: params.messages.length,
      temperature: params.temperature,
      responseFormat: params.responseFormat,
      timeout: timeoutMs
    });
    
    const response = await client.chat.completions.create({
      model: params.model,
      messages: params.messages,
      temperature: params.temperature ?? 0.3,
      max_tokens: params.maxTokens,
      response_format: params.responseFormat === 'json_object' 
        ? { type: 'json_object' } 
        : undefined,
    }, {
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);
    
    const content = response.choices[0]?.message?.content;
    
    if (!content) {
      throw new OpenAIError('OpenAI yanıtı boş');
    }
    
    logger.debug('Chat completion tamamlandı', {
      model: params.model,
      promptTokens: response.usage?.prompt_tokens,
      completionTokens: response.usage?.completion_tokens,
      totalTokens: response.usage?.total_tokens
    });
    
    return content;
    
  } catch (error) {
    clearTimeout(timeoutId);
    
    // Abort hatası
    if (error instanceof Error && error.name === 'AbortError') {
      logger.error('OpenAI timeout', {
        model: params.model,
        timeout: timeoutMs
      });
      throw new OpenAIError(`OpenAI isteği zaman aşımına uğradı (${timeoutMs / 1000}s)`);
    }
    
    if (error instanceof OpenAI.APIError) {
      logger.error('OpenAI API hatası', {
        status: error.status,
        message: error.message,
        type: error.type,
        code: error.code
      });
      
      throw new OpenAIError(
        `OpenAI API hatası (${error.status}/${error.code}): ${error.message}`
      );
    }
    
    throw error;
  }
}

