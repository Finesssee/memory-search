import { existsSync, mkdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

const RULE_FILENAME = 'memory-search.mdc';

export function generateCursorRule(): string {
  return `---
description: Memory search integration for semantic code/doc retrieval
globs:
alwaysApply: true
---

# Memory Search Integration

Use the \`memory\` CLI for searching project knowledge and documentation.

## Available Commands

### Search
\`\`\`bash
# Semantic search
memory search "query"

# With filters
memory search "auth setup" --limit 10 --collection docs
memory search "bug fix" --after 7d --path src/

# Output formats
memory search "query" --format json    # JSON output
memory search "query" --format csv     # CSV output
memory search "query" --format md      # Markdown table
memory search "query" --format files   # File paths only
memory search "query" --compact        # Compact for LLM consumption
\`\`\`

### Retrieve Content
\`\`\`bash
memory get <chunk-id>          # Get by chunk ID
memory get <short-id>          # Get by 6-char short ID
memory get docs/auth.md        # Get by file path
memory get docs/auth.md:50     # Get specific line
memory get "*.md"              # Glob pattern
\`\`\`

### Context Building
\`\`\`bash
memory context build "query"   # Build context block
memory context sync            # Update CLAUDE.md with context
\`\`\`

### Facts Store
\`\`\`bash
memory facts set key "value"   # Store a fact
memory facts get key           # Retrieve a fact
memory facts list              # List all facts
\`\`\`

## Best Practices
- Use \`memory search --compact\` for quick lookups
- Use \`memory get\` to retrieve full content after finding relevant chunks
- Use \`memory context build\` to generate context blocks for prompts
`;
}

export function installCursorIntegration(projectPath: string): string {
  const cursorDir = join(projectPath, '.cursor', 'rules');
  mkdirSync(cursorDir, { recursive: true });

  const rulePath = join(cursorDir, RULE_FILENAME);
  writeFileSync(rulePath, generateCursorRule());

  return rulePath;
}

export function uninstallCursorIntegration(projectPath: string): boolean {
  const rulePath = join(projectPath, '.cursor', 'rules', RULE_FILENAME);
  if (existsSync(rulePath)) {
    unlinkSync(rulePath);
    return true;
  }
  return false;
}

export function getCursorStatus(projectPath: string): { installed: boolean; path: string } {
  const rulePath = join(projectPath, '.cursor', 'rules', RULE_FILENAME);
  return {
    installed: existsSync(rulePath),
    path: rulePath,
  };
}
