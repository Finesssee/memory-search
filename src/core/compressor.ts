// Semantic compression using LLM endpoint

import type { Config } from '../types.js';
import { fetchWithRetry } from '../utils/network.js';

const COMPRESSION_PROMPT = `Compress this content into a dense summary (max 100 words).
Preserve: facts, numbers, names, decisions, preferences, outcomes.
Remove: filler, pleasantries, repetition.
Format: bullet points if multiple items, otherwise prose.

Content: `;

interface ChatResponse {
  response?: string;
  content?: string;
  message?: string;
}

export async function compressContent(content: string, config: Config): Promise<string> {
  if (!config.compressionEnabled) {
    return content;
  }

  try {
    const response = await fetchWithRetry('http://localhost:8080/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [
          { role: 'user', content: COMPRESSION_PROMPT + content }
        ]
      }),
    });

    if (!response.ok) {
      console.error(`[compressor] API error: ${response.status} ${response.statusText}`);
      return content;
    }

    const data = await response.json() as ChatResponse;
    const compressed = data.response || data.content || data.message;

    if (!compressed || typeof compressed !== 'string') {
      console.error('[compressor] Invalid response format');
      return content;
    }

    console.error(`[compressor] Compressed ${content.length} -> ${compressed.length} chars`);
    return compressed;
  } catch (err) {
    console.error(`[compressor] Error: ${err instanceof Error ? err.message : String(err)}`);
    return content;
  }
}
