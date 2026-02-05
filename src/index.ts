// Library exports

export { search } from './core/searcher.js';
export { indexFiles } from './core/indexer.js';
export { chunkMarkdown } from './core/chunker.js';
export { loadConfig, saveConfig } from './utils/config.js';
export type { Config, SearchResult, ChunkRecord, FileRecord } from './types.js';
