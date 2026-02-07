// Search command

import { Command } from 'commander';
import chalk from 'chalk';
import { search } from '../core/searcher.js';
import { MemoryDB } from '../storage/db.js';
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
    .option('--explain', 'Show per-result score breakdown')
    .option('--collection <name>', 'Filter by collection')
    .option('--compact', 'Compact output for LLM consumption')
    .option('--timeline <chunkId>', 'Show timeline context around a chunk')
    .action(async (query: string, options: {
      limit: string;
      format: string;
      expand?: boolean;
      explain?: boolean;
      collection?: string;
      compact?: boolean;
      timeline?: string;
    }) => {
      const config = loadConfig();
      config.searchTopK = parseInt(options.limit, 10);
      config.expandQueries = options.expand ?? false;

      // Check if embedding server is running
      const serverOk = await checkEmbeddingServer(config);
      if (!serverOk) {
        console.error(chalk.red(`Error: Cannot connect to embedding server at ${config.embeddingEndpoint}`));
        console.error(chalk.yellow(''));
        console.error(chalk.yellow('Make sure your embedding server is running and accessible.'));
        console.error(chalk.yellow('Check your config at ~/.memory-search/config.json'));
        process.exit(1);
      }

      try {
        const db = new MemoryDB(config);

        // Handle timeline view
        if (options.timeline) {
          const chunkId = parseInt(options.timeline, 10);
          const chunks = db.getSurroundingChunks(chunkId, 2); // 2 before, 2 after

          if (chunks.length === 0) {
            console.log(chalk.yellow('No timeline context found.'));
            return;
          }

          if (options.format === 'json') {
             console.log(JSON.stringify({ timeline: chunks }, null, 2));
             return;
          }

          console.log(chalk.cyan(`Timeline Context for Chunk #${chunkId}:\n`));
          for (const chunk of chunks) {
            const isTarget = chunk.id === chunkId;
            const prefix = isTarget ? chalk.green('➤ ') : chalk.gray('  ');
            const file = basename(chunk.filePath);
            console.log(`${prefix}${chalk.bold(file)} (Chunk ${chunk.chunkIndex})`);

            // Indent content
            const content = chunk.content.split('\n').map(l => `    ${l}`).join('\n');
            if (isTarget) {
              console.log(chalk.white(content));
            } else {
              console.log(chalk.gray(content));
            }
            console.log('');
          }
          return;
        }

        const results = await search(query, config);

        // Filter by collection if requested
        let filteredResults = results;
        if (options.collection) {
          const collectionFiles = new Set(db.getFilesByCollection(options.collection).map(f => f.path));
          filteredResults = results.filter(r => collectionFiles.has(r.file));
        }

        db.close();

        if (filteredResults.length === 0) {
          if (options.format === 'json') {
            console.log(JSON.stringify({ query, results: [] }));
          } else {
            console.log(chalk.yellow('No matches found.'));
          }
          return;
        }

        if (options.format === 'json' || options.compact) {
          if (options.compact) {
            // Compact output for LLM
            const compact = filteredResults.map(r => ({
              id: r.chunkId,
              file: r.file,
              score: Number(r.score.toFixed(3)),
              lines: [r.lineStart, r.lineEnd]
            }));

            console.log(JSON.stringify({ results: compact }));
          } else {
            // Full JSON output
            console.log(JSON.stringify({
              query,
              results: filteredResults,
            }, null, 2));
          }
        } else {
          console.log(chalk.green(`\nFound ${filteredResults.length} matches:\n`));

          for (let i = 0; i < filteredResults.length; i++) {
            const r = filteredResults[i];
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

            if (options.explain && r.explain) {
              const explain = r.explain;
              const bm25Rank = explain.bm25Rank ? `${explain.bm25Rank}` : 'n/a';
              const bm25Score = Number.isFinite(explain.bm25Score) ? explain.bm25Score!.toFixed(3) : 'n/a';
              const semanticScore = Number.isFinite(explain.semanticScore) ? explain.semanticScore!.toFixed(3) : 'n/a';
              const rrfScore = Number.isFinite(explain.rrfScore) ? explain.rrfScore!.toFixed(4) : 'n/a';
              const rerankerScore = Number.isFinite(explain.rerankerScore) ? explain.rerankerScore!.toFixed(3) : 'n/a';
              const blendWeights = explain.blendWeights
                ? `${explain.blendWeights.bm25.toFixed(2)}/${explain.blendWeights.semantic.toFixed(2)}`
                : 'n/a';
              const rerankerWeights = explain.rerankerWeights
                ? `${explain.rerankerWeights.retrieval.toFixed(2)}/${explain.rerankerWeights.reranker.toFixed(2)}`
                : 'n/a';

              console.log(chalk.gray(`    Explain: rrf=${rrfScore} bm25Rank=${bm25Rank} bm25Score=${bm25Score}`));
              console.log(chalk.gray(`             semanticScore=${semanticScore} blend(bm25/sem)=${blendWeights}`));
              console.log(chalk.gray(`             rerankerScore=${rerankerScore} blend(retrieval/rerank)=${rerankerWeights}`));
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
