// Content hashing for change detection

import { createHash } from 'node:crypto';

export function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

export function shortId(content: string): string {
  return createHash('sha256').update(content).digest('hex').slice(0, 6);
}
