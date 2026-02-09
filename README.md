# memory-search

[![npm](https://img.shields.io/npm/v/memory-search.svg)](https://www.npmjs.com/package/memory-search)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue.svg)](https://www.typescriptlang.org/)
[![Node](https://img.shields.io/badge/node-%3E%3D20-green.svg)](https://nodejs.org/)
[![CI](https://github.com/Finesssee/memory-search/actions/workflows/ci.yml/badge.svg)](https://github.com/Finesssee/memory-search/actions/workflows/ci.yml)

Semantic search CLI for your personal knowledge base. Hybrid BM25 + vector search with cross-encoder reranking over markdown files, notes, session logs, and docs.

## Features

- **Hybrid search** — BM25 keyword matching + vector cosine similarity with RRF fusion
- **Cross-encoder reranking** — bge-reranker-base scores query-document pairs for better relevance
- **Chunked indexing** — markdown-aware splitting with heading context preserved
- **Contextual retrieval** — optional LLM-generated context prefixes per chunk for better search (Groq, Cloudflare AI, or any OpenAI-compatible endpoint)
- **Query expansion** — optional LLM-powered query rewriting + HyDE for better recall
- **Collections** — organize sources into named groups for filtered search
- **Facts store** — key-value pairs for hard facts (preferences, configs, decisions)
- **Context builder** — generate injectable context blocks for LLM prompts
- **Date/path filters** — `--after 7d`, `--before 2025-06-01`, `--path src/`
- **Export/import** — backup and restore your entire database
- **SQLite + sqlite-vec** — single-file database, no external vector DB needed

## Quick start

```bash
git clone https://github.com/Finesssee/memory-search.git
cd memory-search
pnpm install && pnpm build

# Deploy the embedding worker (requires Cloudflare account)
cd workers/embed-api
cp wrangler.toml.example wrangler.toml
# Edit wrangler.toml — add your Cloudflare account_id
pnpm install && npx wrangler deploy

# Configure
# Create ~/.memory-search/config.json:
# { "sources": ["/path/to/your/notes"], "embeddingEndpoint": "https://your-worker.workers.dev/embedding" }

# Index and search
memory index
memory search "how does authentication work"
```

## Usage

```bash
# Search
memory search "deploy steps" --compact          # JSON for LLM consumption
memory search "pricing" --explain               # Score breakdown per result
memory search "hooks" --collection skills       # Filter by collection
memory search "config" --expand                 # LLM query expansion
memory search "bug" --after 7d                  # Last 7 days only
memory search "auth" --path src/                # Filter by file path

# Index
memory index                                    # Index new/changed files
memory index --force                            # Re-embed everything
memory index --prune                            # Remove deleted files
memory index --contextualize                    # Add LLM context prefixes

# Facts
memory facts set "project.stack" "TypeScript"   # Store a fact
memory facts get "project.*"                    # Query facts

# Context (for agents)
memory context build "deploy" --tokens 1000     # Build injectable context block

# Other
memory status                                   # Index stats
memory doctor                                   # Diagnose connectivity
memory export -o backup.json                    # Backup
memory import backup.json                       # Restore
```

## Docs

- [Configuration](docs/configuration.md) — config fields, env vars, collections, path contexts
- [Embedding API](docs/embed-api.md) — endpoint contracts, Cloudflare deploy, local server setup
- [Agent Integration](docs/agent-integration.md) — Claude Code skill, key commands, facts, privacy tags
- [Best Practices](docs/best-practices.md) — chunking, indexing, searching, reranking tips
- [Architecture](docs/architecture.md) — pipeline diagram, design decisions, references
- [Benchmarking](docs/benchmarking.md) — eval framework, metrics, custom benchmarks

## Architecture

```
Index:  File → Chunker → Contextualizer (optional LLM) → BGE embed → SQLite

Query:  Query → Expander (optional) → BGE embed → BM25 + Vector (parallel)
              → RRF fusion → Cross-encoder reranker → Results
```

### Providers

- **Cloudflare Workers AI** (included) — embeddings, reranking, and chat via the included worker (`workers/embed-api/`). Free tier eligible.
- **Groq** — fast LLM inference for contextual retrieval (`--contextualize`). Configure as a `contextLlmEndpoints` slot.
- **Any OpenAI-compatible endpoint** — the contextualizer and query expander work with any chat completions API.

See [docs/architecture.md](docs/architecture.md) for details and design decisions.

## References

- [Anthropic — Contextual Retrieval](https://www.anthropic.com/engineering/contextual-retrieval)
- [Anthropic — Building Effective Agents](https://www.anthropic.com/engineering/building-effective-agents)
- [qmd](https://github.com/tobi/qmd) by Tobi Lutke
- [claude-mem](https://github.com/thedotmack/claude-mem)

## License

MIT
