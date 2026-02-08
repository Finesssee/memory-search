import { describe, it, expect } from 'vitest';
import { getBaseUrl, getChatEndpoint, getExpandEndpoint, getRerankEndpoint, getEmbeddingEndpoint } from './api-endpoints.js';

describe('api-endpoints', () => {
  const base = 'http://localhost:8080/embedding';
  const baseTrailing = 'http://localhost:8080/embedding/';
  const noSuffix = 'http://localhost:8080';

  it('getBaseUrl strips /embedding suffix', () => {
    expect(getBaseUrl(base)).toBe('http://localhost:8080');
    expect(getBaseUrl(baseTrailing)).toBe('http://localhost:8080');
  });

  it('getBaseUrl handles URLs without /embedding', () => {
    expect(getBaseUrl(noSuffix)).toBe('http://localhost:8080');
  });

  it('getChatEndpoint builds correct URL', () => {
    expect(getChatEndpoint(base)).toBe('http://localhost:8080/chat');
    expect(getChatEndpoint(baseTrailing)).toBe('http://localhost:8080/chat');
  });

  it('getExpandEndpoint builds correct URL', () => {
    expect(getExpandEndpoint(base)).toBe('http://localhost:8080/expand');
  });

  it('getRerankEndpoint builds correct URL', () => {
    expect(getRerankEndpoint(base)).toBe('http://localhost:8080/rerank');
  });

  it('getEmbeddingEndpoint preserves /embedding suffix', () => {
    expect(getEmbeddingEndpoint(base)).toBe('http://localhost:8080/embedding');
  });

  it('getEmbeddingEndpoint adds /embedding if missing', () => {
    expect(getEmbeddingEndpoint(noSuffix)).toBe('http://localhost:8080/embedding');
  });
});
