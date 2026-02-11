// Embedding API wrapper - supports Cloudflare Workers AI with batching and parallelism

import type { Config, EmbeddingResponse } from '../types.js';
import { fetchWithRetry } from '../utils/network.js';
import { LruCache } from '../utils/lru.js';
import { MemoryDB } from '../storage/db.js';
import { logDebug, logWarn, errorMessage } from '../utils/log.js';

const BATCH_SIZE = 50;   // Balanced batch size for Cloudflare Workers
const PARALLEL_REQUESTS = 2;  // Moderate parallelism to avoid rate limiting
const COOLDOWN_EVERY = 300;   // Pause every N batches to let Worker AI backend recover
const COOLDOWN_MS = 60000;    // 60s cooldown to reset rate limit window

// LRU cache for query embeddings (max 200 entries)
const queryEmbeddingCache = new LruCache<string, Float32Array>(200);

export function normalizeEmbedding(embedding: Float32Array): Float32Array {
  let sumSquares = 0;
  for (let i = 0; i < embedding.length; i++) {
    const v = embedding[i];
    sumSquares += v * v;
  }
  const norm = Math.sqrt(sumSquares);
  if (norm === 0 || !Number.isFinite(norm)) return embedding;
  for (let i = 0; i < embedding.length; i++) {
    embedding[i] = embedding[i] / norm;
  }
  return embedding;
}

export async function getEmbedding(
  text: string,
  config: Config
): Promise<Float32Array> {
  // Check in-memory LRU cache first
  const cached = queryEmbeddingCache.get(text);
  if (cached) return cached;

  // Single DB connection for cache read + optional write
  const db = new MemoryDB(config);
  try {
    const dbCached = db.getCachedQueryEmbedding(text);
    if (dbCached) {
      queryEmbeddingCache.set(text, dbCached);
      return dbCached;
    }

    // Fetch from embedding server
    const results = await getEmbeddingsBatch([text], config);
    const embedding = results[0];

    // Cache in memory + persist to DB
    queryEmbeddingCache.set(text, embedding);
    db.setCachedQueryEmbedding(text, embedding);

    return embedding;
  } finally {
    db.close();
  }
}

/**
 * Sanitize text for embedding API - remove null bytes, control chars,
 * and base64 data URIs that bloat payloads without adding search value.
 * Also truncates to a max length since embedding models have fixed context windows.
 */
const MAX_EMBED_CHARS = 8000; // ~2000 tokens, well within model limits

function sanitizeForEmbedding(text: string): string {
  let clean = text
    // Strip base64 data URIs (e.g., data:image/png;base64,...) — useless for semantic search
    .replace(/data:[a-zA-Z]+\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=\s]+/g, '[image]')
    // Remove null bytes and non-printable control characters (except newline, tab)
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
  if (clean.length > MAX_EMBED_CHARS) {
    clean = clean.slice(0, MAX_EMBED_CHARS);
  }
  return clean;
}

export async function getEmbeddingsBatch(
  texts: string[],
  config: Config
): Promise<Float32Array[]> {
  if (config.provider === 'local') {
    const { getLocalLlm, initLocalLlm } = await import('./local-llm.js');
    let llm = getLocalLlm();
    if (!llm) llm = await initLocalLlm(config.localLlm ?? {});
    if (llm) return llm.embed(texts);
    logWarn('embeddings', 'Local LLM not available, falling back to API');
  }

  const sanitized = texts.map(sanitizeForEmbedding);

  const response = await fetchWithRetry(config.embeddingEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: sanitized }),
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
    return normalizeEmbedding(new Float32Array(embedding));
  });
}

/**
 * Process embeddings in parallel batches for maximum throughput.
 * Falls back to smaller batches on failure.
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

    const parallelResults = await Promise.allSettled(
      parallelBatches.map(batch => getEmbeddingsBatch(batch, config))
    );

    // Handle results, falling back to individual items on batch failure
    for (let j = 0; j < parallelResults.length; j++) {
      const result = parallelResults[j];
      if (result.status === 'fulfilled') {
        results[batchIndices[j]] = result.value;
      } else {
        logWarn('embeddings', `Batch ${batchIndices[j] + 1} failed, retrying items individually`, { error: errorMessage(result.reason) });
        // Wait before retrying to let rate limits cool down
        await new Promise(r => setTimeout(r, 5000));
        // Retry individual items
        const batch = parallelBatches[j];
        const individualResults: Float32Array[] = [];
        for (const text of batch) {
          try {
            const [embedding] = await getEmbeddingsBatch([text], config);
            individualResults.push(embedding);
          } catch (err) {
            logWarn('embeddings', 'Individual embedding failed, using zero vector', { error: errorMessage(err) });
            individualResults.push(new Float32Array(config.embeddingDimensions));
          }
        }
        results[batchIndices[j]] = individualResults;
      }
      completedBatches++;
      onBatchComplete?.(completedBatches, batches.length);
    }

    // Cooldown pause every COOLDOWN_EVERY batches to let Worker recover
    if (completedBatches > 0 && completedBatches % COOLDOWN_EVERY === 0 && i + PARALLEL_REQUESTS < batches.length) {
      logDebug('embeddings', `Cooldown after ${completedBatches} batches (${COOLDOWN_MS / 1000}s pause)`);
      await new Promise(r => setTimeout(r, COOLDOWN_MS));
      // Health check: verify Worker is responding before resuming
      for (let hc = 0; hc < 5; hc++) {
        try {
          const ok = await checkEmbeddingServer(config);
          if (ok) break;
        } catch { /* ignore */ }
        logDebug('embeddings', `Worker still down after cooldown, waiting another 30s (attempt ${hc + 1}/5)`);
        await new Promise(r => setTimeout(r, 30000));
      }
    }
    // Small delay between batch groups to avoid rate limiting
    else if (i + PARALLEL_REQUESTS < batches.length) {
      await new Promise(r => setTimeout(r, 100));
    }
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
  } catch (err) {
    logDebug('embeddings', 'Embedding server health check failed', { error: errorMessage(err) });
    return false;
  }
}
