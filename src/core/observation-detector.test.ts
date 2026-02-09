import { describe, it, expect } from 'vitest';
import { detectObservationType } from './observation-detector.js';

describe('detectObservationType', () => {
  it('detects bugfix content', () => {
    expect(detectObservationType('Fixed the crash when loading empty files. Bug resolved.')).toBe('bugfix');
  });

  it('detects feature content', () => {
    expect(detectObservationType('Added new feature to implement search filtering. Created new component.')).toBe('feature');
  });

  it('detects decision content', () => {
    expect(detectObservationType('We decided to use PostgreSQL. The decision was based on trade-offs between speed and reliability.')).toBe('decision');
  });

  it('detects architecture content', () => {
    expect(detectObservationType('The architecture uses a layered design pattern with structured modules.')).toBe('architecture');
  });

  it('returns null for generic content', () => {
    expect(detectObservationType('Hello world. This is a simple test.')).toBeNull();
  });
});
