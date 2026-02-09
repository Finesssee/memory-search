import { describe, it, expect } from 'vitest';
import { cosineSimilarity, findTopK } from './cosine.js';

describe('cosineSimilarity', () => {
  it('returns 1 for identical normalized vectors', () => {
    const v = new Float32Array([1, 0, 0]);
    expect(cosineSimilarity(v, v)).toBeCloseTo(1, 5);
  });

  it('returns 0 for orthogonal vectors', () => {
    const a = new Float32Array([1, 0, 0]);
    const b = new Float32Array([0, 1, 0]);
    expect(cosineSimilarity(a, b)).toBeCloseTo(0, 5);
  });

  it('returns -1 for opposite vectors', () => {
    const a = new Float32Array([1, 0, 0]);
    const b = new Float32Array([-1, 0, 0]);
    expect(cosineSimilarity(a, b)).toBeCloseTo(-1, 5);
  });

  it('computes correct dot product for arbitrary vectors', () => {
    const a = new Float32Array([0.5, 0.5, 0.5]);
    const b = new Float32Array([1, 0, 0]);
    expect(cosineSimilarity(a, b)).toBeCloseTo(0.5, 5);
  });

  it('returns 0 for zero vector', () => {
    const a = new Float32Array([0, 0, 0]);
    const b = new Float32Array([1, 0, 0]);
    expect(cosineSimilarity(a, b)).toBeCloseTo(0, 5);
  });

  it('throws on dimension mismatch', () => {
    const a = new Float32Array([1, 0]);
    const b = new Float32Array([1, 0, 0]);
    expect(() => cosineSimilarity(a, b)).toThrow('Vector dimension mismatch');
  });
});

describe('findTopK', () => {
  const items = [
    { id: 'a', embedding: new Float32Array([1, 0, 0]) },
    { id: 'b', embedding: new Float32Array([0, 1, 0]) },
    { id: 'c', embedding: new Float32Array([0.7, 0.7, 0]) },
  ];

  it('returns top-k items sorted by similarity', () => {
    const query = new Float32Array([1, 0, 0]);
    const results = findTopK(query, items, 2);
    expect(results).toHaveLength(2);
    expect(results[0].item.id).toBe('a');
    expect(results[0].score).toBeCloseTo(1, 5);
  });

  it('returns all items when k exceeds array length', () => {
    const query = new Float32Array([0, 1, 0]);
    const results = findTopK(query, items, 10);
    expect(results).toHaveLength(3);
    expect(results[0].item.id).toBe('b');
  });

  it('returns empty array for empty items', () => {
    const query = new Float32Array([1, 0, 0]);
    const results = findTopK(query, [], 5);
    expect(results).toEqual([]);
  });
});
