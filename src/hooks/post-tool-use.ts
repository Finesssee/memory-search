#!/usr/bin/env node
// Post Tool Use Hook
// Captures tool results that contain memorable content

import { appendFileSync } from 'node:fs';
import {
  shouldCapture,
  stripPrivate,
  ensureMemoryDir,
  PENDING_CAPTURES_PATH,
  type PendingCapture,
} from './index.js';

interface ToolUseInput {
  tool_name: string;
  tool_input?: Record<string, unknown>;
  tool_result?: string;
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

    const data: ToolUseInput = JSON.parse(input);

    // Skip if no tool result
    if (!data.tool_result) {
      process.exit(0);
    }

    const result = String(data.tool_result);

    // Check if result contains capturable content
    if (!shouldCapture(result)) {
      process.exit(0);
    }

    // Strip private content
    const cleanResult = stripPrivate(result);

    // Create pending capture
    const capture: PendingCapture = {
      timestamp: new Date().toISOString(),
      source: 'tool_result',
      content: cleanResult.substring(0, 2000),
      context: `Tool: ${data.tool_name}`,
    };

    // Ensure directory exists and append to pending captures
    ensureMemoryDir();
    appendFileSync(PENDING_CAPTURES_PATH, JSON.stringify(capture) + '\n', 'utf8');

    // Log to stderr (visible in hook output but doesn't affect tool flow)
    console.error(`[auto-capture] Captured content from ${data.tool_name}`);
  } catch (err) {
    // Fail silently to not block the tool
    console.error(`[auto-capture] Error: ${err instanceof Error ? err.message : String(err)}`);
  }

  process.exit(0);
}

main();
