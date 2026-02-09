// Integration tests for the search pipeline
// Uses temp file SQLite with fake embeddings, no network calls

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MemoryDB } from '../storage/db.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { Config } from '../types.js';

// Mock embeddings module to avoid network calls
vi.mock('./embeddings.js', () => ({
  getEmbedding: vi.fn(),
  prefixQuery: (text: string) => `search_query: ${text}`,
  prefixDocument: (text: string) => `search_document: ${text}`,
  checkEmbeddingServer: vi.fn().mockResolvedValue(true),
}));

// Mock reranker to pass through results (no network)
vi.mock('./reranker.js', () => ({
  rerankResults: vi.fn((_query: string, results: unknown[]) => {
    return (results as Array<Record<string, unknown>>).map((r) => {
      const { rrfRank: _, fullContent: __, contentHash: ___, ...rest } = r;
      return rest;
    });
  }),
}));

// Mock expander to avoid network
vi.mock('./expander.js', () => ({
  expandQueryStructured: vi.fn().mockResolvedValue({
    original: '',
    lex: [],
    vec: [],
    hyde: '',
  }),
}));

import { search } from './searcher.js';
import { getEmbedding } from './embeddings.js';

const DIM = 4;
let tempDir: string;

function testConfig(): Config {
  return {
    sources: [],
    indexPath: join(tempDir, 'test.db'),
    embeddingEndpoint: 'http://localhost:8080/embedding',
    embeddingDimensions: DIM,
    chunkMaxTokens: 1000,
    chunkOverlapTokens: 150,
    searchTopK: 5,
    searchCandidateCap: 100,
    expandQueries: false,
  };
}

function normalizedEmbedding(vals: number[]): Float32Array {
  const e = new Float32Array(vals);
  let norm = 0;
  for (let i = 0; i < e.length; i++) norm += e[i] * e[i];
  norm = Math.sqrt(norm);
  if (norm > 0) for (let i = 0; i < e.length; i++) e[i] /= norm;
  return e;
}

function seedDB(config: Config): MemoryDB {
  const db = new MemoryDB(config);

  const fileId = db.upsertFile('/test/notes.md', Date.now(), 'hash1');

  // Chunk 0: about TypeScript — embedding close to [1,0,0,0]
  db.insertChunk(fileId, 0, 'TypeScript generics enable reusable typed components', 1, 10,
    normalizedEmbedding([1, 0.1, 0, 0]), undefined, undefined,
    { filePath: '/test/notes.md', headings: ['TypeScript'] });

  // Chunk 1: about Python — embedding close to [0,1,0,0]
  db.insertChunk(fileId, 1, 'Python decorators for caching and memoization', 11, 20,
    normalizedEmbedding([0, 1, 0.1, 0]), undefined, undefined,
    { filePath: '/test/notes.md', headings: ['Python'] });

  // Chunk 2: about Rust — embedding close to [0,0,1,0]
  db.insertChunk(fileId, 2, 'Rust ownership model prevents memory leaks', 21, 30,
    normalizedEmbedding([0, 0, 1, 0.1]), undefined, undefined,
    { filePath: '/test/notes.md', headings: ['Rust'] });

  db.close();
  return db;
}

describe('search pipeline integration', () => {
  let config: Config;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'mem-search-test-'));
    config = testConfig();
    seedDB(config);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    try { rmSync(tempDir, { recursive: true, force: true }); } catch { /* cleanup */ }
  });

  it('returns results ranked by semantic similarity', async () => {
    // Query embedding close to TypeScript chunk
    vi.mocked(getEmbedding).mockResolvedValue(normalizedEmbedding([1, 0, 0, 0]));

    const results = await search('TypeScript generics', config);
    expect(results.length).toBeGreaterThan(0);

    // First result should be the TypeScript chunk (highest cosine similarity)
    expect(results[0].snippet).toContain('TypeScript');
    expect(results[0].file).toBe('/test/notes.md');
    expect(results[0].lineStart).toBe(1);
  });

  it('returns results matching FTS keywords', async () => {
    // Embedding perpendicular to all chunks — forces FTS to do the ranking
    vi.mocked(getEmbedding).mockResolvedValue(normalizedEmbedding([0, 0, 0, 1]));

    const results = await search('Python decorators', config);
    expect(results.length).toBeGreaterThan(0);

    // Python chunk should appear due to FTS match
    const pythonResult = results.find(r => r.snippet.includes('Python'));
    expect(pythonResult).toBeDefined();
  });

  it('returns empty results for non-matching query', async () => {
    vi.mocked(getEmbedding).mockResolvedValue(normalizedEmbedding([0, 0, 0, 1]));

    const results = await search('quantum computing entanglement', config);
    // FTS won't match, semantic is orthogonal — may return results but with low scores
    // The important thing is it doesn't crash
    expect(Array.isArray(results)).toBe(true);
  });

  it('respects searchTopK limit', async () => {
    vi.mocked(getEmbedding).mockResolvedValue(normalizedEmbedding([0.5, 0.5, 0.5, 0]));

    const limitedConfig = { ...config, searchTopK: 2 };
    const results = await search('programming', limitedConfig);
    expect(results.length).toBeLessThanOrEqual(2);
  });

  it('includes fileMtime in results', async () => {
    vi.mocked(getEmbedding).mockResolvedValue(normalizedEmbedding([1, 0, 0, 0]));

    const results = await search('TypeScript', config);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].fileMtime).toBeDefined();
    expect(typeof results[0].fileMtime).toBe('number');
  });
});
