// context command - build context block from query

import { Command } from 'commander';
import { search } from '../core/searcher.js';
import { FactsDB } from '../storage/facts.js';
import { assembleTimeline, formatTimelineAsContext } from '../core/timeline.js';
import { loadConfig } from '../utils/config.js';

export function registerContextCommand(program: Command): void {
  program
    .command('context <query>')
    .description('Build context block from memories for injection')
    .option('-l, --limit <n>', 'Max results', '5')
    .option('-t, --tokens <n>', 'Max tokens in output', '2000')
    .action(async (query: string, options) => {
      const config = loadConfig();
      config.searchTopK = parseInt(options.limit, 10);

      const results = await search(query, config);
      const factsDb = new FactsDB(config);
      const facts = factsDb.list().slice(0, 10);
      factsDb.close();

      const timeline = assembleTimeline(results, facts);
      const context = formatTimelineAsContext(timeline, parseInt(options.tokens, 10));

      console.log(context);
    });
}
