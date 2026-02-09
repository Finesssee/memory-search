#!/usr/bin/env node
// Memory Search CLI - Semantic search over checkpoint files

import { Command } from 'commander';
import { registerCommands } from './commands/index.js';
import { installSigintHandler } from './utils/shutdown.js';

installSigintHandler();

const program = new Command();

program
  .name('memory')
  .description('Semantic search over checkpoint files')
  .version('1.0.0');

registerCommands(program);

program.parse();
