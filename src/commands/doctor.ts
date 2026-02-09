// Doctor command — diagnose configuration and connectivity issues

import { Command } from 'commander';
import chalk from 'chalk';
import { existsSync, statSync } from 'node:fs';
import { loadConfig, getConfigPath } from '../utils/config.js';
import { checkEmbeddingServer } from '../core/embeddings.js';
import { MemoryDB } from '../storage/db.js';

interface Check {
  name: string;
  status: 'ok' | 'warn' | 'fail';
  message: string;
}

export function registerDoctorCommand(program: Command): void {
  program
    .command('doctor')
    .description('Diagnose configuration and connectivity issues')
    .action(async () => {
      const checks: Check[] = [];
      const config = loadConfig();

      // 1. Config file
      const configPath = getConfigPath();
      if (existsSync(configPath)) {
        checks.push({ name: 'Config file', status: 'ok', message: configPath });
      } else {
        checks.push({ name: 'Config file', status: 'warn', message: `Not found at ${configPath} (using defaults)` });
      }

      // 2. Sources configured
      const sourceCount = (config.sources?.length || 0);
      const collectionCount = (config.collections?.length || 0);
      if (sourceCount > 0 || collectionCount > 0) {
        checks.push({ name: 'Sources', status: 'ok', message: `${sourceCount} sources, ${collectionCount} collections` });
      } else {
        checks.push({ name: 'Sources', status: 'warn', message: 'No sources or collections configured — nothing to index' });
      }

      // 3. Index database
      if (existsSync(config.indexPath)) {
        try {
          const size = statSync(config.indexPath).size;
          const sizeMB = (size / 1024 / 1024).toFixed(2);
          const db = new MemoryDB(config);
          const stats = db.getStats();
          db.close();
          checks.push({ name: 'Index DB', status: 'ok', message: `${sizeMB} MB, ${stats.files} files, ${stats.chunks} chunks` });
        } catch (err) {
          checks.push({ name: 'Index DB', status: 'fail', message: `Cannot open: ${err instanceof Error ? err.message : String(err)}` });
        }
      } else {
        checks.push({ name: 'Index DB', status: 'warn', message: `Not found at ${config.indexPath} — run "memory index" first` });
      }

      // 4. Embedding server
      const serverOk = await checkEmbeddingServer(config);
      if (serverOk) {
        checks.push({ name: 'Embedding server', status: 'ok', message: config.embeddingEndpoint });
      } else {
        checks.push({ name: 'Embedding server', status: 'fail', message: `Cannot connect to ${config.embeddingEndpoint}` });
      }

      // 5. Env overrides
      const envVars = ['MEMORY_EMBEDDING_ENDPOINT', 'MEMORY_LLM_ENDPOINT', 'MEMORY_LLM_API_KEY', 'MEMORY_LLM_MODEL'];
      const activeEnv = envVars.filter(v => process.env[v]);
      if (activeEnv.length > 0) {
        checks.push({ name: 'Env overrides', status: 'ok', message: activeEnv.join(', ') });
      } else {
        checks.push({ name: 'Env overrides', status: 'ok', message: 'None (using config file values)' });
      }

      // 6. Context LLM (if configured)
      if (config.contextLlmEndpoint || (config.contextLlmEndpoints && config.contextLlmEndpoints.length > 0)) {
        const slotCount = config.contextLlmEndpoints?.length || 1;
        const hasKey = !!(config.contextLlmApiKey || config.contextLlmEndpoints?.some(s => s.apiKey));
        if (hasKey) {
          checks.push({ name: 'Context LLM', status: 'ok', message: `${slotCount} slot(s) configured with API key` });
        } else {
          checks.push({ name: 'Context LLM', status: 'warn', message: `${slotCount} slot(s) but no API key set` });
        }
      }

      // Print results
      console.log(chalk.bold('\nMemory Search Doctor\n'));
      let hasIssues = false;

      for (const check of checks) {
        let icon: string;
        let color: (s: string) => string;
        if (check.status === 'ok') {
          icon = chalk.green('OK');
          color = chalk.white;
        } else if (check.status === 'warn') {
          icon = chalk.yellow('!!');
          color = chalk.yellow;
          hasIssues = true;
        } else {
          icon = chalk.red('XX');
          color = chalk.red;
          hasIssues = true;
        }
        console.log(`  [${icon}] ${chalk.bold(check.name.padEnd(20))} ${color(check.message)}`);
      }

      console.log('');
      if (hasIssues) {
        console.log(chalk.yellow('Some issues found. Check the messages above.'));
      } else {
        console.log(chalk.green('All checks passed.'));
      }
    });
}
