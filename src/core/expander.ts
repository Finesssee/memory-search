// Query expander - generates query variations for improved recall

import type { Config, ExpandedQuery, ExpandedQueries } from '../types.js';
import { fetchWithRetry } from '../utils/network.js';
import { LruCache } from '../utils/lru.js';

// LRU cache for query expansion results (max 200 entries)
const expansionCache = new LruCache<string, ExpandedQueries>(200);

const STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'how', 'in',
  'is', 'it', 'of', 'on', 'or', 'that', 'the', 'this', 'to', 'was', 'what',
  'when', 'where', 'which', 'who', 'why', 'with',
]);

function normalizeTerms(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .map(t => t.trim())
    .filter(t => t.length > 1 || /\d/.test(t))
    .filter(t => !STOPWORDS.has(t));
}

function normalizeExpansion(original: string, expanded: string): string | null {
  const cleaned = expanded.trim().replace(/\s+/g, ' ');
  if (cleaned.length < 3 || cleaned.length > 200) return null;
  if (cleaned.toLowerCase() === original.trim().toLowerCase()) return null;
  return cleaned;
}

/**
 * Check if expanded query has drifted too far from original
 * Returns true if expansion has insufficient lexical overlap (bad drift)
 */
function hasDrift(original: string, expanded: string): boolean {
  const originalTerms = normalizeTerms(original);
  const expandedTerms = new Set(normalizeTerms(expanded));

  if (originalTerms.length === 0 || expandedTerms.size === 0) {
    return true;
  }

  const overlapCount = originalTerms.filter(t => expandedTerms.has(t)).length;
  const overlapRatio = overlapCount / originalTerms.length;

  const minOverlap = originalTerms.length <= 3 ? 0.8 : 0.5;
  if (overlapRatio < minOverlap) {
    return true;
  }

  const numericTerms = originalTerms.filter(t => /\d/.test(t));
  if (numericTerms.length > 0 && !numericTerms.every(t => expandedTerms.has(t))) {
    return true;
  }

  return false;
}

/**
 * Filter out expansions that have drifted from original query
 */
function filterDriftedQueries(original: string, expansions: string[]): string[] {
  const seen = new Set<string>();
  const filtered: string[] = [];

  for (const exp of expansions) {
    const cleaned = normalizeExpansion(original, exp);
    if (!cleaned) continue;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    if (hasDrift(original, cleaned)) continue;
    seen.add(key);
    filtered.push(cleaned);
  }

  return filtered;
}

interface ExpandResponse {
  variations: string[];
}

interface ChatResponse {
  response: string;
}

/**
 * Generate a hypothetical answer for HyDE (Hypothetical Document Embeddings).
 * The hypothetical answer is embedded and used for semantic search.
 */
export async function generateHyDE(query: string, config: Config): Promise<string> {
  const baseEndpoint = config.embeddingEndpoint.replace(/\/$/, '');
  const chatEndpoint = baseEndpoint + '/chat';

  const prompt = `Answer this question in 2-3 sentences as if you know the answer:
Question: ${query}
Answer:`;

  try {
    const response = await fetchWithRetry(chatEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt }),
    });

    if (response.ok) {
      const data = (await response.json()) as ChatResponse;
      const answer = data.response?.trim();
      if (answer && answer.length > 0) {
        return answer;
      }
    }
  } catch {
    // Return empty on failure
  }

  return '';
}

/**
 * Expand a query into structured variations for hybrid search.
 * Returns keyword-optimized (lex), semantic (vec), and hypothetical answer (hyde).
 */
