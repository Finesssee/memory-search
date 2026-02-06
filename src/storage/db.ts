// SQLite database for storing files, chunks, and embeddings

import Database from 'better-sqlite3';
import { basename } from 'node:path';
import type { Config, FileRecord, ChunkRecord, Observation, Session } from '../types.js';
import { hashContent } from '../utils/hash.js';

// Try to load sqlite-vss if available
let loadVss: ((db: Database.Database) => void) | undefined;
try {
  const vssModule = await import('sqlite-vss');
  loadVss = vssModule.load;
} catch {
  // sqlite-vss not available
}

export class MemoryDB {
  private db: Database.Database;
  private dimensions: number;
  private vssEnabled = false;

  constructor(config: Config) {
    this.db = new Database(config.indexPath);
    this.dimensions = config.embeddingDimensions;

    // Try to load sqlite-vss extension
    if (loadVss) {
      try {
        loadVss(this.db);
        this.vssEnabled = true;
      } catch {
        console.error('[db] sqlite-vss not available, using linear scan');
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

    // Add observation metadata columns (safe migration - ignore if already exist)
    try {
      this.db.exec('ALTER TABLE chunks ADD COLUMN observation_type TEXT');
    } catch {
      // Column already exists
    }
    try {
      this.db.exec('ALTER TABLE chunks ADD COLUMN concepts TEXT');
    } catch {
      // Column already exists
    }
    try {
      this.db.exec('ALTER TABLE chunks ADD COLUMN files_referenced TEXT');
    } catch {
      // Column already exists
    }

    // Create sessions table for session tracking
    try {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS sessions (
          id TEXT PRIMARY KEY,
          started_at INTEGER NOT NULL,
          project_path TEXT,
          summary TEXT,
          capture_count INTEGER DEFAULT 0
        )
      `);
    } catch {
      // Table already exists
    }

    // Add session_id column to chunks
    try {
      this.db.exec('ALTER TABLE chunks ADD COLUMN session_id TEXT');
    } catch {
      // Column already exists
    }
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_chunks_session ON chunks(session_id)');

    // Add content_hash column to chunks
    try {
      this.db.exec('ALTER TABLE chunks ADD COLUMN content_hash TEXT');
    } catch {
      // Column already exists
    }

    // Enable foreign key support
    this.db.pragma('foreign_keys = ON');

    // Create VSS virtual table if extension is available
    if (this.vssEnabled) {
      try {
        this.db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS chunks_vss USING vss0(embedding(${this.dimensions}))`);
      } catch {
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
    } catch {
      // FTS5 might not be available or already exists differently
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
    ftsMeta?: { filePath?: string; headings?: string[] }
  ): void {
    const embeddingBuffer = Buffer.from(embedding.buffer, embedding.byteOffset, embedding.byteLength);
    const contentHash = hashContent(content);

    // Prepare observation metadata
    const observationType = observation?.type ?? null;
    const concepts = observation?.concepts?.length ? JSON.stringify(observation.concepts) : null;
    const filesReferenced = observation?.files?.length ? JSON.stringify(observation.files) : null;

    const result = this.db.prepare(`
      INSERT INTO chunks (file_id, chunk_index, content, line_start, line_end, embedding, observation_type, concepts, files_referenced, session_id, content_hash)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(fileId, chunkIndex, content, lineStart, lineEnd, embeddingBuffer, observationType, concepts, filesReferenced, sessionId ?? null, contentHash);

    // Also insert into FTS5 index
    try {
      const filePath = ftsMeta?.filePath ?? this.getFilePathById(fileId) ?? '';
      const filename = this.getFilenameForPath(filePath);
      const pathTokens = this.tokenizePath(filePath);
      const headings = ftsMeta?.headings?.length
        ? ftsMeta.headings.join(' ')
        : this.extractHeadingsFromContent(content);

      this.db.prepare(`
        INSERT INTO chunks_fts (rowid, content, filename, path_tokens, headings)
        VALUES (?, ?, ?, ?, ?)
      `).run(result.lastInsertRowid, content, filename, pathTokens, headings);
    } catch {
      // FTS5 might not be available
    }

    // Also insert into VSS index if enabled
    if (this.vssEnabled) {
      try {
        this.db.prepare('INSERT INTO chunks_vss (rowid, embedding) VALUES (?, ?)').run(result.lastInsertRowid, embeddingBuffer);
      } catch {
        // VSS insert failed
      }
    }
  }

  deleteChunksForFile(fileId: number): void {
    // First get chunk IDs to delete from FTS and VSS
    const chunkIds = this.db.prepare('SELECT id FROM chunks WHERE file_id = ?').all(fileId) as { id: number }[];
    const ids = chunkIds.map(({ id }) => id);

    // Delete from VSS index if enabled
    if (this.vssEnabled && ids.length > 0) {
      try {
        const placeholders = ids.map(() => '?').join(',');
        this.db.prepare(`DELETE FROM chunks_vss WHERE rowid IN (${placeholders})`).run(...ids);
      } catch {
        // VSS might not be available
      }
    }

    // Delete from FTS5
    if (ids.length > 0) {
      try {
        const placeholders = ids.map(() => '?').join(',');
        this.db.prepare(`DELETE FROM chunks_fts WHERE rowid IN (${placeholders})`).run(...ids);
      } catch {
        // FTS5 might not be available
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
    } catch {
      // FTS5 might not be available
      return [];
    }
  }

  /**
   * Get chunks by their IDs
   */
  getChunksByIds(ids: number[]): (ChunkRecord & { filePath: string })[] {
    if (ids.length === 0) return [];

    const placeholders = ids.map(() => '?').join(',');
    const rows = this.db.prepare(`
      SELECT c.*, f.path as file_path
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
    }));
  }

