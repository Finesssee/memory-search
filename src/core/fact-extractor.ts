// Automatic fact extraction from captured content

import type { Config } from '../types.js';
import { fetchWithRetry } from '../utils/network.js';
import { getChatEndpoint } from '../utils/api-endpoints.js';

export interface ExtractedFact {
  key: string;
  value: string;
}

interface FactPattern {
  regex: RegExp;
  keyIndex: number;
  valueIndex: number;
}

// Pattern-based extraction for common fact patterns
const FACT_PATTERNS: FactPattern[] = [
  // "my X is Y" patterns
  { regex: /my (\w+) is ([^.,!?\n]+)/gi, keyIndex: 1, valueIndex: 2 },
  // "i use X dpi/edpi/sens" patterns
  { regex: /i use (\d+(?:\.\d+)?)\s*(dpi|edpi|sens)/gi, keyIndex: 2, valueIndex: 1 },
  // "my main/primary is X" patterns
  { regex: /my (?:main|primary) (?:is )?(\w+)/gi, keyIndex: 0, valueIndex: 1 },
  // "my X: Y" patterns
  { regex: /my (\w+):\s*([^.,!?\n]+)/gi, keyIndex: 1, valueIndex: 2 },
  // "i prefer X" patterns
  { regex: /i prefer (\w+(?:\s+\w+)?)/gi, keyIndex: 0, valueIndex: 1 },
  // "my sens is X.XXX" specifically for sensitivity
  { regex: /my sens(?:itivity)? is (\d+(?:\.\d+)?)/gi, keyIndex: 0, valueIndex: 1 },
  // "crosshair X" patterns
  { regex: /(?:my )?crosshair[:\s]+([^.,!?\n]+)/gi, keyIndex: 0, valueIndex: 1 },
  // "resolution X" patterns
  { regex: /(?:my )?resolution[:\s]+(\d+x\d+)/gi, keyIndex: 0, valueIndex: 1 },
];

// Keywords to detect game/app context
const CONTEXT_KEYWORDS: Record<string, string[]> = {
  valorant: ['valorant', 'valo', 'vandal', 'phantom', 'agent', 'radiant'],
  osu: ['osu', 'osu!', 'beatmap', 'pp', 'accuracy'],
  csgo: ['csgo', 'cs2', 'counter-strike', 'awp', 'ak-47'],
  apex: ['apex', 'apex legends', 'legend', 'bloodhound'],
  overwatch: ['overwatch', 'ow2', 'mercy', 'genji'],
};

/**
 * Detect namespace context from content and explicit context
 */
function detectNamespace(content: string, context: string): string {
  const combined = `${content} ${context}`.toLowerCase();

  for (const [namespace, keywords] of Object.entries(CONTEXT_KEYWORDS)) {
    for (const keyword of keywords) {
      if (combined.includes(keyword)) {
        return `${namespace}.`;
      }
    }
  }

  return 'general.';
}

/**
 * Normalize a key name for consistency
 */
function normalizeKey(key: string): string {
  return key
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '');
}

/**
 * Normalize a value for consistency
 */
function normalizeValue(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

/**
 * Extract facts from content using pattern matching
 */
function extractWithPatterns(content: string, namespace: string): ExtractedFact[] {
  const facts: ExtractedFact[] = [];
  const seen = new Set<string>();

  for (const pattern of FACT_PATTERNS) {
    // Reset regex state for global patterns
    pattern.regex.lastIndex = 0;

    let match: RegExpExecArray | null;
    while ((match = pattern.regex.exec(content)) !== null) {
      let key: string;
      let value: string;

      if (pattern.keyIndex === 0) {
        // Key is derived from the pattern type itself
        const patternStr = pattern.regex.source;
        if (patternStr.includes('sens')) {
          key = 'sens';
        } else if (patternStr.includes('crosshair')) {
          key = 'crosshair';
        } else if (patternStr.includes('resolution')) {
          key = 'resolution';
        } else if (patternStr.includes('prefer')) {
          key = 'preference';
        } else if (patternStr.includes('main')) {
          key = 'main';
        } else {
          key = match[pattern.keyIndex] || 'unknown';
        }
        value = match[pattern.valueIndex];
      } else {
        key = match[pattern.keyIndex];
        value = match[pattern.valueIndex];
      }

      const normalizedKey = namespace + normalizeKey(key);
      const normalizedValue = normalizeValue(value);

      // Skip duplicates and empty values
      if (!normalizedValue || seen.has(normalizedKey)) {
        continue;
      }

      seen.add(normalizedKey);
      facts.push({
        key: normalizedKey,
        value: normalizedValue,
      });
    }
  }

  return facts;
}

/**
 * Optional LLM-based extraction for complex cases
 * Calls the /chat endpoint with a structured prompt
 */
async function extractWithLLM(
  content: string,
  namespace: string,
  config: Config
): Promise<ExtractedFact[]> {
  const chatEndpoint = getChatEndpoint(config.embeddingEndpoint);

  const prompt = `Extract factual key-value pairs from this text. Focus on personal preferences, settings, and configurations.
Return a JSON array of objects with "key" and "value" fields. Only include clear, factual statements.
If no facts found, return [].

Text: "${content.substring(0, 500)}"

Response (JSON array only):`;

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
      return [];
    }

    const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const text = data.choices?.[0]?.message?.content || '';

    // Try to parse JSON from the response
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      return [];
    }

    const parsed = JSON.parse(jsonMatch[0]) as Array<{ key?: string; value?: string }>;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .filter((item) => item.key && item.value)
      .map((item) => ({
        key: namespace + normalizeKey(item.key!),
        value: normalizeValue(item.value!),
      }));
  } catch {
    // LLM extraction failed, return empty
    return [];
  }
}

/**
 * Extract facts from content using pattern matching and optional LLM fallback
 *
 * @param content - The text content to extract facts from
 * @param context - Context string (e.g., filename, keywords) to help determine namespace
 * @param config - Application config
 * @param useLLM - Whether to use LLM fallback for complex cases (default: false)
 */
export async function extractFacts(
  content: string,
  context: string,
  config: Config,
  useLLM = false
): Promise<ExtractedFact[]> {
  if (!content || content.length < 5) {
    return [];
  }

  // Detect namespace from context and content
  const namespace = detectNamespace(content, context);

  // First try pattern-based extraction
  const patternFacts = extractWithPatterns(content, namespace);

  // If no facts found and LLM is enabled, try LLM extraction
  if (patternFacts.length === 0 && useLLM) {
    return extractWithLLM(content, namespace, config);
  }

  return patternFacts;
}
