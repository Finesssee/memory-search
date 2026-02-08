// Configuration loading and management

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import type { Config, ContextLlmSlot } from '../types.js';

const CONFIG_DIR = join(homedir(), '.memory-search');
const CONFIG_PATH = join(CONFIG_DIR, 'config.json');

const DEFAULT_CONFIG: Config = {
  sources: [],
  indexPath: join(CONFIG_DIR, 'index.db'),
  embeddingEndpoint: 'http://localhost:8080/embedding',
  embeddingDimensions: 768,
  chunkMaxTokens: 1000,
  chunkOverlapTokens: 150,
  searchTopK: 15,
  searchCandidateCap: 200,
};

/** Maps environment variable names to Config field overrides. */
export const ENV_OVERRIDES: Record<string, keyof Config> = {
  MEMORY_EMBEDDING_ENDPOINT: 'embeddingEndpoint',
  MEMORY_LLM_ENDPOINT:       'contextLlmEndpoint',
  MEMORY_LLM_API_KEY:        'contextLlmApiKey',
  MEMORY_LLM_MODEL:          'contextLlmModel',
};

export function applyEnvOverrides(config: Config): Config {
  const result = { ...config };
  for (const [envVar, field] of Object.entries(ENV_OVERRIDES)) {
    const value = process.env[envVar];
    if (value === undefined || value === '') continue;
    (result as unknown as Record<string, unknown>)[field] = value;
  }

  // MEMORY_LLM_API_KEY also cascades into all contextLlmEndpoints slots
  const apiKeyOverride = process.env['MEMORY_LLM_API_KEY'];
  if (apiKeyOverride && apiKeyOverride !== '' && result.contextLlmEndpoints) {
    result.contextLlmEndpoints = result.contextLlmEndpoints.map(
      (slot): ContextLlmSlot => ({ ...slot, apiKey: apiKeyOverride })
    );
  }

  return result;
}

export function maskSecrets(config: Config): Record<string, unknown> {
  const obj: Record<string, unknown> = { ...config };

  // Mask top-level contextLlmApiKey
  if (typeof obj.contextLlmApiKey === 'string' && obj.contextLlmApiKey.length > 0) {
    obj.contextLlmApiKey = maskApiKey(obj.contextLlmApiKey as string);
  }

  // Mask apiKey in each contextLlmEndpoints slot
  if (Array.isArray(obj.contextLlmEndpoints)) {
    obj.contextLlmEndpoints = (obj.contextLlmEndpoints as ContextLlmSlot[]).map(
      (slot) => ({
        ...slot,
        apiKey: slot.apiKey ? maskApiKey(slot.apiKey) : slot.apiKey,
      })
    );
  }

  return obj;
}

function maskApiKey(key: string): string {
  if (key.length <= 4) return '***';
  return key.slice(0, 4) + '***';
}

export function ensureConfigDir(): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

export function loadConfig(): Config {
  ensureConfigDir();

  let config: Config;
  if (!existsSync(CONFIG_PATH)) {
    saveConfig(DEFAULT_CONFIG);
    config = { ...DEFAULT_CONFIG };
  } else {
    try {
      const data = readFileSync(CONFIG_PATH, 'utf-8');
      config = { ...DEFAULT_CONFIG, ...JSON.parse(data) };
    } catch {
      config = { ...DEFAULT_CONFIG };
    }
  }

  return applyEnvOverrides(config);
}

export function saveConfig(config: Config): void {
  ensureConfigDir();
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

export function getConfigPath(): string {
  return CONFIG_PATH;
}
