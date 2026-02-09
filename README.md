# memory-search

Semantic search CLI for your personal knowledge base. Hybrid BM25 + vector search with cross-encoder reranking over markdown files, notes, session logs, and docs.

## Features

- **Hybrid search** — BM25 keyword matching + vector cosine similarity with RRF fusion
- **Cross-encoder reranking** — bge-reranker-base scores query-document pairs for better relevance
- **Chunked indexing** — markdown-aware splitting with heading context preserved
- **Query expansion** — optional LLM-powered query rewriting + HyDE for better recall
- **Collections** — organize sources into named groups for filtered search
- **Facts store** — key-value pairs for hard facts (preferences, configs, decisions)
- **Context builder** — generate injectable context blocks for LLM prompts
- **Timeline view** — see surrounding chunks for any search result
- **Date/path filters** — `--after 7d`, `--before 2025-06-01`, `--path src/`
- **Export/import** — backup and restore your entire database
- **SQLite + sqlite-vec** — single-file database, no external vector DB needed

## Install

```bash
git clone https://github.com/YOUR_USERNAME/memory-search.git
cd memory-search
pnpm install
pnpm build
```

To use globally:

```bash
npm link
# now available as `memory` command
```

## Setup

### 1. Deploy the embedding worker

memory-search uses a Cloudflare Worker for embeddings and reranking. Deploy your own:

```bash
cd workers/embed-api
cp wrangler.toml.example wrangler.toml
# Edit wrangler.toml — add your Cloudflare account_id
pnpm install
npx wrangler deploy
```

The worker provides these endpoints:
- `POST /embedding` — BGE text embeddings (768 dimensions)
- `POST /rerank` — bge-reranker-base cross-encoder scoring
- `POST /chat` — LLM chat (used for query expansion and fact extraction)
- `POST /expand` — query expansion

### 2. Configure

Create `~/.memory-search/config.json`:

```json
{
  "sources": ["/path/to/your/notes", "/path/to/more/docs"],
  "embeddingEndpoint": "https://your-worker.workers.dev/embedding"
}
```

See `config.example.json` for all available options.

### 3. Index your files

```bash
memory index
```

This scans all `sources` directories for markdown files, chunks them, and generates embeddings.

## Usage

### Search

```bash
memory search "how does authentication work"
memory search "deploy steps" --compact          # JSON output for LLM consumption
memory search "pricing" --explain               # Show score breakdown per result
memory search "hooks" --collection skills       # Filter by collection
memory search "config" --expand                 # LLM query expansion for better recall
memory search "bug" --after 7d                  # Only results from last 7 days
memory search "auth" --path src/                # Filter by file path
memory search "deploy" --format json --limit 10
```

### Index

```bash
memory index              # Index new/changed files
memory index --force      # Re-embed everything
memory index --prune      # Remove records for deleted files
```

### Collections

```bash
memory collection add ./docs --name documentation
memory collection list
memory collection remove documentation
```

### Facts

Key-value store for structured knowledge:

```bash
memory facts set "project.stack" "TypeScript, SQLite, Cloudflare Workers"
memory facts get "project.*"
memory facts list
memory facts delete "project.stack"
```

### Context (for agent integration)

Build context blocks from search results + facts for injection into LLM prompts:

```bash
memory context build "deployment process" --tokens 1000
```

Label directories so the search engine understands your project structure:

```bash
memory context add ./src "Source code — TypeScript CLI"
memory context add ./docs "API documentation and guides"
memory context list
```

### Other commands

```bash
memory status             # Index stats
memory get <chunkId>      # Full content for a specific chunk
memory doctor             # Diagnose config and connectivity
memory cache clear        # Clear embedding/reranker caches
memory export -o bak.json # Backup database
memory import bak.json    # Restore from backup
memory sessions list      # View tracked sessions
```

## Agent integration

memory-search is designed to work as a tool for AI coding agents.

### Claude Code skill

Copy `skill.md` to your Claude skills directory to teach Claude how to use memory-search:

```bash
mkdir -p ~/.claude/skills/memory-search
cp skill.md ~/.claude/skills/memory-search/skill.md
```

Claude will then use `memory search`, `memory context build`, and `memory facts` commands when relevant.

### Key commands for agents

| Command | Purpose |
|---------|---------|
| `memory search <query> --compact` | JSON output optimized for LLM token efficiency |
| `memory context build <query> --tokens N` | Build a context block with timeline + facts |
| `memory facts set/get/list` | Persistent key-value store agents can read/write |
| `memory search <query> --format json` | Full structured JSON output |

### Privacy

Wrap content in privacy tags to prevent it from being captured or indexed:

```markdown
<private>This will not be indexed</private>
<secret>Neither will this</secret>
<sensitive>Or this</sensitive>
<redact>Or this</redact>
```

## Configuration

All config lives in `~/.memory-search/config.json`. Available fields:

| Field | Default | Description |
|-------|---------|-------------|
| `sources` | `[]` | Directories to scan for markdown files |
| `indexPath` | `~/.memory-search/index.db` | SQLite database location |
| `embeddingEndpoint` | `http://localhost:8080/embedding` | Embedding server URL |
| `embeddingDimensions` | `768` | Vector dimensions (match your model) |
| `chunkMaxTokens` | `1000` | Max tokens per chunk |
| `chunkOverlapTokens` | `150` | Overlap between chunks |
| `searchTopK` | `15` | Candidates to retrieve before reranking |
| `searchCandidateCap` | `300` | Max BM25 candidates |
| `expandQueries` | `false` | Enable LLM query expansion by default |
| `collections` | `[]` | Named file groups: `[{ name, paths }]` |
| `pathContexts` | `[]` | Directory descriptions: `[{ path, description }]` |

