// Cache management command

import { Command } from 'commander';
import chalk from 'chalk';
import { loadConfig } from '../utils/config.js';
import { MemoryDB } from '../storage/db.js';
import { RerankCache } from '../storage/rerank-cache.js';

export function registerCacheCommand(program: Command): void {
  const cmd = program
    .command('cache')
    .description('Manage caches');

  cmd
    .command('prune')
    .description('Remove stale cache entries')
    .option('-d, --days <n>', 'Max age in days', '30')
    .action((options: { days: string }) => {
      const days = Number(options.days);
      if (!Number.isFinite(days) || days < 1) {
        console.error(chalk.red('Error: --days must be a positive number'));
        process.exit(1);
      }

      const config = loadConfig();
      const db = new MemoryDB(config);
      const rerankCache = new RerankCache(config);

      try {
        const queryPruned = db.pruneQueryEmbeddingCache(days);
        const contextPruned = db.pruneContextCache(days);
        const rerankPruned = rerankCache.prune(days);

        console.log(chalk.green('Cache pruned:'));
        console.log(`  Query embeddings: ${queryPruned} entries removed`);
        console.log(`  Context prefixes: ${contextPruned} entries removed`);
        console.log(`  Reranker scores:  ${rerankPruned} entries removed`);
      } finally {
        db.close();
        rerankCache.close();
      }
    });
}