  /**
   * Rebuild FTS index from chunks table
   */
  rebuildFTS(): void {
    try {
      // Clear and rebuild
      this.db.exec('DELETE FROM chunks_fts');
      const rows = this.db.prepare(`
        SELECT c.id, c.content, f.path as file_path
        FROM chunks c
        JOIN files f ON c.file_id = f.id
      `).all() as Array<{ id: number; content: string; file_path: string }>;

      const insertStmt = this.db.prepare(`
        INSERT INTO chunks_fts (rowid, content, filename, path_tokens, headings)
        VALUES (?, ?, ?, ?, ?)
      `);

      this.withTransaction(() => {
        for (const row of rows) {
          const filename = this.getFilenameForPath(row.file_path);
          const pathTokens = this.tokenizePath(row.file_path);
          const headings = this.extractHeadingsFromContent(row.content);
          insertStmt.run(row.id, row.content, filename, pathTokens, headings);
        }
      });
    } catch {
      // FTS5 might not be available
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

  updateSessionSummary(id: string, summary: string): void {
    this.db.prepare('UPDATE sessions SET summary = ? WHERE id = ?').run(summary, id);
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
   * Vector similarity search using sqlite-vss
   */
  searchVss(queryEmbedding: Float32Array, limit = 50): { chunkId: number; distance: number }[] {
    if (!this.vssEnabled) {
      return [];
    }

    try {
      const embeddingBuffer = Buffer.from(queryEmbedding.buffer, queryEmbedding.byteOffset, queryEmbedding.byteLength);
      const rows = this.db.prepare(`
        SELECT rowid, distance
        FROM chunks_vss
        WHERE vss_search(embedding, ?)
        LIMIT ?
      `).all(embeddingBuffer, limit) as { rowid: number; distance: number }[];

      return rows.map(row => ({ chunkId: row.rowid, distance: row.distance }));
    } catch {
      return [];
    }
  }

  /**
   * Rebuild VSS index from chunks table
   */
  rebuildVss(): void {
    if (!this.vssEnabled) {
      return;
    }

    try {
      // Clear existing VSS data
      this.db.exec('DELETE FROM chunks_vss');

      // Re-insert all embeddings
      const chunks = this.db.prepare('SELECT id, embedding FROM chunks').all() as { id: number; embedding: Buffer }[];
      const insertStmt = this.db.prepare('INSERT INTO chunks_vss (rowid, embedding) VALUES (?, ?)');

      this.withTransaction(() => {
        for (const chunk of chunks) {
          insertStmt.run(chunk.id, chunk.embedding);
        }
      });
    } catch {
      // VSS rebuild failed
    }
  }

  close(): void {
    this.db.close();
  }
}
