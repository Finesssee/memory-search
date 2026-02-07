// Status command - show index statistics

import { Command } from 'commander';
import chalk from 'chalk';
import { MemoryDB } from '../storage/db.js';
import { loadConfig } from '../utils/config.js';
// import { filesize } from 'filesize';
import { statSync, existsSync } from 'node:fs';

export function registerStatusCommand(program: Command): void {
  program
    .command('status')
    .description('Show status of memory index')
    .action(() => {
      const config = loadConfig();
      const db = new MemoryDB(config);

      try {
        const stats = db.getStats();

        // Get file size of index
        let indexSize = '0 B';
        if (existsSync(config.indexPath)) {
          const size = statSync(config.indexPath).size;
          indexSize = `${(size / 1024 / 1024).toFixed(2)} MB`;
        }

        console.log(chalk.bold('Memory Search Status'));
        console.log(chalk.gray('────────────────────'));
        console.log(`Index Path:     ${chalk.cyan(config.indexPath)}`);
        console.log(`Index Size:     ${chalk.yellow(indexSize)}`);
        console.log(`Files Indexed:  ${chalk.green(stats.files)}`);
        console.log(`Chunks:         ${chalk.green(stats.chunks)}`);

        // Collection Stats
        if (config.collections && config.collections.length > 0) {
          console.log(chalk.bold('\nCollections'));
          console.log(chalk.gray('───────────'));
          for (const col of config.collections) {
            try {
              const files = db.getFilesByCollection(col.name);
              console.log(`${col.name.padEnd(15)} ${chalk.green(files.length)} files`);
            } catch (e) {
              console.log(`${col.name.padEnd(15)} ${chalk.gray('(pending)')}`);
            }
          }
        } else if (config.sources && config.sources.length > 0) {
           console.log(chalk.bold('\nSources'));
           console.log(chalk.gray('───────'));
           for (const src of config.sources) {
             console.log(`- ${src}`);
           }
        }

      } finally {
        db.close();
      }
    });
}
