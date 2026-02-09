# Embedding API

memory-search needs an HTTP server that provides embeddings, reranking, and chat completions. The included Cloudflare Worker (`workers/embed-api/`) implements this, but you can use any server that matches the API contract.

## Endpoints

### POST /embedding

Generate text embeddings.

**Request:**
```json
{
  "content": ["first document", "second document"],
  "model": "bge"
}
```

- `content` — string or array of strings to embed
- `model` — optional, defaults to `bge`

**Response:**
```json
[
  { "index": 0, "embedding": [[0.012, -0.034, ...]] },
  { "index": 1, "embedding": [[0.056, 0.078, ...]] }
]
```

Each `embedding` is a nested array — `embedding[0]` contains the float vector (768 dimensions for BGE).

### POST /rerank

Score documents against a query using a cross-encoder.

**Request:**
```json
{
  "query": "how does auth work",
  "documents": ["Auth uses JWT tokens...", "The weather is nice..."]
}
```

**Response:**
```json
[
  { "index": 0, "score": 0.946 },
  { "index": 1, "score": 0.00004 }
]
```

Results sorted by score descending. Scores are logits (can be negative or >1) — the client normalizes them.

### POST /chat

LLM text generation for query expansion and fact extraction.

**Request:**
```json
{
  "prompt": "Expand this search query into variations: 'auth bug'"
}
```

**Response:**
```json
{
  "response": "1. authentication error\n2. login failure\n3. auth token bug"
}
```

## Deploy with Cloudflare Workers

The included worker uses Cloudflare Workers AI (free tier eligible):

```bash
cd workers/embed-api
cp wrangler.toml.example wrangler.toml
# Edit wrangler.toml — set your account_id
pnpm install
npx wrangler deploy
```

Models used:
- **Embeddings:** `@cf/baai/bge-base-en-v1.5` (768 dimensions)
- **Reranker:** `@cf/baai/bge-reranker-base` (cross-encoder)
- **Chat:** `@cf/openai/gpt-oss-120b`

Then set your config:
```json
{
  "embeddingEndpoint": "https://your-worker.workers.dev/embedding"
}
```

The client derives all other endpoints from this base URL (`/rerank`, `/chat`).

## Use a local server

Any HTTP server that implements the endpoints above will work. Set `embeddingEndpoint` to your local server:

```json
{
  "embeddingEndpoint": "http://localhost:8080/embedding"
}
```

### Example: custom server with Ollama

You'd need a thin wrapper that translates between memory-search's API format and Ollama's. The key contract:

- `/embedding` must accept `{ content: string[] }` and return `[{ index, embedding: [float[]] }]`
- `/rerank` must accept `{ query, documents }` and return `[{ index, score }]`
- `/chat` must accept `{ prompt }` and return `{ response: string }`

If you skip the chat endpoint, query expansion (`--expand`) and auto-capture LLM filtering won't work, but core search still functions. If you skip the rerank endpoint, set `MEMORY_SEARCH_DISABLE_RERANK=1` and search will use vector + BM25 only.

## Endpoint derivation

The client only stores the embedding endpoint URL. All other endpoints are derived by replacing the path:

| Config value | Derived endpoints |
|---|---|
| `https://worker.dev/embedding` | `/rerank`, `/chat`, `/expand` |
| `http://localhost:8080/embedding` | `http://localhost:8080/rerank`, etc. |
| `http://localhost:8080` | `http://localhost:8080/embedding`, `/rerank`, etc. |
