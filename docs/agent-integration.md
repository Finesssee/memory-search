# Agent Integration

memory-search is designed to work as a tool for AI coding agents.

## Claude Code skill

Copy `skill.md` to your Claude skills directory to teach Claude how to use memory-search:

```bash
mkdir -p ~/.claude/skills/memory-search
cp skill.md ~/.claude/skills/memory-search/skill.md
```

Claude will then use `memory search`, `memory context build`, and `memory facts` commands when relevant.

## Key commands for agents

| Command | Purpose |
|---------|---------|
| `memory search <query> --compact` | JSON output optimized for LLM token efficiency |
| `memory context build <query> --tokens N` | Build a context block with timeline + facts |
| `memory facts set/get/list` | Persistent key-value store agents can read/write |
| `memory search <query> --format json` | Full structured JSON output |

## Context builder

Use `memory context build` instead of raw search when injecting into prompts — it assembles a timeline with facts and deduplicates:

```bash
memory context build "deployment process" --tokens 1000
```

## Facts store

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
