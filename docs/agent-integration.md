# Agent Integration

memory-search is designed to work as a token-efficient context retrieval tool for AI coding agents.

## Claude Code Skill

Copy the bundled skill to your Claude skills directory:

```bash
mkdir -p ~/.claude/skills/memory-search
cp skill/memory-search/SKILL.md ~/.claude/skills/memory-search/SKILL.md
```

Claude will then use `memory search`, `memory context build`, and `memory facts` commands when relevant.

## Key Commands for Agents

| Command | Tokens | Purpose |
|---------|--------|---------|
| `memory search <query> --digest` | ~50 | File references only — scan and decide |
| `memory search <query> --compact` | ~150 | Metadata + token counts — evaluate cost |
| `memory search <query> --compact --budget 500` | ≤500 | Budget-capped compact results |
| `memory search <query> --format json` | ~2000 | Full results with snippets |
| `memory context build <query> --tokens N` | ≤N | Curated context block with facts |
| `memory get <id> --raw` | ~250 | Full content of a specific chunk |
| `memory facts set/get/list` | ~20 | Persistent key-value store |

## Filesystem Agent Pattern

Inspired by [Vercel's approach](https://vercel.com/blog/we-removed-80-percent-of-our-agents-tools) of letting agents retrieve small context slices on demand:

```
Agent                                    memory-search
  |                                           |
  |-- search "auth" --digest ---------------→ |
  |←-- {id:42, file:auth.md, lines:[10,35]} - |  (~50 tokens)
  |                                           |
  |-- get 42 --raw -------------------------→ |
  |←-- [full chunk content] ---------------- - |  (~250 tokens)
  |                                           |
  Total: ~300 tokens instead of ~2500
```

The key insight: **return references first, content second.** The agent decides what deserves full retrieval.

## Progressive Retrieval

Three layers of increasing detail:

1. **`--digest`** — Which files match? (~10 tokens/result)
2. **`--compact`** — How relevant are they? (~30 tokens/result)
3. **`memory get`** — Full chunk content (~250 tokens/result)

Use `--layer` shortcuts:

```bash
memory search "auth" --layer 1    # → --compact
memory search "auth" --layer 2    # → --timeline
memory search "auth" --layer 3    # → prints "use memory get <id>"
```

## Context Builder

Use `memory context build` instead of raw search when injecting into prompts:

```bash
memory context build "deployment process" --tokens 1000
```

It assembles a timeline with facts, deduplicates, and fits within a token limit.

## Facts Store

Key-value pairs that persist across sessions and are included in context builds:

```bash
memory facts set "project.stack" "TypeScript, SQLite, Cloudflare Workers"
memory facts get "project.*"
memory facts list
memory facts delete "project.stack"
```

Keep fact keys namespaced (e.g., `project.stack`, `user.preference.editor`) for clean organization.

## Privacy

Wrap content in privacy tags to prevent it from being captured or indexed:

```markdown
<private>This will not be indexed</private>
<secret>Neither will this</secret>
<sensitive>Or this</sensitive>
<redact>Or this</redact>
```
