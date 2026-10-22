// Render's free tier wipes the local disk on every restart/deploy, so the SQLite file
// would be lost. When DATABASE_URL points at a Postgres database (e.g. Supabase or Neon,
// both have permanent free tiers), we keep a copy of the whole SQLite file there:
// restored on boot, re-uploaded shortly after every change and on shutdown.
const fs = require('fs');
const path = require('path');

const DATABASE_URL = process.env.DATABASE_URL;
const DB_FILE = path.join(__dirname, '..', 'data', 'app.db');
const BACKUP_INTERVAL_MS = 15 * 1000;

let pool = null;

function getPool() {
  if (!pool) {
    const { Pool } = require('pg');
    const local = /@(localhost|127\.0\.0\.1)[:/]/.test(DATABASE_URL);
    pool = new Pool({
      connectionString: DATABASE_URL,
      ssl: local ? false : { rejectUnauthorized: false },
      max: 2,
    });
  }
  return pool;
}

async function restore() {
  if (!DATABASE_URL) {
    console.log('DATABASE_URL yok: veriler sadece yerel diskte tutuluyor (Render yeniden başlayınca silinir).');
    return;
  }
  const db = getPool();
  await db.query(`CREATE TABLE IF NOT EXISTS snoop_backup (
    id INTEGER PRIMARY KEY,
    data BYTEA NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  const { rows } = await db.query('SELECT data, updated_at FROM snoop_backup WHERE id = 1');
  if (!rows.length) {
    console.log('Kalıcı veritabanı bağlı, henüz yedek yok — yeni başlıyor.');
    return;
  }
  fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
  for (const suffix of ['-wal', '-shm']) fs.rmSync(DB_FILE + suffix, { force: true });
  fs.writeFileSync(DB_FILE, rows[0].data);
  console.log(`Veriler kalıcı veritabanından geri yüklendi (${rows[0].updated_at.toISOString()}).`);
}

function startBackups(sqlite) {
  if (!DATABASE_URL) return;
  const changes = sqlite.prepare('SELECT total_changes() AS n');
  let lastSaved = changes.get().n;
  let running = null;

  async function backup(force = false) {
    if (running) return running;
    const current = changes.get().n;
    if (!force && current === lastSaved) return;
    running = (async () => {
      try {
        sqlite.pragma('wal_checkpoint(TRUNCATE)');
        const buf = sqlite.serialize();
        await getPool().query(
          `INSERT INTO snoop_backup (id, data, updated_at) VALUES (1, $1, now())
           ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
          [buf]
        );
        lastSaved = current;
      } catch (e) {
        console.error('Yedekleme hatası:', e.message);
      } finally {
        running = null;
      }
    })();
    return running;
  }

  setInterval(backup, BACKUP_INTERVAL_MS).unref();

  let shuttingDown = false;
  for (const sig of ['SIGTERM', 'SIGINT']) {
    process.on(sig, async () => {
      if (shuttingDown) return;
      shuttingDown = true;
      if (running) await running;
      await backup();
      process.exit(0);
    });
  }
}

module.exports = { restore, startBackups };
