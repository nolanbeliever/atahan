// Environment configuration. Secrets only ever come from environment variables.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Minimal .env loader (no dependency). Existing environment variables win. */
function loadDotEnv(root: string): void {
  const file = path.join(root, '.env');
  if (!fs.existsSync(file)) return;
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

/** Locate the project root (the directory that contains database/schema.sql). */
export function findProjectRoot(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    if (fs.existsSync(path.join(dir, 'database', 'schema.sql'))) return dir;
    dir = path.dirname(dir);
  }
  return process.cwd();
}

export const PROJECT_ROOT = findProjectRoot();
loadDotEnv(PROJECT_ROOT);

function int(name: string, def: number, min: number, max: number): number {
  const v = Number.parseInt(process.env[name] ?? '', 10);
  if (!Number.isFinite(v)) return def;
  return Math.min(max, Math.max(min, v));
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface ServerConfig {
  port: number;
  host: string;
  env: 'development' | 'production' | 'test';
  databaseUrl: string;
  databaseSsl: boolean;
  sqlitePath: string;
  corsOrigins: string[];
  tickRate: number;
  autosaveSeconds: number;
  logLevel: LogLevel;
  clientDir: string;
  /** Disable NPC timers etc. (used by some tests). */
  simulation: boolean;
  /** Login/register attempts allowed per IP per minute. */
  authRatePerMinute: number;
  /** Trust X-Forwarded-For (only behind a reverse proxy that overwrites it). */
  trustProxy: boolean;
  /** New accounts allowed per IP per hour, and globally per hour. */
  registerPerHour: number;
  registerGlobalPerHour: number;
}

export function loadConfig(overrides: Partial<ServerConfig> = {}): ServerConfig {
  const env = (process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'test' ? process.env.NODE_ENV : 'development') as ServerConfig['env'];
  const level = (process.env.LOG_LEVEL ?? 'info') as LogLevel;
  const cfg: ServerConfig = {
    port: int('PORT', 3000, 0, 65535),
    host: process.env.HOST ?? '0.0.0.0',
    env,
    databaseUrl: process.env.DATABASE_URL ?? '',
    databaseSsl: (process.env.DATABASE_SSL ?? '').toLowerCase() === 'true',
    sqlitePath: path.resolve(PROJECT_ROOT, process.env.SQLITE_PATH || './data/getrich.db'),
    corsOrigins: (process.env.CORS_ORIGINS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    tickRate: int('TICK_RATE', 20, 5, 60),
    autosaveSeconds: int('AUTOSAVE_SECONDS', 30, 5, 3600),
    logLevel: ['debug', 'info', 'warn', 'error'].includes(level) ? level : 'info',
    clientDir: path.resolve(PROJECT_ROOT, 'dist/client'),
    simulation: process.env.DISABLE_SIMULATION !== 'true',
    authRatePerMinute: int('AUTH_RATE_PER_MINUTE', 10, 1, 100_000),
    // Off unless explicitly enabled: if the port is reachable directly, X-Forwarded-For is spoofable.
    trustProxy: process.env.TRUST_PROXY === 'true',
    registerPerHour: int('REGISTER_PER_HOUR', 10, 1, 1_000_000),
    registerGlobalPerHour: int('REGISTER_GLOBAL_PER_HOUR', 500, 1, 1_000_000),
    ...overrides,
  };
  return cfg;
}
