// Searcher - performs hybrid semantic + keyword search over indexed chunks
// with multi-model reranking (BGE + Gemma + Qwen)

import { MemoryDB } from '../storage/db.js';
import { getEmbedding, prefixQuery } from './embeddings.js';
import { findTopK } from '../utils/cosine.js';
import { rerankResults } from './reranker.js';
import { expandQueryStructured } from './expander.js';
import type { Config, SearchResult } from '../types.js';

const RRF_K = 60; // RRF constant (commonly 60)
const ORIGINAL_WEIGHT = 4.0;
const LEX_WEIGHT = 0.5;
const VEC_WEIGHT = 0.5;
const HYDE_WEIGHT = 0.25;

interface RankedItem {
  chunkId: number;
  semanticRank?: number;
  keywordRank?: number;
  rrfScore: number;
  rrfRank?: number;
}

export async function search(
  query: string,
  config: Config
): Promise<SearchResult[]> {
  const db = new MemoryDB(config);
  const candidateCap = config.searchCandidateCap ?? 200;

  try {
    // Build list of queries with weights and types
    interface QueryItem {
      text: string;
      weight: number;
      type: 'original' | 'lex' | 'vec' | 'hyde';
    }

    const queries: QueryItem[] = [
      { text: query, weight: ORIGINAL_WEIGHT, type: 'original' },
    ];

    // Expand query if enabled
    if (config.expandQueries) {
      const expanded = await expandQueryStructured(query, config);

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
    const searchPromises = queries.map(async (q) => {
      // Only run semantic search for original, vec, and hyde queries
      // Only run keyword search for original and lex queries
      const runSemantic = q.type === 'original' || q.type === 'vec' || q.type === 'hyde';
      const runKeyword = q.type === 'original' || q.type === 'lex';

      const [semanticResults, keywordResults] = await Promise.all([
        runSemantic ? semanticSearch(q.text, config, db, candidateCap) : Promise.resolve([]),
        runKeyword ? keywordSearch(q.text, db, candidateCap) : Promise.resolve([]),
      ]);

      return { query: q, semanticResults, keywordResults };
    });

    const allResults = await Promise.all(searchPromises);

    // Build weighted RRF ranking across all query variations
    const chunkScores = new Map<number, RankedItem>();

    for (const { query: q, semanticResults, keywordResults } of allResults) {
      // Add semantic results with weighted scores
      semanticResults.forEach((result, index) => {
        const contribution = q.weight / (RRF_K + index);
        const existing = chunkScores.get(result.chunkId);
        if (existing) {
          existing.rrfScore += contribution;
        } else {
          chunkScores.set(result.chunkId, {
            chunkId: result.chunkId,
            rrfScore: contribution,
          });
        }

        // Track best semantic rank for original query
        if (q.type === 'original') {
          const bestRanks = chunkBestRanks.get(result.chunkId) || {};
          if (bestRanks.semanticRank === undefined || index < bestRanks.semanticRank) {
            bestRanks.semanticRank = index;
          }
          chunkBestRanks.set(result.chunkId, bestRanks);
        }
      });

      // Add keyword results with weighted scores
      keywordResults.forEach((result, index) => {
        const contribution = q.weight / (RRF_K + index);
        const existing = chunkScores.get(result.chunkId);
        if (existing) {
          existing.rrfScore += contribution;
        } else {
          chunkScores.set(result.chunkId, {
            chunkId: result.chunkId,
            rrfScore: contribution,
          });
        }

        // Track best keyword rank for original query
        if (q.type === 'original') {
          const bestRanks = chunkBestRanks.get(result.chunkId) || {};
          if (bestRanks.keywordRank === undefined || index < bestRanks.keywordRank) {
            bestRanks.keywordRank = index;
          }
          chunkBestRanks.set(result.chunkId, bestRanks);
        }
      });
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
          item.rrfScore += 0.05; // Top result bonus
        } else if (bestRank <= 2) {
          item.rrfScore += 0.02; // Top-3 bonus
        }
      }
    }

    // Sort by RRF score (higher is better) and assign ranks
    const rankedChunks = Array.from(chunkScores.values())
      .sort((a, b) => b.rrfScore - a.rrfScore)
      .slice(0, config.searchTopK);

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
          score: ranked.rrfScore, // Keep in 0..1 range for blending/output
          lineStart: chunk.lineStart,
          lineEnd: chunk.lineEnd,
          snippet: truncateSnippet(chunk.content, 300),
          chunkIndex: chunk.chunkIndex,
          rrfRank: rrfRankMap.get(ranked.chunkId),
          fullContent: chunk.content,
          chunkId: chunk.id,
          contentHash: chunk.contentHash,
        };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);

    // Rerank using multi-model ensemble (BGE + Gemma + Qwen)
    const reranked = await rerankResults(query, initialResults, config);

    return reranked;
  } finally {
    db.close();
  }
}

/**
 * Semantic search using embeddings
 * Uses sqlite-vss for vector search if available, otherwise falls back to linear scan
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

  const topK = Math.min(config.searchTopK * 5, candidateCap);

  // Try VSS search first if available
  if (db.isVssEnabled()) {
    const vssResults = db.searchVss(queryEmbedding, topK);
    if (vssResults.length > 0) {
      // Convert distance to similarity score (lower distance = higher score)
      const seeded = vssResults.map(({ chunkId, distance }) => ({
        chunkId,
        score: 1 / (1 + distance), // Convert distance to similarity
      }));
      if (seeded.length >= topK) {
        return seeded;
      }

      // Fill remaining slots with linear scan results
      const chunks = db.getAllChunks();
      if (chunks.length === 0) return seeded;

      const fallbackResults = findTopK(queryEmbedding, chunks, topK);
      const seen = new Set(seeded.map(r => r.chunkId));

      for (const { item, score } of fallbackResults) {
        if (seen.has(item.id)) continue;
        seeded.push({ chunkId: item.id, score });
        if (seeded.length >= topK) break;
      }

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
 * Keyword search using FTS5
 */
function keywordSearch(
  query: string,
  db: MemoryDB,
  candidateCap: number
): { chunkId: number; rank: number }[] {
  return db.searchFTS(query, candidateCap);
}

function truncateSnippet(content: string, maxLength: number): string {
  if (content.length <= maxLength) {
    return content;
  }
  return content.slice(0, maxLength).trim() + '...';
}
