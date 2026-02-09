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
import { registerConfigCommand } from './config.js';
import { registerCacheCommand } from './cache.js';
import { registerDoctorCommand } from './doctor.js';
import { registerExportCommand } from './export.js';
import { registerImportCommand } from './import.js';
import { registerCursorCommand } from './cursor.js';
import { registerModeCommand } from './mode.js';
import { registerCleanupCommand } from './cleanup.js';
import { registerServeCommand } from './serve.js';

export function registerCommands(program: Command): void {
  registerSearchCommand(program);
  registerIndexCommand(program);
  registerStatusCommand(program);
  registerFactsCommand(program);
  registerContextCommand(program);
  registerSessionsCommand(program);
  registerCollectionCommand(program);
  registerGetCommand(program);
  registerConfigCommand(program);
  registerCacheCommand(program);
  registerDoctorCommand(program);
  registerExportCommand(program);
  registerImportCommand(program);
  registerCursorCommand(program);
  registerModeCommand(program);
  registerCleanupCommand(program);
  registerServeCommand(program);
}
