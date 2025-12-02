// API Response Types

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface ApiError {
  error: string;
  details?: any;
  code?: string;
}

// Story API Types
export interface CreateStoryResponse {
  storyId: string;
  detectedLanguage: string;
  estimatedTokens: number;
}

export interface ProcessStoryResponse {
  storyId: string;
  inngestRunId: string;
  message: string;
}

export interface StoryDetailsResponse {
  story: {
    _id: string;
    originalTitle: string;
    originalContent: string;
    originalLanguage: string;
    targetLanguage: string;
    targetCountry: string;
    adaptedTitle?: string;
    adaptedContent?: string;
    status: string;
    progress: number;
    currentStep?: string;
    scenes: any[];
    logs: any[];
  };
}

// OpenAI API Types
export interface OpenAIModelsResponse {
  models: Array<{
    id: string;
    name: string;
    description: string;
    contextWindow: number;
    isDefault?: boolean;
  }>;
}

// ElevenLabs API Types
export interface ElevenLabsVoicesResponse {
  voices: Array<{
    id: string;
    name: string;
    description?: string;
    previewUrl?: string;
    category?: string;
  }>;
}

