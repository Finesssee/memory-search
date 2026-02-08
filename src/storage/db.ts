// SQLite database for storing files, chunks, and embeddings

import Database from 'better-sqlite3';
import { basename } from 'node:path';
import type { Config, FileRecord, ChunkRecord, Observation, Session } from '../types.js';
import { hashContent } from '../utils/hash.js';
import { logDebug, logInfo, logWarn, logError, errorMessage } from '../utils/log.js';

// Try to load sqlite-vec if available
let loadVec: ((db: Database.Database) => void) | undefined;
try {
  const vecModule = await import('sqlite-vec');
  loadVec = vecModule.load;
} catch (err) {
  logDebug('db', 'sqlite-vec module not available', { error: errorMessage(err) });
}

export class MemoryDB {
  private db: Database.Database;
  private dimensions: number;
  private vssEnabled = false;

  constructor(config: Config) {
    this.db = new Database(config.indexPath);
    this.dimensions = config.embeddingDimensions;

    // Try to load sqlite-vec extension
    if (loadVec) {
      try {
        loadVec(this.db);
        this.vssEnabled = true;
      } catch (err) {
        logWarn('db', 'sqlite-vec extension failed to load, using linear scan', { error: errorMessage(err) });
        this.vssEnabled = false;
      }
    }

    this.init();
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS files (
        id INTEGER PRIMARY KEY,
        path TEXT UNIQUE NOT NULL,
        mtime INTEGER NOT NULL,
        content_hash TEXT NOT NULL,
        indexed_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS chunks (
        id INTEGER PRIMARY KEY,
        file_id INTEGER NOT NULL,
        chunk_index INTEGER NOT NULL,
        content TEXT NOT NULL,
        line_start INTEGER NOT NULL,
        line_end INTEGER NOT NULL,
        embedding BLOB NOT NULL,
        FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_chunks_file ON chunks(file_id);
    `);

    // Create FTS5 virtual table for full-text search if it doesn't exist
    this.ensureFtsTable();

    // Safe migrations — ALTER TABLE fails if column exists, which is expected
    const addColumn = (table: string, col: string, type: string) => {
      try { this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`); }
      catch { /* column already exists */ }
    };
    addColumn('chunks', 'observation_type', 'TEXT');
    addColumn('chunks', 'concepts', 'TEXT');
    addColumn('chunks', 'files_referenced', 'TEXT');
    addColumn('chunks', 'session_id', 'TEXT');
    addColumn('chunks', 'content_hash', 'TEXT');
    addColumn('chunks', 'context_prefix', 'TEXT');

    this.db.exec('CREATE INDEX IF NOT EXISTS idx_chunks_session ON chunks(session_id)');

    // Create tables — IF NOT EXISTS handles idempotency; catch logs unexpected errors
    const safeExec = (label: string, sql: string) => {
      try { this.db.exec(sql); }
      catch (err) { logWarn('db', `Migration "${label}" failed`, { error: errorMessage(err) }); }
    };

    safeExec('sessions', `
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        started_at INTEGER NOT NULL,
        project_path TEXT,
        summary TEXT,
        capture_count INTEGER DEFAULT 0
      )
    `);

    safeExec('collections', `
      CREATE TABLE IF NOT EXISTS collections (
        id INTEGER PRIMARY KEY,
        name TEXT UNIQUE NOT NULL,
        created_at INTEGER NOT NULL
      )
    `);

    safeExec('file_collections', `
      CREATE TABLE IF NOT EXISTS file_collections (
        file_id INTEGER NOT NULL,
        collection_id INTEGER NOT NULL,
        PRIMARY KEY (file_id, collection_id),
        FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE,
        FOREIGN KEY (collection_id) REFERENCES collections(id) ON DELETE CASCADE
      )
    `);

    safeExec('query_embedding_cache', `
      CREATE TABLE IF NOT EXISTS query_embedding_cache (
        query_text TEXT PRIMARY KEY,
        embedding BLOB NOT NULL,
        created_at INTEGER NOT NULL
      )
    `);

    safeExec('context_cache', `
      CREATE TABLE IF NOT EXISTS context_cache (
        doc_chunk_hash TEXT PRIMARY KEY,
        context_prefix TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )
    `);

