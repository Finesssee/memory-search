import { describe, it, expect } from 'vitest';
import { createTokenCounter } from './token-estimator.js';
import { chunkMarkdown } from '../core/chunker.js';

describe('createTokenCounter', () => {
  it('returns null when local LLM is not available', async () => {
    const counter = await createTokenCounter();
    expect(counter).toBeNull();
  });
});

describe('chunker with custom tokenizer', () => {
  it('uses provided tokenizer function', () => {
    // Custom tokenizer that counts words instead of chars/3
    const wordTokenizer = (text: string): number => text.split(/\s+/).filter(Boolean).length;

    const content = 'word '.repeat(100).trim(); // 100 words
    const result = chunkMarkdown(content, { maxTokens: 20, tokenizer: wordTokenizer });

    // With 100 words and maxTokens=20, should produce multiple chunks
    expect(result.length).toBeGreaterThan(1);
  });

  it('falls back to heuristic when no tokenizer provided', () => {
    const content = 'A'.repeat(6000); // 6000 chars = ~2000 tokens at chars/3
    const result = chunkMarkdown(content, { maxTokens: 1000 });

    // Should split since 6000 chars / 3 = 2000 tokens > 1000 maxTokens
    expect(result.length).toBeGreaterThan(1);
  });

  it('produces different chunk boundaries with different tokenizers', () => {
    const content = 'short words here\n'.repeat(200);

    // Heuristic: chars/3
    const heuristicResult = chunkMarkdown(content, { maxTokens: 50 });

    // Custom: counts actual words (more generous, fewer chunks)
    const wordTokenizer = (text: string): number => text.split(/\s+/).filter(Boolean).length;
    const customResult = chunkMarkdown(content, { maxTokens: 50, tokenizer: wordTokenizer });

    // They should produce different numbers of chunks
    expect(heuristicResult.length).not.toBe(customResult.length);
  });
});
