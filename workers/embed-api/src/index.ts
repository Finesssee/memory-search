export interface Env {
  AI: Ai;
}

interface EmbeddingRequest {
  content: string | string[];
  model?: 'bge' | 'gemma' | 'qwen' | 'all';
}

interface RerankRequest {
  query: string;
  documents: string[];
}

interface RerankResult {
  index: number;
  score: number;
}

const MODELS = {
  bge: '@cf/baai/bge-base-en-v1.5',
  gemma: '@cf/google/embeddinggemma-300m',
  qwen: '@cf/qwen/qwen3-embedding-0.6b',
} as const;


export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const url = new URL(request.url);

    try {
      // Chat endpoint - text generation
      if (url.pathname === '/chat' || url.pathname === '/chat/20b') {
        const body = await request.json() as { prompt: string };

        if (!body.prompt) {
          return new Response(JSON.stringify({ error: 'Missing prompt field' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        const model = url.pathname === '/chat/20b'
          ? '@cf/openai/gpt-oss-20b'
          : '@cf/openai/gpt-oss-120b';

        const result = await env.AI.run(model as any, {
          messages: [{ role: 'user', content: body.prompt }],
          max_tokens: 256,
        }) as any;

        // gpt-oss-120b returns OpenAI chat completion format
        const text = result?.choices?.[0]?.message?.content
          ?? result?.response
          ?? '';

        return new Response(JSON.stringify({ response: text }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Rerank endpoint - uses bge-reranker-base cross-encoder
      if (url.pathname === '/rerank') {
        const body = await request.json() as RerankRequest;

        if (!body.query || !body.documents?.length) {
          return new Response(JSON.stringify({ error: 'Missing query or documents' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        const rerankerResult = await env.AI.run('@cf/baai/bge-reranker-base' as any, {
          query: body.query,
          contexts: body.documents.map((text) => ({ text })),
        }) as { response: { id: number; score: number }[] };

        const results: RerankResult[] = rerankerResult.response
          .map((item) => ({ index: item.id, score: item.score }))
          .sort((a, b) => b.score - a.score);

        return new Response(JSON.stringify(results), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Default embedding endpoint
      const body = await request.json() as EmbeddingRequest;
      const texts = Array.isArray(body.content) ? body.content : [body.content];
      const modelKey = body.model || 'bge';

      if (!texts.length || !texts[0]) {
        return new Response(JSON.stringify({ error: 'Missing content field' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // If 'all' models requested, run all in parallel
      if (modelKey === 'all') {
        const [bgeResult, gemmaResult, qwenResult] = await Promise.all([
          env.AI.run(MODELS.bge, { text: texts }),
          env.AI.run(MODELS.gemma, { text: texts }),
          env.AI.run(MODELS.qwen, { text: texts }),
        ]);

        const result = texts.map((_, index) => ({
          index,
          embeddings: {
            bge: bgeResult.data[index],
            gemma: gemmaResult.data[index],
            qwen: qwenResult.data[index],
          },
        }));

        return new Response(JSON.stringify(result), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Single model
      const model = MODELS[modelKey as keyof typeof MODELS] || MODELS.bge;
      const response = await env.AI.run(model, { text: texts });

      const result = response.data.map((embedding: number[], index: number) => ({
        index,
        embedding: [embedding],
      }));

      return new Response(JSON.stringify(result), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return new Response(JSON.stringify({ error: message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
  },
};
