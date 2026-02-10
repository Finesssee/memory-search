// Indexer - scans files, chunks, and embeds them

import { readFileSync, statSync } from 'node:fs';
import { glob } from 'glob';
import { MemoryDB } from '../storage/db.js';
import { chunkMarkdown } from './chunker.js';
import { getEmbeddingsParallel, prefixDocument } from './embeddings.js';
import { hashContent } from '../utils/hash.js';
import { contextualizeFileChunks } from './contextualizer.js';
import { logInfo, logWarn } from '../utils/log.js';
import { isShutdownRequested } from '../utils/shutdown.js';
import type { Config } from '../types.js';
import { detectObservationType } from './observation-detector.js';
import { extractConcepts } from './concept-extractor.js';
import { toVirtualPath } from '../utils/paths.js';

const BATCH_SIZE = 100;
const FILE_SCAN_CONCURRENCY = 50;  // Parallel file reads during scan phase

export interface IndexProgress {
  total: number;
  processed: number;
  skipped: number;
  file: string;
}

export async function indexFiles(
  config: Config,
  options: { force?: boolean; prune?: boolean; dryRun?: boolean; onProgress?: (p: IndexProgress) => void; onContextProgress?: (current: number, total: number) => void; onEmbedProgress?: (current: number, total: number) => void } = {}
): Promise<{ indexed: number; skipped: number; pruned: number; contextualized: number; errors: string[] }> {
  const db = new MemoryDB(config);
  const errors: string[] = [];
  let indexed = 0;
  let skipped = 0;
  let pruned = 0;
  let contextualized = 0;

  // Try to create a real tokenizer for local LLM provider
  let tokenizer: ((text: string) => number) | undefined;
  if (config.provider === 'local') {
    const { createTokenCounter } = await import('../utils/token-estimator.js');
    const counter = await createTokenCounter();
    if (counter) tokenizer = counter;
  }

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

    // Helper to compute virtual path for a file given its collection membership
    const computeVirtualPath = (normalizedPath: string, collectionNames: string[]): string | undefined => {
      if (collectionNames.length === 0) return undefined;
      const collName = collectionNames[0];
      const coll = collections.find(c => c.name === collName);
      if (!coll) return undefined;
      for (const root of coll.paths) {
        const vp = toVirtualPath(normalizedPath, collName, root);
        if (vp !== normalizedPath) return vp;
      }
      return undefined;
    };

    // Process files in parallel batches for faster scanning
    const processFile = (i: number) => {
      const file = files[i];
      const normalizedPath = file;
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

        if (!options.force && existing && existing.mtime === mtime) {
          db.clearFileCollections(existing.id);
          for (const name of collectionNames) {
            const collectionId = db.upsertCollection(name);
            db.addFileToCollection(existing.id, collectionId);
          }
          skipped++;
          return;
        }

        const content = readFileSync(file, 'utf-8');
        const contentHash = hashContent(content);

        if (!options.force && existing && existing.contentHash === contentHash) {
          db.upsertFile(normalizedPath, mtime, contentHash, computeVirtualPath(normalizedPath, collectionNames));
          db.clearFileCollections(existing.id);
          for (const name of collectionNames) {
            const collectionId = db.upsertCollection(name);
            db.addFileToCollection(existing.id, collectionId);
          }
          skipped++;
          return;
        }

        const chunks = chunkMarkdown(content, {
          maxTokens: config.chunkMaxTokens,
          overlapTokens: config.chunkOverlapTokens,
          filePath: normalizedPath,
          tokenizer
        });

        if (chunks.length === 0) {
          const existingFile = db.getFile(normalizedPath);
          if (existingFile) {
            db.deleteChunksForFile(existingFile.id);
            db.upsertFile(normalizedPath, mtime, contentHash, computeVirtualPath(normalizedPath, collectionNames));
            db.clearFileCollections(existingFile.id);
            for (const name of collectionNames) {
              const collectionId = db.upsertCollection(name);
              db.addFileToCollection(existingFile.id, collectionId);
            }
          }
          skipped++;
          return;
        }

        work.push({ file, normalizedPath, mtime, contentHash, chunks, collectionNames });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        errors.push(`${normalizedPath}: ${message}`);
      }
    };

    for (let i = 0; i < files.length; i++) {
      if (isShutdownRequested()) {
        logInfo('indexer', 'Shutdown requested, stopping file scan');
        break;
      }
      processFile(i);
    }

    if (options.prune && !options.dryRun) {
      const existingFiles = db.getAllFiles();
      for (const existing of existingFiles) {
        if (!normalizedPaths.has(existing.path)) {
          db.deleteFile(existing.path);
          pruned++;
        }
      }
    }

    // Dry run: report what would happen without actually embedding/storing
    if (options.dryRun) {
      const totalChunks = work.reduce((sum, w) => sum + w.chunks.length, 0);
      logInfo('indexer', `Dry run: ${work.length} files to index, ${totalChunks} chunks, ${skipped} skipped`);
      return { indexed: work.length, skipped, pruned, contextualized: 0, errors };
    }

    // Contextualize chunks if enabled
    const contextPrefixes = new Map<FileWork, string[]>();
    if (config.contextualizeChunks) {
      options.onContextProgress?.(0, work.length);
      const FILE_CONCURRENCY = 20;
      let filesDone = 0;
      const fileWaiters: (() => void)[] = [];
      let fileRunning = 0;
      const filePromises: Promise<void>[] = [];

      for (const w of work) {
        if (isShutdownRequested()) {
          logInfo('indexer', 'Shutdown requested, skipping remaining contextualization');
          break;
        }
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
            options.onContextProgress?.(filesDone, work.length);
          } finally {
            fileRunning--;
            const waiter = fileWaiters.shift();
            if (waiter) waiter();
          }
        })());
      }
      await Promise.all(filePromises);
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
    options.onEmbedProgress?.(0, allChunks.length);
    const allTexts = allChunks.map(c => {
      const prefixes = contextPrefixes.get(c.work);
      const ctxPrefix = prefixes?.[c.chunkIdx] ?? '';
      const text = ctxPrefix ? ctxPrefix + '\n\n' + c.content : c.content;
      return prefixDocument(text);
    });

    let embeddingsSucceeded = false;
    try {
      const embeddings = await getEmbeddingsParallel(allTexts, config, (completed: number, total: number) => {
        options.onEmbedProgress?.(completed, total);
      });
      // Embedding phase complete

      if (isShutdownRequested()) {
        logInfo('indexer', 'Shutdown requested, skipping database write');
      } else {
        // Store all chunks with their embeddings in a single transaction
        db.withTransaction(() => {
          for (let i = 0; i < allChunks.length; i++) {
            const { work: w, chunkIdx } = allChunks[i];
            const chunk = w.chunks[chunkIdx];

            // Upsert file on first chunk
            if (chunkIdx === 0) {
              // Compute virtual path from collection membership
              let virtualPath: string | undefined;
              if (w.collectionNames.length > 0) {
                const collName = w.collectionNames[0];
                const coll = collections.find(c => c.name === collName);
                if (coll) {
                  for (const root of coll.paths) {
                    const vp = toVirtualPath(w.normalizedPath, collName, root);
                    if (vp !== w.normalizedPath) {
                      virtualPath = vp;
                      break;
                    }
                  }
                }
              }
              const fileId = db.upsertFile(w.normalizedPath, w.mtime, w.contentHash, virtualPath);
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
            const detectedType = detectObservationType(chunk.content);
            const detectedConcepts = extractConcepts(chunk.content);
            const observation = (detectedType || detectedConcepts.length > 0)
              ? { type: detectedType ?? 'reference' as const, concepts: detectedConcepts, files: [] as string[] }
              : undefined;
            db.insertChunk(
              fileId,
              chunkIdx,
              chunk.content,
              chunk.lineStart,
              chunk.lineEnd,
              embeddings[i],
              observation,
              undefined,
              { filePath: w.normalizedPath, headings: chunk.headings },
              ctxPrefix || undefined
            );
          }
        });
        embeddingsSucceeded = true;
      }

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
