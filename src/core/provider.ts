import { logWarn, logDebug } from '../utils/log.js';
import type { AIProvider } from '../types.js';

interface ProviderState {
  provider: AIProvider;
  failures: number;
  lastFailure: number;
  cooldownMs: number;
}

const DEFAULT_COOLDOWN = 30_000; // 30 seconds
const MAX_COOLDOWN = 300_000; // 5 minutes

export class ProviderChain {
  private providers: ProviderState[];

  constructor(providers: AIProvider[]) {
    this.providers = providers
      .sort((a, b) => a.priority - b.priority)
      .map(p => ({
        provider: p,
        failures: 0,
        lastFailure: 0,
        cooldownMs: DEFAULT_COOLDOWN,
      }));
  }

  private isAvailable(state: ProviderState): boolean {
    if (state.failures === 0) return true;
    return Date.now() - state.lastFailure > state.cooldownMs;
  }

  private markFailure(state: ProviderState): void {
    state.failures++;
    state.lastFailure = Date.now();
    state.cooldownMs = Math.min(state.cooldownMs * 2, MAX_COOLDOWN);
    logWarn('provider', `Provider ${state.provider.name} failed (${state.failures} failures, cooldown ${state.cooldownMs}ms)`);
  }

  private markSuccess(state: ProviderState): void {
    state.failures = 0;
    state.cooldownMs = DEFAULT_COOLDOWN;
  }

  async chatCompletion(prompt: string): Promise<string> {
    const available = this.providers.filter(s => this.isAvailable(s));

    if (available.length === 0) {
      // All providers in cooldown, try the one with oldest failure
      const oldest = this.providers.reduce((a, b) =>
        a.lastFailure < b.lastFailure ? a : b
      );
      available.push(oldest);
    }

    for (const state of available) {
      const { provider } = state;
      const maxRetries = provider.maxRetries ?? 2;

      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          logDebug('provider', `Trying ${provider.name} (attempt ${attempt + 1})`);

          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), provider.timeoutMs ?? 30_000);

          try {
            const headers: Record<string, string> = { 'Content-Type': 'application/json' };
            if (provider.apiKey) {
              headers['Authorization'] = `Bearer ${provider.apiKey}`;
            }

            const response = await fetch(provider.endpoint, {
              method: 'POST',
              headers,
              body: JSON.stringify({ prompt, model: provider.model }),
              signal: controller.signal,
            });

            clearTimeout(timeoutId);

            if (response.ok) {
              const data = await response.json() as { response?: string; choices?: Array<{ message?: { content?: string } }> };
              const text = data.response ?? data.choices?.[0]?.message?.content ?? '';
              if (text) {
                this.markSuccess(state);
                return text;
              }
            }
          } finally {
            clearTimeout(timeoutId);
          }
        } catch (err) {
          if (attempt === maxRetries) {
            this.markFailure(state);
          }
        }
      }
    }

    throw new Error('All AI providers failed');
  }
}

let defaultChain: ProviderChain | null = null;

export function getProviderChain(providers?: AIProvider[]): ProviderChain | null {
  if (!providers || providers.length === 0) return null;
  if (!defaultChain) {
    defaultChain = new ProviderChain(providers);
  }
  return defaultChain;
}
