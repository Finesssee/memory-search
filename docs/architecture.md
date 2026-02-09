# Architecture

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

## Components

- **Database:** SQLite with sqlite-vec for vector indexing
- **Embeddings:** Cloudflare Workers AI (`@cf/baai/bge-base-en-v1.5`, 768 dimensions)
- **Reranker:** Cloudflare Workers AI (`@cf/baai/bge-reranker-base`, cross-encoder)
- **Caching:** Query embeddings and reranker scores cached in SQLite

## Design decisions

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