    // Enable foreign key support
    this.db.pragma('foreign_keys = ON');

    // Create vec0 virtual table if extension is available
    if (this.vssEnabled) {
      try {
        this.db.exec('DROP TABLE IF EXISTS chunks_vss');
        this.db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS chunks_vec USING vec0(embedding float[${this.dimensions}] distance_metric=cosine)`);
      } catch (err) {
        logWarn('db', 'Failed to create vec0 virtual table', { error: errorMessage(err) });
        this.vssEnabled = false;
      }
    }
  }

  private getFilePathById(fileId: number): string | null {
    const row = this.db.prepare('SELECT path FROM files WHERE id = ?').get(fileId) as { path: string } | undefined;
    return row?.path ?? null;
  }

  private getFilenameForPath(filePath: string): string {
    if (!filePath) return '';
    return basename(filePath);
  }

  private tokenizePath(filePath: string): string {
    if (!filePath) return '';
    const normalized = filePath.replace(/\\/g, '/');
    const parts = normalized.split(/[\/\s._-]+/).filter(Boolean);
    return parts.join(' ');
  }

  private extractHeadingsFromContent(content: string): string {
    const headings: string[] = [];
    const lines = content.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (/^#{1,6}\s+/.test(trimmed)) {
        const text = trimmed.replace(/^#{1,6}\s+/, '').trim();
        if (text.length > 0 && !headings.includes(text)) {
          headings.push(text);
        }
      }
    }
    return headings.join(' ');
  }

  private ensureFtsTable(): void {
    try {
      this.db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
          content,
          filename,
          path_tokens,
          headings,
          content_rowid='id',
          tokenize='porter unicode61'
        );
      `);

      const columns = this.db.prepare('PRAGMA table_info(chunks_fts)').all() as Array<{ name: string }>;
      const columnNames = new Set(columns.map(col => col.name));
      const required = ['content', 'filename', 'path_tokens', 'headings'];
      const missing = required.some(col => !columnNames.has(col));

      if (missing) {
        logInfo('db', 'FTS table schema outdated, rebuilding');
        this.db.exec('DROP TABLE IF EXISTS chunks_fts');
        this.db.exec(`
          CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
            content,
            filename,
            path_tokens,
            headings,
            content_rowid='id',
            tokenize='porter unicode61'
          );
        `);
        this.rebuildFTS();
      }
    } catch (err) {
      logWarn('db', 'FTS5 setup failed — full-text search may be unavailable', { error: errorMessage(err) });
    }
  }

  getFile(path: string): FileRecord | undefined {
    const row = this.db.prepare('SELECT * FROM files WHERE path = ?').get(path) as {
      id: number;
      path: string;
      mtime: number;
      content_hash: string;
      indexed_at: number;
    } | undefined;

    if (!row) return undefined;

    return {
      id: row.id,
      path: row.path,
      mtime: row.mtime,
      contentHash: row.content_hash,
      indexedAt: row.indexed_at,
    };
  }

  upsertFile(path: string, mtime: number, contentHash: string): number {
    const now = Date.now();
    const stmt = this.db.prepare(`
      INSERT INTO files (path, mtime, content_hash, indexed_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(path) DO UPDATE SET
        mtime = excluded.mtime,
        content_hash = excluded.content_hash,
        indexed_at = excluded.indexed_at
    `);

    stmt.run(path, mtime, contentHash, now);

    const row = this.db.prepare('SELECT id FROM files WHERE path = ?').get(path) as { id: number };
    return row.id;
  }

  upsertCollection(name: string): number {
    const now = Date.now();
    this.db.prepare(`
      INSERT INTO collections (name, created_at)
      VALUES (?, ?)
      ON CONFLICT(name) DO NOTHING
    `).run(name, now);

    const row = this.db.prepare('SELECT id FROM collections WHERE name = ?').get(name) as { id: number };
    return row.id;
  }

  addFileToCollection(fileId: number, collectionId: number): void {
    this.db.prepare(`
      INSERT OR IGNORE INTO file_collections (file_id, collection_id)
      VALUES (?, ?)
    `).run(fileId, collectionId);
  }

  clearFileCollections(fileId: number): void {
    this.db.prepare('DELETE FROM file_collections WHERE file_id = ?').run(fileId);
  }

  getFilesByCollection(collectionName: string): FileRecord[] {
    const rows = this.db.prepare(`
      SELECT f.*
      FROM files f
      JOIN file_collections fc ON f.id = fc.file_id
      JOIN collections c ON fc.collection_id = c.id
      WHERE c.name = ?
    `).all(collectionName) as Array<{
      id: number;
      path: string;
      mtime: number;
      content_hash: string;
      indexed_at: number;
    }>;

    return rows.map((row) => ({
      id: row.id,
      path: row.path,
      mtime: row.mtime,
      contentHash: row.content_hash,
      indexedAt: row.indexed_at,
    }));
  }

  deleteFile(path: string): void {
    const existing = this.getFile(path);
    if (!existing) return;

    this.withTransaction(() => {
      this.deleteChunksForFile(existing.id);
      this.db.prepare('DELETE FROM files WHERE path = ?').run(path);
    });
  }

  insertChunk(
    fileId: number,
    chunkIndex: number,
    content: string,
    lineStart: number,
    lineEnd: number,
    embedding: Float32Array,
    observation?: Observation,
    sessionId?: string,
    ftsMeta?: { filePath?: string; headings?: string[] },
    contextPrefix?: string
  ): void {
    const embeddingBuffer = Buffer.from(embedding.buffer, embedding.byteOffset, embedding.byteLength);
    const contentHash = hashContent(content);

    // Prepare observation metadata
    const observationType = observation?.type ?? null;
    const concepts = observation?.concepts?.length ? JSON.stringify(observation.concepts) : null;
    const filesReferenced = observation?.files?.length ? JSON.stringify(observation.files) : null;

    const result = this.db.prepare(`
      INSERT INTO chunks (file_id, chunk_index, content, line_start, line_end, embedding, observation_type, concepts, files_referenced, session_id, content_hash, context_prefix)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(fileId, chunkIndex, content, lineStart, lineEnd, embeddingBuffer, observationType, concepts, filesReferenced, sessionId ?? null, contentHash, contextPrefix ?? null);

    // Also insert into FTS5 index
    try {
      const filePath = ftsMeta?.filePath ?? this.getFilePathById(fileId) ?? '';
      const filename = this.getFilenameForPath(filePath);
      const pathTokens = this.tokenizePath(filePath);
      const headings = ftsMeta?.headings?.length
        ? ftsMeta.headings.join(' ')
        : this.extractHeadingsFromContent(content);
      const ftsContent = contextPrefix ? contextPrefix + '\n\n' + content : content;

      this.db.prepare(`
        INSERT INTO chunks_fts (rowid, content, filename, path_tokens, headings)
        VALUES (?, ?, ?, ?, ?)
      `).run(result.lastInsertRowid, ftsContent, filename, pathTokens, headings);
    } catch (err) {
      logWarn('db', 'FTS5 insert failed for chunk', { chunkIndex, error: errorMessage(err) });
    }

    // Also insert into vec0 index if enabled
    if (this.vssEnabled) {
      try {
        this.db.prepare('INSERT INTO chunks_vec (rowid, embedding) VALUES (?, ?)').run(result.lastInsertRowid, embeddingBuffer);
      } catch (err) {
        logWarn('db', 'vec0 insert failed for chunk', { chunkIndex, error: errorMessage(err) });
      }
    }
  }

  deleteChunksForFile(fileId: number): void {
    // First get chunk IDs to delete from FTS and VSS
    const chunkIds = this.db.prepare('SELECT id FROM chunks WHERE file_id = ?').all(fileId) as { id: number }[];
    const ids = chunkIds.map(({ id }) => id);

    // Delete from vec0 index if enabled
    if (this.vssEnabled && ids.length > 0) {
      try {
        const placeholders = ids.map(() => '?').join(',');
        this.db.prepare(`DELETE FROM chunks_vec WHERE rowid IN (${placeholders})`).run(...ids);
      } catch (err) {
        logWarn('db', 'vec0 delete failed', { fileId, count: ids.length, error: errorMessage(err) });
      }
    }

    // Delete from FTS5
    if (ids.length > 0) {
      try {
        const placeholders = ids.map(() => '?').join(',');
        this.db.prepare(`DELETE FROM chunks_fts WHERE rowid IN (${placeholders})`).run(...ids);
      } catch (err) {
        logWarn('db', 'FTS5 delete failed', { fileId, count: ids.length, error: errorMessage(err) });
      }
    }

    // Delete from chunks table
    this.db.prepare('DELETE FROM chunks WHERE file_id = ?').run(fileId);
  }

  /**
   * Build an FTS5 query string from user input.
   * Handles quoted phrases and individual terms with AND logic.
   */
  private buildFtsQuery(query: string): string {
    const phrases = Array.from(query.matchAll(/"([^"]+)"/g)).map(m => m[1]).filter(Boolean);
    const cleaned = query.replace(/"[^"]+"/g, ' ');
    const terms = cleaned.split(/\s+/).map(t => t.trim()).filter(t => t.length > 1);
    const tokens = [
      ...phrases.map(p => `"${p.replace(/"/g, '')}"`),
      ...terms.map(t => t.replace(/["']/g, '')),
    ];
    if (tokens.length === 0) return '';
    return tokens.join(' AND ');
  }

  /**
   * Full-text search using FTS5 with BM25 ranking
   */
  searchFTS(query: string, limit = 50): { chunkId: number; rank: number }[] {
    try {
      const ftsQuery = this.buildFtsQuery(query);
      if (!ftsQuery) return [];

      const rows = this.db.prepare(`
        SELECT rowid, bm25(chunks_fts, 1.0, 4.0, 2.0, 3.0) as rank
        FROM chunks_fts
        WHERE chunks_fts MATCH ?
        ORDER BY rank
        LIMIT ?
      `).all(ftsQuery, limit) as { rowid: number; rank: number }[];

      return rows.map(row => ({ chunkId: row.rowid, rank: row.rank }));
    } catch (err) {
      logWarn('db', 'FTS5 search failed', { query, error: errorMessage(err) });
      return [];
    }
  }

  /**
   * Get chunks by their IDs
   */
  getChunksByIds(ids: number[]): (ChunkRecord & { filePath: string; fileMtime?: number })[] {
    if (ids.length === 0) return [];

    const placeholders = ids.map(() => '?').join(',');
    const rows = this.db.prepare(`
      SELECT c.*, f.path as file_path, f.mtime as file_mtime
      FROM chunks c
      JOIN files f ON c.file_id = f.id
      WHERE c.id IN (${placeholders})
    `).all(...ids) as Array<{
      id: number;
      file_id: number;
      chunk_index: number;
      content: string;
      line_start: number;
      line_end: number;
      embedding: Buffer;
      file_path: string;
      content_hash: string | null;
      file_mtime: number;
    }>;

    return rows.map((row) => ({
      id: row.id,
      fileId: row.file_id,
      chunkIndex: row.chunk_index,
      content: row.content,
      lineStart: row.line_start,
      lineEnd: row.line_end,
      embedding: new Float32Array(row.embedding.buffer, row.embedding.byteOffset, row.embedding.length / 4),
      filePath: row.file_path,
      contentHash: row.content_hash ?? hashContent(row.content),
      fileMtime: row.file_mtime,
    }));
  }

  getChunkById(id: number): (ChunkRecord & { filePath: string }) | undefined {
    const row = this.db.prepare(`
      SELECT c.*, f.path as file_path
      FROM chunks c
      JOIN files f ON c.file_id = f.id
      WHERE c.id = ?
    `).get(id) as {
      id: number;
      file_id: number;
      chunk_index: number;
      content: string;
      line_start: number;
      line_end: number;
      embedding: Buffer;
      file_path: string;
      content_hash: string | null;
    } | undefined;

    if (!row) return undefined;

    return {
      id: row.id,
      fileId: row.file_id,
      chunkIndex: row.chunk_index,
      content: row.content,
      lineStart: row.line_start,
      lineEnd: row.line_end,
      embedding: new Float32Array(row.embedding.buffer, row.embedding.byteOffset, row.embedding.length / 4),
      filePath: row.file_path,
      contentHash: row.content_hash ?? hashContent(row.content),
    };
  }

  getSurroundingChunks(chunkId: number, range = 2): (ChunkRecord & { filePath: string })[] {
    const centerChunk = this.getChunkById(chunkId);
    if (!centerChunk) return [];

    const rows = this.db.prepare(`
      SELECT c.*, f.path as file_path
      FROM chunks c
      JOIN files f ON c.file_id = f.id
      WHERE c.file_id = ?
      AND c.chunk_index BETWEEN ? AND ?
      ORDER BY c.chunk_index
    `).all(centerChunk.fileId, centerChunk.chunkIndex - range, centerChunk.chunkIndex + range) as Array<{
      id: number;
      file_id: number;
      chunk_index: number;
      content: string;
      line_start: number;
      line_end: number;
      embedding: Buffer;
      file_path: string;
      content_hash: string | null;
    }>;

    return rows.map(row => ({
      id: row.id,
      fileId: row.file_id,
      chunkIndex: row.chunk_index,
      content: row.content,
      lineStart: row.line_start,
      lineEnd: row.line_end,
      embedding: new Float32Array(row.embedding.buffer, row.embedding.byteOffset, row.embedding.length / 4),
      filePath: row.file_path,
      contentHash: row.content_hash ?? hashContent(row.content),
    }));
  }

  /**
   * Rebuild FTS index from chunks table
   */
  rebuildFTS(): void {
    try {
      this.db.exec('DELETE FROM chunks_fts');
      const rows = this.db.prepare(`
        SELECT c.id, c.content, c.context_prefix, f.path as file_path
        FROM chunks c
        JOIN files f ON c.file_id = f.id
      `).all() as Array<{ id: number; content: string; context_prefix: string | null; file_path: string }>;

      const insertStmt = this.db.prepare(`
        INSERT INTO chunks_fts (rowid, content, filename, path_tokens, headings)
        VALUES (?, ?, ?, ?, ?)
      `);

      this.withTransaction(() => {
        for (const row of rows) {
          const filename = this.getFilenameForPath(row.file_path);
          const pathTokens = this.tokenizePath(row.file_path);
          const headings = this.extractHeadingsFromContent(row.content);
          const ftsContent = row.context_prefix ? row.context_prefix + '\n\n' + row.content : row.content;
          insertStmt.run(row.id, ftsContent, filename, pathTokens, headings);
        }
      });
      logInfo('db', `FTS index rebuilt with ${rows.length} chunks`);
    } catch (err) {
      logError('db', 'FTS rebuild failed', { error: errorMessage(err) });
    }
  }

  getAllChunks(): (ChunkRecord & { filePath: string })[] {
    const rows = this.db.prepare(`
      SELECT c.*, f.path as file_path
      FROM chunks c
      JOIN files f ON c.file_id = f.id
    `).all() as Array<{
      id: number;
      file_id: number;
      chunk_index: number;
      content: string;
      line_start: number;
      line_end: number;
      embedding: Buffer;
      file_path: string;
    }>;

    return rows.map((row) => ({
      id: row.id,
      fileId: row.file_id,
      chunkIndex: row.chunk_index,
      content: row.content,
      lineStart: row.line_start,
      lineEnd: row.line_end,
      embedding: new Float32Array(row.embedding.buffer, row.embedding.byteOffset, row.embedding.length / 4),
      filePath: row.file_path,
    }));
  }

  getAllFiles(): FileRecord[] {
    const rows = this.db.prepare('SELECT * FROM files').all() as Array<{
      id: number;
      path: string;
      mtime: number;
      content_hash: string;
      indexed_at: number;
    }>;

    return rows.map((row) => ({
      id: row.id,
      path: row.path,
      mtime: row.mtime,
      contentHash: row.content_hash,
      indexedAt: row.indexed_at,
    }));
  }

  getStats(): { files: number; chunks: number } {
    const files = (this.db.prepare('SELECT COUNT(*) as count FROM files').get() as { count: number }).count;
    const chunks = (this.db.prepare('SELECT COUNT(*) as count FROM chunks').get() as { count: number }).count;
    return { files, chunks };
  }

  upsertSession(id: string, projectPath: string): void {
    const now = Date.now();
    this.db.prepare(`
      INSERT INTO sessions (id, started_at, project_path, capture_count)
      VALUES (?, ?, ?, 0)
      ON CONFLICT(id) DO UPDATE SET
        project_path = excluded.project_path
    `).run(id, now, projectPath);
  }

  getSession(id: string): Session | undefined {
    const row = this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as {
      id: string;
      started_at: number;
      project_path: string;
      summary: string | null;
      capture_count: number;
    } | undefined;

    if (!row) return undefined;

    return {
      id: row.id,
      startedAt: row.started_at,
      projectPath: row.project_path,
      summary: row.summary ?? undefined,
      captureCount: row.capture_count,
    };
  }

  getAllSessions(): Session[] {
    const rows = this.db.prepare('SELECT * FROM sessions ORDER BY started_at DESC').all() as Array<{
      id: string;
      started_at: number;
      project_path: string;
      summary: string | null;
      capture_count: number;
    }>;

    return rows.map((row) => ({
      id: row.id,
      startedAt: row.started_at,
      projectPath: row.project_path,
      summary: row.summary ?? undefined,
      captureCount: row.capture_count,
    }));
  }

  incrementSessionCaptureCount(id: string): void {
    this.db.prepare('UPDATE sessions SET capture_count = capture_count + 1 WHERE id = ?').run(id);
  }

  getChunksBySessionId(sessionId: string): (ChunkRecord & { filePath: string })[] {
    const rows = this.db.prepare(`
      SELECT c.*, f.path as file_path
      FROM chunks c
      JOIN files f ON c.file_id = f.id
      WHERE c.session_id = ?
    `).all(sessionId) as Array<{
      id: number;
      file_id: number;
      chunk_index: number;
      content: string;
      line_start: number;
      line_end: number;
      embedding: Buffer;
      file_path: string;
    }>;

    return rows.map((row) => ({
      id: row.id,
      fileId: row.file_id,
      chunkIndex: row.chunk_index,
      content: row.content,
      lineStart: row.line_start,
      lineEnd: row.line_end,
      embedding: new Float32Array(row.embedding.buffer, row.embedding.byteOffset, row.embedding.length / 4),
      filePath: row.file_path,
    }));
  }

  /**
   * Execute a function within a database transaction for better performance
   */
  withTransaction<T>(fn: () => T): T {
    const tx = this.db.transaction(fn);
    return tx();
  }

  /**
   * Check if VSS (vector similarity search) is enabled
   */
  isVssEnabled(): boolean {
    return this.vssEnabled;
  }

  /**
   * Vector similarity search using sqlite-vec
   */
  searchVss(queryEmbedding: Float32Array, limit = 50): { chunkId: number; distance: number }[] {
    if (!this.vssEnabled) {
      return [];
    }

    try {
      const embeddingBuffer = Buffer.from(queryEmbedding.buffer, queryEmbedding.byteOffset, queryEmbedding.byteLength);
      const rows = this.db.prepare(`
        SELECT rowid, distance
        FROM chunks_vec
        WHERE embedding MATCH ? AND k = ?
      `).all(embeddingBuffer, limit) as { rowid: number; distance: number }[];

      return rows.map(row => ({ chunkId: row.rowid, distance: row.distance }));
    } catch (err) {
      logWarn('db', 'vec0 search failed', { error: errorMessage(err) });
      return [];
    }
  }

  /**
   * Rebuild vec0 index from chunks table
   */
  rebuildVss(): void {
    if (!this.vssEnabled) {
      return;
    }

    try {
      this.db.exec('DELETE FROM chunks_vec');
      const chunks = this.db.prepare('SELECT id, embedding FROM chunks').all() as { id: number; embedding: Buffer }[];
      const insertStmt = this.db.prepare('INSERT INTO chunks_vec (rowid, embedding) VALUES (?, ?)');

      this.withTransaction(() => {
        for (const chunk of chunks) {
          insertStmt.run(chunk.id, chunk.embedding);
        }
      });
      logInfo('db', `vec0 index rebuilt with ${chunks.length} chunks`);
    } catch (err) {
      logError('db', 'vec0 rebuild failed', { error: errorMessage(err) });
    }
  }

  getCachedQueryEmbedding(queryText: string): Float32Array | null {
    const row = this.db.prepare(
      'SELECT embedding FROM query_embedding_cache WHERE query_text = ?'
    ).get(queryText) as { embedding: Buffer } | undefined;
    if (!row) return null;
    return new Float32Array(row.embedding.buffer, row.embedding.byteOffset, row.embedding.byteLength / 4);
  }

  setCachedQueryEmbedding(queryText: string, embedding: Float32Array): void {
    const buffer = Buffer.from(embedding.buffer, embedding.byteOffset, embedding.byteLength);
    this.db.prepare(
      'INSERT OR REPLACE INTO query_embedding_cache (query_text, embedding, created_at) VALUES (?, ?, ?)'
    ).run(queryText, buffer, Date.now());
  }

  getCachedContext(hash: string): string | null {
    const row = this.db.prepare('SELECT context_prefix FROM context_cache WHERE doc_chunk_hash = ?').get(hash) as { context_prefix: string } | undefined;
    return row?.context_prefix ?? null;
  }

  setCachedContext(hash: string, prefix: string): void {
    this.db.prepare('INSERT OR REPLACE INTO context_cache (doc_chunk_hash, context_prefix, created_at) VALUES (?, ?, ?)').run(hash, prefix, Date.now());
  }

  pruneQueryEmbeddingCache(maxAgeDays: number): number {
    const cutoff = Date.now() - maxAgeDays * 86_400_000;
    const result = this.db.prepare('DELETE FROM query_embedding_cache WHERE created_at < ?').run(cutoff);
    return result.changes;
  }

  pruneContextCache(maxAgeDays: number): number {
    const cutoff = Date.now() - maxAgeDays * 86_400_000;
    const result = this.db.prepare('DELETE FROM context_cache WHERE created_at < ?').run(cutoff);
    return result.changes;
  }

  clearAllData(): void {
    // Disable FK constraints briefly so we can delete in any order
    this.db.pragma('foreign_keys = OFF');
    try {
      this.db.exec('DELETE FROM chunks');
      this.db.exec('DELETE FROM files');
      this.db.exec('DELETE FROM file_collections');
      this.db.exec('DELETE FROM collections');
      this.db.exec('DELETE FROM sessions');
      this.db.exec('DELETE FROM context_cache');
      this.db.exec('DELETE FROM query_embedding_cache');
      try { this.db.exec('DELETE FROM chunks_fts'); } catch { /* may not exist */ }
      if (this.vssEnabled) {
        try { this.db.exec('DELETE FROM chunks_vec'); } catch { /* may not exist */ }
      }
    } finally {
      this.db.pragma('foreign_keys = ON');
    }
  }

  getAllCollections(): { name: string; createdAt: number }[] {
    return this.db.prepare('SELECT name, created_at as createdAt FROM collections').all() as any[];
  }

  getAllFileCollectionMappings(): { filePath: string; collectionName: string }[] {
    return this.db.prepare(`
      SELECT f.path as filePath, c.name as collectionName
      FROM file_collections fc JOIN files f ON fc.file_id = f.id JOIN collections c ON fc.collection_id = c.id
    `).all() as any[];
  }

  getAllContextCacheEntries(): { hash: string; prefix: string; createdAt: number }[] {
    return this.db.prepare('SELECT doc_chunk_hash as hash, context_prefix as prefix, created_at as createdAt FROM context_cache').all() as any[];
  }

  getAllChunksForExport(): Array<{filePath: string; chunkIndex: number; content: string; lineStart: number; lineEnd: number; observationType: string|null; concepts: string|null; filesReferenced: string|null; sessionId: string|null; contentHash: string|null; contextPrefix: string|null}> {
    return this.db.prepare(`
      SELECT f.path as filePath, c.chunk_index as chunkIndex, c.content,
             c.line_start as lineStart, c.line_end as lineEnd,
             c.observation_type as observationType, c.concepts,
             c.files_referenced as filesReferenced, c.session_id as sessionId,
             c.content_hash as contentHash, c.context_prefix as contextPrefix
      FROM chunks c JOIN files f ON c.file_id = f.id ORDER BY f.path, c.chunk_index
    `).all() as any[];
  }

  close(): void {
    this.db.close();
  }
}
