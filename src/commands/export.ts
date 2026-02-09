// Export command - export memory database to JSON

import { Command } from 'commander';
import { writeFileSync } from 'node:fs';
import chalk from 'chalk';
import { MemoryDB } from '../storage/db.js';
import { loadConfig } from '../utils/config.js';

export function registerExportCommand(program: Command): void {
  program
    .command('export')
    .description('Export memory database to a JSON file')
    .option('-o, --output <file>', 'Output file path', 'memory-export.json')
    .action((opts: { output: string }) => {
      const config = loadConfig();
      const db = new MemoryDB(config);

      try {
        const files = db.getAllFiles();
        const chunks = db.getAllChunksForExport();
        const collections = db.getAllCollections();
        const fileCollections = db.getAllFileCollectionMappings();
        const sessions = db.getAllSessions();
        const contextCache = db.getAllContextCacheEntries();

        const exportData = {
          version: 1,
          exportedAt: new Date().toISOString(),
          files,
          chunks,
          collections,
          fileCollections,
          sessions,
          contextCache,
        };

        writeFileSync(opts.output, JSON.stringify(exportData, null, 2));

        console.log(chalk.green(`Exported ${files.length} files, ${chunks.length} chunks, ${collections.length} collections to ${opts.output}`));
      } finally {
        db.close();
      }
    });
}
