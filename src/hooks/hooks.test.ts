import { describe, it, expect } from 'vitest';
import { MemoryDB } from '../storage/db.js';
import { loadConfig } from '../utils/config.js';
import {
  findLatestSessionFile,
  parseSessionFile,
  getMessageContent,
  shouldCapture,
  stripPrivate,
  ensureMemoryDir,
} from './index.js';

describe('DB session methods for hooks', () => {
  it('setSessionSummary stores and retrieves summary', () => {
    const config = loadConfig();
    const db = new MemoryDB(config);
    try {
      const id = `test-summary-${Date.now()}`;
      db.upsertSession(id, '/test/path');
      db.setSessionSummary(id, 'REQUEST: Test\nCOMPLETED: Done');
      const session = db.getSession(id);
      expect(session).toBeDefined();
      expect(session!.summary).toBe('REQUEST: Test\nCOMPLETED: Done');
    } finally {
      db.close();
    }
  }, 15000);

  it('incrementSessionPromptCount does not throw', () => {
    const config = loadConfig();
    const db = new MemoryDB(config);
    try {
      const id = `test-prompt-${Date.now()}`;
      db.upsertSession(id, '/test/path');
      expect(() => db.incrementSessionPromptCount(id)).not.toThrow();
      expect(() => db.incrementSessionPromptCount(id)).not.toThrow();
      expect(() => db.incrementSessionPromptCount(id)).not.toThrow();
    } finally {
      db.close();
    }
  });

  it('getRecentSessions returns sessions with summaries', () => {
    const config = loadConfig();
    const db = new MemoryDB(config);
    try {
      const id = `test-recent-${Date.now()}`;
      db.upsertSession(id, '/test/path');
      db.setSessionSummary(id, 'Summary text');
      const recent = db.getRecentSessions(5);
      expect(recent.length).toBeGreaterThanOrEqual(1);
      const found = recent.find(s => s.id === id);
      expect(found).toBeDefined();
      expect(found!.summary).toBe('Summary text');
    } finally {
      db.close();
    }
  });

  it('getRecentSessions excludes sessions without summaries', () => {
    const config = loadConfig();
    const db = new MemoryDB(config);
    try {
      const id = `test-nosummary-${Date.now()}`;
      db.upsertSession(id, '/test/path');
      const recent = db.getRecentSessions(100);
      const found = recent.find(s => s.id === id);
      expect(found).toBeUndefined();
    } finally {
      db.close();
    }
  });

  it('setSessionSummary overwrites previous summary', () => {
    const config = loadConfig();
    const db = new MemoryDB(config);
    try {
      const id = `test-overwrite-${Date.now()}`;
      db.upsertSession(id, '/test/path');
      db.setSessionSummary(id, 'First summary');
      db.setSessionSummary(id, 'Updated summary');
      const session = db.getSession(id);
      expect(session!.summary).toBe('Updated summary');
    } finally {
      db.close();
    }
  });

  it('getRecentSessions respects limit', () => {
    const config = loadConfig();
    const db = new MemoryDB(config);
    try {
      // Create several sessions with summaries
      for (let i = 0; i < 5; i++) {
        const id = `test-limit-${Date.now()}-${i}`;
        db.upsertSession(id, '/test/path');
        db.setSessionSummary(id, `Summary ${i}`);
      }
      const recent = db.getRecentSessions(2);
      expect(recent.length).toBeLessThanOrEqual(2);
    } finally {
      db.close();
    }
  });
});

describe('Hook shared utilities', () => {
  it('ensureMemoryDir does not throw', () => {
    expect(() => ensureMemoryDir()).not.toThrow();
  });

  it('shouldCapture detects preference patterns', () => {
    expect(shouldCapture('I prefer using TypeScript for all projects')).toBe(true);
  });

  it('shouldCapture rejects short content', () => {
    expect(shouldCapture('ok')).toBe(false);
  });

  it('stripPrivate removes tagged content', () => {
    const input = 'before <private>secret stuff</private> after';
    const result = stripPrivate(input);
    expect(result).toContain('before');
    expect(result).toContain('after');
    expect(result).not.toContain('secret stuff');
  });

  it('getMessageContent extracts string content', () => {
    const msg = { type: 'assistant', message: { role: 'assistant', content: 'Hello world' } };
    expect(getMessageContent(msg)).toBe('Hello world');
  });

  it('getMessageContent extracts array content', () => {
    const msg = {
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Part 1' },
          { type: 'text', text: 'Part 2' },
        ],
      },
    };
    expect(getMessageContent(msg)).toBe('Part 1\nPart 2');
  });

  it('getMessageContent returns empty for missing content', () => {
    const msg = { type: 'assistant' };
    expect(getMessageContent(msg)).toBe('');
  });
});
