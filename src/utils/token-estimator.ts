export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export async function createTokenCounter(): Promise<((text: string) => number) | null> {
  try {
    const { getLocalLlm } = await import('../core/local-llm.js');
    const llm = getLocalLlm();
    if (!llm) return null;
    // Pre-warm the model so tokenize is fast
    await llm.countTokens('warmup');
    const model = llm.getEmbedModel();
    if (!model) return null;
    // model.tokenize() is synchronous once loaded
    return (text: string) => model.tokenize(text).length;
  } catch {
    return null;
  }
}
