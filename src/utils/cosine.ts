// Dot product similarity for normalized vectors

export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) {
    throw new Error(`Vector dimension mismatch: ${a.length} vs ${b.length}`);
  }

  let dotProduct = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
  }

  return dotProduct;
}

export function findTopK<T extends { embedding: Float32Array }>(
  query: Float32Array,
  items: T[],
  k: number
): { item: T; score: number }[] {
  const scored = items.map((item) => ({
    item,
    score: cosineSimilarity(query, item.embedding),
  }));

  scored.sort((a, b) => b.score - a.score);

  return scored.slice(0, k);
}
