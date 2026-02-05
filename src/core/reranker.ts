// Multi-model reranker using Cloudflare Workers AI

import type { Config, SearchResult } from '../types.js';
import { RerankCache } from '../storage/rerank-cache.js';
import { hashContent } from '../utils/hash.js';
import { fetchWithRetry } from '../utils/network.js';

interface RerankResponse {
  index: number;
  score: number;
  scores: { bge: number; gemma: number; qwen: number };
}

interface SearchResultWithRank extends SearchResult {
  rrfRank?: number;
}

/**
 * Get position-aware blend weights based on initial RRF rank.
 * Top positions trust retrieval more, lower positions get slight reranker boost.
 * Conservative weights since reranker quality varies.
 */
function getBlendWeights(rank: number): { retrieval: number; reranker: number } {
  if (rank <= 3) return { retrieval: 0.95, reranker: 0.05 };
  if (rank <= 10) return { retrieval: 0.90, reranker: 0.10 };
  return { retrieval: 0.85, reranker: 0.15 };
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

// Reranker scores can be:
// - Already normalized [0, 1] → keep as-is
// - Cosine similarity [-1, 1] → linear scale to [0, 1]
// - Logits (unbounded) → sigmoid to [0, 1]
function normalizeRerankerScore(score: number): number {
  if (!Number.isFinite(score)) return 0;
  // Already normalized
  if (score >= 0 && score <= 1) return clamp01(score);
  // Cosine similarity range [-1, 1] → linear scale
  if (score >= -1 && score <= 1) return clamp01((score + 1) / 2);
  // Logits (outside [-1, 1]) → sigmoid
  return clamp01(1 / (1 + Math.exp(-score)));
}

function averageNormalizedScores(scores: Record<string, unknown> | undefined): number | null {
  if (!scores) return null;
  const values = Object.values(scores).filter((value): value is number => typeof value === 'number');
  if (values.length === 0) return null;
  const normalized = values.map(normalizeRerankerScore);
  const avg = normalized.reduce((sum, value) => sum + value, 0) / normalized.length;
  return clamp01(avg);
}

function extractRerankItems(body: unknown): RerankResponse[] {
  if (Array.isArray(body)) {
    return body as RerankResponse[];
  }
  if (body && typeof body === 'object') {
    const obj = body as Record<string, unknown>;
    if (Array.isArray(obj.response)) return obj.response as RerankResponse[];
    if (Array.isArray(obj.results)) return obj.results as RerankResponse[];
    if (Array.isArray(obj.data)) return obj.data as RerankResponse[];
  }
  return [];
}

function getDocKey(result: SearchResultWithRank): string {
  const content = result.fullContent ?? result.snippet;
  const contentHash = result.contentHash ?? hashContent(content);
  return `${result.chunkId ?? 'x'}:${contentHash}`;
}

/**
 * Rerank search results using multiple embedding models (BGE, Gemma, Qwen)
 * Calls the /rerank endpoint which runs all 3 models in parallel
 * Uses per-document caching to avoid redundant API calls
 */
export async function rerankResults(
  query: string,
  results: SearchResultWithRank[],
  config: Config
): Promise<SearchResult[]> {
  if (process.env.MEMORY_SEARCH_DISABLE_RERANK === '1') {
    return results.map(({ rrfRank: _, fullContent: __, chunkId: ___, contentHash: ____, ...rest }) => rest);
  }
  if (results.length === 0) return results;

  const cache = new RerankCache(config);
  const model = 'multi-v4'; // Cache key for combined multi-model score (fixed normalization + conservative weights)
  const queryHash = hashContent(query);

  // Check cache for each document
  const cachedScores: Map<number, number> = new Map();
  const uncachedIndices: number[] = [];

  for (let i = 0; i < results.length; i++) {
    const docKey = getDocKey(results[i]);
    const cachedScore = cache.getScore(queryHash, docKey, model);
    if (cachedScore !== null) {
      cachedScores.set(i, clamp01(cachedScore));
    } else {
      uncachedIndices.push(i);
    }
  }

  // If all scores are cached, skip API call
  let newScores: Map<number, number> = new Map();

  if (uncachedIndices.length > 0) {
    const uncachedDocs = uncachedIndices.map(i => results[i].fullContent ?? results[i].snippet);
    const endpoint = config.embeddingEndpoint.replace(/\/$/, '') + '/rerank';

    const response = await fetchWithRetry(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, documents: uncachedDocs }),
    });

    if (!response.ok) {
      // Fall back to original order if reranking fails
      console.error(`Rerank failed: ${response.status}`);
      cache.close();
      return results.map(({ rrfRank, ...rest }) => rest);
    }

    const body = (await response.json()) as unknown;
    const reranked = extractRerankItems(body);

    // Store new scores in cache and collect them
    for (const r of reranked) {
      const rawIndex =
        (r as unknown as { index?: number; id?: number; document_index?: number; documentIndex?: number }).index ??
        (r as unknown as { id?: number }).id ??
        (r as unknown as { document_index?: number }).document_index ??
        (r as unknown as { documentIndex?: number }).documentIndex;

      if (!Number.isFinite(rawIndex)) {
        console.warn('Rerank response missing index field', r);
        continue;
      }

      const originalIndex = uncachedIndices[rawIndex as number];
      if (!Number.isFinite(originalIndex)) {
        console.warn('Rerank index out of range', { rawIndex, total: uncachedIndices.length });
        continue;
      }

      const docKey = getDocKey(results[originalIndex]);
      const averaged = averageNormalizedScores((r as unknown as { scores?: Record<string, unknown> }).scores);
      const normalized = averaged ?? normalizeRerankerScore((r as unknown as { score?: number }).score ?? NaN);
      cache.setScore(queryHash, docKey, model, normalized);
      newScores.set(originalIndex, normalized);
    }
  }

  cache.close();

  // Combine cached and new scores, apply position-aware blending
  const blendedResults = results.map((original, index) => {
    const rerankerScore = cachedScores.get(index) ?? newScores.get(index) ?? 0;
    const rrfRank = original.rrfRank ?? index + 1;
    const weights = getBlendWeights(rrfRank);

    // Retrieval score is already in [0, 1] from RRF fusion
    const retrievalScore = clamp01(original.score);

    const blendedScore = weights.retrieval * retrievalScore + weights.reranker * rerankerScore;

    const { rrfRank: _, fullContent: __, chunkId: ___, contentHash: ____, ...rest } = original;
    return {
      ...rest,
      score: blendedScore,
    };
  });

  // Sort by blended score (higher is better)
  return blendedResults.sort((a, b) => b.score - a.score);
}