export async function expandQueryStructured(
  query: string,
  config: Config,
  contextHints: string[] = []
): Promise<ExpandedQueries> {
  // Short or empty queries are not good candidates for expansion
  if (normalizeTerms(query).length < 2) {
    return {
      original: query,
      lex: [],
      vec: [],
      hyde: '',
    };
  }

  // Check cache first (include hints in key if present)
  const cacheKey = contextHints.length > 0 ? `${query}|${contextHints.join('|')}` : query;
  const cached = expansionCache.get(cacheKey);
  if (cached) return cached;

  const baseEndpoint = config.embeddingEndpoint.replace(/\/$/, '');
  const chatEndpoint = baseEndpoint + '/chat';

  let contextBlock = '';
  if (contextHints.length > 0) {
    contextBlock = `\nContext Information:\n${contextHints.map(h => `- ${h}`).join('\n')}\n`;
  }

  const prompt = `Given this search query${contextHints.length > 0 ? ' and context' : ''}, generate optimized variations.
${contextBlock}
Query: "${query}"

Respond in this exact JSON format:
{
  "lex": ["keyword variation 1", "keyword variation 2"],
  "vec": ["semantic variation 1", "semantic variation 2"],
  "hyde": "A 2-3 sentence hypothetical answer to the query"
}

Rules:
- lex: 2 keyword-focused queries (exact terms, acronyms, synonyms)
- vec: 2 semantic queries (rephrased for meaning, context)
- hyde: A plausible answer as if you knew it

JSON only, no markdown:`;

  try {
    const response = await fetchWithRetry(chatEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt }),
    });

    if (response.ok) {
      const data = (await response.json()) as ChatResponse;
      const text = data.response?.trim();

      if (text) {
        // Try to parse JSON from response
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]) as {
            lex?: string[];
            vec?: string[];
            hyde?: string;
          };

          // Extract raw expansions
          const rawLex = Array.isArray(parsed.lex) ? parsed.lex.slice(0, 2) : [];
          const rawVec = Array.isArray(parsed.vec) ? parsed.vec.slice(0, 2) : [];
          const rawHyde = typeof parsed.hyde === 'string' ? parsed.hyde : '';

          // Apply drift protection - filter out expansions that drifted too far
          const filteredLex = filterDriftedQueries(query, rawLex);
          const filteredVec = filterDriftedQueries(query, rawVec);
          const hydeCandidate = rawHyde.trim().replace(/\s+/g, ' ');
          const hyde =
            hydeCandidate.length >= 20 && hydeCandidate.length <= 500
              ? hydeCandidate
              : '';

          const result: ExpandedQueries = {
            original: query,
            lex: filteredLex,
            vec: filteredVec,
            hyde,
          };

          // Cache the result
          expansionCache.set(cacheKey, result);

          return result;
        }
      }
    }
  } catch {
    // Fall through to fallback
  }

  // Fallback: use simple HyDE generation
  const rawHyde = await generateHyDE(query, config);
  const hydeCandidate = rawHyde.trim().replace(/\s+/g, ' ');
  const hyde =
    hydeCandidate.length >= 20 && hydeCandidate.length <= 500
      ? hydeCandidate
      : '';

  const result: ExpandedQueries = {
    original: query,
    lex: [],
    vec: [],
    hyde,
  };

  // Cache the fallback result too
  expansionCache.set(cacheKey, result);

  return result;
}

/**
 * Expand a query into multiple variations for improved search recall.
 * Tries /expand endpoint first, falls back to /chat.
 * @deprecated Use expandQueryStructured for better results
 */
export async function expandQuery(
  query: string,
  config: Config
): Promise<ExpandedQuery> {
  const baseEndpoint = config.embeddingEndpoint.replace(/\/$/, '');

  // Try dedicated /expand endpoint first
  try {
    const expandEndpoint = baseEndpoint + '/expand';
    const response = await fetchWithRetry(expandEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
    });

    if (response.ok) {
      const data = (await response.json()) as ExpandResponse;
      if (data.variations && data.variations.length > 0) {
        return {
          original: query,
          variations: data.variations.slice(0, 3),
        };
      }
    }
  } catch {
    // Fall through to chat fallback
  }

  // Fallback to /chat endpoint
  try {
    const chatEndpoint = baseEndpoint + '/chat';
    const prompt = `Generate 2-3 alternative search queries for: "${query}". Return only the queries, one per line, no numbering or explanations.`;

    const response = await fetchWithRetry(chatEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt }),
    });

    if (response.ok) {
      const data = (await response.json()) as ChatResponse;
      const variations = data.response
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0 && line.length < 200)
        .slice(0, 3);

      if (variations.length > 0) {
        return {
          original: query,
          variations,
        };
      }
    }
  } catch {
    // Return original query only
  }

  // If both fail, return just the original query
  return {
    original: query,
    variations: [],
  };
}
