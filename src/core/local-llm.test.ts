import { describe, it, expect } from 'vitest';
import { isLocalLlmAvailable, LocalLlm, getLocalLlm, disposeLocalLlm } from './local-llm.js';

describe('local-llm', () => {
  it('isLocalLlmAvailable returns false when node-llama-cpp is not installed', async () => {
    const available = await isLocalLlmAvailable();
    expect(available).toBe(false);
  });

  it('getLocalLlm returns null without prior init', () => {
    const llm = getLocalLlm();
    expect(llm).toBeNull();
  });

  it('LocalLlm constructor accepts config', () => {
    const llm = new LocalLlm({ inactivityTimeoutMs: 1000 });
    expect(llm).toBeInstanceOf(LocalLlm);
  });

  it('dispose is idempotent', async () => {
    const llm = new LocalLlm();
    await llm.dispose();
    await llm.dispose(); // second call should not throw
  });

  it('disposeLocalLlm handles null singleton', async () => {
    await disposeLocalLlm(); // should not throw
  });
});
