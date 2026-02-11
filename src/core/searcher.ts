// Searcher - performs hybrid semantic + keyword search over indexed chunks
// with multi-model reranking (BGE + Gemma + Qwen)

import { MemoryDB } from '../storage/db.js';
import { getEmbedding, prefixQuery } from './embeddings.js';
import { findTopK } from '../utils/cosine.js';
import { rerankResults } from './reranker.js';
import { expandQueryStructured } from './expander.js';
import { resolveContextForPath } from '../utils/context-resolver.js';
import { correctQuery } from './spell-corrector.js';
import type { Config, SearchResult } from '../types.js';

const RRF_K = 60; // RRF constant (commonly 60)
const ORIGINAL_WEIGHT = 4.0;
const ORIGINAL_BM25_WEIGHT = 0.6;
const ORIGINAL_SEM_WEIGHT = 0.4;
const LEX_WEIGHT = 0.5;
const VEC_WEIGHT = 0.5;
const HYDE_WEIGHT = 0.25;
const VSS_EXPAND_FACTOR = 4;

interface RankedItem {
  chunkId: number;
  totalScore: number;
  rrfScore: number;
  rrfRank?: number;
  bm25Rank?: number;
  bm25Score?: number;
  semanticScore?: number;
  blendWeights?: { bm25: number; semantic: number };
}

export type SearchMode = 'hybrid' | 'bm25' | 'vector';

