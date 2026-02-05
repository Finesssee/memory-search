// Markdown-aware chunking with overlap and metadata support

import { basename } from 'node:path';

export interface Chunk {
  content: string;
  lineStart: number;
  lineEnd: number;
  header?: string;
}

export interface ChunkOptions {
  maxTokens?: number;
  overlapTokens?: number;
  filePath?: string; // For metadata injection
}

/**
 * Extract date from session filename (e.g., session-2026-02-04T101945.md)
 */
function extractSessionDate(filePath: string): string | null {
  const filename = basename(filePath);
  const match = filename.match(/session-(\d{4}-\d{2}-\d{2})/);
  if (match) {
    return match[1]; // Returns "2026-02-04"
  }
  return null;
}

/**
 * Build metadata prefix for a chunk
 */
function buildMetadataPrefix(filePath: string): string {
  const parts: string[] = [];

  const date = extractSessionDate(filePath);
  if (date) {
    parts.push(`[Date: ${date}]`);
  }

  const filename = basename(filePath, '.md');
  parts.push(`[Source: ${filename}]`);

  if (parts.length > 0) {
    return parts.join(' ') + '\n\n';
  }
  return '';
}

export function chunkMarkdown(content: string, options: ChunkOptions | number = {}): Chunk[] {
  // Support legacy signature: chunkMarkdown(content, maxTokens)
  if (typeof options === 'number') {
    options = { maxTokens: options };
  }

  const maxTokens = options.maxTokens ?? 1000;
  const overlapTokens = options.overlapTokens ?? 150;
  const filePath = options.filePath;

  const lines = content.split('\n');
  const chunks: Chunk[] = [];

  // Build metadata prefix if we have a file path
  const metadataPrefix = filePath ? buildMetadataPrefix(filePath) : '';

  let currentChunk: string[] = [];
  let currentHeader = '';
  let chunkStartLine = 1;
  let overlapBuffer: string[] = []; // Store lines for overlap

  const estimateTokens = (text: string): number => {
    // Conservative: ~3 chars per token
    return text.length / 3;
  };

  const flushChunk = (endLine: number, keepOverlap = true) => {
    if (currentChunk.length > 0) {
      const text = currentChunk.join('\n').trim();
      if (text.length > 50) {
        // Minimum 50 chars
        let finalContent = currentHeader ? `${currentHeader}\n\n${text}` : text;

        // Add metadata prefix
        if (metadataPrefix) {
          finalContent = metadataPrefix + finalContent;
        }

        chunks.push({
          content: finalContent,
          lineStart: chunkStartLine,
          lineEnd: endLine,
          header: currentHeader || undefined,
        });
      }

      // Keep overlap for next chunk
      if (keepOverlap && overlapTokens > 0) {
        overlapBuffer = [];
        let overlapSize = 0;
        // Take lines from the end of current chunk for overlap
        for (let i = currentChunk.length - 1; i >= 0 && overlapSize < overlapTokens; i--) {
          const line = currentChunk[i];
          overlapSize += estimateTokens(line);
          overlapBuffer.unshift(line);
        }
      }
    }

    // Start new chunk with overlap
    currentChunk = [...overlapBuffer];
    chunkStartLine = endLine + 1 - overlapBuffer.length;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    // Check for header (## or ###) - flush on major sections
    if (/^#{1,3}\s/.test(line)) {
      flushChunk(lineNum - 1);
      currentHeader = line;
      chunkStartLine = lineNum;
      overlapBuffer = []; // Don't overlap across headers
    }

    currentChunk.push(line);

    // Check if we've exceeded max tokens
    const estimatedTokens = estimateTokens(currentChunk.join('\n'));
    if (estimatedTokens > maxTokens) {
      flushChunk(lineNum);
    }
  }

  // Flush remaining (no overlap needed for last chunk)
  flushChunk(lines.length, false);

  return chunks;
}
