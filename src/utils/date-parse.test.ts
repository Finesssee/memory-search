import { describe, it, expect, vi, afterEach } from 'vitest';
import { parseDate } from './date-parse.js';

describe('parseDate', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('parses relative days (7d)', () => {
    vi.useFakeTimers({ now: new Date('2025-06-15T00:00:00Z') });
    const result = parseDate('7d');
    const expected = Date.now() - 7 * 24 * 60 * 60 * 1000;
    expect(result).toBe(expected);
  });

  it('parses relative weeks (2w)', () => {
    vi.useFakeTimers({ now: new Date('2025-06-15T00:00:00Z') });
    const result = parseDate('2w');
    const expected = Date.now() - 2 * 7 * 24 * 60 * 60 * 1000;
    expect(result).toBe(expected);
  });

  it('parses relative months (1m)', () => {
    vi.useFakeTimers({ now: new Date('2025-06-15T00:00:00Z') });
    const result = parseDate('1m');
    const expected = Date.now() - 30 * 24 * 60 * 60 * 1000;
    expect(result).toBe(expected);
  });

  it('parses relative years (1y)', () => {
    vi.useFakeTimers({ now: new Date('2025-06-15T00:00:00Z') });
    const result = parseDate('1y');
    const expected = Date.now() - 365 * 24 * 60 * 60 * 1000;
    expect(result).toBe(expected);
  });

  it('parses ISO date string', () => {
    const result = parseDate('2025-01-15');
    expect(result).toBe(Date.parse('2025-01-15'));
  });

  it('returns null for invalid input', () => {
    expect(parseDate('notadate')).toBeNull();
    expect(parseDate('')).toBeNull();
    expect(parseDate('abc123')).toBeNull();
  });
});
