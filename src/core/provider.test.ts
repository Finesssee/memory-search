import { describe, it, expect } from 'vitest';
import { ProviderChain } from './provider.js';

describe('ProviderChain', () => {
  it('creates chain from providers', () => {
    const chain = new ProviderChain([
      { name: 'test', endpoint: 'http://localhost:9999/chat', priority: 1 },
    ]);
    expect(chain).toBeDefined();
  });

  it('throws when all providers fail', async () => {
    const chain = new ProviderChain([
      { name: 'bad', endpoint: 'http://localhost:1/nope', priority: 1, maxRetries: 0, timeoutMs: 100 },
    ]);
    await expect(chain.chatCompletion('test')).rejects.toThrow('All AI providers failed');
  });
});
