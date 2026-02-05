// Search command

import { Command } from 'commander';
import chalk from 'chalk';
import { search } from '../core/searcher.js';
import { checkEmbeddingServer } from '../core/embeddings.js';
import { loadConfig } from '../utils/config.js';
import { basename } from 'node:path';

export function registerSearchCommand(program: Command): void {
  program
    .command('search <query>')
    .description('Search checkpoint files semantically')
    .option('-l, --limit <n>', 'Number of results', '5')
    .option('-f, --format <type>', 'Output format (human|json)', 'human')
    .option('-e, --expand', 'Expand query into variations for better recall')
    .action(async (query: string, options: { limit: string; format: string; expand?: boolean }) => {
      const config = loadConfig();
      config.searchTopK = parseInt(options.limit, 10);
      config.expandQueries = options.expand ?? false;

      // Check if embedding server is running
      const serverOk = await checkEmbeddingServer(config);
      if (!serverOk) {
        console.error(chalk.red('Error: Embedding server not running'));
        console.error(chalk.yellow('Start it with: pm2 start embed-server'));
        process.exit(1);
      }

      try {
        const results = await search(query, config);

        if (results.length === 0) {
          if (options.format === 'json') {
            console.log(JSON.stringify({ query, results: [] }));
          } else {
            console.log(chalk.yellow('No matches found.'));
          }
          return;
        }

        if (options.format === 'json') {
          console.log(JSON.stringify({ query, results }, null, 2));
        } else {
          console.log(chalk.green(`\nFound ${results.length} matches:\n`));

          for (let i = 0; i < results.length; i++) {
            const r = results[i];
            const fileName = basename(r.file);
            // Score is already 0-1 from reranker blending, convert to percentage
            const scorePercent = Math.round(r.score * 100);

            console.log(chalk.cyan(`[${i + 1}] ${fileName}`) + chalk.gray(` (${scorePercent}%)`));
            console.log(chalk.gray(`    Lines ${r.lineStart}-${r.lineEnd}`));
            console.log(chalk.gray('    ─────────────────────────────────────────────────'));

            // Indent snippet
            const snippetLines = r.snippet.split('\n').slice(0, 5);
            for (const line of snippetLines) {
              console.log(chalk.white(`    ${line}`));
            }
            if (r.snippet.split('\n').length > 5) {
              console.log(chalk.gray('    ...'));
            }
            console.log();
          }
        }
      } catch (err) {
        console.error(chalk.red('Search failed:'), err instanceof Error ? err.message : err);
        process.exit(1);
      }
    });
}
