# Best Practices

## Chunking

- Keep chunks under 1000 tokens — large chunks dilute relevance signals
- Use overlap (default 150 tokens) so context isn't lost at boundaries
- Preserve heading hierarchy — memory-search keeps parent headings with each chunk so search results have context even when the chunk itself is mid-document

## Indexing

- Run `memory index --prune` periodically to remove stale records from deleted files
- Use collections to separate unrelated content (e.g., `skills` vs `session-logs`) — this prevents cross-contamination in search results
- Label directories with `memory context add` so the search engine understands what lives where

## Searching

- Use `--compact` for agent consumption — it strips formatting and minimizes tokens
- Use `--expand` for vague queries — the LLM rewrites your query into multiple variations for better recall
- Use `--explain` when debugging relevance — it shows the full score breakdown (BM25 rank, semantic score, reranker score, blend weights)
- Combine `--after`/`--before` with keyword queries to scope results to a time window

## Agent integration

- Use `memory context build` instead of raw search when injecting into prompts — it assembles a timeline with facts and deduplicates
- Store hard facts with `memory facts set` — key-value pairs survive across sessions and are included in context builds
- Keep fact keys namespaced (e.g., `project.stack`, `user.preference.editor`) for clean organization

## Reranking

- The cross-encoder (bge-reranker-base) sees query and document together, so it catches semantic matches that embedding cosine similarity misses
- Reranking adds latency — disable it with `MEMORY_SEARCH_DISABLE_RERANK=1` if speed matters more than precision
- Reranker scores are cached per query-document pair, so repeated searches are fast
