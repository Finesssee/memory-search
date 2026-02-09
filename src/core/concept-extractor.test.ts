import { describe, it, expect } from 'vitest';
import { extractConcepts } from './concept-extractor.js';

describe('extractConcepts', () => {
  it('extracts headings', () => {
    const concepts = extractConcepts('# Authentication Setup\n\nSome content here.');
    expect(concepts).toContain('authentication setup');
  });

  it('extracts code identifiers', () => {
    const concepts = extractConcepts('The MemoryDB class handles getChunkById lookups.');
    expect(concepts.some(c => c.includes('getchunkbyid') || c.includes('getchunk'))).toBe(true);
  });

  it('extracts backtick terms', () => {
    const concepts = extractConcepts('Use `sqlite-vec` for vector search.');
    expect(concepts).toContain('sqlite-vec');
  });

  it('returns empty for minimal content', () => {
    const concepts = extractConcepts('ok');
    expect(concepts.length).toBe(0);
  });
});
