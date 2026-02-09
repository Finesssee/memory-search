import { Command } from 'commander';
import chalk from 'chalk';
import { installCursorIntegration, uninstallCursorIntegration, getCursorStatus } from '../integrations/cursor.js';

export function registerCursorCommand(program: Command): void {
  const cursorCmd = program
    .command('cursor')
    .description('Cursor IDE integration');

  cursorCmd
    .command('install')
    .description('Install memory-search rules for Cursor IDE')
    .option('--project <path>', 'Project root path', process.cwd())
    .action((options: { project: string }) => {
      const rulePath = installCursorIntegration(options.project);
      console.log(chalk.green(`Cursor rule installed at ${rulePath}`));
    });

  cursorCmd
    .command('uninstall')
    .description('Remove memory-search rules from Cursor IDE')
    .option('--project <path>', 'Project root path', process.cwd())
    .action((options: { project: string }) => {
      const removed = uninstallCursorIntegration(options.project);
      if (removed) {
        console.log(chalk.green('Cursor rule removed.'));
      } else {
        console.log(chalk.yellow('No Cursor rule found to remove.'));
      }
    });

  cursorCmd
    .command('status')
    .description('Check Cursor integration status')
    .option('--project <path>', 'Project root path', process.cwd())
    .action((options: { project: string }) => {
      const status = getCursorStatus(options.project);
      if (status.installed) {
        console.log(chalk.green(`Cursor integration installed at ${status.path}`));
      } else {
        console.log(chalk.yellow('Cursor integration not installed.'));
        console.log(chalk.gray('Run: memory cursor install'));
      }
    });
}
