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
  return { retrieval: 0.80, reranker: 0.20 };
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function isTrivialQuery(query: string): boolean {
  const trimmed = query.trim();
  if (trimmed.length === 0) return true;
  if (trimmed.length < 3) return true;
  return false;
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

function parseRerankerWeights(rawValue: string | undefined): { bge: number; qwen: number; gemma: number } {
  const defaults = { bge: 0.5, qwen: 0.3, gemma: 0.2 };
  if (!rawValue || rawValue.trim().length === 0) return defaults;

  const parsed: Partial<Record<'bge' | 'qwen' | 'gemma', number>> = {};

  const trimmed = rawValue.trim();
  if (trimmed.startsWith('{')) {
    try {
      const json = JSON.parse(trimmed) as Record<string, unknown>;
      for (const key of ['bge', 'qwen', 'gemma'] as const) {
        const value = json[key];
        if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
          parsed[key] = value;
        }
      }
    } catch {
      return defaults;
    }
  } else {
    const pairs = trimmed
      .split(',')
      .map(part => part.trim())
      .filter(Boolean);
    for (const pair of pairs) {
      const [rawKey, rawNumber] = pair.includes('=')
        ? pair.split('=')
        : pair.includes(':')
          ? pair.split(':')
          : [];
      if (!rawKey || !rawNumber) continue;
      const key = rawKey.trim().toLowerCase();
      if (key !== 'bge' && key !== 'qwen' && key !== 'gemma') continue;
      const value = Number.parseFloat(rawNumber.trim());
      if (!Number.isFinite(value) || value < 0) continue;
      parsed[key] = value;
    }
  }

  const bge = parsed.bge ?? defaults.bge;
  const qwen = parsed.qwen ?? defaults.qwen;
  const gemma = parsed.gemma ?? defaults.gemma;
  const sum = bge + qwen + gemma;
  if (!Number.isFinite(sum) || sum <= 0) return defaults;

  return {
    bge: bge / sum,
    qwen: qwen / sum,
    gemma: gemma / sum,
  };
}

function blendNormalizedScores(
  scores: Record<string, unknown> | undefined,
  weights: { bge: number; qwen: number; gemma: number }
): number | null {
  if (!scores) return null;

  const bge = typeof scores.bge === 'number' ? normalizeRerankerScore(scores.bge) : null;
  const qwen = typeof scores.qwen === 'number' ? normalizeRerankerScore(scores.qwen) : null;
  const gemma = typeof scores.gemma === 'number' ? normalizeRerankerScore(scores.gemma) : null;

  let weightedSum = 0;
  let weightSum = 0;
  if (bge !== null) {
    weightedSum += bge * weights.bge;
    weightSum += weights.bge;
  }
  if (qwen !== null) {
    weightedSum += qwen * weights.qwen;
    weightSum += weights.qwen;
  }
  if (gemma !== null) {
    weightedSum += gemma * weights.gemma;
    weightSum += weights.gemma;
  }

  if (weightSum <= 0) return null;
  return clamp01(weightedSum / weightSum);
}

function minMaxNormalizeScores(scoresByIndex: Map<number, number>): Map<number, number> {
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
    return results.map(({ rrfRank: _, fullContent: __, contentHash: ____, ...rest }) => rest);
  }
  if (results.length === 0) return results;
  if (isTrivialQuery(query)) {
    return results.map(({ rrfRank: _, fullContent: __, contentHash: ____, ...rest }) => rest);
  }

  const cache = new RerankCache(config);
  const model = 'multi-v5'; // Cache key for weighted multi-model blend + per-query normalization
  const modelWeights = parseRerankerWeights(process.env.RERANKER_WEIGHTS);
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
        console.warn('Rerank response missing index field', r);
        continue;
      }

      const originalIndex = uncachedIndices[rawIndex as number];
      if (!Number.isFinite(originalIndex)) {
        console.warn('Rerank index out of range', { rawIndex, total: uncachedIndices.length });
        continue;
      }

      const docKey = getDocKey(results[originalIndex]);
      const blended = blendNormalizedScores((r as unknown as { scores?: Record<string, unknown> }).scores, modelWeights);
      const normalized = blended ?? normalizeRerankerScore((r as unknown as { score?: number }).score ?? NaN);
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
        rerankerModelWeights: modelWeights,
      },
      score: blendedScore,
    };
  });

  // Sort by blended score (higher is better)
  return blendedResults.sort((a, b) => b.score - a.score);
}
