# memory-search

[![npm](https://img.shields.io/npm/v/memory-search.svg)](https://www.npmjs.com/package/memory-search)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue.svg)](https://www.typescriptlang.org/)
[![Node](https://img.shields.io/badge/node-%3E%3D20-green.svg)](https://nodejs.org/)
[![CI](https://github.com/Finesssee/memory-search/actions/workflows/ci.yml/badge.svg)](https://github.com/Finesssee/memory-search/actions/workflows/ci.yml)

Semantic search CLI for your personal knowledge base. Hybrid BM25 + vector search with cross-encoder reranking over markdown files, notes, session logs, and docs.

## Features

- **Hybrid search** — BM25 keyword matching + vector cosine similarity with RRF fusion
- **Search modes** — `--mode bm25|vector|hybrid` to control which retrieval paths run
- **Cross-encoder reranking** — bge-reranker-base scores query-document pairs for better relevance
- **Chunked indexing** — markdown-aware splitting with heading context preserved
- **Contextual retrieval** — optional LLM-generated context prefixes per chunk for better search (Groq, Cloudflare AI, or any OpenAI-compatible endpoint)
- **Query expansion** — optional LLM-powered query rewriting + HyDE for better recall
- **Multi-provider AI** — circuit breaker failover across multiple LLM providers with priority ordering
- **Output formats** — `--format human|json|csv|xml|md|files` for flexible output
- **Progressive retrieval** — `--layer 1|2|3` for token-efficient multi-pass search
- **Collections** — organize sources into named groups for filtered search
- **Named indexes** — `--index <name>` to switch between multiple databases
- **Observation types** — auto-detected chunk categories (`bugfix`, `feature`, `decision`, `architecture`, etc.) with `--type` filter
- **Concept tagging** — auto-extracted concepts from content with `--concept` filter
- **Short IDs** — 6-char identifiers for quick chunk retrieval (`memory get a3f2c1`)
- **Flexible get** — retrieve by numeric ID, short ID, file path, glob, or comma-separated list
- **Facts store** — key-value pairs for hard facts (preferences, configs, decisions)
- **Context builder** — generate injectable context blocks for LLM prompts
- **CLAUDE.md sync** — `memory context sync` to auto-inject memory context into CLAUDE.md
- **Config modes** — named config profiles for different workflows (`memory mode set research`)
- **Date/path filters** — `--after 7d`, `--before 2025-06-01`, `--path src/`
- **Git pull on index** — `memory index --pull` to pull sources before indexing
- **Database cleanup** — `memory cleanup` removes orphaned data and runs VACUUM
- **HTTP API server** — `memory serve --port 3737` for programmatic access
- **Cursor IDE integration** — `memory cursor install` generates `.cursor/rules/` for Cursor
- **Export/import** — backup and restore your entire database
- **Agent skill** — bundled skill definition at `skill/memory-search/` for AI coding agents
- **Local LLM execution** — optional on-device embeddings, reranking, and generation via `node-llama-cpp` with GGUF models
- **Virtual path scheme** — portable `memory://collection/file.md` URIs for collection-relative addressing
- **Token-perfect chunking** — uses real model tokenizer when local LLM is loaded, falls back to heuristic
- **VRAM lifecycle management** — auto-disposes idle model contexts after configurable inactivity timeout
- **OSC 9;4 terminal progress** — tab progress bars in Windows Terminal, iTerm2, and Hyper
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
memory search "auth" --mode bm25               # Keyword-only search
memory search "design" --type architecture     # Filter by observation type
memory search "auth" --concept "JWT"           # Filter by concept tag
memory search "overview" --layer 1             # Compact progressive retrieval
memory search "data" --format csv              # CSV output
memory search "auth" --digest                  # Ultra-compact file:lines only
memory search "deploy" --budget 500            # Cap results at 500 tokens

# Get
memory get 42                                   # By numeric chunk ID
memory get a3f2c1                               # By 6-char short ID
memory get docs/auth.md                         # By file path
memory get "docs/*.md"                          # By glob pattern
memory get 1,2,3                                # Multiple IDs
memory get docs/auth.md --raw                   # Raw content, no headers

# Index
memory index                                    # Index new/changed files
memory index --force                            # Re-embed everything
memory index --prune                            # Remove deleted files
memory index --contextualize                    # Add LLM context prefixes
memory index --pull                             # Git pull sources first

# Facts
memory facts set "project.stack" "TypeScript"   # Store a fact
memory facts get "project.*"                    # Query facts

# Context
memory context build "deploy" --limit 5         # Build injectable context block
memory context sync . --query "architecture"    # Sync into CLAUDE.md

# Modes
memory mode create research --set limit=20      # Create config profile
memory mode set research                        # Activate profile

# Utilities
memory status                                   # Index stats
memory doctor                                   # Diagnose connectivity
memory cleanup                                  # Remove orphans + VACUUM
memory serve --port 3737                        # Start HTTP API
memory cursor install                           # Cursor IDE integration
memory export -o backup.json                    # Backup
memory import backup.json                       # Restore
```

## Docs

- [Configuration](docs/configuration.md) — config fields, env vars, collections, path contexts
- [Embedding API](docs/embed-api.md) — endpoint contracts, Cloudflare deploy, local server setup
- [Agent Integration](docs/agent-integration.md) — Claude Code skill, key commands, facts, privacy tags
- [Token Efficiency](docs/token-efficiency.md) — minimize token usage with progressive retrieval and budgets
- [Best Practices](docs/best-practices.md) — chunking, indexing, searching, reranking tips
- [Architecture](docs/architecture.md) — pipeline diagram, design decisions, references
- [Benchmarking](docs/benchmarking.md) — eval framework, metrics, regression detection, CI integration

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
- **Local LLM** (`provider: "local"`) — on-device execution via `node-llama-cpp`. Uses embeddinggemma-300M for embeddings, qwen3-reranker-0.6b for reranking, and qmd-query-expansion-1.7B for generation. Models auto-download on first use. Install `node-llama-cpp` as an optional dependency.

See [docs/architecture.md](docs/architecture.md) for details and design decisions.

## Agent Skill

An agent skill is bundled at `skill/memory-search/` for use with AI coding agents (Claude Code, Cursor, etc.). The skill provides structured command documentation so agents can use `memory-search` effectively.

```
skill/memory-search/
├── SKILL.md                  # Skill definition with triggers and workflows
└── references/
    └── commands.md           # Full CLI option reference
```

## References

- [Anthropic — Contextual Retrieval](https://www.anthropic.com/engineering/contextual-retrieval)
- [Anthropic — Building Effective Agents](https://www.anthropic.com/engineering/building-effective-agents)
- [qmd](https://github.com/tobi/qmd) by Tobi Lutke
- [claude-mem](https://github.com/thedotmack/claude-mem)

## License

MIT
