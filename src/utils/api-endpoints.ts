// Centralized API endpoint construction

export function getBaseUrl(embeddingEndpoint: string): string {
  return embeddingEndpoint.replace(/\/$/, '').replace(/\/embedding$/, '');
}

export function getChatEndpoint(embeddingEndpoint: string): string {
  return getBaseUrl(embeddingEndpoint) + '/chat';
}

export function getExpandEndpoint(embeddingEndpoint: string): string {
  return getBaseUrl(embeddingEndpoint) + '/expand';
}

export function getRerankEndpoint(embeddingEndpoint: string): string {
  return getBaseUrl(embeddingEndpoint) + '/rerank';
}

export function getEmbeddingEndpoint(embeddingEndpoint: string): string {
  const base = getBaseUrl(embeddingEndpoint);
  return embeddingEndpoint.endsWith('/embedding') ? embeddingEndpoint : base + '/embedding';
}
