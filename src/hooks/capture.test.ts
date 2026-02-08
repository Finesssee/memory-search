import { describe, it, expect } from 'vitest';
import { shouldCapture, stripPrivate } from './index.js';

describe('shouldCapture', () => {
  it('rejects content shorter than 30 chars', () => {
    expect(shouldCapture('i prefer X')).toBe(false);
  });

  it('captures "i prefer" pattern', () => {
    expect(shouldCapture('I prefer using TypeScript for all my projects because it catches errors early')).toBe(true);
  });

  it('captures "i decided" pattern', () => {
    expect(shouldCapture('I decided to switch from npm to pnpm for faster installs and better monorepo support')).toBe(true);
  });

  it('captures "my X is" pattern', () => {
    expect(shouldCapture('My sensitivity is 0.45 and my DPI is 800 in Valorant settings')).toBe(true);
  });

  it('captures "note to self" pattern', () => {
    expect(shouldCapture('Note to self: always run the linter before pushing code to avoid CI failures')).toBe(true);
  });

  it('captures "configured to" pattern', () => {
    expect(shouldCapture('The search was configured to use 20 results per query for better coverage in retrieval')).toBe(true);
  });

  it('does not capture generic text without triggers', () => {
    expect(shouldCapture('The quick brown fox jumps over the lazy dog and runs away into the forest')).toBe(false);
  });

  it('does not capture routine code output', () => {
    expect(shouldCapture('npm install completed successfully with 0 vulnerabilities found in the project')).toBe(false);
  });
});

describe('stripPrivate', () => {
  it('redacts <private> tags', () => {
    expect(stripPrivate('before <private>secret</private> after')).toBe('before [REDACTED] after');
  });

  it('redacts <secret> tags', () => {
    expect(stripPrivate('my key is <secret>sk-1234</secret>')).toBe('my key is [REDACTED]');
  });

  it('leaves text without privacy tags unchanged', () => {
    expect(stripPrivate('normal text')).toBe('normal text');
  });
});
