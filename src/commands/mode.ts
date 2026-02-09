import { Command } from 'commander';
import chalk from 'chalk';
import { createMode, getMode, listModes, setActiveMode, getActiveMode, clearActiveMode } from '../utils/mode-manager.js';

export function registerModeCommand(program: Command): void {
  const modeCmd = program
    .command('mode')
    .description('Manage configuration profiles');

  modeCmd
    .command('create <name>')
    .description('Create a new mode with JSON overrides from stdin or args')
    .option('--set <json>', 'JSON config overrides')
    .action((name: string, options: { set?: string }) => {
      const overrides = options.set ? JSON.parse(options.set) : {};
      createMode(name, overrides);
      console.log(chalk.green(`Mode "${name}" created.`));
    });

  modeCmd
    .command('set <name>')
    .description('Activate a configuration mode')
    .action((name: string) => {
      const mode = getMode(name);
      if (!mode) {
        console.error(chalk.red(`Mode "${name}" not found. Create it first with: memory mode create ${name}`));
        process.exit(1);
      }
      setActiveMode(name);
      console.log(chalk.green(`Active mode set to "${name}"`));
    });

  modeCmd
    .command('show [name]')
    .description('Show mode configuration')
    .action((name?: string) => {
      const target = name ?? getActiveMode();
      if (!target) {
        console.log(chalk.yellow('No active mode. Specify a name or set one with: memory mode set <name>'));
        return;
      }
      const mode = getMode(target);
      if (!mode) {
        console.error(chalk.red(`Mode "${target}" not found.`));
        process.exit(1);
      }
      const isActive = getActiveMode() === target;
      console.log(chalk.cyan(`Mode: ${target}${isActive ? ' (active)' : ''}`));
      console.log(JSON.stringify(mode, null, 2));
    });

  modeCmd
    .command('list')
    .description('List all modes')
    .action(() => {
      const modes = listModes();
      const active = getActiveMode();
      if (modes.length === 0) {
        console.log(chalk.yellow('No modes defined.'));
        return;
      }
      for (const m of modes) {
        const marker = m === active ? chalk.green(' (active)') : '';
        console.log(`  ${m}${marker}`);
      }
    });

  modeCmd
    .command('clear')
    .description('Deactivate current mode')
    .action(() => {
      clearActiveMode();
      console.log(chalk.green('Active mode cleared.'));
    });
}
