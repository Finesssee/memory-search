import { describe, it, expect, vi, afterEach } from 'vitest';
import { applyEnvOverrides, maskSecrets, ENV_OVERRIDES, validateConfig, KNOWN_KEYS } from './config.js';
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

describe('validateConfig', () => {
  it('passes through valid config with no warnings', () => {
    const raw = {
      indexPath: '/tmp/index.db',
      embeddingEndpoint: 'http://localhost:8080/embedding',
      embeddingDimensions: 768,
      chunkMaxTokens: 1000,
      chunkOverlapTokens: 150,
      searchTopK: 15,
    };
    const { config, warnings } = validateConfig(raw);
    expect(warnings).toHaveLength(0);
    expect(config).toEqual(raw);
  });

  it('warns on unknown keys and removes them', () => {
    const raw = {
      indexPath: '/tmp/index.db',
      bogusKey: 'hello',
      anotherBad: 42,
    };
    const { config, warnings } = validateConfig(raw);
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toContain('bogusKey');
    expect(warnings[1]).toContain('anotherBad');
    expect((config as unknown as Record<string, unknown>).bogusKey).toBeUndefined();
    expect((config as unknown as Record<string, unknown>).anotherBad).toBeUndefined();
  });

  it('warns when string field has wrong type', () => {
    const raw = { indexPath: 123 };
    const { config, warnings } = validateConfig(raw);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('indexPath');
    expect(warnings[0]).toContain('string');
    expect((config as unknown as Record<string, unknown>).indexPath).toBeUndefined();
  });

  it('warns when boolean field has wrong type', () => {
    const raw = { expandQueries: 'yes' };
    const { config, warnings } = validateConfig(raw);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('expandQueries');
    expect(warnings[0]).toContain('boolean');
  });

  it('warns when array field has wrong type', () => {
    const raw = { sources: 'not-an-array' };
    const { config, warnings } = validateConfig(raw);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('sources');
    expect(warnings[0]).toContain('array');
  });

  it('warns when numeric value is out of range', () => {
    const raw = { embeddingDimensions: 99999, searchTopK: 0 };
    const { config, warnings } = validateConfig(raw);
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toContain('embeddingDimensions');
    expect(warnings[0]).toContain('out of range');
    expect(warnings[1]).toContain('searchTopK');
    expect((config as unknown as Record<string, unknown>).embeddingDimensions).toBeUndefined();
    expect((config as unknown as Record<string, unknown>).searchTopK).toBeUndefined();
  });

  it('warns when numeric field is not a finite number', () => {
    const raw = { chunkMaxTokens: 'five hundred' };
    const { config, warnings } = validateConfig(raw);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('chunkMaxTokens');
    expect(warnings[0]).toContain('finite number');
  });

  it('KNOWN_KEYS covers all Config interface fields', () => {
    // All keys from a fully-populated Config should be in KNOWN_KEYS
    const allKeys = [
      'sources', 'collections', 'ignorePaths', 'indexPath',
      'embeddingEndpoint', 'embeddingDimensions', 'chunkMaxTokens',
      'chunkOverlapTokens', 'searchTopK', 'searchCandidateCap',
      'expandQueries', 'pathContexts', 'contextualizeChunks',
      'contextParallelism', 'contextMaxDocTokens',
      'contextLlmEndpoint', 'contextLlmModel', 'contextLlmApiKey',
      'contextLlmEndpoints',
    ];
    for (const key of allKeys) {
      expect(KNOWN_KEYS.has(key)).toBe(true);
    }
  });
});
