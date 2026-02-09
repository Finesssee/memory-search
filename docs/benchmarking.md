# Benchmarking

memory-search includes an evaluation framework for measuring search quality.

## Running benchmarks

```bash
npx tsx scripts/eval.ts --benchmark scripts/benchmark.json --k 5 --verbose
npx tsx scripts/eval.ts --benchmark scripts/benchmark-hard.json --k 5 --verbose
npx tsx scripts/eval.ts --benchmark scripts/benchmark-stress.json --k 5 --verbose
```

## Configs

Each benchmark runs multiple configurations to compare:

| Config | Description |
|--------|-------------|
| `baseline` | Default search with reranking |
| `expand` | Search with LLM query expansion |
| `no-rerank` | Vector search only, no reranker |
| `expand+no-rerank` | Expanded query, no reranker |

Run specific configs:

```bash
npx tsx scripts/eval.ts --benchmark scripts/benchmark.json --configs baseline,no-rerank --verbose
```

## Metrics

- **nDCG@K** — Normalized Discounted Cumulative Gain. Measures ranking quality — are the right docs near the top?
- **MRR** — Mean Reciprocal Rank. How high is the first relevant result?
- **Recall@K** — Did the expected doc appear in the top K results at all?

## Included benchmarks

| File | Queries | Focus |
|------|---------|-------|
| `benchmark.json` | 18 | Standard queries — keyword and semantic |
| `benchmark-hard.json` | 22 | Vague natural language, typos, cross-domain |
| `benchmark-stress.json` | 80 | Large-scale: exact keywords, long-form, edge cases |

## Custom benchmarks

Create your own benchmark file:

```json
{
  "name": "my-benchmark",
  "k": 5,
  "queries": [
    {
      "id": "q1",
      "query": "how does auth work",
      "expected": ["docs/auth.md"]
    },
    {
      "id": "q2",
      "query": "deploy to production",
      "expected": ["docs/deploy.md", "runbooks/prod-deploy.md"],
      "notes": "Should match either file"
    }
  ]
}
```

Run it:

```bash
npx tsx scripts/eval.ts --benchmark path/to/my-benchmark.json --k 5 --verbose
```
