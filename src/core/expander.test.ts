// Tests for query expander

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Config } from '../types.js';

// Mock network to avoid real HTTP calls
vi.mock('../utils/network.js', () => ({
  fetchWithRetry: vi.fn(),
}));

import { expandQueryStructured } from './expander.js';
import { fetchWithRetry } from '../utils/network.js';

function testConfig(): Config {
  return {
    sources: [],
    indexPath: ':memory:',
    embeddingEndpoint: 'http://localhost:8080/embedding',
    embeddingDimensions: 768,
    chunkMaxTokens: 1000,
    chunkOverlapTokens: 150,
    searchTopK: 15,
  };
}

function mockResponse(body: unknown, ok = true): Response {
  return {
    ok,
    status: ok ? 200 : 500,
    json: () => Promise.resolve(body),
  } as Response;
}

describe('expandQueryStructured', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns empty expansions for short/single-word query', async () => {
    const result = await expandQueryStructured('typescript', testConfig());
    expect(result.original).toBe('typescript');
    expect(result.lex).toEqual([]);
    expect(result.vec).toEqual([]);
    expect(result.hyde).toBe('');
    // Should not even call fetch for short queries
    expect(fetchWithRetry).not.toHaveBeenCalled();
  });

  it('parses structured JSON LLM response correctly', async () => {
    const llmJson = {
      lex: ['typescript generics usage', 'typescript generic types'],
      vec: ['how to use type parameters in typescript', 'reusable typed components'],
      hyde: 'TypeScript generics allow you to write reusable components that work with multiple types. You can use type parameters to define flexible interfaces.',
    };
    vi.mocked(fetchWithRetry).mockResolvedValue(
      mockResponse({ response: JSON.stringify(llmJson) })
    );

    const result = await expandQueryStructured('typescript generics patterns', testConfig());
    expect(result.original).toBe('typescript generics patterns');
    expect(result.lex.length).toBeLessThanOrEqual(2);
    expect(result.vec.length).toBeLessThanOrEqual(2);
    expect(result.hyde.length).toBeGreaterThan(0);
  });

  it('falls back gracefully on network error', async () => {
    vi.mocked(fetchWithRetry).mockRejectedValue(new Error('Connection refused'));

    const result = await expandQueryStructured('typescript generics patterns', testConfig());
    expect(result.original).toBe('typescript generics patterns');
    expect(result.lex).toEqual([]);
    expect(result.vec).toEqual([]);
    // hyde may or may not be empty depending on the fallback, but should not throw
  });

  it('handles malformed LLM JSON response', async () => {
    vi.mocked(fetchWithRetry).mockResolvedValue(
      mockResponse({ response: 'not valid json at all {{{' })
    );

    const result = await expandQueryStructured('typescript generics patterns', testConfig());
    expect(result.original).toBe('typescript generics patterns');
    // Should fall through to fallback, not crash
    expect(result.lex).toEqual([]);
    expect(result.vec).toEqual([]);
  });
});