### Environment variables

| Variable | Maps to |
|----------|---------|
| `MEMORY_EMBEDDING_ENDPOINT` | `embeddingEndpoint` |
| `MEMORY_SEARCH_DISABLE_RERANK` | Set `1` to skip reranking |

## Best practices

### Chunking

- Keep chunks under 1000 tokens — large chunks dilute relevance signals
- Use overlap (default 150 tokens) so context isn't lost at boundaries
- Preserve heading hierarchy — memory-search keeps parent headings with each chunk so search results have context even when the chunk itself is mid-document

### Indexing

- Run `memory index --prune` periodically to remove stale records from deleted files
- Use collections to separate unrelated content (e.g., `skills` vs `session-logs`) — this prevents cross-contamination in search results
- Label directories with `memory context add` so the search engine understands what lives where

### Searching

- Use `--compact` for agent consumption — it strips formatting and minimizes tokens
- Use `--expand` for vague queries — the LLM rewrites your query into multiple variations for better recall
- Use `--explain` when debugging relevance — it shows the full score breakdown (BM25 rank, semantic score, reranker score, blend weights)
- Combine `--after`/`--before` with keyword queries to scope results to a time window

### Agent integration

- Use `memory context build` instead of raw search when injecting into prompts — it assembles a timeline with facts and deduplicates
- Store hard facts with `memory facts set` — key-value pairs survive across sessions and are included in context builds
- Keep fact keys namespaced (e.g., `project.stack`, `user.preference.editor`) for clean organization

### Reranking

- The cross-encoder (bge-reranker-base) sees query and document together, so it catches semantic matches that embedding cosine similarity misses
- Reranking adds latency — disable it with `MEMORY_SEARCH_DISABLE_RERANK=1` if speed matters more than precision
- Reranker scores are cached per query-document pair, so repeated searches are fast

## Architecture

```
Query
  → Expander (optional LLM + HyDE)
  → BGE embedding (768d)
  → Parallel: BM25 keyword search + Vector cosine similarity
  → Weighted RRF fusion
  → Cross-encoder reranker (bge-reranker-base)
  → Blended final scores
  → Results
```

- **Database:** SQLite with sqlite-vec for vector indexing
- **Embeddings:** Cloudflare Workers AI (`@cf/baai/bge-base-en-v1.5`, 768 dimensions)
- **Reranker:** Cloudflare Workers AI (`@cf/baai/bge-reranker-base`, cross-encoder)
- **Caching:** Query embeddings and reranker scores cached in SQLite

### Design decisions

- **Hybrid BM25 + vector** rather than vector-only — BM25 catches exact keyword matches that embeddings miss, especially for technical terms, error codes, and proper nouns
- **RRF fusion** over learned fusion — Reciprocal Rank Fusion is simple, parameter-free, and works well when combining two ranked lists of different scales
- **Cross-encoder reranker** over bi-encoder reranker — cross-encoders score query-document pairs together (not independently), producing more accurate relevance judgments at the cost of not being cacheable by document alone
- **SQLite single-file DB** over dedicated vector databases — for personal knowledge bases (tens of thousands of chunks), sqlite-vec is fast enough and eliminates infrastructure complexity
- **Cloudflare Workers AI** over local models — keeps the CLI lightweight with no GPU requirement; the worker is free-tier eligible

## References and prior art

memory-search draws from several projects and research:

- **[Anthropic — Contextual Retrieval](https://www.anthropic.com/engineering/contextual-retrieval)** — The hybrid BM25 + embedding + reranking pipeline is directly inspired by this work, which showed that combining contextual embeddings with BM25 reduces retrieval failure by 49%, and adding a reranker pushes that to 67%
- **[Anthropic — Building Effective Agents](https://www.anthropic.com/engineering/building-effective-agents)** — The augmented LLM pattern (retrieval + tools + memory) and the principle of starting simple before adding complexity shaped the overall architecture
- **[qmd](https://github.com/tobi/qmd)** by Tobi Lutke — An on-device search engine for personal docs using hybrid search with query expansion, RRF fusion, and local GGUF models via node-llama-cpp. memory-search shares the same hybrid pipeline philosophy but trades local models for Cloudflare Workers AI to avoid GPU requirements
- **[claude-mem](https://github.com/thedotmack/claude-mem)** — A Claude Code plugin that auto-captures session context with hybrid semantic + keyword search over SQLite and Chroma. memory-search takes a similar approach to session capture but uses a single SQLite database (with sqlite-vec) instead of a separate vector DB

## Benchmarking

```bash
npx tsx scripts/eval.ts --benchmark scripts/benchmark.json --k 5 --verbose
npx tsx scripts/eval.ts --benchmark scripts/benchmark-hard.json --k 5 --verbose
npx tsx scripts/eval.ts --benchmark scripts/benchmark-stress.json --k 5 --verbose
```

Configs: `baseline`, `expand`, `no-rerank`, `expand+no-rerank`

Create custom benchmarks:

```json
{
  "name": "my-benchmark",
  "k": 5,
  "queries": [
    {
      "id": "q1",
      "query": "how does auth work",
      "expected": ["docs/auth.md"]
    }
  ]
}
```

## License

MIT
