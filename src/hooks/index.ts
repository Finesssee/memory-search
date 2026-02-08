// Auto-Capture Hooks - Shared utilities
// Detects patterns worth remembering and processes session data

import { readdirSync, readFileSync, statSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { Config, LLMCaptureDecision, Observation, ObservationType } from '../types.js';
import { detectMode, shouldSkipForMode } from '../modes/index.js';
import { fetchWithRetry } from '../utils/network.js';
import { getChatEndpoint } from '../utils/api-endpoints.js';

// Directory constants
export const CLAUDE_PROJECTS_DIR = join(homedir(), '.claude', 'projects');
export const PENDING_CAPTURES_PATH = join(homedir(), '.memory-search', 'pending-captures.jsonl');

// Patterns that indicate content worth capturing (tightened to reduce false positives)
export const CAPTURE_TRIGGERS = /\b(i (?:prefer|decided|learned|realized|discovered|always|never)|my [\w]+ is|note to self|takeaway|key (?:point|insight|takeaway)|rule of thumb|found that|turns out|setting:|configured? to)\b/i;

// Privacy tags - content within these should not be captured
export const PRIVACY_TAGS = [
  /<private>[\s\S]*?<\/private>/gi,
  /<secret>[\s\S]*?<\/secret>/gi,
  /<sensitive>[\s\S]*?<\/sensitive>/gi,
  /<redact>[\s\S]*?<\/redact>/gi,
];

export interface SessionMessage {
  type: string;
  message?: {
    role?: string;
    content?: string | Array<{ type: string; text?: string }>;
  };
  timestamp?: string;
}

export interface PendingCapture {
  timestamp: string;
  source: 'tool_result' | 'session';
  content: string;
  context?: string;
}

/**
 * Find the most recently modified .jsonl session file
 */
export function findLatestSessionFile(): string | null {
  const files: { path: string; mtime: number }[] = [];

  function walkDir(dir: string): void {
    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
          walkDir(fullPath);
        } else if (entry.name.endsWith('.jsonl')) {
          const stat = statSync(fullPath);
          files.push({ path: fullPath, mtime: stat.mtimeMs });
        }
      }
    } catch {
      // Ignore permission errors
    }
  }

  if (!existsSync(CLAUDE_PROJECTS_DIR)) {
    return null;
  }

  walkDir(CLAUDE_PROJECTS_DIR);

  if (files.length === 0) return null;

  // Sort by modification time, most recent first
  files.sort((a, b) => b.mtime - a.mtime);
  return files[0].path;
}

/**
 * Parse a JSONL session file into message objects
 */
export function parseSessionFile(filePath: string): SessionMessage[] {
  const content = readFileSync(filePath, 'utf8');
  const lines = content.trim().split('\n').filter(Boolean);

  const messages: SessionMessage[] = [];
  for (const line of lines) {
    try {
      const obj = JSON.parse(line);
      messages.push(obj);
    } catch {
      // Skip malformed lines
    }
  }

  return messages;
}

/**
 * Extract text content from a message object
 */
export function getMessageContent(msg: SessionMessage): string {
  if (typeof msg.message?.content === 'string') {
    return msg.message.content;
  }
  if (Array.isArray(msg.message?.content)) {
    return msg.message.content
      .filter((c) => c.type === 'text')
      .map((c) => c.text || '')
      .join('\n');
  }
  return '';
}

/**
 * Check if content matches any capture triggers
 */
export function shouldCapture(content: string): boolean {
  if (!content || content.length < 30) return false;
  const mode = detectMode(content);
  if (shouldSkipForMode(content, mode)) return false;
  return CAPTURE_TRIGGERS.test(content);
}

/**
 * LLM-based capture filter - uses AI to decide if content should be saved
 * Falls back to regex shouldCapture on error
 */
