/**
 * Utility fonksiyonlar
 */

/**
 * Metni paragraf sınırlarından parçalara böl
 */
export function chunkText(text: string, chunkSize: number): string[] {
  const paragraphs = text.split(/\n\n+/);
  const chunks: string[] = [];
  let currentChunk = '';

  for (const para of paragraphs) {
    if ((currentChunk + para).length > chunkSize && currentChunk) {
      chunks.push(currentChunk.trim());
      currentChunk = para;
    } else {
      currentChunk += (currentChunk ? '\n\n' : '') + para;
    }
  }

  if (currentChunk) {
    chunks.push(currentChunk.trim());
  }

  return chunks;
}

/**
 * Token sayısını yaklaşık olarak hesapla
 */
export function estimateTokens(text: string): number {
  // Basit tahmin: 1 token ≈ 4 karakter
  return Math.ceil(text.length / 4);
}

/**
 * Sleep fonksiyonu
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Format duration (seconds to MM:SS)
 */
export function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Sanitize filename
 */
export function sanitizeFilename(filename: string): string {
  return filename
    .replace(/[^a-z0-9-_\.]/gi, '_')
    .replace(/_{2,}/g, '_')
    .toLowerCase();
}

/**
 * Convert stream to buffer
 */
export async function streamToBuffer(stream: ReadableStream): Promise<Buffer> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  
  return Buffer.concat(chunks);
}

