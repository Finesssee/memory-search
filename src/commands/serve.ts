import { Command } from 'commander';
import chalk from 'chalk';
import { loadConfig } from '../utils/config.js';
import { startServer } from '../server/index.js';

export function registerServeCommand(program: Command): void {
  program
    .command('serve')
    .description('Start HTTP API server')
    .option('-p, --port <n>', 'Port number', '3737')
    .option('--cors', 'Enable CORS headers')
    .action((options: { port: string; cors?: boolean }) => {
      const port = parseInt(options.port, 10);
      if (!Number.isFinite(port) || port < 1 || port > 65535) {
        console.error(chalk.red('Error: --port must be a valid port number (1-65535)'));
        process.exit(1);
      }

      const config = loadConfig();
      startServer(config, port, options.cors ?? false);
    });
}
