// context command - build context block from query and manage path contexts

import { Command } from 'commander';
import { search } from '../core/searcher.js';
import { FactsDB } from '../storage/facts.js';
import { assembleTimeline, formatTimelineAsContext } from '../core/timeline.js';
import { loadConfig, saveConfig } from '../utils/config.js';
import { generateContextBlock, upsertClaudeMd } from '../integrations/claude-md.js';
import path from 'path';
import chalk from 'chalk';

export function registerContextCommand(program: Command): void {
  const contextCmd = program
    .command('context')
    .description('Manage path contexts and build context blocks');

  // Subcommand: build (existing functionality)
  contextCmd
    .command('build <query>')
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

  // Subcommand: add
  contextCmd
    .command('add <path> <description>')
    .description('Add a context description for a specific path')
    .action(async (targetPath: string, description: string) => {
      const config = loadConfig();
      if (!config.pathContexts) {
        config.pathContexts = [];
      }

      // Resolve path
      const resolvedPath = targetPath === '/' || targetPath === '\\' ? '/' : path.resolve(targetPath);

      // Remove existing entry for this path if any
      config.pathContexts = config.pathContexts.filter(c => c.path !== resolvedPath);

      // Add new entry
      config.pathContexts.push({
        path: resolvedPath,
        description: description.trim()
      });

      await saveConfig(config);
      console.log(chalk.green(`Added context for ${resolvedPath}`));
      console.log(chalk.gray(`"${description}"`));
    });

  // Subcommand: list
  contextCmd
    .command('list')
    .description('List all path contexts')
    .action(() => {
      const config = loadConfig();
      if (!config.pathContexts || config.pathContexts.length === 0) {
        console.log(chalk.yellow('No path contexts defined.'));
        return;
      }

      console.log(chalk.cyan('Path Contexts:'));
      for (const ctx of config.pathContexts) {
        console.log(`${chalk.green(ctx.path)}: ${ctx.description}`);
      }
    });

  // Subcommand: rm
  contextCmd
    .command('rm <path>')
    .description('Remove a path context')
    .action(async (targetPath: string) => {
      const config = loadConfig();
      if (!config.pathContexts || config.pathContexts.length === 0) {
        console.log(chalk.yellow('No path contexts to remove.'));
        return;
      }

      const resolvedPath = targetPath === '/' || targetPath === '\\' ? '/' : path.resolve(targetPath);
      const initialLength = config.pathContexts.length;
      config.pathContexts = config.pathContexts.filter(c => c.path !== resolvedPath);

      if (config.pathContexts.length < initialLength) {
        await saveConfig(config);
        console.log(chalk.green(`Removed context for ${resolvedPath}`));
      } else {
        console.log(chalk.yellow(`No context found for ${resolvedPath}`));
      }
    });

  // Subcommand: sync
  contextCmd
    .command('sync [path]')
    .description('Sync memory context into CLAUDE.md')
    .option('-q, --query <query>', 'Custom search query for context')
    .option('-l, --limit <n>', 'Max results', '5')
    .action(async (targetPath: string | undefined, options: { query?: string; limit?: string }) => {
      const projectPath = targetPath ?? process.cwd();
      const config = loadConfig();
      const limit = parseInt(options.limit ?? '5', 10);
      config.searchTopK = limit;

      // Use provided query or generate from project name
      const query = options.query ?? path.basename(projectPath);

      const results = await search(query, config);

      const memories = results.map(r => ({
        file: r.file,
        snippet: r.snippet,
        score: r.score,
      }));

      const contextBlock = generateContextBlock(memories);

      if (!contextBlock) {
        console.log(chalk.yellow('No relevant memories found.'));
        return;
      }

      const claudePath = upsertClaudeMd(projectPath, contextBlock);
      console.log(chalk.green(`Context synced to ${claudePath}`));
      console.log(chalk.gray(`  ${memories.length} memories included`));
    });

  // Legacy support: if first arg is not a subcommand, treat as build
  // This is tricky in Commander, so we'll just advise users to use 'build'
}
