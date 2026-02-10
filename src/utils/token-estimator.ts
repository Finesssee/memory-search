import type { SearchResult } from '../types.js';

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Truncate a results array to fit within a token budget.
 * Includes results in order until the budget is exhausted.
 * Returns { results, totalTokens, truncated }.
 */
export function truncateToTokenBudget(
  results: SearchResult[],
  budget: number,
): { results: SearchResult[]; totalTokens: number; truncated: boolean } {
  let used = 0;
  const kept: SearchResult[] = [];
  for (const r of results) {
    const cost = estimateTokens(r.snippet);
    if (used + cost > budget && kept.length > 0) {
      return { results: kept, totalTokens: used, truncated: true };
    }
    used += cost;
    kept.push(r);
  }
  return { results: kept, totalTokens: used, truncated: false };
}

export async function createTokenCounter(): Promise<((text: string) => number) | null> {
  try {
    const { getLocalLlm } = await import('../core/local-llm.js');
    const llm = getLocalLlm();
    if (!llm) return null;
    // Pre-warm the model so tokenize is fast
    await llm.countTokens('warmup');
    const model = llm.getEmbedModel();
    if (!model) return null;
    // model.tokenize() is synchronous once loaded
    return (text: string) => model.tokenize(text).length;
  } catch {
    return null;
  }
}
