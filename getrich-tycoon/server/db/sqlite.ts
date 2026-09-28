// SQLite fallback for local development (better-sqlite3 is an optional dependency).
// All access is serialised through one queue so async transactions are isolated.

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import type { Database, Queryable, Row } from './types';

type BetterSqlite = import('better-sqlite3').Database;

/** Convert $1..$n placeholders into positional ? parameters. */
export function convertPlaceholders(sql: string, params: unknown[]): { sql: string; params: unknown[] } {
  const out: unknown[] = [];
  const converted = sql.replace(/\$(\d+)/g, (_m, n: string) => {
    const v = params[Number(n) - 1];
    out.push(typeof v === 'boolean' ? (v ? 1 : 0) : v === undefined ? null : v);
    return '?';
  });
  return { sql: converted, params: out };
}

export async function createSqlite(file: string): Promise<Database> {
  const require = createRequire(import.meta.url);
  let DatabaseCtor: typeof import('better-sqlite3');
  try {
    DatabaseCtor = require('better-sqlite3');
  } catch {
    throw new Error('better-sqlite3 is not installed. Set DATABASE_URL to use PostgreSQL or run `npm install better-sqlite3`.');
  }
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db: BetterSqlite = new DatabaseCtor(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');

  const stmtCache = new Map<string, import('better-sqlite3').Statement>();
  const run = <T extends Row>(sql: string, params: unknown[] = []): T[] => {
    const c = convertPlaceholders(sql, params);
    let stmt = stmtCache.get(c.sql);
    if (!stmt) {
      stmt = db.prepare(c.sql);
      stmtCache.set(c.sql, stmt);
    }
    if (stmt.reader) return stmt.all(...c.params) as T[];
    stmt.run(...c.params);
    return [];
  };

  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(fn: () => Promise<T> | T): Promise<T> => {
    const p = queue.then(fn, fn);
    queue = p.catch(() => undefined);
    return p;
  };

  const direct: Queryable = { query: async (sql, params) => run(sql, params) };

  return {
    kind: 'sqlite',
    query: (sql, params) => serial(() => run(sql, params)),
    exec: (sql) =>
      serial(() => {
        db.exec(sql);
      }),
    tx: <T>(fn: (q: Queryable) => Promise<T>) =>
      serial(async () => {
        db.exec('BEGIN IMMEDIATE');
        try {
          const r = await fn(direct);
          db.exec('COMMIT');
          return r;
        } catch (err) {
          db.exec('ROLLBACK');
          throw err;
        }
      }),
    close: () =>
      serial(() => {
        db.close();
      }),
  };
}
