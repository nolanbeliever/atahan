import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import express from 'express';
import compression from 'compression';
import { Server } from 'socket.io';
import { config } from './config.js';
import { HotelSimulation } from './game/HotelSimulation.js';
import { attachSocketHandlers } from './net/socketHandlers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const require = createRequire(import.meta.url);
// 'three' paketinin build klasörü (three.module.min.js + three.core.min.js)
const threeBuild = path.dirname(require.resolve('three'));
const threeAddons = path.join(threeBuild, '..', 'examples', 'jsm');

const app = express();
app.disable('x-powered-by');
// gzip: mobil veri ve indirme süresi (dolayısıyla pil) tasarrufu
app.use(compression());

const vendorCache = { maxAge: '7d' };
app.use('/vendor/three/addons', express.static(threeAddons, vendorCache));
app.use('/vendor/three', express.static(threeBuild, vendorCache));
app.use('/shared', express.static(path.join(root, 'shared')));
app.use(express.static(path.join(root, 'public')));

app.get('/health', (_req, res) => {
  res.json({ ok: true, players: sim.players.size, running: sim.running });
});

const server = http.createServer(app);
const io = new Server(server, {
  // Mesajlar küçük; sıkıştırma CPU harcar, kapalı kalsın
  perMessageDeflate: false,
  serveClient: true,
});

const sim = new HotelSimulation({ config });
attachSocketHandlers(io, sim);

server.listen(config.port, () => {
  console.log(`Amsterdam Otel sunucusu hazır → http://localhost:${config.port}`);
  console.log(`Gün uzunluğu: ${config.dayLengthSec} sn, hafta sonu hızı: x${config.weekendSpeed}`);
});

function shutdown() {
  sim.stop();
  io.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
