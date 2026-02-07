// get command - retrieve full content of a chunk

import { Command } from 'commander';
import chalk from 'chalk';
import { MemoryDB } from '../storage/db.js';
import { loadConfig } from '../utils/config.js';

export function registerGetCommand(program: Command): void {
  program
    .command('get <chunkId>')
    .description('Get full content for a specific chunk')
    .option('--json', 'Output raw JSON')
    .action(async (chunkIdStr: string, options: { json?: boolean }) => {
      const config = loadConfig();
      const db = new MemoryDB(config);
      const chunkId = parseInt(chunkIdStr, 10);

      try {
        const chunk = db.getChunkById(chunkId);

        if (!chunk) {
          console.error(chalk.red(`Chunk #${chunkId} not found`));
          process.exit(1);
        }

        if (options.json) {
          console.log(JSON.stringify(chunk, null, 2));
          return;
        }

        console.log(chalk.cyan(`File: ${chunk.filePath}`));
        console.log(chalk.gray(`Chunk #${chunk.id} | Index: ${chunk.chunkIndex} | Lines: ${chunk.lineStart}-${chunk.lineEnd}`));
        console.log(chalk.gray('─────────────────────────────────────────────────'));
        console.log(chunk.content);
        console.log(chalk.gray('─────────────────────────────────────────────────'));

      } finally {
        db.close();
      }
    });
}
