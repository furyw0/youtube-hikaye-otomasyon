/**
 * LLM Router Servisi
 * OpenAI ve Claude arasında provider seçimi yapar
 */

import logger from '@/lib/logger';
import { ISettings } from '@/models/Settings';
import { 
  createChatCompletion as createOpenAICompletion,
  parseJSONResponse as parseOpenAIJSON,
  estimateTokens as estimateOpenAITokens,
  chunkByTokenLimit as chunkByOpenAITokenLimit
} from './openai.service';
import {
  createClaudeCompletion,
  parseClaudeJSONResponse,
  estimateClaudeTokens,
  chunkByClaudeTokenLimit
} from './claude.service';

export type LLMProvider = 'openai' | 'claude';

interface LLMMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

interface LLMCompletionParams {
  provider?: LLMProvider;  // Eğer verilmezse Settings'den alınır
  model: string;
  systemPrompt: string;
  cacheableContent?: string;  // Claude için: cache'lenecek büyük içerik
  cacheTTL?: '5m' | '1h';     // Claude için: cache süresi
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  temperature?: number;
  maxTokens?: number;
  responseFormat?: 'text' | 'json_object';
}

/**
 * Provider'a göre completion oluştur
 * Unified interface for both OpenAI and Claude
 */
export async function createCompletion(params: LLMCompletionParams): Promise<string> {
  const provider = params.provider || 'openai'; // Varsayılan OpenAI
  
  logger.debug('LLM Router: Completion başlatılıyor', {
    provider,
    model: params.model,
    messageCount: params.messages.length,
    hasCacheableContent: !!params.cacheableContent
  });
  
  try {
    if (provider === 'claude') {
      // Claude API
      return await createClaudeCompletion({
        model: params.model,
        systemPrompt: params.systemPrompt,
        cacheableContent: params.cacheableContent,
        cacheTTL: params.cacheTTL,
        messages: params.messages,
        temperature: params.temperature,
        maxTokens: params.maxTokens,
        responseFormat: params.responseFormat === 'json_object' ? 'json' : 'text'
      });
    } else {
      // OpenAI API
      // OpenAI için messages formatını dönüştür
      const openaiMessages = [
        { role: 'system' as const, content: params.systemPrompt },
        ...params.messages
      ];
      
      // Eğer cacheableContent varsa system message'a ekle (OpenAI'de cache yok ama context olarak kullanabiliriz)
      if (params.cacheableContent) {
        openaiMessages[0].content += `\n\nBağlam:\n${params.cacheableContent}`;
      }
      
      return await createOpenAICompletion({
        model: params.model,
        messages: openaiMessages,
        temperature: params.temperature,
        maxTokens: params.maxTokens,
        responseFormat: params.responseFormat === 'json_object' ? 'json_object' : 'text'
      });
    }
  } catch (error) {
    logger.error('LLM Router hatası', {
      provider,
      model: params.model,
      error: error instanceof Error ? error.message : 'Bilinmeyen hata'
    });
    throw error;
  }
}

/**
 * JSON yanıtını parse et (provider'a göre)
 */
export function parseJSONResponse<T>(
  content: string,
  provider: LLMProvider,
  expectedFields?: string[]
): T {
  if (provider === 'claude') {
    return parseClaudeJSONResponse<T>(content, expectedFields);
  } else {
    return parseOpenAIJSON<T>(content, expectedFields);
  }
}

/**
 * Token sayısını tahmin et (provider'a göre)
 */
export function estimateTokens(text: string, provider: LLMProvider): number {
  if (provider === 'claude') {
    return estimateClaudeTokens(text);
  } else {
    return estimateOpenAITokens(text);
  }
}

/**
 * Metni token limitine göre böl (provider'a göre)
 */
export function chunkByTokenLimit(
  text: string,
  modelId: string,
  provider: LLMProvider,
  reserveTokens: number = 1000
): string[] {
  if (provider === 'claude') {
    return chunkByClaudeTokenLimit(text, modelId, reserveTokens);
  } else {
    return chunkByOpenAITokenLimit(text, modelId, reserveTokens);
  }
}

/**
 * Settings'den provider ve model bilgisini al
 * Servisler bu helper'ı kullanarak provider/model bilgisini alabilir
 */
export function getLLMConfig(settings: ISettings): {
  provider: LLMProvider;
  model: string;
} {
  const provider: LLMProvider = settings.llmProvider || 'openai';
  const model = provider === 'claude' 
    ? settings.defaultClaudeModel || 'claude-sonnet-4-20250514'
    : settings.defaultOpenaiModel || 'gpt-4o-mini';
  
  return { provider, model };
}
