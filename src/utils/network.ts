// Network utilities with retry logic and timeout handling

import { logDebug, logWarn, errorMessage } from './log.js';

export interface FetchOptions {
  timeoutMs?: number;
  retries?: number;
  backoffMs?: number;
}

export async function fetchWithRetry(
  url: string,
  init: RequestInit,
  opts: FetchOptions = {}
): Promise<Response> {
  const { timeoutMs = 30000, retries = 5, backoffMs = 500 } = opts;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...init, signal: controller.signal });
      clearTimeout(timeout);
      if (res.ok) return res;
      // Retry on server errors (500, 502, 503, 429)
      const retryable = res.status >= 500 || res.status === 429;
      if (attempt < retries && retryable) {
        logDebug('network', `Request to ${url} returned ${res.status}, retrying (${attempt + 1}/${retries})`);
      } else {
        return res;
      }
    } catch (err) {
      clearTimeout(timeout);
      if (attempt < retries) {
        logWarn('network', `Request to ${url} failed, retrying (${attempt + 1}/${retries})`, { error: errorMessage(err) });
      }
      if (attempt === retries) throw err;
    }
    const delay = backoffMs * Math.pow(2, attempt) + Math.floor(Math.random() * 200);
    await new Promise(r => setTimeout(r, delay));
  }
  throw new Error('fetchWithRetry: unreachable');
}
