import { describe, it, expect } from 'vitest';
import {
  getBlendWeights,
  clamp01,
  isTrivialQuery,
  normalizeRerankerScore,
  parseRerankerWeights,
  blendNormalizedScores,
  minMaxNormalizeScores,
} from './reranker.js';

// --- getBlendWeights ---
describe('getBlendWeights', () => {
  it('returns high retrieval weight for top-3 ranks', () => {
    const w = getBlendWeights(1);
    expect(w.retrieval).toBe(0.95);
    expect(w.reranker).toBe(0.05);
  });

  it('returns moderate weights for ranks 4-10', () => {
    const w = getBlendWeights(5);
    expect(w.retrieval).toBe(0.90);
    expect(w.reranker).toBe(0.10);
  });

  it('returns lower retrieval weight for ranks beyond 10', () => {
    const w = getBlendWeights(15);
    expect(w.retrieval).toBe(0.80);
    expect(w.reranker).toBe(0.20);
  });
});

// --- clamp01 ---
describe('clamp01', () => {
  it('clamps negative values to 0', () => {
    expect(clamp01(-0.5)).toBe(0);
  });

  it('clamps values above 1 to 1', () => {
    expect(clamp01(1.5)).toBe(1);
  });

  it('passes through values in [0,1]', () => {
    expect(clamp01(0.5)).toBe(0.5);
  });

  it('returns 0 for non-finite values', () => {
    expect(clamp01(NaN)).toBe(0);
    expect(clamp01(Infinity)).toBe(0);
    expect(clamp01(-Infinity)).toBe(0);
  });
});

// --- isTrivialQuery ---
describe('isTrivialQuery', () => {
  it('returns true for empty string', () => {
    expect(isTrivialQuery('')).toBe(true);
  });

  it('returns true for very short queries', () => {
    expect(isTrivialQuery('ab')).toBe(true);
  });

  it('returns false for queries with 3+ chars', () => {
    expect(isTrivialQuery('abc')).toBe(false);
  });
});

// --- normalizeRerankerScore ---
describe('normalizeRerankerScore', () => {
  it('keeps already-normalized scores in [0,1]', () => {
    expect(normalizeRerankerScore(0.75)).toBeCloseTo(0.75, 5);
  });

  it('linearly scales cosine similarity [-1,1] to [0,1]', () => {
    // -1 -> 0, 0 -> 0.5, but 0 is already in [0,1] so handled there
    expect(normalizeRerankerScore(-0.5)).toBeCloseTo(0.25, 5);
    expect(normalizeRerankerScore(-1)).toBeCloseTo(0, 5);
  });

  it('applies sigmoid for logit values outside [-1,1]', () => {
    // sigmoid(0) = 0.5, sigmoid(5) ≈ 0.993
    const result = normalizeRerankerScore(5);
    expect(result).toBeGreaterThan(0.99);
    expect(result).toBeLessThanOrEqual(1);
  });

  it('returns 0 for NaN/Infinity', () => {
    expect(normalizeRerankerScore(NaN)).toBe(0);
    expect(normalizeRerankerScore(Infinity)).toBe(0);
  });
});

// --- parseRerankerWeights ---
describe('parseRerankerWeights', () => {
  it('returns defaults when input is undefined', () => {
    const w = parseRerankerWeights(undefined);
    expect(w.bge).toBeCloseTo(0.5, 5);
    expect(w.qwen).toBeCloseTo(0.3, 5);
    expect(w.gemma).toBeCloseTo(0.2, 5);
  });

  it('parses JSON object format', () => {
    const w = parseRerankerWeights('{"bge": 1, "qwen": 1, "gemma": 1}');
    // Should be normalized to 1/3 each
    expect(w.bge).toBeCloseTo(1 / 3, 5);
    expect(w.qwen).toBeCloseTo(1 / 3, 5);
    expect(w.gemma).toBeCloseTo(1 / 3, 5);
  });

  it('parses comma-separated key=value format', () => {
    const w = parseRerankerWeights('bge=0.6, qwen=0.3, gemma=0.1');
    expect(w.bge).toBeCloseTo(0.6, 5);
    expect(w.qwen).toBeCloseTo(0.3, 5);
    expect(w.gemma).toBeCloseTo(0.1, 5);
  });

  it('returns defaults for invalid JSON', () => {
    const w = parseRerankerWeights('{bad json');
    expect(w.bge).toBeCloseTo(0.5, 5);
  });

  it('returns defaults for empty string', () => {
    const w = parseRerankerWeights('');
    expect(w.bge).toBeCloseTo(0.5, 5);
  });
});

// --- blendNormalizedScores ---
describe('blendNormalizedScores', () => {
  const weights = { bge: 0.5, qwen: 0.3, gemma: 0.2 };

  it('blends all three model scores', () => {
    const scores = { bge: 0.8, qwen: 0.6, gemma: 0.4 };
    const result = blendNormalizedScores(scores, weights);
    expect(result).not.toBeNull();
    // (0.8*0.5 + 0.6*0.3 + 0.4*0.2) / (0.5+0.3+0.2) = (0.4+0.18+0.08)/1.0 = 0.66
    expect(result!).toBeCloseTo(0.66, 2);
  });

  it('handles partial scores (missing models)', () => {
    const scores = { bge: 0.9 };
    const result = blendNormalizedScores(scores, weights);
    expect(result).not.toBeNull();
    // Only bge present: (0.9 * 0.5) / 0.5 = 0.9
    expect(result!).toBeCloseTo(0.9, 2);
  });

  it('returns null when scores is undefined', () => {
    expect(blendNormalizedScores(undefined, weights)).toBeNull();
  });

  it('returns null when no valid scores', () => {
    const scores = { other: 'invalid' };
    expect(blendNormalizedScores(scores, weights)).toBeNull();
  });
});

// --- minMaxNormalizeScores ---
describe('minMaxNormalizeScores', () => {
  it('normalizes scores to [0,1] range', () => {
    const input = new Map<number, number>([
      [0, 10],
      [1, 20],
      [2, 30],
    ]);
    const result = minMaxNormalizeScores(input);
    expect(result.get(0)).toBeCloseTo(0, 5);
    expect(result.get(1)).toBeCloseTo(0.5, 5);
    expect(result.get(2)).toBeCloseTo(1, 5);
  });

  it('returns all 1s when all scores are equal', () => {
    const input = new Map<number, number>([
      [0, 5],
      [1, 5],
    ]);
    const result = minMaxNormalizeScores(input);
    expect(result.get(0)).toBe(1);
    expect(result.get(1)).toBe(1);
  });

  it('returns empty map for empty input', () => {
    const result = minMaxNormalizeScores(new Map());
    expect(result.size).toBe(0);
  });
});
