// Import command - import memory database from JSON

import { Command } from 'commander';
import { readFileSync } from 'node:fs';
import chalk from 'chalk';
import { MemoryDB } from '../storage/db.js';
import { loadConfig } from '../utils/config.js';

export function registerImportCommand(program: Command): void {
  program
    .command('import <file>')
    .description('Import memory database from a JSON file')
    .option('--merge', 'Merge with existing data instead of replacing')
    .action((file: string, opts: { merge?: boolean }) => {
      const config = loadConfig();
      const db = new MemoryDB(config);

      try {
        const raw = readFileSync(file, 'utf-8');
        const data = JSON.parse(raw);

        if (!data.version || data.version !== 1) {
          console.error(chalk.red('Invalid export file: missing or unsupported version field.'));
          process.exitCode = 1;
          return;
        }

        if (!opts.merge) {
          db.clearAllData();
        }

        const zeroEmbedding = new Float32Array(config.embeddingDimensions);

        // Build a file path -> fileId map as we import
        const fileIdMap = new Map<string, number>();

        // Import files
        for (const f of data.files ?? []) {
          const fileId = db.upsertFile(f.path, f.mtime, f.contentHash);
          fileIdMap.set(f.path, fileId);
        }

        // Import chunks
        let chunkCount = 0;
        for (const c of data.chunks ?? []) {
          const fileId = fileIdMap.get(c.filePath);
          if (fileId === undefined) continue;

          const observation = c.observationType ? {
            type: c.observationType,
            concepts: c.concepts ? JSON.parse(c.concepts) : [],
            files: c.filesReferenced ? JSON.parse(c.filesReferenced) : [],
          } : undefined;

          db.insertChunk(
            fileId,
            c.chunkIndex,
            c.content,
            c.lineStart,
            c.lineEnd,
            zeroEmbedding,
            observation,
            c.sessionId ?? undefined,
            { filePath: c.filePath },
            c.contextPrefix ?? undefined,
          );
          chunkCount++;
        }

        // Import collections and file-collection mappings
        const collectionIdMap = new Map<string, number>();
        for (const col of data.collections ?? []) {
          const colId = db.upsertCollection(col.name);
          collectionIdMap.set(col.name, colId);
        }

        for (const fc of data.fileCollections ?? []) {
          const fileId = fileIdMap.get(fc.filePath);
          const colId = collectionIdMap.get(fc.collectionName);
          if (fileId !== undefined && colId !== undefined) {
            db.addFileToCollection(fileId, colId);
          }
        }

        // Import sessions
        for (const s of data.sessions ?? []) {
          db.upsertSession(s.id, s.projectPath);
        }

        // Import context cache
        for (const entry of data.contextCache ?? []) {
          db.setCachedContext(entry.hash, entry.prefix);
        }

        console.log(chalk.green(`Imported ${data.files?.length ?? 0} files, ${chunkCount} chunks. Run \`memory index --force\` to regenerate embeddings.`));
      } finally {
        db.close();
      }
    });
}
