// Config command - view and manage configuration

import { Command } from 'commander';
import chalk from 'chalk';
import { loadConfig, saveConfig, getConfigPath, maskSecrets, ENV_OVERRIDES } from '../utils/config.js';

export function registerConfigCommand(program: Command): void {
  const cmd = program
    .command('config')
    .description('View and manage configuration');

  // memory config (no subcommand) — show all config
  cmd.action(() => {
    const config = loadConfig();
    const masked = maskSecrets(config);

    console.log(chalk.bold('Memory Search Configuration'));
    console.log(chalk.gray('──────────────────────────'));
    console.log(chalk.gray(`Config file: ${getConfigPath()}`));
    console.log();

    for (const [key, value] of Object.entries(masked)) {
      if (Array.isArray(value)) {
        if (value.length === 0) {
          console.log(`${chalk.cyan(key)}: ${chalk.gray('(empty)')}`);
        } else {
          console.log(`${chalk.cyan(key)}:`);
          for (const item of value) {
            if (typeof item === 'object') {
              console.log(`  - ${JSON.stringify(item)}`);
            } else {
              console.log(`  - ${item}`);
            }
          }
        }
      } else if (typeof value === 'object' && value !== null) {
        console.log(`${chalk.cyan(key)}: ${JSON.stringify(value)}`);
      } else {
        console.log(`${chalk.cyan(key)}: ${value}`);
      }
    }

    // Show active env overrides
    const activeOverrides: string[] = [];
    for (const envVar of Object.keys(ENV_OVERRIDES)) {
      if (process.env[envVar] !== undefined) {
        activeOverrides.push(envVar);
      }
    }
    if (activeOverrides.length > 0) {
      console.log();
      console.log(chalk.bold('Active env overrides:'));
      for (const envVar of activeOverrides) {
        console.log(`  ${chalk.yellow(envVar)}=${process.env[envVar]}`);
      }
    }
  });

  // memory config get <key>
  cmd
    .command('get <key>')
    .description('Get a configuration value')
    .action((key: string) => {
      const config = loadConfig();
      const masked = maskSecrets(config);

      if (!(key in masked)) {
        console.error(chalk.red(`Unknown config key: ${key}`));
        console.error(chalk.gray(`Valid keys: ${Object.keys(masked).join(', ')}`));
        process.exit(1);
      }

      const value = masked[key];
      if (typeof value === 'object') {
        console.log(JSON.stringify(value, null, 2));
      } else {
        console.log(value);
      }
    });

  // memory config set <key> <value>
  cmd
    .command('set <key> <value>')
    .description('Set a configuration value')
    .action((key: string, value: string) => {
      const config = loadConfig();

      if (!(key in config)) {
        console.error(chalk.red(`Unknown config key: ${key}`));
        process.exit(1);
      }

      const currentValue = (config as unknown as Record<string, unknown>)[key];

      // Handle null to clear optional fields
      if (value === 'null') {
        (config as unknown as Record<string, unknown>)[key] = undefined;
        saveConfig(config);
        console.log(chalk.green(`Cleared ${key}`));
        return;
      }

      // Parse value based on current type
      let parsed: unknown;
      if (typeof currentValue === 'number') {
        parsed = Number(value);
        if (!Number.isFinite(parsed as number)) {
          console.error(chalk.red(`Invalid number: ${value}`));
          process.exit(1);
        }
      } else if (typeof currentValue === 'boolean') {
        if (!['true', 'false', '1', '0'].includes(value)) {
          console.error(chalk.red(`Invalid boolean: ${value} (use true/false/1/0)`));
          process.exit(1);
        }
        parsed = value === 'true' || value === '1';
      } else if (Array.isArray(currentValue) || (typeof currentValue === 'object' && currentValue !== null)) {
        try {
          parsed = JSON.parse(value);
        } catch {
          console.error(chalk.red(`Invalid JSON for ${key}: ${value}`));
          console.error(chalk.gray('Arrays and objects must be valid JSON, e.g.: \'["path/a","path/b"]\''));
          process.exit(1);
        }
      } else {
        parsed = value;
      }

      (config as unknown as Record<string, unknown>)[key] = parsed;
      saveConfig(config);
      console.log(chalk.green(`Set ${key} = ${parsed}`));
    });
}
