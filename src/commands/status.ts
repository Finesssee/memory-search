// Status command

import { Command } from 'commander';
import chalk from 'chalk';
import { MemoryDB } from '../storage/db.js';
import { checkEmbeddingServer } from '../core/embeddings.js';
import { loadConfig, getConfigPath } from '../utils/config.js';
import { basename } from 'node:path';

export function registerStatusCommand(program: Command): void {
  program
    .command('status')
    .description('Show index status and statistics')
    .option('--files', 'List all indexed files')
    .action(async (options: { files?: boolean }) => {
      const config = loadConfig();

      console.log(chalk.blue('\n📊 Memory Search Status\n'));

      // Config info
      console.log(chalk.gray('Config: ') + getConfigPath());
      console.log(chalk.gray('Index:  ') + config.indexPath);
      console.log(chalk.gray('Sources:'));
      for (const src of config.sources) {
        console.log(chalk.gray(`  - ${src}`));
      }

      // Embedding server status
      const serverOk = await checkEmbeddingServer(config);
      console.log(
        chalk.gray('\nEmbedding Server: ') +
          (serverOk ? chalk.green('✓ Running') : chalk.red('✗ Not running'))
      );

      // DB stats
      try {
        const db = new MemoryDB(config);
        const stats = db.getStats();

        console.log(chalk.gray('\nIndex Stats:'));
        console.log(chalk.white(`  Files:  ${stats.files}`));
        console.log(chalk.white(`  Chunks: ${stats.chunks}`));

        if (options.files) {
          const files = db.getAllFiles();
          console.log(chalk.gray('\nIndexed Files:'));
          for (const file of files) {
            const date = new Date(file.indexedAt).toLocaleDateString();
            console.log(chalk.gray(`  [${date}] `) + basename(file.path));
          }
        }

        db.close();
      } catch (err) {
        console.log(chalk.yellow('\nNo index found yet. Run `memory index` first.'));
      }

      console.log();
    });
}
