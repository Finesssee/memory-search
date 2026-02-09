# Memory Search — Full Command Reference

## Global Options

| Option | Description |
|--------|-------------|
| `--index <name>` | Use a named index instead of the default database |

---

## memory search \<query\>

Search checkpoint files semantically using hybrid BM25 + vector retrieval.

| Option | Description | Default |
|--------|-------------|---------|
| `-l, --limit <n>` | Number of results | 5 |
| `-f, --format <type>` | Output format: `human`, `json`, `csv`, `xml`, `md`, `files` | `human` |
| `-e, --expand` | Expand query into variations for better recall | off |
| `--explain` | Show per-result score breakdown | off |
| `--collection <name>` | Filter by collection | — |
| `--compact` | Compact output for LLM consumption | off |
| `--timeline <chunkId>` | Show timeline context around a chunk | — |
| `--after <date>` | Filter results modified after date (e.g. `7d`, `2w`, `2025-01-15`) | — |
| `--before <date>` | Filter results modified before date | — |
| `--path <pattern>` | Filter by file path substring or glob | — |
| `--type <type>` | Filter by observation type (`bugfix`, `feature`, `decision`, `preference`, `config`, `architecture`, `reference`, `learning`) | — |
| `--concept <tag>` | Filter by concept tag | — |
| `--layer <n>` | Progressive retrieval layer: `1` = compact, `2` = timeline, `3` = get | — |
| `--mode <type>` | Search mode: `hybrid`, `bm25`, `vector` | `hybrid` |

---

## memory get \<identifier\>

Get full content by chunk ID, short ID, or file path.

**Identifier formats:**
- Numeric chunk ID: `42`
- 6-char short ID: `a3f2c1`
- File path: `docs/auth.md`
- File path with line: `docs/auth.md:100`
- Glob pattern: `"docs/*.md"`
- Comma-separated: `docs/auth.md,docs/api.md`

| Option | Description |
|--------|-------------|
| `--json` | Output raw JSON |
| `--raw` | Output raw content only (no headers) |
| `--lines <range>` | Line range filter (e.g. `10-20`) |

---

## memory index

Index or reindex checkpoint files.

| Option | Description |
|--------|-------------|
| `--force` | Force re-embed all files |
| `--prune` | Delete indexed files that no longer exist on disk |
| `--contextualize` | Generate LLM context for chunks (improves retrieval) |
| `--dry-run` | Show what would be indexed without making changes |
| `--pull` | Run git pull in source directories before indexing |

---

## memory status

Show status of memory index. Displays total chunks, files, collections, and database size.

No options.

---

## memory facts

Manage key-value facts storage.

### memory facts set \<key\> \<value\>
Store a fact.

### memory facts get \<pattern\>
Get facts matching pattern (supports `*` and `?` wildcards).

| Option | Description |
|--------|-------------|
| `--json` | Output as JSON |

### memory facts list
List all facts.

| Option | Description |
|--------|-------------|
| `--json` | Output as JSON |

### memory facts delete \<key\>
Delete a fact by exact key or pattern.

| Option | Description |
|--------|-------------|
| `--pattern` | Treat key as wildcard pattern |

---

## memory context

Manage path contexts and build context blocks.

### memory context build \<query\>
Build context block from memories for prompt injection.

| Option | Description | Default |
|--------|-------------|---------|
| `-l, --limit <n>` | Number of chunks | 5 |

### memory context add \<path\> \<description\>
Add a context description for a specific path.

### memory context list
List all path contexts.

### memory context rm \<path\>
Remove a path context.

### memory context sync [path]
Sync memory context into CLAUDE.md. Inserts between `<!-- memory-search-context:start -->` and `<!-- memory-search-context:end -->` markers.

| Option | Description |
|--------|-------------|
| `-q, --query <query>` | Search query for context generation |
| `-l, --limit <n>` | Number of chunks to include |

---

## memory sessions

Manage session history.

### memory sessions list
List recent sessions.

| Option | Description |
|--------|-------------|
| `-l, --limit <n>` | Number of sessions |

### memory sessions show \<id\>
Show captures from a session.

---

## memory collection

Manage named file collections.

### memory collection add \<path\>
Add a directory path to a collection.

| Option | Description |
|--------|-------------|
| `--name <name>` | Collection name |

### memory collection list
List all collections and their stats.

### memory collection remove \<name\>
Remove a collection.

---

## memory config

View and manage configuration.

### memory config get \<key\>
Get a configuration value.

### memory config set \<key\> \<value\>
Set a configuration value.

**Known keys:** `embeddingModel`, `embeddingEndpoint`, `apiKey`, `chunkSize`, `chunkOverlap`, `rerankerModel`, `rerankerEndpoint`, `rerankerApiKey`, `contextEndpoint`, `contextModel`, `contextApiKey`, `paths`, `aiProviders`

---

## memory mode

Manage configuration profiles (named overrides).

### memory mode create \<name\>
Create a new mode with JSON overrides from stdin or args.

| Option | Description |
|--------|-------------|
| `--set <key=value>` | Set a config key (repeatable) |

### memory mode set \<name\>
Activate a configuration mode.

### memory mode show [name]
Show mode configuration. Shows active mode if no name given.

### memory mode list
List all modes.

### memory mode clear
Deactivate current mode.

---

## memory cleanup

Remove orphaned data and optimize database. Cleans up orphaned FTS entries, orphaned vector entries, and runs VACUUM.

| Option | Description |
|--------|-------------|
| `--dry-run` | Show what would be cleaned without making changes |

---

## memory serve

Start HTTP API server.

| Option | Description | Default |
|--------|-------------|---------|
| `-p, --port <n>` | Port number | 3737 |
| `--cors` | Enable CORS headers | off |

**Endpoints:**
- `GET /health` — Health check
- `GET /status` — Index status
- `GET /search?q=<query>&limit=<n>` — Search
- `GET /get/:id` — Get chunk by ID
- `POST /index` — Trigger indexing

---

## memory cursor

Cursor IDE integration.

### memory cursor install
Install memory-search rules for Cursor IDE.

| Option | Description |
|--------|-------------|
| `--project <path>` | Project directory |

### memory cursor uninstall
Remove memory-search rules from Cursor IDE.

| Option | Description |
|--------|-------------|
| `--project <path>` | Project directory |

### memory cursor status
Check Cursor integration status.

| Option | Description |
|--------|-------------|
| `--project <path>` | Project directory |

---

## memory export

Export memory database to a JSON file.

| Option | Description | Default |
|--------|-------------|---------|
| `-o, --output <file>` | Output file path | `memory-export.json` |

---

## memory import \<file\>

Import memory database from a JSON file.

| Option | Description |
|--------|-------------|
| `--merge` | Merge with existing data instead of replacing |

---

## memory cache prune

Remove stale cache entries.

---

## memory doctor

Diagnose configuration and connectivity issues. Checks config validity, database accessibility, embedding endpoint connectivity, and reranker availability.

No options.
