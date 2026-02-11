// Markdown-aware chunking with overlap and metadata support

import { basename } from 'node:path';

export interface Chunk {
  content: string;
  lineStart: number;
  lineEnd: number;
  header?: string;
  headings?: string[];
}

export interface ChunkOptions {
  maxTokens?: number;
  overlapTokens?: number;
  filePath?: string; // For metadata injection
  tokenizer?: (text: string) => number;
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

  // Strip inline base64 data URIs before chunking — they bloat chunks
  // without adding search value (e.g., CoSidian conversation exports with embedded images)
  content = content.replace(/data:[a-zA-Z]+\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=\s]+/g, '[image]');

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

  const estimateTokens = options.tokenizer ?? ((text: string): number => text.length / 3);

  const extractHeadings = (headerLine: string, bodyText: string): string[] => {
    const headings: string[] = [];
    const addHeading = (text: string) => {
      const clean = text.replace(/^#+\s*/, '').trim();
      if (clean.length === 0) return;
      if (!headings.includes(clean)) headings.push(clean);
    };

    if (headerLine) {
      addHeading(headerLine);
    }

    const lines = bodyText.split('\n');
    for (const line of lines) {
      if (/^#{1,6}\s+/.test(line)) {
        addHeading(line);
      }
    }

    return headings;
  };

  const flushChunk = (endLine: number, keepOverlap = true) => {
    if (currentChunk.length > 0) {
      const text = currentChunk.join('\n').trim();
      if (text.length > 50) {
        // Minimum 50 chars
        let finalContent = currentHeader ? `${currentHeader}\n\n${text}` : text;
        const headings = extractHeadings(currentHeader, text);

        // Add metadata prefix
        if (metadataPrefix) {
          finalContent = metadataPrefix + finalContent;
        }

        chunks.push({
          content: finalContent,
          lineStart: chunkStartLine,
          lineEnd: endLine,
          header: currentHeader || undefined,
          headings: headings.length > 0 ? headings : undefined,
        });
        // }
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
