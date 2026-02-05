// Per-document reranker score caching

import Database from 'better-sqlite3';
import type { Config } from '../types.js';

export class RerankCache {
  private db: Database.Database;

  constructor(config: Config) {
    this.db = new Database(config.indexPath);
    this.init();
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS rerank_cache (
        query_hash TEXT NOT NULL,
        doc_hash TEXT NOT NULL,
        model TEXT NOT NULL,
        score REAL NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (query_hash, doc_hash, model)
      );
    `);
  }

  getScore(queryHash: string, docHash: string, model: string): number | null {
    const row = this.db.prepare(
      'SELECT score FROM rerank_cache WHERE query_hash = ? AND doc_hash = ? AND model = ?'
    ).get(queryHash, docHash, model);
    return row ? (row as { score: number }).score : null;
  }

  setScore(queryHash: string, docHash: string, model: string, score: number): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO rerank_cache (query_hash, doc_hash, model, score, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(queryHash, docHash, model, score, Date.now());
  }

  close(): void {
    this.db.close();
  }
}
