// collection command - manage named file collections

import { Command } from 'commander';
import chalk from 'chalk';
import { loadConfig, saveConfig } from '../utils/config.js';
import { MemoryDB } from '../storage/db.js';
import path from 'path';

export function registerCollectionCommand(program: Command): void {
  const collectionCmd = program
    .command('collection')
    .description('Manage named file collections');

  collectionCmd
    .command('add <path>')
    .description('Add a directory path to a collection')
    .option('-n, --name <name>', 'Collection name', 'default')
    .action(async (targetPath: string, options: { name: string }) => {
      const config = loadConfig();
      if (!config.collections) {
        config.collections = [];
      }

      const collectionName = options.name;
      const resolvedPath = path.resolve(targetPath);

      // Find or create collection in config
      let collection = config.collections.find(c => c.name === collectionName);
      if (!collection) {
        collection = { name: collectionName, paths: [] };
        config.collections.push(collection);
      }

      // Add path if not exists
      if (!collection.paths.includes(resolvedPath)) {
        collection.paths.push(resolvedPath);
        await saveConfig(config);
        console.log(chalk.green(`Added ${resolvedPath} to collection '${collectionName}'`));
      } else {
        console.log(chalk.yellow(`Path ${resolvedPath} already exists in collection '${collectionName}'`));
      }
    });

  collectionCmd
    .command('list')
    .description('List all collections and their stats')
    .action(() => {
      const config = loadConfig();
      const db = new MemoryDB(config);

      try {
        if (!config.collections || config.collections.length === 0) {
          if (!config.sources || config.sources.length === 0) {
            console.log(chalk.yellow('No collections defined.'));
            return;
          }
          // specific case for backward compatibility
          console.log(chalk.cyan('Legacy Sources (default):'));
          for (const source of config.sources) {
             console.log(`  ${source}`);
          }
          return;
        }

        console.log(chalk.cyan('Collections:'));
        for (const collection of config.collections) {
          console.log(chalk.bold(`\n${collection.name}:`));
          for (const p of collection.paths) {
            console.log(`  ${p}`);
          }

          // Get stats from DB
          try {
            const files = db.getFilesByCollection(collection.name);
            console.log(chalk.gray(`  Indexed files: ${files.length}`));
          } catch (e) {
            // DB might not have collection data yet
            console.log(chalk.gray('  (Not indexed yet)'));
          }
        }
      } finally {
        db.close();
      }
    });

  collectionCmd
    .command('remove <name>')
    .description('Remove a collection')
    .action(async (name: string) => {
      const config = loadConfig();
      if (!config.collections) {
        console.log(chalk.yellow('No collections defined.'));
        return;
      }

      const initialLength = config.collections.length;
      config.collections = config.collections.filter(c => c.name !== name);

      if (config.collections.length < initialLength) {
        await saveConfig(config);
        console.log(chalk.green(`Removed collection '${name}'`));
        console.log(chalk.yellow('Note: Run "memory index --prune" to remove indexed files for this collection.'));
      } else {
        console.log(chalk.red(`Collection '${name}' not found.`));
      }
    });
}
