// Cloud save storage. Uses Postgres (e.g. Neon) when DATABASE_URL is set,
// otherwise an in-memory map so the server still runs locally without a database.
import pg from 'pg';

const MAX_BYTES = 1024 * 1024;

export async function createStore(url = process.env.DATABASE_URL) {
  if (!url) {
    console.warn('DATABASE_URL not set: cloud saves are kept in memory only (lost on restart).');
    return memoryStore();
  }
  // Neon requires TLS; add sslmode if the connection string doesn't specify it.
  const connectionString = /sslmode=/.test(url) ? url : url + (url.includes('?') ? '&' : '?') + 'sslmode=require';
  const pool = new pg.Pool({ connectionString, max: 5, idleTimeoutMillis: 30000, connectionTimeoutMillis: 10000 });
  // Neon closes idle connections; don't let that crash the process.
  pool.on('error', (e) => console.warn('postgres pool error:', e.message));
  await pool.query(`CREATE TABLE IF NOT EXISTS dd_saves (
    player_id TEXT NOT NULL,
    slot TEXT NOT NULL,
    name TEXT,
    data JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (player_id, slot)
  )`);
  console.log('Cloud saves: connected to Postgres.');
  return {
    kind: 'postgres',
    async get(id, slot) {
      const r = await pool.query('SELECT data, name, updated_at FROM dd_saves WHERE player_id = $1 AND slot = $2', [id, slot]);
      return r.rows[0] ? { data: r.rows[0].data, name: r.rows[0].name, updated: r.rows[0].updated_at.getTime() } : null;
    },
    async put(id, slot, name, data) {
      await pool.query(
        `INSERT INTO dd_saves (player_id, slot, name, data, updated_at) VALUES ($1, $2, $3, $4, now())
         ON CONFLICT (player_id, slot) DO UPDATE SET name = EXCLUDED.name, data = EXCLUDED.data, updated_at = now()`,
        [id, slot, name, JSON.stringify(data)]);
    },
    async close() { await pool.end(); },
  };
}

function memoryStore() {
  const m = new Map();
  return {
    kind: 'memory',
    async get(id, slot) { return m.get(id + '/' + slot) || null; },
    async put(id, slot, name, data) { m.set(id + '/' + slot, { data, name, updated: Date.now() }); },
    async close() {},
  };
}

// ---- HTTP handlers: GET / PUT /api/save/:id/:slot
const ID_RE = /^[A-Z0-9]{4}(-[A-Z0-9]{4}){2,4}$/;
const SLOTS = new Set(['sp', 'mp']);
const writes = new Map(); // ip -> {n, t}

export function handleSaveApi(store, req, res, url) {
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, PUT, OPTIONS', 'access-control-allow-headers': 'content-type' };
  const reply = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json', ...cors }); res.end(JSON.stringify(obj)); };
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return; }
  const m = url.match(/^\/api\/save\/([^/]+)\/([^/]+)$/);
  if (!m) return reply(404, { error: 'not found' });
  const id = m[1].toUpperCase(), slot = m[2];
  if (!ID_RE.test(id) || !SLOTS.has(slot)) return reply(400, { error: 'bad save code' });
  if (req.method === 'GET') {
    store.get(id, slot).then((row) => reply(200, row || { data: null })).catch((e) => { console.warn('save get failed', e.message); reply(500, { error: 'database error' }); });
    return;
  }
  if (req.method !== 'PUT') return reply(405, { error: 'method' });
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  const w = writes.get(ip) || { n: 0, t: Date.now() };
  if (Date.now() - w.t > 60000) { w.n = 0; w.t = Date.now(); }
  if (++w.n > 30) return reply(429, { error: 'too many saves' });
  writes.set(ip, w);
  let size = 0; const chunks = [];
  req.on('data', (c) => { size += c.length; if (size > MAX_BYTES) { req.destroy(); } else chunks.push(c); });
  req.on('end', () => {
    if (size > MAX_BYTES) return;
    let body;
    try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch (e) { return reply(400, { error: 'bad json' }); }
    if (!body || typeof body.data !== 'object' || body.data === null) return reply(400, { error: 'missing data' });
    const name = String(body.name || '').slice(0, 16);
    store.put(id, slot, name, body.data).then(() => reply(200, { ok: true })).catch((e) => { console.warn('save put failed', e.message); reply(500, { error: 'database error' }); });
  });
}
