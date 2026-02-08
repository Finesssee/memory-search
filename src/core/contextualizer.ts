// Contextual Retrieval - generates LLM context prefixes for chunks at index time
// Multi-model round-robin to distribute load across rate limit pools

import { createHash } from 'node:crypto';
import { fetchWithRetry } from '../utils/network.js';
import type { Config, ContextLlmSlot } from '../types.js';
import type { MemoryDB } from '../storage/db.js';

interface ChatResponse {
  response?: string;
  choices?: { message: { content: string } }[];
}

const DEFAULT_BATCH_SIZE = 100;

// Global progress tracking
let globalDone = 0;
let globalTotal = 0;
let lastProgressLog = 0;

function logProgress(slotModel: string, batchChunks: number) {
  globalDone += batchChunks;
  const now = Date.now();
  if (now - lastProgressLog > 5000) { // log every 5s
    const pct = globalTotal > 0 ? ((globalDone / globalTotal) * 100).toFixed(1) : '?';
    process.stderr.write(`\r[ctx] ${globalDone}/${globalTotal} (${pct}%) last: ${slotModel}   `);
    lastProgressLog = now;
  }
}

function computeCacheKey(docContent: string, chunkContent: string): string {
  return createHash('sha256')
    .update(docContent)
    .update('\0')
    .update(chunkContent)
    .digest('hex');
}

function truncateDocument(doc: string, maxTokens: number): string {
  const estimatedTokens = Math.ceil(doc.length / 4);
  if (estimatedTokens <= maxTokens) return doc;

  const maxChars = maxTokens * 4;
  const head = doc.slice(0, Math.floor(maxChars * 0.7));
  const tail = doc.slice(-Math.floor(maxChars * 0.25));
  return head + '\n...\n' + tail;
}

function buildSlots(config: Config): ContextLlmSlot[] {
  if (config.contextLlmEndpoints && config.contextLlmEndpoints.length > 0) {
    return config.contextLlmEndpoints;
  }
  const endpoint = config.contextLlmEndpoint
    ? config.contextLlmEndpoint.replace(/\/$/, '')
    : config.embeddingEndpoint.replace(/\/$/, '') + '/chat';
  return [{
    endpoint,
    model: config.contextLlmModel ?? '',
    apiKey: config.contextLlmApiKey ?? '',
    parallelism: config.contextParallelism ?? 8,
  }];
}

async function generateContextBatch(
  docContent: string,
  chunkContents: string[],
  slot: ContextLlmSlot,
  maxDocTokens: number
): Promise<string[]> {
  const truncatedDoc = truncateDocument(docContent, maxDocTokens);

  const chunksBlock = chunkContents
    .map((c, i) => `<chunk index="${i}">\n${c}\n</chunk>`)
    .join('\n');

  const prompt = `<document>
${truncatedDoc}
</document>

Here are ${chunkContents.length} chunks from this document. For each chunk, give a short succinct context (1-2 sentences) to situate it within the overall document for improving search retrieval.

${chunksBlock}

Respond with a JSON array of strings, one context per chunk, in order. Example: ["context for chunk 0", "context for chunk 1", ...]
Respond ONLY with the JSON array, no other text.`;

  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (slot.apiKey) {
      headers['Authorization'] = `Bearer ${slot.apiKey}`;
    }
    const body = JSON.stringify({
      model: slot.model,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 4096,
    });

    const response = await fetchWithRetry(slot.endpoint, {
      method: 'POST',
      headers,
      body,
    }, { timeoutMs: 120000, retries: 2 });

    if (!response.ok) return chunkContents.map(() => '');

    const data = (await response.json()) as ChatResponse;
    const text = (data.choices?.[0]?.message?.content ?? data.response)?.trim();

    if (!text) return chunkContents.map(() => '');

    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return chunkContents.map(() => '');

    const parsed = JSON.parse(jsonMatch[0]) as string[];
    if (!Array.isArray(parsed)) return chunkContents.map(() => '');

    return chunkContents.map((_, i) => {
      const ctx = parsed[i];
      if (!ctx || typeof ctx !== 'string' || ctx.length < 10 || ctx.length > 500) return '';
      return ctx.trim();
    });
  } catch {
    return chunkContents.map(() => '');
  }
}

