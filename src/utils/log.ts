// Structured logger — all output goes to stderr to keep JSON stdout clean

type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  silent: 4,
};

function getLevel(): LogLevel {
  const env = process.env.MEMORY_LOG_LEVEL?.toLowerCase();
  if (env && env in LEVEL_ORDER) return env as LogLevel;
  return 'debug';
}

function shouldLog(level: LogLevel): boolean {
  return LEVEL_ORDER[level] >= LEVEL_ORDER[getLevel()];
}

function formatMessage(level: string, context: string, message: string, extra?: Record<string, unknown>): string {
  const ts = new Date().toISOString();
  let line = `[${ts}] [${level.toUpperCase()}] [${context}] ${message}`;
  if (extra && Object.keys(extra).length > 0) {
    line += ' ' + JSON.stringify(extra);
  }
  return line;
}

export function logDebug(context: string, message: string, extra?: Record<string, unknown>): void {
  if (shouldLog('debug')) process.stderr.write(formatMessage('debug', context, message, extra) + '\n');
}

export function logInfo(context: string, message: string, extra?: Record<string, unknown>): void {
  if (shouldLog('info')) process.stderr.write(formatMessage('info', context, message, extra) + '\n');
}

export function logWarn(context: string, message: string, extra?: Record<string, unknown>): void {
  if (shouldLog('warn')) process.stderr.write(formatMessage('warn', context, message, extra) + '\n');
}

export function logError(context: string, message: string, extra?: Record<string, unknown>): void {
  if (shouldLog('error')) process.stderr.write(formatMessage('error', context, message, extra) + '\n');
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
