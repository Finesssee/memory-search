// Facts command - key-value storage for persistent facts

import { Command } from 'commander';
import chalk from 'chalk';
import { FactsDB } from '../storage/facts.js';
import { loadConfig } from '../utils/config.js';

export function registerFactsCommand(program: Command): void {
  const facts = program
    .command('facts')
    .description('Manage key-value facts storage');

  facts
    .command('set <key> <value>')
    .description('Set a fact')
    .action((key: string, value: string) => {
      const config = loadConfig();
      const db = new FactsDB(config);

      try {
        db.set(key, value);
        console.log(chalk.green(`Set ${key} = ${value}`));
      } finally {
        db.close();
      }
    });

  facts
    .command('get <pattern>')
    .description('Get facts matching pattern (supports * and ? wildcards)')
    .option('-f, --format <type>', 'Output format (human|json)', 'human')
    .action((pattern: string, options: { format: string }) => {
      const config = loadConfig();
      const db = new FactsDB(config);

      try {
        const results = db.get(pattern);

        if (results.length === 0) {
          if (options.format === 'json') {
            console.log(JSON.stringify({ pattern, results: [] }));
          } else {
            console.log(chalk.yellow('No facts found.'));
          }
          return;
        }

        if (options.format === 'json') {
          console.log(JSON.stringify({ pattern, results }, null, 2));
        } else {
          for (const fact of results) {
            console.log(chalk.cyan(fact.key) + chalk.gray(' = ') + fact.value);
          }
        }
      } finally {
        db.close();
      }
    });

  facts
    .command('list')
    .description('List all facts')
    .option('-f, --format <type>', 'Output format (human|json)', 'human')
    .action((options: { format: string }) => {
      const config = loadConfig();
      const db = new FactsDB(config);

      try {
        const results = db.list();

        if (results.length === 0) {
          if (options.format === 'json') {
            console.log(JSON.stringify({ results: [] }));
          } else {
            console.log(chalk.yellow('No facts stored.'));
          }
          return;
        }

        if (options.format === 'json') {
          console.log(JSON.stringify({ results }, null, 2));
        } else {
          console.log(chalk.green(`${results.length} fact(s):\n`));
          for (const fact of results) {
            console.log(chalk.cyan(fact.key) + chalk.gray(' = ') + fact.value);
          }
        }
      } finally {
        db.close();
      }
    });

  facts
    .command('delete <key>')
    .description('Delete a fact by exact key or pattern (with --pattern)')
    .option('-p, --pattern', 'Treat key as glob pattern')
    .action((key: string, options: { pattern?: boolean }) => {
      const config = loadConfig();
      const db = new FactsDB(config);

      try {
        if (options.pattern) {
          const count = db.deletePattern(key);
          if (count > 0) {
            console.log(chalk.green(`Deleted ${count} fact(s) matching "${key}"`));
          } else {
            console.log(chalk.yellow(`No facts matching "${key}"`));
          }
        } else {
          const deleted = db.delete(key);
          if (deleted) {
            console.log(chalk.green(`Deleted ${key}`));
          } else {
            console.log(chalk.yellow(`Fact "${key}" not found`));
          }
        }
      } finally {
        db.close();
      }
    });
}
