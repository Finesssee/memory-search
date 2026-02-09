import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { Config } from '../types.js';

const MODES_DIR = join(homedir(), '.memory-search', 'modes');
const ACTIVE_MODE_FILE = join(homedir(), '.memory-search', 'active-mode');

function ensureModesDir(): void {
  mkdirSync(MODES_DIR, { recursive: true });
}

export function createMode(name: string, overrides: Partial<Config>): void {
  ensureModesDir();
  const modePath = join(MODES_DIR, `${name}.json`);
  writeFileSync(modePath, JSON.stringify(overrides, null, 2));
}

export function getMode(name: string): Partial<Config> | null {
  const modePath = join(MODES_DIR, `${name}.json`);
  if (!existsSync(modePath)) return null;
  return JSON.parse(readFileSync(modePath, 'utf-8'));
}

export function listModes(): string[] {
  ensureModesDir();
  return readdirSync(MODES_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => f.replace('.json', ''));
}

export function setActiveMode(name: string): void {
  writeFileSync(ACTIVE_MODE_FILE, name);
}

export function getActiveMode(): string | null {
  if (!existsSync(ACTIVE_MODE_FILE)) return null;
  const name = readFileSync(ACTIVE_MODE_FILE, 'utf-8').trim();
  return name || null;
}

export function clearActiveMode(): void {
  if (existsSync(ACTIVE_MODE_FILE)) unlinkSync(ACTIVE_MODE_FILE);
}

export function applyMode(config: Config): Config {
  const activeName = getActiveMode();
  if (!activeName) return config;
  const overrides = getMode(activeName);
  if (!overrides) return config;
  return { ...config, ...overrides };
}
