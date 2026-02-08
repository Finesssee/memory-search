// Tests for contextualizer

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { Config } from '../types.js';
import { MemoryDB } from '../storage/db.js';

// Mock network to avoid real HTTP calls
vi.mock('../utils/network.js', () => ({
  fetchWithRetry: vi.fn(),
}));

import { contextualizeFileChunks } from './contextualizer.js';
import { fetchWithRetry } from '../utils/network.js';

let tempDir: string;

function testConfig(): Config {
  return {
    sources: [],
    indexPath: join(tempDir, 'test.db'),
    embeddingEndpoint: 'http://localhost:8080/embedding',
    embeddingDimensions: 4,
    chunkMaxTokens: 1000,
    chunkOverlapTokens: 150,
    searchTopK: 15,
    contextLlmEndpoint: 'http://localhost:8080/chat',
    contextLlmModel: 'test-model',
    contextLlmApiKey: '',
  };
}

function mockResponse(body: unknown, ok = true): Response {
  return {
    ok,
    status: ok ? 200 : 500,
    json: () => Promise.resolve(body),
  } as Response;
}

describe('contextualizeFileChunks', () => {
  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'ctx-test-'));
    vi.restoreAllMocks();
  });

  afterEach(() => {
    try { rmSync(tempDir, { recursive: true, force: true }); } catch { /* cleanup */ }
  });

  it('returns context prefixes from mocked LLM response', async () => {
    const contexts = ['This chunk describes TypeScript generics.', 'This chunk describes Python decorators.'];
    vi.mocked(fetchWithRetry).mockResolvedValue(
      mockResponse({ choices: [{ message: { content: JSON.stringify(contexts) } }] })
    );

    const config = testConfig();
    const db = new MemoryDB(config);
    const docContent = 'Full document about programming languages.\nTypeScript generics.\nPython decorators.';
    const chunks = [
      { content: 'TypeScript generics enable reusable typed components' },
      { content: 'Python decorators for caching and memoization' },
    ];

    const result = await contextualizeFileChunks(docContent, chunks, db, config);
    expect(result).toHaveLength(2);
    expect(result[0]).toContain('TypeScript');
    expect(result[1]).toContain('Python');
    db.close();
  });

  it('returns empty strings when LLM fails', async () => {
    vi.mocked(fetchWithRetry).mockResolvedValue(
      mockResponse({}, false)
    );

    const config = testConfig();
    const db = new MemoryDB(config);
    const chunks = [
      { content: 'chunk one content here' },
      { content: 'chunk two content here' },
    ];

    const result = await contextualizeFileChunks('document content', chunks, db, config);
    expect(result).toHaveLength(2);
    expect(result[0]).toBe('');
    expect(result[1]).toBe('');
    db.close();
  });

  it('uses cache and skips LLM call for cached chunks', async () => {
    const config = testConfig();
    const db = new MemoryDB(config);
    const docContent = 'Full document content for caching test';
    const chunkContent = 'chunk content that will be cached';

    // Pre-populate the context cache
    // Reproduce the cache key computation from contextualizer
    const { createHash } = await import('node:crypto');
    const cacheKey = createHash('sha256')
      .update(docContent)
      .update('\0')
      .update(chunkContent)
      .digest('hex');
    db.setCachedContext(cacheKey, 'cached context prefix');

    const chunks = [{ content: chunkContent }];
    const result = await contextualizeFileChunks(docContent, chunks, db, config);

    // Should use cached value without calling LLM
    expect(result).toHaveLength(1);
    expect(result[0]).toBe('cached context prefix');
    expect(fetchWithRetry).not.toHaveBeenCalled();
    db.close();
  });
});
