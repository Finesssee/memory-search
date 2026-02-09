import { describe, it, expect } from 'vitest';
import {
  getBlendWeights,
  clamp01,
  isTrivialQuery,
  normalizeRerankerScore,
  minMaxNormalizeScores,
} from './reranker.js';

// --- getBlendWeights ---
describe('getBlendWeights', () => {
  it('returns high retrieval weight for top-3 ranks', () => {
    const w = getBlendWeights(1);
    expect(w.retrieval).toBe(0.70);
    expect(w.reranker).toBe(0.30);
  });

  it('returns moderate weights for ranks 4-10', () => {
    const w = getBlendWeights(5);
    expect(w.retrieval).toBe(0.60);
    expect(w.reranker).toBe(0.40);
  });

  it('returns lower retrieval weight for ranks beyond 10', () => {
    const w = getBlendWeights(15);
    expect(w.retrieval).toBe(0.50);
    expect(w.reranker).toBe(0.50);
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