/**
 * Process a queue of work items for a single slot with its own concurrency limit.
 */
async function processSlotQueue(
  slotIdx: number,
  slot: ContextLlmSlot,
  queue: { docContent: string; batch: { index: number; content: string; cacheKey: string }[] }[],
  results: string[],
  db: MemoryDB,
  maxDocTokens: number
): Promise<void> {
  const maxParallel = slot.parallelism ?? 3;
  let running = 0;
  let queueIdx = 0;
  const waiters: (() => void)[] = [];

  async function processOne(item: typeof queue[0]) {
    const contexts = await generateContextBatch(
      item.docContent,
      item.batch.map(b => b.content),
      slot,
      maxDocTokens
    );

    for (let j = 0; j < item.batch.length; j++) {
      const ctx = contexts[j] ?? '';
      results[item.batch[j].index] = ctx;
      db.setCachedContext(item.batch[j].cacheKey, ctx);
    }

    logProgress(slot.model, item.batch.length);
  }

  const tasks: Promise<void>[] = [];
  for (const item of queue) {
    if (running >= maxParallel) {
      await new Promise<void>(r => waiters.push(r));
    }
    running++;
    tasks.push(
      processOne(item).finally(() => {
        running--;
        const w = waiters.shift();
        if (w) w();
      })
    );
  }
  await Promise.all(tasks);
}

/**
 * Generate context prefixes for all chunks of a document.
 * Uses multi-model round-robin to distribute LLM calls across providers.
 * Results are cached in SQLite to avoid redundant LLM calls.
 */
export async function contextualizeFileChunks(
  documentContent: string,
  chunks: { content: string }[],
  db: MemoryDB,
  config: Config
): Promise<string[]> {
  const slots = buildSlots(config);
  const maxDocTokens = config.contextMaxDocTokens ?? 6000;
  const results: string[] = new Array(chunks.length).fill('');

  // Check cache for all chunks
  const uncached: { index: number; content: string; cacheKey: string }[] = [];
  for (let i = 0; i < chunks.length; i++) {
    const cacheKey = computeCacheKey(documentContent, chunks[i].content);
    const cached = db.getCachedContext(cacheKey);
    if (cached !== null) {
      results[i] = cached;
    } else {
      uncached.push({ index: i, content: chunks[i].content, cacheKey });
    }
  }

  if (uncached.length === 0) return results;

  // Update global progress tracker
  globalTotal += uncached.length;

  // Create per-slot work queues with per-slot batch sizes
  const slotQueues: { docContent: string; batch: typeof uncached }[][] = slots.map(() => []);

  // Round-robin assign uncached chunks to slots, batching per-slot
  const slotBatchSizes = slots.map(s => s.batchSize ?? DEFAULT_BATCH_SIZE);
  const slotBuffers: typeof uncached[] = slots.map(() => []);

  let nextSlot = 0;
  for (const item of uncached) {
    slotBuffers[nextSlot].push(item);
    if (slotBuffers[nextSlot].length >= slotBatchSizes[nextSlot]) {
      slotQueues[nextSlot].push({
        docContent: documentContent,
        batch: slotBuffers[nextSlot],
      });
      slotBuffers[nextSlot] = [];
    }
    nextSlot = (nextSlot + 1) % slots.length;
  }

  // Flush remaining buffers
  for (let i = 0; i < slots.length; i++) {
    if (slotBuffers[i].length > 0) {
      slotQueues[i].push({
        docContent: documentContent,
        batch: slotBuffers[i],
      });
    }
  }

  // Process all slot queues in parallel
  await Promise.all(
    slots.map((slot, i) =>
      processSlotQueue(i, slot, slotQueues[i], results, db, maxDocTokens)
    )
  );

  return results;
}
