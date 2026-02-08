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
    .option('--prune', 'Delete indexed files that no longer exist on disk')
    .option('--contextualize', 'Generate LLM context for chunks (improves retrieval)')
    .option('--dry-run', 'Show what would be indexed without making changes')
    .action(async (options: { force?: boolean; prune?: boolean; contextualize?: boolean; dryRun?: boolean }) => {
      const config = loadConfig();

      if (!options.dryRun) {
        const serverOk = await checkEmbeddingServer(config);
        if (!serverOk) {
          console.error(chalk.red(`Error: Cannot connect to embedding server at ${config.embeddingEndpoint}`));
          console.error(chalk.yellow(''));
          console.error(chalk.yellow('Make sure your embedding server is running and accessible.'));
          console.error(chalk.yellow('Check your config at ~/.memory-search/config.json'));
          console.error(chalk.yellow('Run "memory doctor" to diagnose issues.'));
          process.exit(1);
        }
      }

      const label = options.dryRun ? 'Scanning files (dry run)...' : 'Indexing files...';
      console.log(chalk.blue(label));
      if (options.contextualize) {
        config.contextualizeChunks = true;
      }
      const sourceCount = (config.sources?.length || 0) + (config.collections?.length || 0);
      console.log(chalk.gray(`Sources: ${sourceCount} configured`));

      const startTime = Date.now();

      const result = await indexFiles(config, {
        force: options.force,
        prune: options.prune,
        dryRun: options.dryRun,
        onProgress: (p) => {
          process.stdout.write(
            `\r${chalk.cyan(`[${p.processed}/${p.total}]`)} ${p.file.slice(-50).padEnd(50)}`
          );
        },
      });

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

      console.log('\n');
      if (options.dryRun) {
        console.log(chalk.yellow(`[DRY RUN] Would index ${result.indexed} files`));
      } else {
        console.log(chalk.green(`Done. Indexed ${result.indexed} files`));
      }
      console.log(chalk.gray(`  Skipped: ${result.skipped} (unchanged)`));
      if (options.prune) {
        console.log(chalk.gray(`  Pruned: ${result.pruned} (missing on disk)`));
      }
      if (options.contextualize && result.contextualized > 0) {
        console.log(chalk.gray(`  Contextualized: ${result.contextualized} chunks`));
      }
      console.log(chalk.gray(`  Time: ${elapsed}s`));

      if (result.errors.length > 0) {
        console.log(chalk.yellow(`\nErrors (${result.errors.length}):`));
        for (const err of result.errors.slice(0, 5)) {
          console.log(chalk.red(`  - ${err}`));
        }
        if (result.errors.length > 5) {
          console.log(chalk.gray(`  ... and ${result.errors.length - 5} more`));
        }
      }
    });
}
