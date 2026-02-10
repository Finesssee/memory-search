// Types for memory-search CLI

export interface AIProvider {
  name: string;
  endpoint: string;
  model?: string;
  apiKey?: string;
  priority: number;
  maxRetries?: number;
  timeoutMs?: number;
}

export interface ContextLlmSlot {
  endpoint: string;
  model: string;
  apiKey: string;
  parallelism?: number;
  batchSize?: number;
}

export interface Collection {
  name: string;
  paths: string[];
}

export interface Config {
  sources?: string[];
  collections?: Collection[];
  ignorePaths?: string[];
  indexPath: string;
  embeddingEndpoint: string;
  embeddingDimensions: number;
  chunkMaxTokens: number;
  chunkOverlapTokens: number;
  searchTopK: number;
  searchCandidateCap?: number;
  expandQueries?: boolean;
  pathContexts?: PathContext[];
  contextualizeChunks?: boolean;
  contextParallelism?: number;
  contextMaxDocTokens?: number;
  contextLlmEndpoint?: string;
  contextLlmModel?: string;
  contextLlmApiKey?: string;
  contextLlmEndpoints?: ContextLlmSlot[];
  aiProviders?: AIProvider[];
  provider?: 'api' | 'local';
  localLlm?: {
    embedModel?: string;
    rerankModel?: string;
    generateModel?: string;
    modelCacheDir?: string;
    inactivityTimeoutMs?: number;
  };
}

export interface PathContext {
  path: string;
  description: string;
}

export interface FileRecord {
  id: number;
  path: string;
  mtime: number;
  contentHash: string;
  indexedAt: number;
}

export interface ChunkRecord {
  id: number;
  fileId: number;
  chunkIndex: number;
  content: string;
  lineStart: number;
  lineEnd: number;
  embedding: Float32Array;
  contentHash?: string;
}

export interface SearchResult {
  file: string;
  score: number;
  lineStart: number;
  lineEnd: number;
  snippet: string;
  chunkIndex: number;
  chunkId?: number;
  contentHash?: string;
  fullContent?: string;
  fileMtime?: number;
  explain?: SearchExplain;
}

export interface SearchExplain {
  rrfScore?: number;
  rrfRank?: number;
  bm25Rank?: number;
  bm25Score?: number;
  semanticScore?: number;
  blendWeights?: { bm25: number; semantic: number };
  rerankerScore?: number;
  rerankerWeights?: { retrieval: number; reranker: number };
}

export interface EmbeddingResponse {
  index: number;
  embedding: number[][];
}

export interface ExpandedQuery {
  original: string;
  variations: string[];
}

export interface ExpandedQueries {
  original: string;
  lex: string[];    // Keyword-optimized queries
  vec: string[];    // Semantic queries
  hyde: string;     // Hypothetical answer
}

export interface Fact {
  key: string;
  value: string;
  updatedAt: number;
}

export type ObservationType = 'bugfix' | 'feature' | 'decision' | 'preference' | 'learning' | 'config' | 'architecture' | 'reference';

export interface Observation {
  type: ObservationType;
  concepts: string[];
  files: string[];
}

export interface LLMCaptureDecision {
  capture: boolean;
  reason: string;
  observation?: Observation;
}

export interface Session {
  id: string;
  startedAt: number;
  projectPath: string;
  summary?: string;
  captureCount?: number;
}
