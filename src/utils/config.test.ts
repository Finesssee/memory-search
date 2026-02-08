import { describe, it, expect, vi, afterEach } from 'vitest';
import { applyEnvOverrides, maskSecrets, ENV_OVERRIDES } from './config.js';
import type { Config, ContextLlmSlot } from '../types.js';

function baseConfig(): Config {
  return {
    sources: [],
    indexPath: '/tmp/index.db',
    embeddingEndpoint: 'http://localhost:8080/embedding',
    embeddingDimensions: 768,
    chunkMaxTokens: 1000,
    chunkOverlapTokens: 150,
    searchTopK: 15,
    searchCandidateCap: 200,
  };
}

function configWithSlots(): Config {
  return {
    ...baseConfig(),
    contextLlmApiKey: 'sk-original-key',
    contextLlmEndpoints: [
      { endpoint: 'http://a:8080', model: 'gpt-4', apiKey: 'sk-slot-a-key', parallelism: 2 },
      { endpoint: 'http://b:8080', model: 'gpt-4', apiKey: 'sk-slot-b-key' },
    ],
  };
}

describe('applyEnvOverrides', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns config unchanged when no env vars are set', () => {
    const config = baseConfig();
    const result = applyEnvOverrides(config);
    expect(result).toEqual(config);
  });

  it('overrides embeddingEndpoint from MEMORY_EMBEDDING_ENDPOINT', () => {
    vi.stubEnv('MEMORY_EMBEDDING_ENDPOINT', 'http://remote:9090/embed');
    const result = applyEnvOverrides(baseConfig());
    expect(result.embeddingEndpoint).toBe('http://remote:9090/embed');
  });

  it('overrides contextLlmEndpoint from MEMORY_LLM_ENDPOINT', () => {
    vi.stubEnv('MEMORY_LLM_ENDPOINT', 'http://llm:4000/v1');
    const result = applyEnvOverrides(baseConfig());
    expect(result.contextLlmEndpoint).toBe('http://llm:4000/v1');
  });

  it('overrides contextLlmModel from MEMORY_LLM_MODEL', () => {
    vi.stubEnv('MEMORY_LLM_MODEL', 'claude-opus-4');
    const result = applyEnvOverrides(baseConfig());
    expect(result.contextLlmModel).toBe('claude-opus-4');
  });

  it('overrides contextLlmApiKey AND all contextLlmEndpoints[].apiKey from MEMORY_LLM_API_KEY', () => {
    vi.stubEnv('MEMORY_LLM_API_KEY', 'sk-env-override-key');
    const result = applyEnvOverrides(configWithSlots());

    expect(result.contextLlmApiKey).toBe('sk-env-override-key');
    expect(result.contextLlmEndpoints).toHaveLength(2);
    expect(result.contextLlmEndpoints![0].apiKey).toBe('sk-env-override-key');
    expect(result.contextLlmEndpoints![1].apiKey).toBe('sk-env-override-key');
  });

  it('does not override when env var is empty string', () => {
    vi.stubEnv('MEMORY_EMBEDDING_ENDPOINT', '');
    vi.stubEnv('MEMORY_LLM_API_KEY', '');
    const config = configWithSlots();
    const result = applyEnvOverrides(config);

    expect(result.embeddingEndpoint).toBe('http://localhost:8080/embedding');
    expect(result.contextLlmApiKey).toBe('sk-original-key');
    expect(result.contextLlmEndpoints![0].apiKey).toBe('sk-slot-a-key');
  });

  it('partial override only changes specified fields', () => {
    vi.stubEnv('MEMORY_LLM_MODEL', 'gpt-5');
    const config = configWithSlots();
    const result = applyEnvOverrides(config);

    // Changed
    expect(result.contextLlmModel).toBe('gpt-5');
    // Unchanged
    expect(result.embeddingEndpoint).toBe('http://localhost:8080/embedding');
    expect(result.contextLlmApiKey).toBe('sk-original-key');
    expect(result.contextLlmEndpoints![0].apiKey).toBe('sk-slot-a-key');
  });

  it('does not mutate the original config object', () => {
    vi.stubEnv('MEMORY_LLM_API_KEY', 'sk-new');
    const config = configWithSlots();
    applyEnvOverrides(config);

    expect(config.contextLlmApiKey).toBe('sk-original-key');
    expect(config.contextLlmEndpoints![0].apiKey).toBe('sk-slot-a-key');
  });

  it('handles MEMORY_LLM_API_KEY when no contextLlmEndpoints exist', () => {
    vi.stubEnv('MEMORY_LLM_API_KEY', 'sk-env-key');
    const config = baseConfig();
    const result = applyEnvOverrides(config);

    expect(result.contextLlmApiKey).toBe('sk-env-key');
    expect(result.contextLlmEndpoints).toBeUndefined();
  });
});

describe('maskSecrets', () => {
  it('masks contextLlmApiKey to first 4 chars + ***', () => {
    const config = { ...baseConfig(), contextLlmApiKey: 'sk-abcdef1234567890xyz' };
    const masked = maskSecrets(config);
    expect(masked.contextLlmApiKey).toBe('sk-a***');
  });

  it('masks short API keys to just ***', () => {
    const config = { ...baseConfig(), contextLlmApiKey: 'abc' };
    const masked = maskSecrets(config);
    expect(masked.contextLlmApiKey).toBe('***');
  });

  it('masks apiKey in all contextLlmEndpoints slots', () => {
    const config = configWithSlots();
    const masked = maskSecrets(config);
    const slots = masked.contextLlmEndpoints as ContextLlmSlot[];

    expect(slots[0].apiKey).toBe('sk-s***');
    expect(slots[1].apiKey).toBe('sk-s***');
  });

  it('does not mask empty string', () => {
    const config = { ...baseConfig(), contextLlmApiKey: '' };
    const masked = maskSecrets(config);
    expect(masked.contextLlmApiKey).toBe('');
  });

  it('preserves non-secret fields unchanged', () => {
    const config = baseConfig();
    const masked = maskSecrets(config);
    expect(masked.embeddingEndpoint).toBe('http://localhost:8080/embedding');
    expect(masked.searchTopK).toBe(15);
  });

  it('does not mutate the original config', () => {
    const config = configWithSlots();
    maskSecrets(config);
    expect(config.contextLlmApiKey).toBe('sk-original-key');
    expect(config.contextLlmEndpoints![0].apiKey).toBe('sk-slot-a-key');
  });
});

describe('ENV_OVERRIDES', () => {
  it('maps expected env var names', () => {
    expect(Object.keys(ENV_OVERRIDES)).toEqual([
      'MEMORY_EMBEDDING_ENDPOINT',
      'MEMORY_LLM_ENDPOINT',
      'MEMORY_LLM_API_KEY',
      'MEMORY_LLM_MODEL',
    ]);
  });

  it('maps to correct config fields', () => {
    expect(ENV_OVERRIDES['MEMORY_EMBEDDING_ENDPOINT']).toBe('embeddingEndpoint');
    expect(ENV_OVERRIDES['MEMORY_LLM_ENDPOINT']).toBe('contextLlmEndpoint');
    expect(ENV_OVERRIDES['MEMORY_LLM_API_KEY']).toBe('contextLlmApiKey');
    expect(ENV_OVERRIDES['MEMORY_LLM_MODEL']).toBe('contextLlmModel');
  });
});
