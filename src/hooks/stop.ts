#!/usr/bin/env node
// Stop Hook
// Generates a structured session summary from the transcript

import { existsSync } from 'node:fs';
import { basename } from 'node:path';
import { loadConfig } from '../utils/config.js';
import { MemoryDB } from '../storage/db.js';
import {
  findLatestSessionFile,
  parseSessionFile,
  getMessageContent,
  ensureMemoryDir,
} from './index.js';
import { fetchWithRetry } from '../utils/network.js';
import { getChatEndpoint } from '../utils/api-endpoints.js';
import type { Config } from '../types.js';

interface StopInput {
  session_id?: string;
  transcript_path?: string;
}

/**
 * Extract the last assistant message from session messages
 */
function extractLastAssistantMessage(
  messages: Array<{ type: string; message?: { role?: string; content?: string | Array<{ type: string; text?: string }> }; timestamp?: string }>
): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.type === 'assistant' || msg.message?.role === 'assistant') {
      const content = getMessageContent(msg);
      if (content && content.length > 20) {
        return content;
      }
    }
  }
  return '';
}

/**
 * Generate a structured summary via LLM
 */
async function generateSummary(lastMessage: string, config: Config): Promise<string | null> {
  const chatEndpoint = getChatEndpoint(config.embeddingEndpoint);

  const prompt = `Summarize this Claude session output into a structured format. Be concise.

Session output:
${lastMessage.substring(0, 3000)}

Respond in this exact format (plain text, no JSON):
REQUEST: What the user asked for (1 sentence)
INVESTIGATED: What was explored/researched (1-2 sentences)
LEARNED: Key insights or findings (1-2 sentences)
COMPLETED: What was accomplished (1-2 sentences)
NEXT_STEPS: Remaining work or follow-ups (1 sentence, or "None")`;

  try {
    const response = await fetchWithRetry(chatEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 300,
        temperature: 0.1,
      }),
    });

    if (!response.ok) {
      return null;
    }

    const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    return data.choices?.[0]?.message?.content?.trim() || null;
  } catch {
    return null;
  }
}

/**
 * Generate a heuristic summary when LLM is unavailable
 */
function heuristicSummary(lastMessage: string): string {
  const lines = lastMessage.split('\n').filter(l => l.trim().length > 0);
  // Take the first few meaningful lines as a summary
  const meaningful = lines
    .filter(l => l.length > 15 && !l.startsWith('```') && !l.startsWith('#'))
    .slice(0, 5);

  if (meaningful.length === 0) {
    return 'Session completed (no summary available)';
  }

  return meaningful.join('\n').substring(0, 500);
}

async function main(): Promise<void> {
  try {
    // Read JSON from stdin
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(chunk);
    }
    const input = Buffer.concat(chunks).toString('utf8');

    let data: StopInput = {};
    if (input.trim()) {
      try {
        data = JSON.parse(input);
      } catch {
        // Not JSON, ignore
      }
    }

    ensureMemoryDir();
    const config = loadConfig();

    // Find session transcript
    let sessionPath = data.transcript_path;
    let sessionId = data.session_id;

    if (!sessionPath || !existsSync(sessionPath)) {
      sessionPath = findLatestSessionFile() || undefined;
    }

    if (!sessionPath) {
      console.error('[memory-search] Stop hook: no session transcript found');
      process.exit(0);
    }

    if (!sessionId) {
      sessionId = basename(sessionPath, '.jsonl');
    }

    // Parse session and extract last assistant message
    const messages = parseSessionFile(sessionPath);
    const lastMessage = extractLastAssistantMessage(messages);

    if (!lastMessage) {
      console.error('[memory-search] Stop hook: no assistant message found');
      process.exit(0);
    }

    // Generate summary
    let summary = await generateSummary(lastMessage, config);
    if (!summary) {
      summary = heuristicSummary(lastMessage);
    }

    // Store summary in the database
    const db = new MemoryDB(config);
    try {
      db.upsertSession(sessionId, '');
      db.setSessionSummary(sessionId, summary);
      console.error(`[memory-search] Stop hook: session ${sessionId.substring(0, 8)}... summarized`);
    } finally {
      db.close();
    }
  } catch (err) {
    console.error(`[memory-search] Stop error: ${err instanceof Error ? err.message : String(err)}`);
  }

  process.exit(0);
}

main();
