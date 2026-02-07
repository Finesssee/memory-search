// Command registrations

import type { Command } from 'commander';
import { registerSearchCommand } from './search.js';
import { registerIndexCommand } from './index-cmd.js';
import { registerStatusCommand } from './status.js';
import { registerFactsCommand } from './facts.js';
import { registerContextCommand } from './context.js';
import { registerSessionsCommand } from './sessions.js';
import { registerCollectionCommand } from './collection.js';
import { registerGetCommand } from './get.js';

export function registerCommands(program: Command): void {
  registerSearchCommand(program);
  registerIndexCommand(program);
  registerStatusCommand(program);
  registerFactsCommand(program);
  registerContextCommand(program);
  registerSessionsCommand(program);
  registerCollectionCommand(program);
  registerGetCommand(program);
}
