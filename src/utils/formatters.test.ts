import { describe, it, expect } from 'vitest';
import { formatCsv, formatXml, formatMarkdown, formatFiles } from './formatters.js';
import type { SearchResult } from '../types.js';

const mockResults: SearchResult[] = [
  { file: '/docs/auth.md', score: 0.85, lineStart: 10, lineEnd: 20, snippet: 'Auth setup', chunkIndex: 0 },
  { file: '/docs/api.md', score: 0.72, lineStart: 5, lineEnd: 15, snippet: 'API guide', chunkIndex: 1 },
];

describe('formatCsv', () => {
  it('produces valid CSV with headers', () => {
    const csv = formatCsv(mockResults);
    const lines = csv.split('\n');
    expect(lines[0]).toBe('file,score,lineStart,lineEnd,snippet');
    expect(lines.length).toBe(3);
  });
});

describe('formatXml', () => {
  it('produces valid XML', () => {
    const xml = formatXml(mockResults, 'test query');
    expect(xml).toContain('<?xml');
    expect(xml).toContain('<results query="test query">');
    expect(xml).toContain('<file>/docs/auth.md</file>');
  });
});

describe('formatMarkdown', () => {
  it('produces markdown table', () => {
    const md = formatMarkdown(mockResults, 'test');
    expect(md).toContain('| # | File | Score | Lines |');
    expect(md).toContain('auth.md');
  });
});

describe('formatFiles', () => {
  it('returns unique file paths', () => {
    const files = formatFiles(mockResults);
    expect(files).toBe('/docs/auth.md\n/docs/api.md');
  });
});
