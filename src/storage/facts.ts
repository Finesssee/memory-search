// SQLite database for storing facts (key-value pairs)

import Database from 'better-sqlite3';
import type { Config, Fact } from '../types.js';

export class FactsDB {
  private db: Database.Database;

  constructor(config: Config) {
    this.db = new Database(config.indexPath);
    this.init();
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS facts (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);
  }

  /**
   * Convert glob pattern to SQL LIKE pattern
   * * -> %
   * ? -> _
   */
  private globToLike(pattern: string): string {
    return pattern
      .replace(/%/g, '\\%')
      .replace(/_/g, '\\_')
      .replace(/\*/g, '%')
      .replace(/\?/g, '_');
  }

  set(key: string, value: string): void {
    const now = Date.now();
    this.db.prepare(`
      INSERT INTO facts (key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = excluded.updated_at
    `).run(key, value, now);
  }

  get(pattern: string): Fact[] {
    const likePattern = this.globToLike(pattern);
    const hasWildcard = pattern.includes('*') || pattern.includes('?');

    if (hasWildcard) {
      const rows = this.db.prepare(`
        SELECT key, value, updated_at FROM facts
        WHERE key LIKE ? ESCAPE '\\'
        ORDER BY key
      `).all(likePattern) as Array<{ key: string; value: string; updated_at: number }>;

      return rows.map(row => ({
        key: row.key,
        value: row.value,
        updatedAt: row.updated_at,
      }));
    } else {
      const row = this.db.prepare(`
        SELECT key, value, updated_at FROM facts WHERE key = ?
      `).get(pattern) as { key: string; value: string; updated_at: number } | undefined;

      if (!row) return [];

      return [{
        key: row.key,
        value: row.value,
        updatedAt: row.updated_at,
      }];
    }
  }

  list(): Fact[] {
    const rows = this.db.prepare(`
      SELECT key, value, updated_at FROM facts ORDER BY key
    `).all() as Array<{ key: string; value: string; updated_at: number }>;

    return rows.map(row => ({
      key: row.key,
      value: row.value,
      updatedAt: row.updated_at,
    }));
  }

  delete(key: string): boolean {
    const result = this.db.prepare('DELETE FROM facts WHERE key = ?').run(key);
    return result.changes > 0;
  }

  deletePattern(pattern: string): number {
    const likePattern = this.globToLike(pattern);
    const result = this.db.prepare(`
      DELETE FROM facts WHERE key LIKE ? ESCAPE '\\'
    `).run(likePattern);
    return result.changes;
  }

  close(): void {
    this.db.close();
  }
}
