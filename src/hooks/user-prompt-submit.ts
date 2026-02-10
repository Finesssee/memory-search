#!/usr/bin/env node
// User Prompt Submit Hook
// Creates/updates session records and tracks prompt count

import { loadConfig } from '../utils/config.js';
import { MemoryDB } from '../storage/db.js';
import { ensureMemoryDir } from './index.js';

interface PromptSubmitInput {
  session_id?: string;
  cwd?: string;
  prompt?: string;
}

async function main(): Promise<void> {
  try {
    // Read JSON from stdin
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(chunk);
    }
    const input = Buffer.concat(chunks).toString('utf8');

    if (!input.trim()) {
      process.exit(0);
    }

    const data: PromptSubmitInput = JSON.parse(input);

    // Need at least a session_id to track
    if (!data.session_id) {
      process.exit(0);
    }

    ensureMemoryDir();
    const config = loadConfig();
    const db = new MemoryDB(config);

    try {
      // Create or update session record
      const projectPath = data.cwd || '';
      db.upsertSession(data.session_id, projectPath);

      // Increment prompt counter
      db.incrementSessionPromptCount(data.session_id);

      console.error(`[memory-search] Session ${data.session_id.substring(0, 8)}... prompt tracked`);
    } finally {
      db.close();
    }
  } catch (err) {
    // Fail silently to not block the prompt
    console.error(`[memory-search] Prompt submit error: ${err instanceof Error ? err.message : String(err)}`);
  }

  process.exit(0);
}

main();
