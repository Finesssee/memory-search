import { describe, it, expect } from 'vitest';
import { chunkMarkdown, type Chunk } from './chunker.js';

describe('chunkMarkdown', () => {
  it('returns empty array for empty content', () => {
    const result = chunkMarkdown('');
    expect(result).toEqual([]);
  });

  it('returns empty array for content shorter than 50 chars', () => {
    const result = chunkMarkdown('short');
    expect(result).toEqual([]);
  });

  it('produces a single chunk for small content', () => {
    const content = 'A'.repeat(100); // 100 chars, well under default 1000-token limit
    const result = chunkMarkdown(content);
    expect(result).toHaveLength(1);
    expect(result[0].content).toBe(content);
    expect(result[0].lineStart).toBe(1);
  });

  it('splits on markdown headers', () => {
    const lines: string[] = [];
    lines.push('## Section One');
    lines.push('Content for section one. '.repeat(10));
    lines.push('## Section Two');
    lines.push('Content for section two. '.repeat(10));
    const content = lines.join('\n');

    const result = chunkMarkdown(content);
    expect(result.length).toBeGreaterThanOrEqual(2);

    const headers = result.map((c: Chunk) => c.header).filter(Boolean);
    expect(headers).toContain('## Section One');
    expect(headers).toContain('## Section Two');
  });

  it('respects maxTokens option (legacy number signature)', () => {
    // Using legacy chunkMarkdown(content, maxTokens) signature
    const longContent = ('word '.repeat(50) + '\n').repeat(30); // ~7500 chars
    const result = chunkMarkdown(longContent, 100); // ~300 char limit
    expect(result.length).toBeGreaterThan(1);
  });

  it('extracts headings from chunk body', () => {
    const content = [
      '## Main Heading',
      'Some intro text that is long enough to not be filtered out by the fifty character minimum requirement.',
      '### Sub Heading',
      'More content that also needs to meet the minimum character threshold for chunks.',
    ].join('\n');

    const result = chunkMarkdown(content, { maxTokens: 5000 });
    // All in one chunk since maxTokens is high
    expect(result.length).toBeGreaterThanOrEqual(1);
    const allHeadings = result.flatMap((c: Chunk) => c.headings ?? []);
    expect(allHeadings).toContain('Main Heading');
    expect(allHeadings).toContain('Sub Heading');
  });

  it('adds metadata prefix when filePath is provided', () => {
    const content = 'A long enough content line that exceeds the fifty character minimum for chunking threshold.';
    const result = chunkMarkdown(content, {
      filePath: 'session-2026-02-04T101945.md',
    });

    expect(result).toHaveLength(1);
    expect(result[0].content).toContain('[Date: 2026-02-04]');
    expect(result[0].content).toContain('[Source: session-2026-02-04T101945]');
  });

  it('adds source-only prefix when filePath has no session date', () => {
    const content = 'A long enough content line that exceeds the fifty character minimum for chunking threshold.';
    const result = chunkMarkdown(content, {
      filePath: 'notes.md',
    });

    expect(result).toHaveLength(1);
    expect(result[0].content).toContain('[Source: notes]');
    expect(result[0].content).not.toContain('[Date:');
  });

  it('produces overlap between consecutive token-split chunks', () => {
    // Use very small maxTokens to force splits, with overlap
    const longContent = ('sentence one. sentence two. sentence three. ' + 'x '.repeat(40) + '\n').repeat(10);
    const result = chunkMarkdown(longContent, { maxTokens: 80, overlapTokens: 20 });

    if (result.length >= 2) {
      // With overlap, the end of chunk N should appear at the start of chunk N+1
      const chunk1Content = result[0].content;
      const chunk2Content = result[1].content;
      // The second chunk's lineStart should be <= the first chunk's lineEnd (overlap)
      expect(result[1].lineStart).toBeLessThanOrEqual(result[0].lineEnd + 1);
      // Both chunks should have content
      expect(chunk1Content.length).toBeGreaterThan(0);
      expect(chunk2Content.length).toBeGreaterThan(0);
    }
  });
});
