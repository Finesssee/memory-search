# Configuration

All config lives in `~/.memory-search/config.json`. See `config.example.json` for a template.

## Fields

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

## Environment variables

| Variable | Maps to |
|----------|---------|
| `MEMORY_EMBEDDING_ENDPOINT` | `embeddingEndpoint` |
| `MEMORY_SEARCH_DISABLE_RERANK` | Set `1` to skip reranking |

## Collections

Organize sources into named groups for filtered search:

```bash
memory collection add ./docs --name documentation
memory collection list
memory collection remove documentation
```

Use `--collection` when searching:

```bash
memory search "deploy" --collection documentation
```

## Path contexts

Label directories so the search engine understands your project structure:

```bash
memory context add ./src "Source code — TypeScript CLI"
memory context add ./docs "API documentation and guides"
memory context list
memory context rm ./src
```
