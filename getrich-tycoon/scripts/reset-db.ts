// Deletes all game data. Uses DATABASE_URL (Postgres) or the local SQLite file.
// Usage: npm run db:reset -- --yes
import fs from 'node:fs';
import pg from 'pg';
import { loadConfig } from '../server/config';

const TABLES = ['notices', 'transactions', 'auctions', 'market_listings', 'dealerships', 'vehicles', 'sessions', 'players', 'world_state', 'schema_info'];

if (!process.argv.includes('--yes')) {
  console.error('This deletes ALL players, vehicles and dealerships. Re-run with --yes to confirm.');
  process.exit(1);
}
const cfg = loadConfig();
if (cfg.databaseUrl) {
  const client = new pg.Client({ connectionString: cfg.databaseUrl, ssl: cfg.databaseSsl ? { rejectUnauthorized: false } : undefined });
  await client.connect();
  for (const t of TABLES) await client.query(`DROP TABLE IF EXISTS ${t} CASCADE`);
  await client.end();
  console.log('PostgreSQL tables dropped. They are recreated on the next server start.');
} else {
  for (const suffix of ['', '-wal', '-shm', '-journal']) fs.rmSync(cfg.sqlitePath + suffix, { force: true });
  console.log(`SQLite database removed: ${cfg.sqlitePath}`);
}
