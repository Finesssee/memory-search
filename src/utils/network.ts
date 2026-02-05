// Network utilities with retry logic and timeout handling

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
  const { timeoutMs = 10000, retries = 2, backoffMs = 300 } = opts;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...init, signal: controller.signal });
      clearTimeout(timeout);
      if (res.ok) return res;
      if (attempt === retries) return res;
    } catch (err) {
      clearTimeout(timeout);
      if (attempt === retries) throw err;
    }
    const delay = backoffMs * Math.pow(2, attempt) + Math.floor(Math.random() * 50);
    await new Promise(r => setTimeout(r, delay));
  }
  throw new Error('fetchWithRetry: unreachable');
}
