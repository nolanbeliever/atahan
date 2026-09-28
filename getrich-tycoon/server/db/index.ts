import fs from 'node:fs';
import path from 'node:path';
import type { ServerConfig } from '../config';
import { PROJECT_ROOT } from '../config';
import { createLogger } from '../logger';
import { createPostgres } from './postgres';
import { createSqlite } from './sqlite';
import type { Database } from './types';

export type { Database, Queryable, Row } from './types';

const log = createLogger('db');
export const SCHEMA_VERSION = '1';

export async function openDatabase(cfg: Pick<ServerConfig, 'databaseUrl' | 'databaseSsl' | 'sqlitePath'>): Promise<Database> {
  let db: Database;
  if (cfg.databaseUrl) {
    db = await createPostgres(cfg.databaseUrl, cfg.databaseSsl);
    log.info('connected to PostgreSQL');
  } else {
    db = await createSqlite(cfg.sqlitePath);
    log.warn('DATABASE_URL not set - using local SQLite fallback (development only)', { file: cfg.sqlitePath });
  }
  await migrate(db);
  return db;
}

export async function migrate(db: Database): Promise<void> {
  const schema = fs.readFileSync(path.join(PROJECT_ROOT, 'database', 'schema.sql'), 'utf8');
  await db.exec(schema);
  await db.query(
    'INSERT INTO schema_info (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = excluded.value',
    ['schema_version', SCHEMA_VERSION],
  );
}
