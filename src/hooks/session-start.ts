#!/usr/bin/env node
// Session Start Hook
// Injects relevant memory context when a Claude Code session begins

import { loadConfig } from '../utils/config.js';
import { MemoryDB } from '../storage/db.js';
import { search } from '../core/searcher.js';
import { FactsDB } from '../storage/facts.js';
import { ensureMemoryDir } from './index.js';

interface SessionStartInput {
  session_id?: string;
  cwd?: string;
}

async function main(): Promise<void> {
  try {
    // Read JSON from stdin
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(chunk);
    }
    const input = Buffer.concat(chunks).toString('utf8');

    let data: SessionStartInput = {};
    if (input.trim()) {
      try {
        data = JSON.parse(input);
      } catch {
        // Not JSON, ignore
      }
    }

    ensureMemoryDir();
    const config = loadConfig();

    const contextParts: string[] = [];

    // 1. Retrieve recent session summaries
    const db = new MemoryDB(config);
    try {
      const recentSessions = db.getRecentSessions(3);
      if (recentSessions.length > 0) {
        contextParts.push('## Recent Session History');
        for (const session of recentSessions) {
          const date = new Date(session.startedAt).toISOString().slice(0, 10);
          const project = session.projectPath ? ` (${session.projectPath})` : '';
          contextParts.push(`\n### ${date}${project}`);
          if (session.summary) {
            contextParts.push(session.summary);
          }
        }
      }
    } finally {
      db.close();
    }

    // 2. Retrieve relevant facts
    const factsDb = new FactsDB(config);
    try {
      const facts = factsDb.list();
      if (facts.length > 0) {
        contextParts.push('\n## Known Facts');
        const displayed = facts.slice(0, 15);
        for (const fact of displayed) {
          contextParts.push(`- **${fact.key}**: ${fact.value}`);
        }
      }
    } finally {
      factsDb.close();
    }

    // 3. If we have a working directory, search for relevant memories
    if (data.cwd) {
      try {
        const projectName = data.cwd.split(/[/\\]/).pop() || '';
        if (projectName) {
          config.searchTopK = 3;
          const results = await search(projectName, config);
          if (results.length > 0) {
            contextParts.push('\n## Related Memories');
            for (const result of results.slice(0, 3)) {
              const snippet = result.snippet.substring(0, 200);
              contextParts.push(`\n**${result.file}** (${Math.round(result.score * 100)}%)`);
              contextParts.push(snippet);
            }
          }
        }
      } catch {
        // Search failed, non-critical
      }
    }

    // Output context to stdout (Claude Code reads this as additionalContext)
    if (contextParts.length > 0) {
      const header = '<!-- memory-search: session context -->';
      const footer = '<!-- /memory-search -->';
      console.log(`${header}\n${contextParts.join('\n')}\n${footer}`);
    }

    console.error('[memory-search] Session start hook: context injected');
  } catch (err) {
    console.error(`[memory-search] Session start error: ${err instanceof Error ? err.message : String(err)}`);
  }

  process.exit(0);
}

main();
