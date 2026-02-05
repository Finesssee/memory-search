// Timeline assembly for context injection

import type { SearchResult, Fact } from '../types.js';

export interface TimelineEntry {
  timestamp: number;
  type: 'observation' | 'fact';
  content: string;
  source?: string;
  observationType?: string;
  concepts?: string[];
}

/**
 * Assemble search results and facts into chronological timeline
 */
export function assembleTimeline(
  searchResults: SearchResult[],
  facts: Fact[]
): TimelineEntry[] {
  const entries: TimelineEntry[] = [];

  // Add search results as observations
  for (const result of searchResults) {
    entries.push({
      timestamp: Date.now(), // Use file mtime if available
      type: 'observation',
      content: result.snippet,
      source: result.file,
    });
  }

  // Add facts
  for (const fact of facts) {
    entries.push({
      timestamp: fact.updatedAt,
      type: 'fact',
      content: `${fact.key} = ${fact.value}`,
    });
  }

  // Sort chronologically (newest first)
  entries.sort((a, b) => b.timestamp - a.timestamp);
  return entries;
}

/**
 * Format timeline as context block for injection
 */
export function formatTimelineAsContext(entries: TimelineEntry[], maxTokens = 2000): string {
  let context = '## Relevant Memories\n\n';
  let tokenEstimate = 0;

  for (const entry of entries) {
    const date = new Date(entry.timestamp).toLocaleDateString();
    const line = entry.type === 'fact'
      ? `- **Fact**: ${entry.content}\n`
      : `- **[${date}]** ${entry.content.substring(0, 200)}...\n`;

    tokenEstimate += line.length / 4;
    if (tokenEstimate > maxTokens) break;

    context += line;
  }

  return context;
}
