// Configuration loading and management

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import type { Config, ContextLlmSlot } from '../types.js';
import { logWarn } from './log.js';
import { applyMode } from './mode-manager.js';

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

/** All valid top-level Config field names. */
export const KNOWN_KEYS = new Set<string>([
  'sources',
  'collections',
  'ignorePaths',
  'indexPath',
  'embeddingEndpoint',
  'embeddingDimensions',
  'chunkMaxTokens',
  'chunkOverlapTokens',
  'searchTopK',
  'searchCandidateCap',
  'expandQueries',
  'pathContexts',
  'contextualizeChunks',
  'contextParallelism',
  'contextMaxDocTokens',
  'contextLlmEndpoint',
  'contextLlmModel',
  'contextLlmApiKey',
  'contextLlmEndpoints',
  'aiProviders',
  'provider',
  'localLlm',
]);

const NUMERIC_RANGES: Record<string, [number, number]> = {
  embeddingDimensions: [1, 4096],
  chunkMaxTokens: [50, 10000],
  chunkOverlapTokens: [0, 5000],
  searchTopK: [1, 1000],
  searchCandidateCap: [1, 100000],
  contextParallelism: [1, 64],
  contextMaxDocTokens: [100, 200000],
};

const STRING_FIELDS = new Set([
  'indexPath',
  'embeddingEndpoint',
  'contextLlmEndpoint',
  'contextLlmModel',
  'contextLlmApiKey',
  'provider',
]);

const BOOLEAN_FIELDS = new Set([
  'expandQueries',
  'contextualizeChunks',
]);

const ARRAY_FIELDS = new Set([
  'sources',
  'collections',
  'ignorePaths',
  'pathContexts',
  'contextLlmEndpoints',
  'aiProviders',
]);

export function validateConfig(raw: Record<string, unknown>): { config: Config; warnings: string[] } {
  const warnings: string[] = [];
  const cleaned = { ...raw };

  for (const key of Object.keys(cleaned)) {
    if (!KNOWN_KEYS.has(key)) {
      warnings.push(`Unknown config key "${key}" — ignoring`);
      delete cleaned[key];
      continue;
    }

    const value = cleaned[key];

    // Type checking
    if (STRING_FIELDS.has(key)) {
      if (typeof value !== 'string') {
        warnings.push(`Config key "${key}" should be a string — using default`);
        delete cleaned[key];
      }
    } else if (BOOLEAN_FIELDS.has(key)) {
      if (typeof value !== 'boolean') {
        warnings.push(`Config key "${key}" should be a boolean — using default`);
        delete cleaned[key];
      }
    } else if (ARRAY_FIELDS.has(key)) {
      if (!Array.isArray(value)) {
        warnings.push(`Config key "${key}" should be an array — using default`);
        delete cleaned[key];
      }
    } else if (key in NUMERIC_RANGES) {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        warnings.push(`Config key "${key}" should be a finite number — using default`);
        delete cleaned[key];
      } else {
        const [min, max] = NUMERIC_RANGES[key];
        if (value < min || value > max) {
          warnings.push(`Config key "${key}" value ${value} is out of range [${min}, ${max}] — using default`);
          delete cleaned[key];
        }
      }
    }
  }

  return { config: cleaned as unknown as Config, warnings };
}

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

let indexOverride: string | undefined;

export function setIndexOverride(name: string): void {
  indexOverride = name;
}

export function applyIndexOverride(config: Config, indexName?: string): Config {
  if (!indexName) return config;
  const indexDir = join(homedir(), '.memory-search', 'indexes');
  mkdirSync(indexDir, { recursive: true });
  return { ...config, indexPath: join(indexDir, `${indexName}.db`) };
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
      const parsed = JSON.parse(data) as Record<string, unknown>;
      const { config: validated, warnings } = validateConfig(parsed);
      for (const w of warnings) {
        logWarn('config', w);
      }
      config = { ...DEFAULT_CONFIG, ...validated };
    } catch {
      config = { ...DEFAULT_CONFIG };
    }
  }

  config = applyMode(config);
  config = applyEnvOverrides(config);

  if (indexOverride) {
    config = applyIndexOverride(config, indexOverride);
  }

  return config;
}

export function saveConfig(config: Config): void {
  ensureConfigDir();
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

export function getConfigPath(): string {
  return CONFIG_PATH;
}
