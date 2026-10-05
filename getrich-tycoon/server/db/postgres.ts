import pg from 'pg';
import { createLogger } from '../logger';
import type { Database, Queryable, Row } from './types';

const log = createLogger('db');

// BIGINT (int8) -> JS number. Money values stay far below 2^53.
pg.types.setTypeParser(20, (v: string) => Number.parseInt(v, 10));
// NUMERIC -> number
pg.types.setTypeParser(1700, (v: string) => Number.parseFloat(v));

export async function createPostgres(url: string, ssl: boolean): Promise<Database> {
  const pool = new pg.Pool({
    connectionString: url,
    ssl: ssl ? { rejectUnauthorized: false } : undefined,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });
  pool.on('error', (err) => log.error('postgres pool error', { error: err.message }));
  // Fail fast on bad credentials.
  const client = await pool.connect();
  client.release();

  const wrap = (c: pg.Pool | pg.PoolClient): Queryable => ({
    async query<T extends Row = Row>(sql: string, params: unknown[] = []): Promise<T[]> {
      const res = await c.query(sql, params);
      return res.rows as T[];
    },
  });
  const base = wrap(pool);

  return {
    kind: 'postgres',
    query: base.query,
    async exec(sql: string) {
      await pool.query(sql);
    },
    async tx<T>(fn: (q: Queryable) => Promise<T>): Promise<T> {
      const c = await pool.connect();
      try {
        await c.query('BEGIN');
        const result = await fn(wrap(c));
        await c.query('COMMIT');
        return result;
      } catch (err) {
        try {
          await c.query('ROLLBACK');
        } catch (rbErr) {
          log.error('rollback failed', { error: (rbErr as Error).message });
        }
        throw err;
      } finally {
        c.release();
      }
    },
    async close() {
      await pool.end();
    },
  };
}
