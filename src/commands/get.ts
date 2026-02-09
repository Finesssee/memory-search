// get command - retrieve full content by chunk ID, short ID, or file path

import { Command } from 'commander';
import chalk from 'chalk';
import { MemoryDB } from '../storage/db.js';
import { loadConfig } from '../utils/config.js';

export function registerGetCommand(program: Command): void {
  program
    .command('get <identifier>')
    .description('Get full content by chunk ID, short ID, or file path')
    .option('--json', 'Output raw JSON')
    .option('--raw', 'Output raw content only (no headers)')
    .option('--lines <range>', 'Line range filter (e.g. 10-20)')
    .action(async (identifier: string, options: { json?: boolean; raw?: boolean; lines?: string }) => {
      const config = loadConfig();
      const db = new MemoryDB(config);

      try {
        // Detect identifier type and resolve chunks
        const chunks = resolveIdentifier(identifier, db);

        if (chunks.length === 0) {
          console.error(chalk.red(`No content found for "${identifier}"`));
          process.exit(1);
        }

        // Apply line range filter
        let filteredChunks = chunks;
        if (options.lines) {
          const [start, end] = options.lines.split('-').map(Number);
          filteredChunks = chunks.filter(c => {
            if (end) return c.lineStart <= end && c.lineEnd >= start;
            return c.lineStart <= start && c.lineEnd >= start;
          });
        }

        if (options.json) {
          console.log(JSON.stringify(filteredChunks, null, 2));
          return;
        }

        for (const chunk of filteredChunks) {
          if (options.raw) {
            console.log(chunk.content);
          } else {
            console.log(chalk.cyan(`File: ${chunk.filePath}`));
            console.log(chalk.gray(`Chunk #${chunk.id} | Index: ${chunk.chunkIndex} | Lines: ${chunk.lineStart}-${chunk.lineEnd}`));
            console.log(chalk.gray('─────────────────────────────────────────────────'));
            console.log(chunk.content);
            console.log(chalk.gray('─────────────────────────────────────────────────'));
            console.log('');
          }
        }
      } finally {
        db.close();
      }
    });
}

function resolveIdentifier(identifier: string, db: MemoryDB): Array<any> {
  // Check for comma-separated or glob pattern (Feature 3)
  if (identifier.includes(',') || identifier.includes('*') || identifier.includes('?')) {
    return resolvePattern(identifier, db);
  }

  // Try numeric chunk ID
  const numId = parseInt(identifier, 10);
  if (!isNaN(numId) && String(numId) === identifier.trim()) {
    const chunk = db.getChunkById(numId);
    return chunk ? [chunk] : [];
  }

  // Try 6-char short ID (hex)
  if (/^[0-9a-f]{6}$/i.test(identifier)) {
    const chunk = db.getChunkByShortId(identifier.toLowerCase());
    return chunk ? [chunk] : [];
  }

  // Try file path (with optional :line)
  const colonIdx = identifier.lastIndexOf(':');
  let filePath = identifier;
  let lineHint: number | undefined;
  if (colonIdx > 0) {
    const maybeLine = parseInt(identifier.slice(colonIdx + 1), 10);
    if (!isNaN(maybeLine)) {
      filePath = identifier.slice(0, colonIdx);
      lineHint = maybeLine;
    }
  }

  const chunks = db.getChunksByFilePath(filePath);
  if (chunks.length > 0 && lineHint !== undefined) {
    // Filter to chunks containing the specified line
    return chunks.filter(c => c.lineStart <= lineHint! && c.lineEnd >= lineHint!);
  }

  if (chunks.length > 0) return chunks;

  // Try substring match
  const subChunks = db.getChunksByFilePathSubstring(filePath);
  return subChunks;
}

function resolvePattern(pattern: string, db: MemoryDB): Array<any> {
  if (pattern.includes(',')) {
    // Comma-separated paths
    const paths = pattern.split(',').map(p => p.trim());
    const results: any[] = [];
    for (const p of paths) {
      results.push(...resolveIdentifier(p, db));
    }
    return results;
  }
  // Glob pattern
  return db.getFilesByPathPattern(pattern);
}
