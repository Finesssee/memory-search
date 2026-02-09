// Cross-encoder reranker using Cloudflare Workers AI (bge-reranker-base)

import type { Config, SearchResult } from '../types.js';
import { RerankCache } from '../storage/rerank-cache.js';
import { hashContent } from '../utils/hash.js';
import { fetchWithRetry } from '../utils/network.js';
import { logWarn, logError, errorMessage } from '../utils/log.js';
import { getRerankEndpoint } from '../utils/api-endpoints.js';

interface RerankResponse {
  index: number;
  score: number;
}

interface SearchResultWithRank extends SearchResult {
  rrfRank?: number;
}

/**
 * Get position-aware blend weights based on initial RRF rank.
 * Top positions trust retrieval more, lower positions get slight reranker boost.
 * Conservative weights since reranker quality varies.
 */
export function getBlendWeights(rank: number): { retrieval: number; reranker: number } {
  if (rank <= 3) return { retrieval: 0.70, reranker: 0.30 };
  if (rank <= 10) return { retrieval: 0.60, reranker: 0.40 };
  return { retrieval: 0.50, reranker: 0.50 };
}

export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

export function isTrivialQuery(query: string): boolean {
  const trimmed = query.trim();
  if (trimmed.length === 0) return true;
  if (trimmed.length < 3) return true;
  return false;
}

// Reranker scores can be:
// - Already normalized [0, 1] → keep as-is
// - Cosine similarity [-1, 1] → linear scale to [0, 1]
// - Logits (unbounded) → sigmoid to [0, 1]
export function normalizeRerankerScore(score: number): number {
  if (!Number.isFinite(score)) return 0;
  // Already normalized
  if (score >= 0 && score <= 1) return clamp01(score);
  // Cosine similarity range [-1, 1] → linear scale
  if (score >= -1 && score <= 1) return clamp01((score + 1) / 2);
  // Logits (outside [-1, 1]) → sigmoid
  return clamp01(1 / (1 + Math.exp(-score)));
}


export function minMaxNormalizeScores(scoresByIndex: Map<number, number>): Map<number, number> {
  const normalized = new Map<number, number>();
  if (scoresByIndex.size === 0) return normalized;

  let min = Infinity;
  let max = -Infinity;
  for (const score of scoresByIndex.values()) {
    if (!Number.isFinite(score)) continue;
    if (score < min) min = score;
    if (score > max) max = score;
  }

  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return normalized;
  }

  const range = max - min;
  for (const [index, score] of scoresByIndex.entries()) {
    let value = 0;
    if (range === 0) {
      value = 1;
    } else {
      value = (score - min) / range;
    }
    normalized.set(index, clamp01(value));
  }

  return normalized;
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
 * Rerank search results using bge-reranker-base cross-encoder
 * Calls the /rerank endpoint which scores query-document pairs directly
 * Uses per-document caching to avoid redundant API calls
 */
export async function rerankResults(
  query: string,
  results: SearchResultWithRank[],
  config: Config
): Promise<SearchResult[]> {
  if (process.env.MEMORY_SEARCH_DISABLE_RERANK === '1') {
    return results.map(({ rrfRank: _, fullContent: __, contentHash: ____, ...rest }) => rest);
  }
  if (results.length === 0) return results;
  if (isTrivialQuery(query)) {
    return results.map(({ rrfRank: _, fullContent: __, contentHash: ____, ...rest }) => rest);
  }

  const cache = new RerankCache(config);
  const model = 'bge-reranker-v1'; // Cache key for bge-reranker-base cross-encoder
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
    const endpoint = getRerankEndpoint(config.embeddingEndpoint);

    const response = await fetchWithRetry(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, documents: uncachedDocs }),
    });

    if (!response.ok) {
      logError('reranker', `Rerank API failed`, { status: response.status, endpoint });
      cache.close();
      return results.map(({ rrfRank: _, fullContent: __, contentHash: ____, ...rest }) => rest);
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
        logWarn('reranker', 'Rerank response item missing index field', { item: JSON.stringify(r) });
        continue;
      }

      const originalIndex = uncachedIndices[rawIndex as number];
      if (!Number.isFinite(originalIndex)) {
        logWarn('reranker', 'Rerank index out of range', { rawIndex, total: uncachedIndices.length });
        continue;
      }

      const docKey = getDocKey(results[originalIndex]);
      const normalized = normalizeRerankerScore((r as unknown as { score?: number }).score ?? NaN);
      cache.setScore(queryHash, docKey, model, normalized);
      newScores.set(originalIndex, normalized);
    }
  }

  cache.close();

  const rawRerankerScores = new Map<number, number>();
  for (let index = 0; index < results.length; index++) {
    rawRerankerScores.set(index, cachedScores.get(index) ?? newScores.get(index) ?? 0);
  }
  const normalizedRerankerScores = minMaxNormalizeScores(rawRerankerScores);

  // Combine cached and new scores, apply position-aware blending
  const blendedResults = results.map((original, index) => {
    const rerankerRawScore = rawRerankerScores.get(index) ?? 0;
    const rerankerScore = normalizedRerankerScores.get(index) ?? 0;
    const rrfRank = original.rrfRank ?? index + 1;
    const weights = getBlendWeights(rrfRank);

    // Retrieval score is already in [0, 1] from RRF fusion
    const retrievalScore = clamp01(original.score);

    const blendedScore = weights.retrieval * retrievalScore + weights.reranker * rerankerScore;

    const { rrfRank: _, fullContent: __, contentHash: ____, ...rest } = original;
    return {
      ...rest,
      chunkId: original.chunkId,
      explain: {
        ...original.explain,
        rerankerRawScore,
        rerankerScore,
        rerankerWeights: weights,
      },
      score: blendedScore,
    };
  });

  // Sort by blended score (higher is better)
  return blendedResults.sort((a, b) => b.score - a.score);
}
