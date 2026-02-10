import { logDebug, logWarn, logInfo } from '../utils/log.js';

const DEFAULT_EMBED_MODEL = 'hf:ggml-org/embeddinggemma-300M-GGUF/embeddinggemma-300M-Q8_0.gguf';
const DEFAULT_RERANK_MODEL = 'hf:ggml-org/Qwen3-Reranker-0.6B-Q8_0-GGUF/qwen3-reranker-0.6b-q8_0.gguf';
const DEFAULT_GENERATE_MODEL = 'hf:tobil/qmd-query-expansion-1.7B-gguf/qmd-query-expansion-1.7B-q4_k_m.gguf';
const DEFAULT_INACTIVITY_TIMEOUT = 5 * 60 * 1000;

export interface LocalLlmConfig {
  embedModel?: string;
  rerankModel?: string;
  generateModel?: string;
  modelCacheDir?: string;
  inactivityTimeoutMs?: number;
}

let nodeLlamaCppModule: any = null;

async function loadNodeLlamaCpp(): Promise<any> {
  if (nodeLlamaCppModule) return nodeLlamaCppModule;
  try {
    // Dynamic import with variable to prevent TypeScript from resolving the module
    const moduleName = 'node-llama-cpp';
    nodeLlamaCppModule = await import(/* @vite-ignore */ moduleName);
    return nodeLlamaCppModule;
  } catch {
    logDebug('local-llm', 'node-llama-cpp not available');
    return null;
  }
}

export async function isLocalLlmAvailable(): Promise<boolean> {
  return (await loadNodeLlamaCpp()) !== null;
}

export class LocalLlm {
  private config: LocalLlmConfig;
  private llama: any = null;
  private embedModel: any = null;
  private embedContext: any = null;
  private rerankModel: any = null;
  private generateModel: any = null;
  private inactivityTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;

  constructor(config: LocalLlmConfig = {}) {
    this.config = config;
  }

  private touchActivity(): void {
    if (this.inactivityTimer) clearTimeout(this.inactivityTimer);
    const timeout = this.config.inactivityTimeoutMs ?? DEFAULT_INACTIVITY_TIMEOUT;
    this.inactivityTimer = setTimeout(() => this.unloadIdleResources(), timeout);
  }

  private async ensureLlama(): Promise<any> {
    if (this.llama) return this.llama;
    const mod = await loadNodeLlamaCpp();
    if (!mod) throw new Error('node-llama-cpp is not installed');
    this.llama = await mod.getLlama();
    return this.llama;
  }

  private async ensureEmbedModel(): Promise<any> {
    if (this.embedModel) return this.embedModel;
    const llama = await this.ensureLlama();
    const modelPath = this.config.embedModel ?? DEFAULT_EMBED_MODEL;
    logInfo('local-llm', `Loading embedding model: ${modelPath}`);
    this.embedModel = await llama.loadModel({ modelUrl: modelPath });
    return this.embedModel;
  }

  private async ensureEmbedContext(): Promise<any> {
    if (this.embedContext) return this.embedContext;
    const model = await this.ensureEmbedModel();
    this.embedContext = await model.createEmbeddingContext();
    return this.embedContext;
  }

  private async ensureRerankModel(): Promise<any> {
    if (this.rerankModel) return this.rerankModel;
    const llama = await this.ensureLlama();
    const modelPath = this.config.rerankModel ?? DEFAULT_RERANK_MODEL;
    logInfo('local-llm', `Loading reranker model: ${modelPath}`);
    this.rerankModel = await llama.loadModel({ modelUrl: modelPath });
    return this.rerankModel;
  }

  private async ensureGenerateModel(): Promise<any> {
    if (this.generateModel) return this.generateModel;
    const llama = await this.ensureLlama();
    const modelPath = this.config.generateModel ?? DEFAULT_GENERATE_MODEL;
    logInfo('local-llm', `Loading generation model: ${modelPath}`);
    this.generateModel = await llama.loadModel({ modelUrl: modelPath });
    return this.generateModel;
  }

  async embed(texts: string[]): Promise<Float32Array[]> {
    const context = await this.ensureEmbedContext();
    const results: Float32Array[] = [];
    for (const text of texts) {
      const embedding = await context.getEmbeddingFor(text);
      results.push(new Float32Array(embedding.vector));
    }
    this.touchActivity();
    return results;
  }

  async rerank(query: string, documents: string[]): Promise<Array<{ index: number; score: number }>> {
    const model = await this.ensureRerankModel();
    const context = await model.createEmbeddingContext();
    try {
      const ranked = await context.rankAndSort(query, documents);
      const result = ranked.map((item: any) => ({
        index: documents.indexOf(item.document),
        score: item.score,
      }));
      this.touchActivity();
      return result;
    } finally {
      await context.dispose();
    }
  }

  async complete(prompt: string): Promise<string> {
    const model = await this.ensureGenerateModel();
    const mod = await loadNodeLlamaCpp();
    const context = await model.createContext();
    const sequence = context.getSequence();
    const session = new mod.LlamaChatSession({ contextSequence: sequence });
    try {
      let result = '';
      await session.prompt(prompt, {
        maxTokens: 500,
        temperature: 0.7,
        onTextChunk: (text: string) => { result += text; },
      });
      this.touchActivity();
      return result;
    } finally {
      await context.dispose();
    }
  }

  async tokenize(text: string): Promise<readonly any[]> {
    const model = await this.ensureEmbedModel();
    return model.tokenize(text);
  }

  async countTokens(text: string): Promise<number> {
    const tokens = await this.tokenize(text);
    return tokens.length;
  }

  getEmbedModel(): any { return this.embedModel; }

  async unloadIdleResources(): Promise<void> {
    logDebug('local-llm', 'Unloading idle resources');
    if (this.embedContext) { await this.embedContext.dispose(); this.embedContext = null; }
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    if (this.inactivityTimer) { clearTimeout(this.inactivityTimer); this.inactivityTimer = null; }
    if (this.embedContext) { await this.embedContext.dispose(); this.embedContext = null; }
    if (this.embedModel) { await this.embedModel.dispose(); this.embedModel = null; }
    if (this.rerankModel) { await this.rerankModel.dispose(); this.rerankModel = null; }
    if (this.generateModel) { await this.generateModel.dispose(); this.generateModel = null; }
    if (this.llama) { await this.llama.dispose(); this.llama = null; }
    logDebug('local-llm', 'All resources disposed');
  }
}

let defaultInstance: LocalLlm | null = null;

export function getLocalLlm(config?: LocalLlmConfig): LocalLlm | null {
  if (!defaultInstance && config) {
    defaultInstance = new LocalLlm(config);
  }
  return defaultInstance;
}

export async function initLocalLlm(config: LocalLlmConfig): Promise<LocalLlm | null> {
  const mod = await loadNodeLlamaCpp();
  if (!mod) return null;
  defaultInstance = new LocalLlm(config);
  return defaultInstance;
}

export async function disposeLocalLlm(): Promise<void> {
  if (defaultInstance) {
    await defaultInstance.dispose();
    defaultInstance = null;
  }
}
