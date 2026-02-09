import type { IncomingMessage, ServerResponse } from 'node:http';
import { search } from '../core/searcher.js';
import { MemoryDB } from '../storage/db.js';
import { indexFiles } from '../core/indexer.js';
import type { Config } from '../types.js';
import { URL } from 'node:url';

function json(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function parseBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

export async function handleRequest(req: IncomingMessage, res: ServerResponse, config: Config): Promise<void> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const path = url.pathname;

  if (path === '/health' && req.method === 'GET') {
    json(res, 200, { status: 'ok', timestamp: Date.now() });
    return;
  }

  if (path === '/status' && req.method === 'GET') {
    const db = new MemoryDB(config);
    try {
      const stats = db.getStats();
      json(res, 200, { ...stats, indexPath: config.indexPath });
    } finally {
      db.close();
    }
    return;
  }

  if (path === '/search' && req.method === 'GET') {
    const q = url.searchParams.get('q');
    if (!q) {
      json(res, 400, { error: 'Missing query parameter "q"' });
      return;
    }
    const limit = parseInt(url.searchParams.get('limit') ?? '5', 10);
    const searchConfig = { ...config, searchTopK: limit };

    const results = await search(q, searchConfig);
    json(res, 200, { query: q, results });
    return;
  }

  if (path.startsWith('/get/') && req.method === 'GET') {
    const idStr = path.slice(5);
    const id = parseInt(idStr, 10);
    if (isNaN(id)) {
      json(res, 400, { error: 'Invalid chunk ID' });
      return;
    }
    const db = new MemoryDB(config);
    try {
      const chunk = db.getChunkById(id);
      if (!chunk) {
        json(res, 404, { error: 'Chunk not found' });
        return;
      }
      json(res, 200, chunk);
    } finally {
      db.close();
    }
    return;
  }

  if (path === '/index' && req.method === 'POST') {
    const result = await indexFiles(config);
    json(res, 200, result);
    return;
  }

  json(res, 404, { error: 'Not found' });
}
