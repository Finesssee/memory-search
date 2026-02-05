// Embedding API wrapper - supports Cloudflare Workers AI with batching and parallelism

import type { Config, EmbeddingResponse } from '../types.js';
import { fetchWithRetry } from '../utils/network.js';
import { LruCache } from '../utils/lru.js';

const BATCH_SIZE = 100;  // Cloudflare Workers AI can handle larger batches
const PARALLEL_REQUESTS = 4;  // Fire multiple batches concurrently

// LRU cache for query embeddings (max 200 entries)
const queryEmbeddingCache = new LruCache<string, Float32Array>(200);

export async function getEmbedding(
  text: string,
  config: Config
): Promise<Float32Array> {
  // Check cache first
  const cached = queryEmbeddingCache.get(text);
  if (cached) return cached;

  const results = await getEmbeddingsBatch([text], config);
  const embedding = results[0];

  // Cache the result
  queryEmbeddingCache.set(text, embedding);

  return embedding;
}

export async function getEmbeddingsBatch(
  texts: string[],
  config: Config
): Promise<Float32Array[]> {
  const response = await fetchWithRetry(config.embeddingEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: texts }),
  });

  if (!response.ok) {
    throw new Error(`Embedding API error: ${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as EmbeddingResponse[];

  return data.map((item) => {
    const embedding = item.embedding[0];
    if (!Array.isArray(embedding)) {
      throw new Error('Invalid embedding response format');
    }
    return new Float32Array(embedding);
  });
}

/**
 * Process embeddings in parallel batches for maximum throughput
 */
export async function getEmbeddingsParallel(
  texts: string[],
  config: Config,
  onBatchComplete?: (completed: number, total: number) => void
): Promise<Float32Array[]> {
  // Split into batches
  const batches: string[][] = [];
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    batches.push(texts.slice(i, i + BATCH_SIZE));
  }

  const results: Float32Array[][] = new Array(batches.length);
  let completedBatches = 0;

  // Process batches in parallel groups
  for (let i = 0; i < batches.length; i += PARALLEL_REQUESTS) {
    const parallelBatches = batches.slice(i, i + PARALLEL_REQUESTS);
    const batchIndices = parallelBatches.map((_, idx) => i + idx);

    const parallelResults = await Promise.all(
      parallelBatches.map(batch => getEmbeddingsBatch(batch, config))
    );

    // Store results in correct order
    parallelResults.forEach((result, idx) => {
      results[batchIndices[idx]] = result;
      completedBatches++;
      onBatchComplete?.(completedBatches, batches.length);
    });
  }

  // Flatten results
  return results.flat();
}

export async function getEmbeddings(
  texts: string[],
  config: Config
): Promise<Float32Array[]> {
  return getEmbeddingsParallel(texts, config);
}

/**
 * Prefix text for query embedding (Nomic model requirement)
 */
export function prefixQuery(text: string): string {
  return `search_query: ${text}`;
}

/**
 * Prefix text for document embedding (Nomic model requirement)
 */
export function prefixDocument(text: string): string {
  return `search_document: ${text}`;
}

export async function checkEmbeddingServer(config: Config): Promise<boolean> {
  try {
    const response = await fetchWithRetry(config.embeddingEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: ['test'] }),
    });
    if (!response.ok) return false;
    const data = await response.json() as EmbeddingResponse[];
    return Array.isArray(data) && data.length > 0 && Array.isArray(data[0]?.embedding);
  } catch {
    return false;
  }
}
