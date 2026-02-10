import { describe, it, expect } from 'vitest';
import { toVirtualPath, fromVirtualPath, isVirtualPath, parseVirtualPath } from './paths.js';

describe('toVirtualPath', () => {
  it('converts absolute path to virtual path', () => {
    expect(toVirtualPath('/home/user/notes/doc.md', 'notes', '/home/user/notes'))
      .toBe('memory://notes/doc.md');
  });

  it('handles nested paths', () => {
    expect(toVirtualPath('/home/user/notes/sub/deep/file.md', 'notes', '/home/user/notes'))
      .toBe('memory://notes/sub/deep/file.md');
  });

  it('returns original path if not under collection root', () => {
    expect(toVirtualPath('/other/path/file.md', 'notes', '/home/user/notes'))
      .toBe('/other/path/file.md');
  });

  it('normalizes backslashes', () => {
    expect(toVirtualPath('D:\\code\\notes\\doc.md', 'notes', 'D:\\code\\notes'))
      .toBe('memory://notes/doc.md');
  });

  it('handles trailing slash on root', () => {
    expect(toVirtualPath('/home/user/notes/doc.md', 'notes', '/home/user/notes/'))
      .toBe('memory://notes/doc.md');
  });
});

describe('fromVirtualPath', () => {
  const collections = [
    { name: 'notes', paths: ['/home/user/notes'] },
    { name: 'code', paths: ['/home/user/code'] },
  ];

  it('resolves virtual path to absolute', () => {
    expect(fromVirtualPath('memory://notes/doc.md', collections))
      .toBe('/home/user/notes/doc.md');
  });

  it('resolves nested virtual path', () => {
    expect(fromVirtualPath('memory://code/src/main.ts', collections))
      .toBe('/home/user/code/src/main.ts');
  });

  it('returns null for non-virtual path', () => {
    expect(fromVirtualPath('/regular/path.md', collections)).toBeNull();
  });

  it('returns null for unknown collection', () => {
    expect(fromVirtualPath('memory://unknown/file.md', collections)).toBeNull();
  });

  it('returns null for malformed virtual path (no slash after collection)', () => {
    expect(fromVirtualPath('memory://notes', collections)).toBeNull();
  });
});

describe('isVirtualPath', () => {
  it('returns true for virtual paths', () => {
    expect(isVirtualPath('memory://notes/doc.md')).toBe(true);
  });

  it('returns false for regular paths', () => {
    expect(isVirtualPath('/home/user/doc.md')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isVirtualPath('')).toBe(false);
  });
});

describe('parseVirtualPath', () => {
  it('parses collection and relative path', () => {
    expect(parseVirtualPath('memory://notes/sub/doc.md'))
      .toEqual({ collection: 'notes', relativePath: 'sub/doc.md' });
  });

  it('returns null for non-virtual paths', () => {
    expect(parseVirtualPath('/regular/path.md')).toBeNull();
  });

  it('returns null for missing relative path', () => {
    expect(parseVirtualPath('memory://notes')).toBeNull();
  });
});
