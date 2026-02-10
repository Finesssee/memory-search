# Benchmarking

memory-search includes a comprehensive evaluation framework for measuring search quality, token efficiency, and performance over time.

## Running Benchmarks

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

| Metric | What it measures | Good value |
|--------|-----------------|------------|
| **nDCG@K** | Ranking quality — are right docs near the top? | > 0.7 |
| **MRR** | How high is the first relevant result? | > 0.8 |
| **Recall@K** | Did expected docs appear in top K? | > 0.7 |
| **Precision@K** | What fraction of top K results are relevant? | > 0.5 |
| **Latency** | End-to-end search time per query | < 2s |
| **Tokens** | Total tokens in returned results | Lower is better |

## Included Benchmarks

| File | Queries | Categories | Focus |
|------|---------|------------|-------|
| `benchmark.json` | 18 | exact-keyword, semantic | Standard queries |
| `benchmark-hard.json` | 22 | session-memory, cross-domain, vague, edge-case | Hard queries |
| `benchmark-stress.json` | 80 | exact-keyword, natural-language, cross-domain, vague-fuzzy, technical, edge-case | Full stress test |

## Category Breakdown

The eval groups results by the `notes`/`category` field in each query, so you can see which query types your pipeline handles well vs. poorly:

```
Category           nDCG@K  MRR    Recall@K  Queries
exact-keyword      0.920   0.950  0.880     18
natural-language   0.750   0.800  0.720     18
cross-domain       0.680   0.720  0.650     12
vague-fuzzy        0.550   0.600  0.500     12
edge-case          0.420   0.450  0.380     8
```

## Regression Detection

Save a baseline and compare against it on subsequent runs:

```bash
# Save baseline
npx tsx scripts/eval.ts --benchmark scripts/benchmark.json --json > scripts/baseline-v1.json

# Compare after changes
npx tsx scripts/eval.ts --benchmark scripts/benchmark.json --compare scripts/baseline-v1.json
```

The comparator reports regressions (metrics that dropped) and improvements:

```
Regression Detection:
  baseline: nDCG 0.850 → 0.820 (-0.030) ⚠️
  baseline: recall 0.780 → 0.800 (+0.020) ✓
```

## CI Integration

Use `--json` for machine-readable output in CI pipelines:

```bash
npx tsx scripts/eval.ts --benchmark scripts/benchmark.json --json | jq '.summary.avgNDCG'
```

Example CI assertion (GitHub Actions):

```yaml
- name: Run search quality evals
  run: |
    RESULT=$(npx tsx scripts/eval.ts --benchmark scripts/benchmark.json --json)
    NDCG=$(echo "$RESULT" | jq -r '.summary.avgNDCG')
    if (( $(echo "$NDCG < 0.7" | bc -l) )); then
      echo "nDCG regression: $NDCG < 0.7"
      exit 1
    fi
```

## Custom Benchmarks

Create your own benchmark file:

```json
{
  "name": "my-benchmark",
  "k": 5,
  "queries": [
    {
      "id": "q1",
      "query": "how does auth work",
      "expected": ["docs/auth.md"],
      "notes": "exact-keyword",
      "difficulty": "easy"
    },
    {
      "id": "q2",
      "query": "deploy to production",
      "expected": ["docs/deploy.md", "runbooks/prod-deploy.md"],
      "notes": "natural-language",
      "difficulty": "medium"
    }
  ]
}
```

### Creating Effective Benchmarks

- **Cover all query types** — exact keywords, natural language, vague, typos, cross-domain
- **Include difficulty levels** — easy queries validate basics, hard queries push the pipeline
- **Use specific expected files** — the more specific the path, the more meaningful the metric
- **Add notes** — categories like `session-memory`, `cross-domain`, `edge-case` enable breakdown analysis
- **Start small, grow over time** — begin with 10–20 queries, add more as you discover failure cases