export async function shouldCaptureLLM(
  content: string,
  context: string,
  config: Config
): Promise<LLMCaptureDecision> {
  if (!content || content.length < 10) {
    return { capture: false, reason: 'Content too short' };
  }

  const chatEndpoint = getChatEndpoint(config.embeddingEndpoint);
  const mode = detectMode(content);

  const prompt = `Decide if this content should be saved to long-term memory.
Focus: ${mode.recording_focus}

CAPTURE if it contains:
- Specific preferences, settings, or configurations
- Decisions with rationale
- Learned facts or insights
- Important outcomes or results

SKIP if it's:
- Routine status checks
- Repetitive listings
- Generic acknowledgments
- Temporary debug output

Context: ${context.substring(0, 200)}
Content: ${content.substring(0, 500)}

Respond with JSON only: {"capture": true/false, "reason": "brief explanation", "observation": {"type": "bugfix|feature|decision|preference|learning|config", "concepts": ["concept1", "concept2"], "files": ["file1.ts"]}}`;

  try {
    const response = await fetchWithRetry(chatEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 200,
        temperature: 0.1,
      }),
    });

    if (!response.ok) {
      // Fallback to regex
      return {
        capture: shouldCapture(content),
        reason: 'LLM unavailable, using regex fallback',
      };
    }

    const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const text = data.choices?.[0]?.message?.content || '';

    // Try to parse JSON from the response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return {
        capture: shouldCapture(content),
        reason: 'LLM response parse failed, using regex fallback',
      };
    }

    const parsed = JSON.parse(jsonMatch[0]) as {
      capture?: boolean;
      reason?: string;
      observation?: {
        type?: string;
        concepts?: string[];
        files?: string[];
      };
    };

    const result: LLMCaptureDecision = {
      capture: parsed.capture ?? false,
      reason: parsed.reason ?? 'No reason provided',
    };

    // Attach observation if capture is true and observation data exists
    if (result.capture && parsed.observation) {
      const validTypes: ObservationType[] = ['bugfix', 'feature', 'decision', 'preference', 'learning', 'config'];
      const obsType = parsed.observation.type as ObservationType;

      if (validTypes.includes(obsType)) {
        result.observation = {
          type: obsType,
          concepts: parsed.observation.concepts || [],
          files: parsed.observation.files || [],
        };
      }
    }

    return result;
  } catch {
    // LLM failed, fall back to regex
    return {
      capture: shouldCapture(content),
      reason: 'LLM error, using regex fallback',
    };
  }
}

/**
 * Remove content within privacy tags
 */
export function stripPrivate(content: string): string {
  let result = content;
  for (const pattern of PRIVACY_TAGS) {
    result = result.replace(pattern, '[REDACTED]');
  }
  return result;
}

/**
 * Ensure the memory-search directory exists
 */
export function ensureMemoryDir(): void {
  const dir = join(homedir(), '.memory-search');
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

/**
 * Extract capturable insights from session messages
 */
export function extractCapturableContent(messages: SessionMessage[]): PendingCapture[] {
  const captures: PendingCapture[] = [];
  const now = new Date().toISOString();

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (msg.type !== 'human' && msg.type !== 'assistant') continue;

    const content = getMessageContent(msg);
    if (!shouldCapture(content)) continue;

    // Get context from surrounding messages
    const prevContent = i > 0 ? getMessageContent(messages[i - 1]) : '';
    const context = prevContent.substring(0, 200);

    // Strip private content and extract relevant portions
    const cleanContent = stripPrivate(content);

    // Find sentences containing trigger words
    const sentences = cleanContent.split(/[.!?]+/).filter(Boolean);
    const relevantSentences = sentences.filter((s) => shouldCapture(s));

    if (relevantSentences.length > 0) {
      captures.push({
        timestamp: msg.timestamp || now,
        source: 'session',
        content: relevantSentences.join('. ').substring(0, 1000),
        context: context || undefined,
      });
    }
  }

  return captures;
}
