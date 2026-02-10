# Token Efficiency

How to minimize token usage when using memory-search with AI agents.

## The Problem

Context windows fill up fast. Dumping 5 search results with full snippets can easily consume 2,000–5,000 tokens — context that could be used for reasoning instead.

Vercel's filesystem agent approach ([blog post](https://vercel.com/blog/we-removed-80-percent-of-our-agents-tools)) showed that letting agents retrieve **small slices on demand** beats pasting everything into the prompt. They achieved 37% fewer tokens while improving accuracy.

## Output Format Comparison

| Format | Tokens/Result | Includes | Use When |
|--------|--------------|----------|----------|
| `--digest` | ~10 | file, lines | Agent needs to scan and decide what to read |
| `--compact` | ~30 | file, lines, score, token count | Agent needs scores to prioritize |
| `--format json` | ~200–500 | Everything + snippets | Full context needed immediately |
| `--format human` | ~250–600 | Formatted with colors | Human reading terminal |

## Progressive Retrieval Workflow

The most token-efficient pattern for agents:

```bash
# Step 1: Scan (minimal tokens)
memory search "authentication flow" --digest
# → {"results":[{"id":42,"file":"docs/auth.md","lines":[10,35]},...]}

# Step 2: Evaluate (moderate tokens)
memory search "authentication flow" --compact
# → {"results":[{"id":42,"file":"docs/auth.md","score":0.87,"lines":[10,35],"tokens":250},...], "totalTokens": 1200}

# Step 3: Drill down (targeted tokens)
memory get 42
# → Full content of just the relevant chunk
```

## Token Budget

Use `--budget` to hard-cap the total tokens returned:

```bash
# Cap at 1000 tokens — only as many results as fit
memory search "deploy" --compact --budget 1000
# → {"results":[...],"totalTokens":950,"budget":{"truncated":true,"totalTokens":950}}

# Cap at 500 tokens with full JSON
memory search "deploy" --format json --budget 500
```

The budget applies after all filtering (`--collection`, `--after`, `--path`, etc.) and before output formatting.

## Agent Integration Patterns

### Pattern 1: Digest-first (minimal tokens)

Agent searches with `--digest`, scans file names, then `memory get` only the relevant chunks:

```
Agent: memory search "auth middleware" --digest
→ 5 results, ~50 tokens total
Agent: memory get 42 --raw
→ Only the chunk it needs, ~250 tokens
Total: ~300 tokens instead of ~2500
```

### Pattern 2: Budget-aware (predictable cost)

Agent uses `--budget` to stay within a known token limit:

```
Agent: memory search "deploy steps" --compact --budget 800
→ Results fit within 800 tokens, truncated if necessary
```

### Pattern 3: Context builder (curated)

For prompt injection, use the context builder which deduplicates and includes facts:

```bash
memory context build "deployment" --tokens 1000
```

## Tips

- Use `--compact` over `--format json` — it's 5–10x more token-efficient
- Use `--digest` when the agent only needs to know *which* files match
- Combine `--budget` with `--compact` for predictable token cost
- Use `memory get <id> --raw` to retrieve full content of specific chunks
- Store hard facts with `memory facts set` — they survive across sessions without re-searching
