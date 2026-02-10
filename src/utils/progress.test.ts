import { describe, it, expect } from 'vitest';
import { ProgressDisplay } from './progress.js';

describe('ProgressDisplay', () => {
  it('constructs without error', () => {
    const p = new ProgressDisplay();
    expect(p).toBeInstanceOf(ProgressDisplay);
  });

  it('formatElapsed returns milliseconds for short durations', () => {
    const p = new ProgressDisplay();
    const elapsed = p.formatElapsed();
    expect(elapsed).toMatch(/^\d+ms$/);
  });

  it('resetTimer resets the start time', () => {
    const p = new ProgressDisplay();
    p.resetTimer();
    const elapsed = p.formatElapsed();
    expect(elapsed).toMatch(/^\d+ms$/);
  });

  it('update does not throw when not a TTY', () => {
    const p = new ProgressDisplay();
    // In test environment, stderr is typically not a TTY, so this should be a no-op
    expect(() => p.update('test', 5, 10)).not.toThrow();
  });

  it('clear does not throw when not a TTY', () => {
    const p = new ProgressDisplay();
    expect(() => p.clear()).not.toThrow();
  });

  it('done does not throw when not a TTY', () => {
    const p = new ProgressDisplay();
    expect(() => p.done('finished')).not.toThrow();
  });
});