export async function search(
  query: string,
  config: Config,
  onStage?: (stage: string) => void,
  mode: SearchMode = 'hybrid'
): Promise<SearchResult[]> {
  const db = new MemoryDB(config);
  const candidateCap = config.searchCandidateCap ?? 300;
  const finalTopK = Math.max(1, config.searchTopK);

  try {
    // Spell correction — fix typos using the FTS vocabulary
    let searchQuery = query;
    const { corrected, corrections } = correctQuery(query, db);
    if (corrections.length > 0) {
      searchQuery = corrected;
      const fixedTerms = corrections.map(c => `"${c.original}" → "${c.replacement}"`).join(', ');
      onStage?.(`Corrected: ${fixedTerms}`);
    }

    // Build list of queries with weights and types
    interface QueryItem {
      text: string;
      weight: number;
      type: 'original' | 'lex' | 'vec' | 'hyde';
    }

    const queries: QueryItem[] = [
      { text: searchQuery, weight: ORIGINAL_WEIGHT, type: 'original' },
    ];

    // Also search with original uncorrected query if corrections were made
    if (corrections.length > 0) {
      queries.push({ text: query, weight: ORIGINAL_WEIGHT * 0.5, type: 'original' });
    }

    // Expand query if enabled
    if (config.expandQueries) {
      onStage?.('Expanding query...');
      // Resolve context hints for the current directory
      const cwd = process.cwd();
      const contextHints = resolveContextForPath(cwd, config.pathContexts);

      const expanded = await expandQueryStructured(searchQuery, config, contextHints);

      // Add keyword-optimized queries (for FTS)
      for (const lexQuery of expanded.lex) {
        queries.push({ text: lexQuery, weight: LEX_WEIGHT, type: 'lex' });
      }

      // Add semantic queries (for vector search)
      for (const vecQuery of expanded.vec) {
        queries.push({ text: vecQuery, weight: VEC_WEIGHT, type: 'vec' });
      }

      // Add HyDE hypothetical answer (for vector search only)
      if (expanded.hyde) {
        queries.push({ text: expanded.hyde, weight: HYDE_WEIGHT, type: 'hyde' });
      }
    }

    // Track best ranks for each chunk across original query
    const chunkBestRanks = new Map<number, { semanticRank?: number; keywordRank?: number }>();

    // Run semantic and keyword search for all queries in parallel
    onStage?.('Searching...');
    const searchPromises = queries.map(async (q) => {
      // Only run semantic search for original, vec, and hyde queries
      // Only run keyword search for original and lex queries
      const runSemantic = mode !== 'bm25' && (q.type === 'original' || q.type === 'vec' || q.type === 'hyde');
      const runKeyword = mode !== 'vector' && (q.type === 'original' || q.type === 'lex');

      const [semanticResults, keywordResults] = await Promise.all([
        runSemantic ? semanticSearch(q.text, config, db, candidateCap) : Promise.resolve([]),
        runKeyword ? keywordSearch(q.text, db, candidateCap) : Promise.resolve([]),
      ]);

      return { query: q, semanticResults, keywordResults };
    });

    const allResults = await Promise.all(searchPromises);

    // Build weighted RRF ranking for expanded queries
    const chunkScores = new Map<number, RankedItem>();
    let originalSemanticResults: { chunkId: number; score: number }[] = [];
    let originalKeywordResults: { chunkId: number; rank: number }[] = [];

    for (const { query: q, semanticResults, keywordResults } of allResults) {
      if (q.type === 'original') {
        originalSemanticResults = semanticResults;
        originalKeywordResults = keywordResults;
      } else {
        // Add semantic results with weighted scores for expanded queries
        semanticResults.forEach((result, index) => {
          const contribution = q.weight / (RRF_K + index);
          const existing = chunkScores.get(result.chunkId);
          if (existing) {
            existing.rrfScore += contribution;
            existing.totalScore += contribution;
          } else {
            chunkScores.set(result.chunkId, {
              chunkId: result.chunkId,
              totalScore: contribution,
              rrfScore: contribution,
            });
          }
        });

        // Add keyword results with weighted scores for expanded queries
        keywordResults.forEach((result, index) => {
          const contribution = q.weight / (RRF_K + index);
          const existing = chunkScores.get(result.chunkId);
          if (existing) {
            existing.rrfScore += contribution;
            existing.totalScore += contribution;
          } else {
            chunkScores.set(result.chunkId, {
              chunkId: result.chunkId,
              totalScore: contribution,
              rrfScore: contribution,
            });
          }
        });
      }

      // Track best semantic rank for original query
      if (q.type === 'original') {
        semanticResults.forEach((result, index) => {
          const bestRanks = chunkBestRanks.get(result.chunkId) || {};
          if (bestRanks.semanticRank === undefined || index < bestRanks.semanticRank) {
            bestRanks.semanticRank = index;
          }
          chunkBestRanks.set(result.chunkId, bestRanks);
        });

        // Track best keyword rank for original query
        keywordResults.forEach((result, index) => {
          const bestRanks = chunkBestRanks.get(result.chunkId) || {};
          if (bestRanks.keywordRank === undefined || index < bestRanks.keywordRank) {
            bestRanks.keywordRank = index;
          }
          chunkBestRanks.set(result.chunkId, bestRanks);
        });
      }
    }

    // Score-aware fusion for original query (bm25 + semantic)
    const bm25Norm = normalizeScoreMap(
      originalKeywordResults.map(r => ({ chunkId: r.chunkId, value: r.rank })),
      false
    );
    const semanticNorm = normalizeScoreMap(
      originalSemanticResults.map(r => ({ chunkId: r.chunkId, value: r.score })),
      true
    );
    const bm25RankMap = new Map(originalKeywordResults.map((r, i) => [r.chunkId, i + 1]));

    const originalChunkIds = new Set<number>([
      ...bm25Norm.keys(),
      ...semanticNorm.keys(),
    ]);

    for (const chunkId of originalChunkIds) {
      const bm25Score = bm25Norm.get(chunkId) ?? 0;
      const semanticScore = semanticNorm.get(chunkId) ?? 0;
      const blended = bm25Score * ORIGINAL_BM25_WEIGHT + semanticScore * ORIGINAL_SEM_WEIGHT;
      const contribution = blended * ORIGINAL_WEIGHT;

      const existing = chunkScores.get(chunkId);
      if (existing) {
        existing.totalScore += contribution;
      } else {
        chunkScores.set(chunkId, {
          chunkId,
          totalScore: contribution,
          rrfScore: 0,
        });
      }

      const target = chunkScores.get(chunkId)!;
      target.bm25Rank = bm25RankMap.get(chunkId);
      target.bm25Score = bm25Score;
      target.semanticScore = semanticScore;
      target.blendWeights = { bm25: ORIGINAL_BM25_WEIGHT, semantic: ORIGINAL_SEM_WEIGHT };
    }

    // Apply top-rank bonus based on original query performance
    for (const [chunkId, item] of chunkScores) {
      const bestRanks = chunkBestRanks.get(chunkId);
      if (bestRanks) {
        const bestRank = Math.min(
          bestRanks.semanticRank ?? Infinity,
          bestRanks.keywordRank ?? Infinity
        );
        if (bestRank === 0) {
          item.totalScore += 0.05; // Top result bonus
        } else if (bestRank <= 2) {
          item.totalScore += 0.02; // Top-3 bonus
        }
      }
    }

    // Normalize retrieval scores to [0, 1] for blending
    const normalizedScores = normalizeScoreMap(
      Array.from(chunkScores.values()).map(item => ({ chunkId: item.chunkId, value: item.totalScore })),
      true
    );
    for (const item of chunkScores.values()) {
      item.totalScore = normalizedScores.get(item.chunkId) ?? 0;
    }

    // Sort by retrieval score (higher is better) and assign ranks
    const rankedChunks = Array.from(chunkScores.values())
      .sort((a, b) => b.totalScore - a.totalScore)
      .slice(0, finalTopK);

    // Assign RRF ranks for position-aware blending
    rankedChunks.forEach((item, index) => {
      item.rrfRank = index + 1;
    });

    // Fetch full chunk data for top results
    const chunkIds = rankedChunks.map(r => r.chunkId);
    const chunks = db.getChunksByIds(chunkIds);

    // Build results with RRF scores
    const chunkMap = new Map(chunks.map(c => [c.id, c]));
    const rrfRankMap = new Map(rankedChunks.map(r => [r.chunkId, r.rrfRank!]));

    const initialResults = rankedChunks
      .map(ranked => {
        const chunk = chunkMap.get(ranked.chunkId);
        if (!chunk) return null;

        return {
          file: chunk.filePath,
          score: ranked.totalScore, // Normalized 0..1 for blending/output
          lineStart: chunk.lineStart,
          lineEnd: chunk.lineEnd,
          snippet: truncateSnippet(chunk.content, 300),
          chunkIndex: chunk.chunkIndex,
          rrfRank: rrfRankMap.get(ranked.chunkId),
          fullContent: chunk.content,
          chunkId: chunk.id,
          contentHash: chunk.contentHash,
          fileMtime: chunk.fileMtime,
          explain: {
            rrfScore: ranked.rrfScore,
            rrfRank: rrfRankMap.get(ranked.chunkId),
            bm25Rank: ranked.bm25Rank,
            bm25Score: ranked.bm25Score,
            semanticScore: ranked.semanticScore,
            blendWeights: ranked.blendWeights,
          },
        };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);

    // Skip reranking for bm25 mode
    if (mode === 'bm25') {
      onStage?.('Done');
      return initialResults.slice(0, finalTopK);
    }

    // Rerank using multi-model ensemble (BGE + Gemma + Qwen)
    onStage?.('Reranking...');
    const reranked = await rerankResults(query, initialResults, config);
    onStage?.('Done');
    return reranked.slice(0, finalTopK);
  } finally {
    db.close();
  }
}

/**
 * Semantic search using embeddings
 * Uses sqlite-vec for vector search if available, otherwise falls back to linear scan
 */
async function semanticSearch(
  query: string,
  config: Config,
  db: MemoryDB,
  candidateCap: number
): Promise<{ chunkId: number; score: number }[]> {
  // Get query embedding with Nomic prefix
  const prefixedQuery = prefixQuery(query);
  const queryEmbedding = await getEmbedding(prefixedQuery, config);

  const topK = Math.min(config.searchTopK * 8, candidateCap);

  // Try VSS search first if available
  if (db.isVssEnabled()) {
    const vssLimit = Math.min(topK * VSS_EXPAND_FACTOR, candidateCap);
    const vssResults = db.searchVss(queryEmbedding, vssLimit);
    if (vssResults.length > 0) {
      // Convert cosine distance to similarity score (distance = 1 - similarity)
      const seeded = vssResults.map(({ chunkId, distance }) => ({
        chunkId,
        score: Math.max(0, 1 - distance),
      }));
      return seeded;
    }
  }

  // Fallback to linear scan
  const chunks = db.getAllChunks();

  if (chunks.length === 0) {
    return [];
  }

  // Find top-K similar chunks (get more than needed for RRF fusion)
  const results = findTopK(queryEmbedding, chunks, topK);

  return results.map(({ item, score }) => ({
    chunkId: item.id,
    score,
  }));
}

/**
 * Keyword search using FTS5 with fuzzy fallback.
 * If strict AND search returns no results, falls back to OR-based fuzzy search.
 */
function keywordSearch(
  query: string,
  db: MemoryDB,
  candidateCap: number
): { chunkId: number; rank: number }[] {
  const results = db.searchFTS(query, candidateCap);

  // If strict search returned no results, try fuzzy OR search
  if (results.length === 0) {
    return db.searchFTSFuzzy(query, candidateCap);
  }

  return results;
}

function truncateSnippet(content: string, maxLength: number): string {
  if (content.length <= maxLength) {
    return content;
  }
  return content.slice(0, maxLength).trim() + '...';
}

function normalizeScoreMap(
  items: Array<{ chunkId: number; value: number }>,
  higherBetter: boolean
): Map<number, number> {
  const map = new Map<number, number>();
  if (items.length === 0) return map;

  let min = Infinity;
  let max = -Infinity;
  for (const item of items) {
    if (!Number.isFinite(item.value)) continue;
    if (item.value < min) min = item.value;
    if (item.value > max) max = item.value;
  }

  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return map;
  }

  const range = max - min;
  for (const item of items) {
    let normalized = 0;
    if (range === 0) {
      normalized = 1;
    } else if (higherBetter) {
      normalized = (item.value - min) / range;
    } else {
      normalized = (max - item.value) / range;
    }
    if (!Number.isFinite(normalized)) normalized = 0;
    map.set(item.chunkId, Math.max(0, Math.min(1, normalized)));
  }

  return map;
}
