// Tiny structured logger. Never pass secrets or passwords to it.

import type { LogLevel } from './config';

const LEVELS: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

let threshold = LEVELS.info;
let silent = false;

export function setLogLevel(level: LogLevel, quiet = false): void {
  threshold = LEVELS[level];
  silent = quiet;
}

function fmt(v: unknown): string {
  if (v instanceof Error) return JSON.stringify(v.message);
  if (typeof v === 'string') return /\s/.test(v) ? JSON.stringify(v) : v;
  return JSON.stringify(v);
}

function write(level: LogLevel, scope: string, msg: string, fields?: Record<string, unknown>): void {
  if (silent || LEVELS[level] < threshold) return;
  const parts = [new Date().toISOString(), level.toUpperCase().padEnd(5), `[${scope}]`, msg];
  if (fields) for (const [k, v] of Object.entries(fields)) if (v !== undefined) parts.push(`${k}=${fmt(v)}`);
  const line = parts.join(' ');
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

export interface Logger {
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
}

export function createLogger(scope: string): Logger {
  return {
    debug: (m, f) => write('debug', scope, m, f),
    info: (m, f) => write('info', scope, m, f),
    warn: (m, f) => write('warn', scope, m, f),
    error: (m, f) => write('error', scope, m, f),
  };
}
