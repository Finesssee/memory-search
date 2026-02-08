import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { logDebug, logInfo, logWarn, logError, errorMessage } from './log.js';

describe('errorMessage', () => {
  it('extracts message from Error instance', () => {
    expect(errorMessage(new Error('test'))).toBe('test');
  });

  it('converts non-Error to string', () => {
    expect(errorMessage(42)).toBe('42');
    expect(errorMessage('oops')).toBe('oops');
    expect(errorMessage(null)).toBe('null');
  });
});

describe('log functions', () => {
  let writeSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    writeSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    writeSpy.mockRestore();
  });

  it('logDebug writes to stderr at debug level', () => {
    vi.stubEnv('MEMORY_LOG_LEVEL', 'debug');
    logDebug('test', 'hello');
    expect(writeSpy).toHaveBeenCalledOnce();
    const output = writeSpy.mock.calls[0][0] as string;
    expect(output).toContain('[DEBUG]');
    expect(output).toContain('[test]');
    expect(output).toContain('hello');
  });

  it('logDebug is suppressed at warn level', () => {
    vi.stubEnv('MEMORY_LOG_LEVEL', 'warn');
    logDebug('test', 'hello');
    expect(writeSpy).not.toHaveBeenCalled();
  });

  it('logError always writes unless silent', () => {
    vi.stubEnv('MEMORY_LOG_LEVEL', 'error');
    logError('ctx', 'failed');
    expect(writeSpy).toHaveBeenCalledOnce();
    const output = writeSpy.mock.calls[0][0] as string;
    expect(output).toContain('[ERROR]');
  });

  it('silent level suppresses everything', () => {
    vi.stubEnv('MEMORY_LOG_LEVEL', 'silent');
    logDebug('a', 'b');
    logInfo('a', 'b');
    logWarn('a', 'b');
    logError('a', 'b');
    expect(writeSpy).not.toHaveBeenCalled();
  });

  it('includes extra data as JSON', () => {
    vi.stubEnv('MEMORY_LOG_LEVEL', 'debug');
    logWarn('net', 'timeout', { url: 'http://x', code: 500 });
    const output = writeSpy.mock.calls[0][0] as string;
    expect(output).toContain('"url":"http://x"');
    expect(output).toContain('"code":500');
  });
});
