#!/usr/bin/env node
// Session End Hook
// Processes pending captures and indexes them into memory-search DB

import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { homedir } from 'node:os';
import {
  findLatestSessionFile,
  parseSessionFile,
  extractCapturableContent,
  ensureMemoryDir,
  shouldCaptureLLM,
  getMessageContent,
  stripPrivate,
  PENDING_CAPTURES_PATH,
  type PendingCapture,
} from './index.js';
import { loadConfig } from '../utils/config.js';
import { MemoryDB } from '../storage/db.js';
import { FactsDB } from '../storage/facts.js';
import { chunkMarkdown } from '../core/chunker.js';
import { getEmbeddingsParallel } from '../core/embeddings.js';
import { hashContent } from '../utils/hash.js';
import { extractFacts } from '../core/fact-extractor.js';
import type { Config, Observation, LLMCaptureDecision } from '../types.js';

const MEMORY_DIR = join(homedir(), '.memory-search', 'auto-captures');

// Extended capture with observation metadata
interface EnhancedCapture extends PendingCapture {
  observation?: Observation;
}

function getTimestamp(): string {
  const now = new Date();
  const iso = now.toISOString();
  return iso.slice(0, 10) + 'T' + iso.slice(11, 19).replace(/:/g, '');
}

function loadPendingCaptures(): PendingCapture[] {
  if (!existsSync(PENDING_CAPTURES_PATH)) {
    return [];
  }

  const content = readFileSync(PENDING_CAPTURES_PATH, 'utf8');
  const lines = content.trim().split('\n').filter(Boolean);
  const captures: PendingCapture[] = [];

  for (const line of lines) {
    try {
      captures.push(JSON.parse(line));
    } catch {
      // Skip malformed lines
    }
  }

  return captures;
}

function clearPendingCaptures(): void {
  if (existsSync(PENDING_CAPTURES_PATH)) {
    unlinkSync(PENDING_CAPTURES_PATH);
  }
}

function generateMarkdownFromCaptures(captures: EnhancedCapture[]): string {
  const timestamp = getTimestamp();
  let md = `# Auto-Captured Insights - ${timestamp}\n\n`;
  md += `#auto-capture #memory\n\n`;
  md += `> Automatically captured from Claude session\n\n`;

  // Group by source
  const toolCaptures = captures.filter((c) => c.source === 'tool_result');
  const sessionCaptures = captures.filter((c) => c.source === 'session');

  if (sessionCaptures.length > 0) {
    md += `## Session Insights\n\n`;
    for (const capture of sessionCaptures) {
      md += `### ${new Date(capture.timestamp).toLocaleTimeString()}`;
      if (capture.observation?.type) {
        md += ` [${capture.observation.type}]`;
      }
      md += `\n`;
      if (capture.context) {
        md += `> Context: ${capture.context.substring(0, 150)}...\n\n`;
      }
      if (capture.observation?.concepts?.length) {
        md += `**Concepts:** ${capture.observation.concepts.join(', ')}\n\n`;
      }
      md += `${capture.content}\n\n`;
    }
  }

  if (toolCaptures.length > 0) {
    md += `## Tool Outputs\n\n`;
    for (const capture of toolCaptures) {
      md += `### ${capture.context || 'Tool Result'}\n`;
      md += `${capture.content}\n\n`;
    }
  }

  md += `---\n*Auto-captured by memory-search hooks*\n`;

  return md;
}

/**
 * Extract capturable content from session messages using LLM-based filtering
 */
async function extractCapturableContentLLM(
  messages: Array<{ type: string; message?: { role?: string; content?: string | Array<{ type: string; text?: string }> }; timestamp?: string }>,
  config: Config
): Promise<EnhancedCapture[]> {
  const captures: EnhancedCapture[] = [];
  const now = new Date().toISOString();

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (msg.type !== 'human' && msg.type !== 'assistant') continue;

    const content = getMessageContent(msg);
    if (!content || content.length < 20) continue;

    // Get context from surrounding messages
    const prevContent = i > 0 ? getMessageContent(messages[i - 1]) : '';
    const context = prevContent.substring(0, 200);

    // Use LLM to decide if content should be captured
    const decision = await shouldCaptureLLM(content, context, config);

    if (!decision.capture) {
      continue;
    }

    console.error(`[auto-capture] LLM approved: ${decision.reason}`);

    // Strip private content
    const cleanContent = stripPrivate(content);

    captures.push({
      timestamp: msg.timestamp || now,
      source: 'session',
      content: cleanContent.substring(0, 1000),
      context: context || undefined,
      observation: decision.observation,
    });
  }

  return captures;
}

