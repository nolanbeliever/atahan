// Local Postgres for development/tests (PGlite over the Postgres wire protocol).
//   node server/pg-dev.js   then   DATABASE_URL=postgres://postgres@127.0.0.1:55432/postgres?sslmode=disable node server/server.js
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
const db = await PGlite.create();
const s = new PGLiteSocketServer({ db, port: 55432, host: '127.0.0.1' });
await s.start();
console.log('dev postgres on 127.0.0.1:55432');
