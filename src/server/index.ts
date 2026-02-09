import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { handleRequest } from './routes.js';
import type { Config } from '../types.js';

export function startServer(config: Config, port: number, cors: boolean): void {
  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    if (cors) {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }
    }

    try {
      await handleRequest(req, res, config);
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err instanceof Error ? err.message : 'Internal error' }));
    }
  });

  server.listen(port, () => {
    console.log(`memory-search server listening on http://localhost:${port}`);
    console.log('Endpoints:');
    console.log('  GET  /health');
    console.log('  GET  /status');
    console.log('  GET  /search?q=<query>&limit=<n>&mode=<hybrid|bm25|vector>');
    console.log('  GET  /get/<chunkId>');
    console.log('  POST /index');
  });
}
