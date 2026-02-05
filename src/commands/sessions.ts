// Sessions command - manage session history

import { Command } from 'commander';
import chalk from 'chalk';
import { MemoryDB } from '../storage/db.js';
import { loadConfig } from '../utils/config.js';

export function registerSessionsCommand(program: Command): void {
  const sessions = program
    .command('sessions')
    .description('Manage session history');

  sessions
    .command('list')
    .description('List recent sessions')
    .option('-n, --limit <number>', 'Number of sessions to show', '20')
    .action((options: { limit: string }) => {
      const config = loadConfig();
      const db = new MemoryDB(config);

      try {
        const allSessions = db.getAllSessions();
        const limit = parseInt(options.limit, 10) || 20;
        const sessions = allSessions.slice(0, limit);

        if (sessions.length === 0) {
          console.log(chalk.yellow('No sessions found.'));
          return;
        }

        console.log(chalk.blue('\nRecent Sessions\n'));
        console.log(chalk.gray('ID        Date                 Captures  Project'));
        console.log(chalk.gray('-'.repeat(70)));

        for (const s of sessions) {
          const date = new Date(s.startedAt).toLocaleString();
          const id = s.id.substring(0, 8);
          const captures = String(s.captureCount || 0).padStart(3);
          const project = s.projectPath || '';
          console.log(`${id}  ${date}  ${captures}       ${project}`);
        }

        console.log();
      } finally {
        db.close();
      }
    });

  sessions
    .command('show <id>')
    .description('Show captures from a session')
    .action((id: string) => {
      const config = loadConfig();
      const db = new MemoryDB(config);

      try {
        // Find session by prefix match
        const allSessions = db.getAllSessions();
        const session = allSessions.find((s) => s.id.startsWith(id));

        if (!session) {
          console.log(chalk.red(`Session not found: ${id}`));
          return;
        }

        console.log(chalk.blue(`\nSession: ${session.id}\n`));
        console.log(chalk.gray('Started: ') + new Date(session.startedAt).toLocaleString());
        console.log(chalk.gray('Project: ') + (session.projectPath || 'N/A'));
        if (session.summary) {
          console.log(chalk.gray('Summary: ') + session.summary);
        }
        console.log();

        // Get chunks for this session
        const chunks = db.getChunksBySessionId(session.id);

        if (chunks.length === 0) {
          console.log(chalk.yellow('No captures found for this session.'));
          return;
        }

        console.log(chalk.blue(`Captures (${chunks.length}):\n`));

        for (const chunk of chunks) {
          console.log(chalk.gray('---'));
          console.log(chalk.gray(`File: ${chunk.filePath}`));
          console.log(chunk.content.substring(0, 500));
          if (chunk.content.length > 500) {
            console.log(chalk.gray('... (truncated)'));
          }
          console.log();
        }
      } finally {
        db.close();
      }
    });
}
