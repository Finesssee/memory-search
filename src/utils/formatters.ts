import type { SearchResult } from '../types.js';
import { basename } from 'node:path';

export function formatCsv(results: SearchResult[]): string {
  const header = 'file,score,lineStart,lineEnd,snippet';
  const rows = results.map(r => {
    const snippet = r.snippet.replace(/"/g, '""').replace(/\n/g, ' ');
    return `"${r.file}",${r.score.toFixed(3)},${r.lineStart},${r.lineEnd},"${snippet}"`;
  });
  return [header, ...rows].join('\n');
}

export function formatXml(results: SearchResult[], query: string): string {
  const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const items = results.map(r =>
    `  <result>\n    <file>${escape(r.file)}</file>\n    <score>${r.score.toFixed(3)}</score>\n    <lineStart>${r.lineStart}</lineStart>\n    <lineEnd>${r.lineEnd}</lineEnd>\n    <snippet>${escape(r.snippet)}</snippet>\n  </result>`
  ).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<results query="${escape(query)}">\n${items}\n</results>`;
}

export function formatMarkdown(results: SearchResult[], query: string): string {
  const header = `# Search: ${query}\n\n| # | File | Score | Lines |\n|---|------|-------|-------|\n`;
  const rows = results.map((r, i) => {
    const file = basename(r.file);
    const score = Math.round(r.score * 100) + '%';
    return `| ${i + 1} | ${file} | ${score} | ${r.lineStart}-${r.lineEnd} |`;
  }).join('\n');
  return header + rows;
}

export function formatFiles(results: SearchResult[]): string {
  const unique = [...new Set(results.map(r => r.file))];
  return unique.join('\n');
}
