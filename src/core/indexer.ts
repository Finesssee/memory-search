// Indexer - scans files, chunks, and embeds them

import { readFileSync, statSync } from 'node:fs';
import { glob } from 'glob';
import { MemoryDB } from '../storage/db.js';
import { chunkMarkdown } from './chunker.js';
import { getEmbeddingsParallel, prefixDocument } from './embeddings.js';
import { hashContent } from '../utils/hash.js';
import { contextualizeFileChunks } from './contextualizer.js';
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
  options: { force?: boolean; prune?: boolean; onProgress?: (p: IndexProgress) => void } = {}
): Promise<{ indexed: number; skipped: number; pruned: number; contextualized: number; errors: string[] }> {
  const db = new MemoryDB(config);
  const errors: string[] = [];
  let indexed = 0;
  let skipped = 0;
  let pruned = 0;
  let contextualized = 0;

  try {
    // Normalize config to collections
    interface NormalizedCollection {
      name: string;
      paths: string[];
    }
    const collections: NormalizedCollection[] = [];

    // Migrate sources to default collection if needed
    if (config.sources && config.sources.length > 0) {
      collections.push({
        name: 'default',
        paths: config.sources
      });
    }

    // Add configured collections
    if (config.collections) {
      collections.push(...config.collections);
    }

    // Ensure we have something to index
    if (collections.length === 0) {
      return { indexed: 0, skipped: 0, pruned: 0, contextualized: 0, errors: [] };
    }

    // Find all markdown files in all collections
    // Map file path to list of collection names it belongs to
    const fileCollections = new Map<string, Set<string>>();
    const ignorePatterns = config.ignorePaths || [];

    for (const collection of collections) {
      for (const source of collection.paths) {
        const pattern = source.replace(/\\/g, '/') + '/**/*.md';
        const matches = await glob(pattern, {
          ignore: ignorePatterns.map(p => `**/${p}/**`)
        });

        for (const match of matches) {
          const normalized = match.replace(/\//g, '\\');
          if (!fileCollections.has(normalized)) {
            fileCollections.set(normalized, new Set());
          }
          fileCollections.get(normalized)?.add(collection.name);
        }
      }
    }

    const files = Array.from(fileCollections.keys());
    const total = files.length;
    const normalizedPaths = new Set<string>();

    // Collect all work to do first
    interface FileWork {
      file: string;
      normalizedPath: string;
      mtime: number;
      contentHash: string;
      chunks: { content: string; lineStart: number; lineEnd: number; headings?: string[] }[];
      collectionNames: string[];
    }
    const work: FileWork[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const normalizedPath = file; // Already normalized
      normalizedPaths.add(normalizedPath);
      const collectionNames = Array.from(fileCollections.get(normalizedPath) || []);

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

        // If file exists and hasn't changed, we still need to update collections
        if (!options.force && existing && existing.mtime === mtime) {
          // Update collections for existing file
          db.clearFileCollections(existing.id);
          for (const name of collectionNames) {
            const collectionId = db.upsertCollection(name);
            db.addFileToCollection(existing.id, collectionId);
          }

          skipped++;
          continue;
        }

        const content = readFileSync(file, 'utf-8');
        const contentHash = hashContent(content);

        if (!options.force && existing && existing.contentHash === contentHash) {
          db.upsertFile(normalizedPath, mtime, contentHash);

          // Update collections for existing file
          db.clearFileCollections(existing.id);
          for (const name of collectionNames) {
            const collectionId = db.upsertCollection(name);
            db.addFileToCollection(existing.id, collectionId);
          }

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

            // Update collections even for empty files
            db.clearFileCollections(existingFile.id);
            for (const name of collectionNames) {
              const collectionId = db.upsertCollection(name);
              db.addFileToCollection(existingFile.id, collectionId);
            }
          }
          skipped++;
          continue;
        }

        work.push({ file, normalizedPath, mtime, contentHash, chunks, collectionNames });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        errors.push(`${normalizedPath}: ${message}`);
      }
    }

    if (options.prune) {
      const existingFiles = db.getAllFiles();
      for (const existing of existingFiles) {
        if (!normalizedPaths.has(existing.path)) {
          db.deleteFile(existing.path);
          pruned++;
        }
      }
    }

    // Contextualize chunks if enabled
    const contextPrefixes = new Map<FileWork, string[]>();
    if (config.contextualizeChunks) {
      console.log(`Contextualizing ${work.length} files...`);
      const FILE_CONCURRENCY = 20;
      let fileIdx = 0;
      let filesDone = 0;
      const fileWaiters: (() => void)[] = [];
      let fileRunning = 0;
      const filePromises: Promise<void>[] = [];

      for (const w of work) {
        if (fileRunning >= FILE_CONCURRENCY) {
          await new Promise<void>(r => fileWaiters.push(r));
        }
        fileRunning++;
        filePromises.push((async () => {
          try {
            const docContent = readFileSync(w.file, 'utf-8');
            const prefixes = await contextualizeFileChunks(
              docContent,
              w.chunks,
              db,
              config
            );
            contextPrefixes.set(w, prefixes);
            filesDone++;
            if (filesDone % 50 === 0) {
              process.stderr.write(`\r[files] ${filesDone}/${work.length} contextualized   `);
            }
          } finally {
            fileRunning--;
            const waiter = fileWaiters.shift();
            if (waiter) waiter();
          }
        })());
      }
      await Promise.all(filePromises);
      process.stderr.write('\n');
      const totalCtx = Array.from(contextPrefixes.values()).flat().filter(p => p.length > 0).length;
      console.log(`  Contextualized ${totalCtx} chunks`);
    }
    contextualized = Array.from(contextPrefixes.values()).flat().filter(p => p.length > 0).length;

    // Now embed all chunks at once with parallel processing
    const allChunks: { work: FileWork; chunkIdx: number; content: string }[] = [];
    for (const w of work) {
      for (let j = 0; j < w.chunks.length; j++) {
        allChunks.push({ work: w, chunkIdx: j, content: w.chunks[j].content });
      }
    }

    if (allChunks.length === 0) {
      return { indexed: 0, skipped, pruned, contextualized, errors };
    }

    // Get all embeddings in parallel with document prefix
    console.log(`Embedding ${allChunks.length} chunks...`);
    const allTexts = allChunks.map(c => {
      const prefixes = contextPrefixes.get(c.work);
      const ctxPrefix = prefixes?.[c.chunkIdx] ?? '';
      const text = ctxPrefix ? ctxPrefix + '\n\n' + c.content : c.content;
      return prefixDocument(text);
    });

    let embeddingsSucceeded = false;
    try {
      const embeddings = await getEmbeddingsParallel(allTexts, config, (completed: number, total: number) => {
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

            // Update collections
            db.clearFileCollections(fileId);
            for (const name of w.collectionNames) {
              const collectionId = db.upsertCollection(name);
              db.addFileToCollection(fileId, collectionId);
            }

            (w as FileWork & { fileId: number }).fileId = fileId;
          }

          const fileId = (w as FileWork & { fileId: number }).fileId;
          const prefixes = contextPrefixes.get(w);
          const ctxPrefix = prefixes?.[chunkIdx] ?? '';
          db.insertChunk(
            fileId,
            chunkIdx,
            chunk.content,
            chunk.lineStart,
            chunk.lineEnd,
            embeddings[i],
            undefined,
            undefined,
            { filePath: w.normalizedPath, headings: chunk.headings },
            ctxPrefix || undefined
          );
        }
      });
      embeddingsSucceeded = true;

    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push(`Embedding error: ${message}`);
    }

    indexed = embeddingsSucceeded ? work.length : 0;

    return { indexed, skipped, pruned, contextualized, errors };
  } finally {
    db.close();
  }
}
