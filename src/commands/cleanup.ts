import { Command } from 'commander';
import chalk from 'chalk';
import { MemoryDB } from '../storage/db.js';
import { loadConfig } from '../utils/config.js';

export function registerCleanupCommand(program: Command): void {
  program
    .command('cleanup')
    .description('Remove orphaned data and optimize database')
    .option('--dry-run', 'Show what would be cleaned without making changes')
    .action(async (options: { dryRun?: boolean }) => {
      const config = loadConfig();
      const db = new MemoryDB(config);

      try {
        const stats = db.getDetailedStats();
        console.log(chalk.cyan('Database Status:'));
        console.log(chalk.gray(`  Files: ${stats.files}`));
        console.log(chalk.gray(`  Chunks: ${stats.chunks}`));
        console.log(chalk.gray(`  Orphan chunks: ${stats.orphanChunks}`));
        console.log(chalk.gray(`  Orphan FTS entries: ${stats.orphanFts}`));
        console.log(chalk.gray(`  Cache entries: ${stats.cacheEntries}`));
        console.log(chalk.gray(`  DB size: ${stats.dbSizeMb.toFixed(1)} MB`));

        if (options.dryRun) {
          console.log(chalk.yellow('\n[DRY RUN] Would remove:'));
          console.log(chalk.yellow(`  ${stats.orphanChunks} orphan chunks`));
          console.log(chalk.yellow(`  ${stats.orphanFts} orphan FTS entries`));
          return;
        }

        let removed = 0;
        const orphanChunks = db.removeOrphanChunks();
        removed += orphanChunks;
        if (orphanChunks > 0) console.log(chalk.green(`  Removed ${orphanChunks} orphan chunks`));

        const orphanFts = db.removeOrphanFts();
        removed += orphanFts;
        if (orphanFts > 0) console.log(chalk.green(`  Removed ${orphanFts} orphan FTS entries`));

        const orphanVec = db.removeOrphanVec();
        removed += orphanVec;
        if (orphanVec > 0) console.log(chalk.green(`  Removed ${orphanVec} orphan vec entries`));

        db.vacuum();
        console.log(chalk.green(`\nCleanup complete. Removed ${removed} orphan entries.`));

        const newStats = db.getDetailedStats();
        console.log(chalk.gray(`  DB size: ${newStats.dbSizeMb.toFixed(1)} MB`));
      } finally {
        db.close();
      }
    });
}
