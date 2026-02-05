// Index command

import { Command } from 'commander';
import chalk from 'chalk';
import { indexFiles } from '../core/indexer.js';
import { checkEmbeddingServer } from '../core/embeddings.js';
import { loadConfig } from '../utils/config.js';

export function registerIndexCommand(program: Command): void {
  program
    .command('index')
    .description('Index or reindex checkpoint files')
    .option('--force', 'Force re-embed all files')
    .action(async (options: { force?: boolean }) => {
      const config = loadConfig();

      // Check if embedding server is running
      const serverOk = await checkEmbeddingServer(config);
      if (!serverOk) {
        console.error(chalk.red('Error: Embedding server not running'));
        console.error(chalk.yellow('Start it with: pm2 start embed-server'));
        process.exit(1);
      }

      console.log(chalk.blue('Indexing files...'));
      console.log(chalk.gray(`Sources: ${config.sources.join(', ')}`));

      const startTime = Date.now();

      const result = await indexFiles(config, {
        force: options.force,
        onProgress: (p) => {
          process.stdout.write(
            `\r${chalk.cyan(`[${p.processed}/${p.total}]`)} ${p.file.slice(-50).padEnd(50)}`
          );
        },
      });

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

      console.log('\n');
      console.log(chalk.green(`✓ Indexed ${result.indexed} files`));
      console.log(chalk.gray(`  Skipped: ${result.skipped} (unchanged)`));
      console.log(chalk.gray(`  Time: ${elapsed}s`));

      if (result.errors.length > 0) {
        console.log(chalk.yellow(`\n⚠ Errors (${result.errors.length}):`));
        for (const err of result.errors.slice(0, 5)) {
          console.log(chalk.red(`  - ${err}`));
        }
        if (result.errors.length > 5) {
          console.log(chalk.gray(`  ... and ${result.errors.length - 5} more`));
        }
      }
    });
}
