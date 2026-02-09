import { describe, it, expect } from 'vitest';
import { generateContextBlock } from './claude-md.js';

describe('generateContextBlock', () => {
  it('generates markdown with markers', () => {
    const block = generateContextBlock([
      { file: 'docs/auth.md', snippet: 'Auth setup instructions', score: 0.85 },
    ]);
    expect(block).toContain('<!-- memory-search-context:start -->');
    expect(block).toContain('<!-- memory-search-context:end -->');
    expect(block).toContain('docs/auth.md');
    expect(block).toContain('85%');
  });

  it('returns empty for no memories', () => {
    expect(generateContextBlock([])).toBe('');
  });
});
