// Tests the cloud-save store and HTTP API against a real Postgres wire server
// (PGlite + pglite-socket), i.e. the same pg driver/SQL path used with Neon.
//   node server/test-db.js
import http from 'node:http';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { createStore, handleSaveApi } from './db.js';

const ok = (name, cond, extra = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name} ${extra}`); if (!cond) process.exitCode = 1; };

const db = await PGlite.create();
const pgServer = new PGLiteSocketServer({ db, port: 55432, host: '127.0.0.1' });
await pgServer.start();
const store = await createStore('postgres://postgres:postgres@127.0.0.1:55432/postgres?sslmode=disable');
ok('store uses postgres', store.kind === 'postgres');

const code = 'ABCD-EFGH-JK23';
ok('missing save returns null', (await store.get(code, 'sp')) === null);
await store.put(code, 'sp', 'Alice', { v: 2, day: 3, inv: { slots: [{ id: 'pistol', n: 1 }] } });
let row = await store.get(code, 'sp');
ok('save round-trips through postgres', row && row.data.day === 3 && row.data.inv.slots[0].id === 'pistol' && row.name === 'Alice', JSON.stringify(row));
await store.put(code, 'sp', 'Alice', { v: 2, day: 4 });
row = await store.get(code, 'sp');
ok('upsert overwrites', row.data.day === 4);
await store.put(code, 'mp', 'Alice', { hp: 50 });
ok('slots are separate', (await store.get(code, 'sp')).data.day === 4 && (await store.get(code, 'mp')).data.hp === 50);

// HTTP API
const srv = http.createServer((req, res) => handleSaveApi(store, req, res, req.url));
await new Promise(r => srv.listen(55433, r));
const base = 'http://127.0.0.1:55433';
let r = await fetch(`${base}/api/save/${code}/sp`);
ok('GET existing save', r.status === 200 && (await r.json()).data.day === 4);
r = await fetch(`${base}/api/save/ZZZZ-ZZZZ-ZZZZ/sp`);
ok('GET unknown save returns empty', r.status === 200 && (await r.json()).data === null);
r = await fetch(`${base}/api/save/not-a-code/sp`);
ok('bad code rejected', r.status === 400);
r = await fetch(`${base}/api/save/${code}/other`);
ok('bad slot rejected', r.status === 400);
r = await fetch(`${base}/api/save/QQQQ-WWWW-EEEE/sp`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Bob', data: { day: 9 } }) });
ok('PUT new save', r.status === 200);
r = await fetch(`${base}/api/save/qqqq-wwww-eeee/sp`);
ok('codes are case-insensitive', r.status === 200 && (await r.json()).data.day === 9);
r = await fetch(`${base}/api/save/${code}/sp`, { method: 'PUT', body: '{not json' });
ok('bad json rejected', r.status === 400);
r = await fetch(`${base}/api/save/${code}/sp`, { method: 'PUT', body: JSON.stringify({ name: 'x', data: { big: 'x'.repeat(1.2e6) } }) }).catch(() => ({ status: 'closed' }));
ok('oversized save refused', r.status !== 200, String(r.status));
const big = await store.get(code, 'sp');
ok('oversized save did not overwrite', big.data.day === 4);

srv.close();
await store.close();
await pgServer.stop();
await db.close();
