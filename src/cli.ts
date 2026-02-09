#!/usr/bin/env node
// Memory Search CLI - Semantic search over checkpoint files

import { Command } from 'commander';
import { registerCommands } from './commands/index.js';
import { installSigintHandler } from './utils/shutdown.js';
import { setIndexOverride } from './utils/config.js';

installSigintHandler();

const program = new Command();

program
  .name('memory')
  .description('Semantic search over checkpoint files')
  .version('1.0.0')
  .option('--index <name>', 'Use a named index instead of default');

program.hook('preAction', (thisCommand) => {
  const opts = thisCommand.opts();
  if (opts.index) {
    setIndexOverride(opts.index);
  }
});

registerCommands(program);

program.parse();
