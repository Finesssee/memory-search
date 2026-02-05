// Indexer - scans files, chunks, and embeds them

import { readFileSync, statSync } from 'node:fs';
import { glob } from 'glob';
import { MemoryDB } from '../storage/db.js';
import { chunkMarkdown } from './chunker.js';
import { getEmbeddingsParallel, prefixDocument } from './embeddings.js';
import { hashContent } from '../utils/hash.js';
import type { Config } from '../types.js';

const BATCH_SIZE = 100;  // Larger batches for parallel processing

export interface IndexProgress {
  total: number;
  processed: number;
  skipped: number;
  file: string;
}

export async function indexFiles(
  config: Config,
  options: { force?: boolean; onProgress?: (p: IndexProgress) => void } = {}
): Promise<{ indexed: number; skipped: number; errors: string[] }> {
  const db = new MemoryDB(config);
  const errors: string[] = [];
  let indexed = 0;
  let skipped = 0;

  try {
    // Find all markdown files in sources
    const files: string[] = [];
    const ignorePatterns = config.ignorePaths || [];

    for (const source of config.sources) {
      const pattern = source.replace(/\\/g, '/') + '/**/*.md';
      const matches = await glob(pattern, {
        ignore: ignorePatterns.map(p => `**/${p}/**`)
      });
      files.push(...matches);
    }

    const total = files.length;

    // Collect all work to do first
    interface FileWork {
      file: string;
      normalizedPath: string;
      mtime: number;
      contentHash: string;
      chunks: { content: string; lineStart: number; lineEnd: number }[];
    }
    const work: FileWork[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const normalizedPath = file.replace(/\//g, '\\');

      options.onProgress?.({
        total,
        processed: i + 1,
        skipped,
        file: normalizedPath,
      });

      try {
        const stat = statSync(file);
        const mtime = stat.mtimeMs;

        const existing = db.getFile(normalizedPath);

        if (!options.force && existing && existing.mtime === mtime) {
          skipped++;
          continue;
        }

        const content = readFileSync(file, 'utf-8');
        const contentHash = hashContent(content);

        if (!options.force && existing && existing.contentHash === contentHash) {
          db.upsertFile(normalizedPath, mtime, contentHash);
          skipped++;
          continue;
        }

        const chunks = chunkMarkdown(content, {
          maxTokens: config.chunkMaxTokens,
          overlapTokens: config.chunkOverlapTokens,
          filePath: normalizedPath
        });

        // Handle empty files - delete existing chunks if any
        if (chunks.length === 0) {
          const existingFile = db.getFile(normalizedPath);
          if (existingFile) {
            db.deleteChunksForFile(existingFile.id);
            db.upsertFile(normalizedPath, mtime, contentHash);
          }
          skipped++;
          continue;
        }

        work.push({ file, normalizedPath, mtime, contentHash, chunks });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        errors.push(`${normalizedPath}: ${message}`);
      }
    }

    // Now embed all chunks at once with parallel processing
    const allChunks: { work: FileWork; chunkIdx: number; content: string }[] = [];
    for (const w of work) {
      for (let j = 0; j < w.chunks.length; j++) {
        allChunks.push({ work: w, chunkIdx: j, content: w.chunks[j].content });
      }
    }

    if (allChunks.length === 0) {
      return { indexed: 0, skipped, errors };
    }

    // Get all embeddings in parallel with document prefix
    console.log(`Embedding ${allChunks.length} chunks...`);
    const allTexts = allChunks.map(c => prefixDocument(c.content));

    let embeddingsSucceeded = false;
    try {
      const embeddings = await getEmbeddingsParallel(allTexts, config, (completed, total) => {
        process.stdout.write(`\r  Batch ${completed}/${total}`);
      });
      console.log(''); // New line after progress

      // Store all chunks with their embeddings in a single transaction
      db.withTransaction(() => {
        for (let i = 0; i < allChunks.length; i++) {
          const { work: w, chunkIdx } = allChunks[i];
          const chunk = w.chunks[chunkIdx];

          // Upsert file on first chunk
          if (chunkIdx === 0) {
            const fileId = db.upsertFile(w.normalizedPath, w.mtime, w.contentHash);
            db.deleteChunksForFile(fileId);
            (w as FileWork & { fileId: number }).fileId = fileId;
          }

          const fileId = (w as FileWork & { fileId: number }).fileId;
          db.insertChunk(fileId, chunkIdx, chunk.content, chunk.lineStart, chunk.lineEnd, embeddings[i]);
        }
      });
      embeddingsSucceeded = true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push(`Embedding error: ${message}`);
    }

    indexed = embeddingsSucceeded ? work.length : 0;

    return { indexed, skipped, errors };
  } finally {
    db.close();
  }
}