async function indexCaptures(captures: EnhancedCapture[], sessionId?: string): Promise<number> {
  if (captures.length === 0) return 0;

  const config = loadConfig();
  const db = new MemoryDB(config);

  try {
    // Generate markdown content
    const timestamp = getTimestamp();
    const mdContent = generateMarkdownFromCaptures(captures);

    // Save to auto-captures directory
    mkdirSync(MEMORY_DIR, { recursive: true });
    const filename = `capture-${timestamp}.md`;
    const filePath = join(MEMORY_DIR, filename);
    writeFileSync(filePath, mdContent, 'utf8');

    // Index into the database
    const mtime = Date.now();
    const contentHash = hashContent(mdContent);

    // Check if already indexed
    const existing = db.getFile(filePath);
    if (existing && existing.contentHash === contentHash) {
      console.error(`[auto-capture] Already indexed: ${filename}`);
      return 0;
    }

    // Chunk the content
    const chunks = chunkMarkdown(mdContent, {
      maxTokens: config.chunkMaxTokens,
      overlapTokens: config.chunkOverlapTokens,
      filePath,
    });

    if (chunks.length === 0) {
      console.error(`[auto-capture] No chunks generated`);
      return 0;
    }

    // Get embeddings
    let textsForEmbedding = chunks.map((c) => c.content);
    console.error(`[auto-capture] Embedding ${textsForEmbedding.length} chunks...`);

    const embeddings = await getEmbeddingsParallel(textsForEmbedding, config);

    // Store in database - use first capture's observation for all chunks (simplified)
    const fileId = db.upsertFile(filePath, mtime, contentHash);
    db.deleteChunksForFile(fileId);

    // Collect all observations from captures for metadata
    const combinedObservation: Observation | undefined = captures.find((c) => c.observation)?.observation;

    // Insert all chunks in a single transaction for better performance
    db.withTransaction(() => {
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        db.insertChunk(
          fileId,
          i,
          chunk.content,
          chunk.lineStart,
          chunk.lineEnd,
          embeddings[i],
          combinedObservation,
          sessionId,
          { filePath, headings: chunk.headings }
        );

        // Increment session capture count for each chunk
        if (sessionId) {
          db.incrementSessionCaptureCount(sessionId);
        }
      }
    });

    console.error(`[auto-capture] Indexed ${chunks.length} chunks from ${filename}`);
    return chunks.length;
  } finally {
    db.close();
  }
}

async function main(): Promise<void> {
  console.error('[auto-capture] Session end hook starting...');

  try {
    ensureMemoryDir();
    const config = loadConfig();

    // Load pending captures from tool hooks (convert to EnhancedCapture)
    const pendingCaptures: EnhancedCapture[] = loadPendingCaptures().map((c) => ({ ...c }));
    console.error(`[auto-capture] Found ${pendingCaptures.length} pending captures`);

    // Also extract from session history using LLM-based filtering
    const sessionPath = findLatestSessionFile();
    let sessionId: string | undefined;
    let projectPath = '';

    if (sessionPath) {
      console.error(`[auto-capture] Processing session: ${sessionPath}`);

      // Extract session ID from the session file path (filename without extension)
      sessionId = basename(sessionPath, '.jsonl');
      // Extract project path from the session path (parent directory name)
      projectPath = dirname(sessionPath);

      // Create/update session record
      const db = new MemoryDB(config);
      db.upsertSession(sessionId, projectPath);
      db.close();

      const messages = parseSessionFile(sessionPath);

      // Use LLM-based extraction for better filtering
      console.error(`[auto-capture] Using LLM filter for ${messages.length} messages...`);
      const sessionCaptures = await extractCapturableContentLLM(messages, config);
      console.error(`[auto-capture] LLM approved ${sessionCaptures.length} insights from session`);
      pendingCaptures.push(...sessionCaptures);
    }

    // Deduplicate by content hash
    const seen = new Set<string>();
    const uniqueCaptures = pendingCaptures.filter((c) => {
      const key = hashContent(c.content);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    console.error(`[auto-capture] ${uniqueCaptures.length} unique captures to index`);

    if (uniqueCaptures.length > 0) {
      const indexed = await indexCaptures(uniqueCaptures, sessionId);
      console.error(`[auto-capture] Indexed ${indexed} chunks`);

      // Extract facts from captures and store in FactsDB
      const factsDB = new FactsDB(config);
      let factCount = 0;

      try {
        for (const capture of uniqueCaptures) {
          const context = capture.context || '';
          const facts = await extractFacts(capture.content, context, config);

          for (const fact of facts) {
            factsDB.set(fact.key, fact.value);
            console.error(`[auto-capture] Extracted fact: ${fact.key} = ${fact.value}`);
            factCount++;
          }
        }

        if (factCount > 0) {
          console.error(`[auto-capture] Stored ${factCount} facts`);
        }
      } finally {
        factsDB.close();
      }
    }

    // Clear pending captures
    clearPendingCaptures();
    console.error('[auto-capture] Session end hook complete');
  } catch (err) {
    console.error(`[auto-capture] Error: ${err instanceof Error ? err.message : String(err)}`);
  }

  process.exit(0);
}

main();
