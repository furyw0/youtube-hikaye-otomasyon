// Base App Error
export class AppError extends Error {
  constructor(
    message: string,
    public statusCode: number = 500,
    public code?: string
  ) {
    super(message);
    this.name = this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
  }
}

// Validation Error
export class ValidationError extends AppError {
  constructor(message: string, public details?: any) {
    super(message, 400, 'VALIDATION_ERROR');
  }
}

// Scene Validation Error
export class SceneValidationError extends AppError {
  constructor(message: string) {
    super(message, 500, 'SCENE_VALIDATION_ERROR');
  }
}

// Max Retries Exceeded Error
export class MaxRetriesExceededError extends AppError {
  constructor(message: string) {
    super(message, 500, 'MAX_RETRIES_EXCEEDED');
  }
}

// Image Generation Error
export class ImageGenerationError extends AppError {
  constructor(message: string) {
    super(message, 500, 'IMAGE_GENERATION_ERROR');
  }
}

// Rate Limit Error
export class RateLimitError extends AppError {
  constructor() {
    super('Rate limit exceeded', 429, 'RATE_LIMIT_EXCEEDED');
  }
}

// Language Detection Error
export class LanguageDetectionError extends AppError {
  constructor(message: string) {
    super(message, 500, 'LANGUAGE_DETECTION_ERROR');
  }
}

// Translation Error
export class TranslationError extends AppError {
  constructor(message: string) {
    super(message, 500, 'TRANSLATION_ERROR');
  }
}

// Audio Generation Error
export class AudioGenerationError extends AppError {
  constructor(message: string) {
    super(message, 500, 'AUDIO_GENERATION_ERROR');
  }
}

