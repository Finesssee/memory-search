---
name: memory-search
description: Search, index, and manage a personal knowledge base using the memory-search CLI. Hybrid semantic + BM25 search over notes, session logs, code docs, and any markdown files. Use when: (1) User asks to search their notes/memory ("find my note about X", "where did I write about Y"), (2) User wants to index new files or directories into the search database, (3) User asks to manage collections, contexts, facts, or sessions, (4) User mentions "memory search", "memory-search", or the `memory` CLI command, (5) User wants to retrieve or explore previously saved knowledge, (6) User asks to run benchmarks or tune search quality, (7) User asks about their indexed content, search status, or chunk data.
---

# Memory Search

## Overview

CLI tool for hybrid semantic + BM25 search over personal knowledge bases. Indexes markdown, text, and code files into a SQLite database with vector embeddings, then provides multi-modal search with cross-encoder reranking.

Supports two providers: `api` (default, uses Cloudflare Workers) and `local` (on-device via `node-llama-cpp` with GGUF models). Files are addressable via portable `memory://collection/path` virtual URIs.

## Quick Start

```bash
# Index files from configured sources
memory index

# Search with hybrid retrieval
memory search "authentication flow"

# Get full content of a result
memory get <chunk-id>

# Check index health
memory status
```

## Core Workflows

### Search

```bash
# Basic search
memory search "query"

# More results, expanded query
memory search "query" -l 10 --expand

# BM25-only (fast keyword search)
memory search "query" --mode bm25

# Vector-only (semantic search)
memory search "query" --mode vector

# Filter by date, path, observation type, or concept
memory search "query" --after 7d --path "docs/*" --type architecture --concept "auth"

# Output formats: human (default), json, csv, xml, md, files
memory search "query" --format json

# Compact output for LLM context injection
memory search "query" --compact

# Progressive retrieval layers
memory search "query" --layer 1  # compact index
memory search "query" --layer 2  # timeline context (needs --timeline <id>)
memory get <id>                  # layer 3: full content

# Score breakdown per result
memory search "query" --explain
```

### Get / Retrieve

```bash
# By numeric chunk ID
memory get 42

# By 6-char short ID (shown in search results)
memory get a3f2c1

# By virtual path (memory:// URI)
memory get memory://docs/auth.md

# By file path
memory get docs/auth.md

# By file path with line range
memory get docs/auth.md:100 --lines 90-120

# Glob pattern or comma-separated
memory get "docs/*.md"
memory get docs/auth.md,docs/api.md

# Raw content only (no headers)
memory get <id> --raw
```

### Index

```bash
# Index configured sources
memory index

# Force full re-embed
memory index --force

# Remove files that no longer exist on disk
memory index --prune

# Generate LLM context for chunks (improves retrieval quality)
memory index --contextualize

# Git pull sources before indexing
memory index --pull

# Preview what would be indexed
memory index --dry-run
```

### Context & Facts

```bash
# Build a context block from memories for injection into prompts
memory context build "query" --limit 5

# Add path-level descriptions
memory context add src/auth "Authentication module with JWT handling"

# Sync memory context into CLAUDE.md between markers
memory context sync ./my-project --query "project architecture"

# Store key-value facts
memory facts set "db.engine" "PostgreSQL 16"
memory facts get "db.*"
memory facts list
```

## Additional Commands

| Command | Purpose |
|---------|---------|
| `memory collection add <path> --name <n>` | Group paths into named collections |
| `memory sessions list` | List recent coding sessions |
| `memory mode create <name>` | Create config profile (overrides search/index settings) |
| `memory mode set <name>` | Activate a config profile |
| `memory cleanup` | Remove orphans + VACUUM |
| `memory serve --port 3737` | Start HTTP API server |
| `memory cursor install` | Install Cursor IDE integration |
| `memory export -o backup.json` | Export database to JSON |
| `memory import backup.json --merge` | Import/merge from JSON |
| `memory doctor` | Diagnose config + connectivity |
| `memory config set <key> <value>` | Set config values |
| `memory cache prune` | Remove stale cache entries |

Use `--index <name>` on any command to use a named index instead of the default.

## Best Practices for Agents

1. **Start with `--compact` or `--layer 1`** to get a token-efficient overview before drilling down.
2. **Use `--expand`** when initial results are poor — it generates query variations for better recall.
3. **Use `--mode bm25`** for exact keyword lookups, `--mode vector` for conceptual/semantic search.
4. **Use `memory context build`** to generate pre-formatted context blocks for prompt injection.
5. **Filter aggressively** with `--after`, `--path`, `--type`, `--concept` to reduce noise.
6. **Use `memory get <id> --raw`** to retrieve content without metadata headers.

## Resources

### references/

- **commands.md** — Full command reference with all options and examples. Read when you need detailed flag documentation or edge-case usage patterns.
