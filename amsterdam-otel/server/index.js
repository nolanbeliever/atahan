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
import { FileStore } from './house/FileStore.js';
import { PgStore } from './house/PgStore.js';
import { fetchVideoInfo, thumbnailHandler } from './house/youtube.js';

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

// TV ekranındaki video küçük resmi (aynı köken → WebGL dokusu olarak kullanılabilir)
app.get('/yt/thumb/:id', thumbnailHandler());

app.get('/health', (_req, res) => {
  res.json({ ok: true, players: sim.players.size, running: sim.running });
});

const server = http.createServer(app);
const io = new Server(server, {
  // Mesajlar küçük; sıkıştırma CPU harcar, kapalı kalsın
  perMessageDeflate: false,
  serveClient: true,
});

// Kalıcı kayıt: evler (Bizim Ev + oyuncu evleri, sahipler), eşyalar, anahtarlı oyuncu cüzdanları,
// otel kasası ve oyun saati. DATABASE_URL varsa PostgreSQL (ör. ücretsiz Neon — Render'ın ücretsiz
// diski her yeniden başlatmada silinir), yoksa yerel JSON dosyası (HOUSE_FILE ile değiştirilebilir).
const houseFile = process.env.HOUSE_FILE || path.join(root, 'data', 'house.json');
let store;
if (process.env.DATABASE_URL) {
  try {
    store = await PgStore.create(process.env.DATABASE_URL);
    console.log('Kayıt: PostgreSQL (DATABASE_URL)');
  } catch (err) {
    // Boş bir kayıtla açılıp veritabanındaki kaydın üstüne yazmamak için başlamayı reddet
    console.error('Veritabanına bağlanılamadı, sunucu başlatılmıyor:', err.message);
    process.exit(1);
  }
} else {
  store = new FileStore(houseFile);
  console.log(`Kayıt: ${houseFile} (DATABASE_URL yok — Render'ın ücretsiz planında yeniden başlatmada silinir)`);
}
const sim = new HotelSimulation({
  config,
  house: { store, fetchVideoInfo },
});
attachSocketHandlers(io, sim);

server.listen(config.port, () => {
  console.log(`Amsterdam Otel sunucusu hazır → http://localhost:${config.port}`);
  console.log(`Gün uzunluğu: ${config.dayLengthSec} sn, hafta sonu hızı: x${config.weekendSpeed}`);
});

let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  setTimeout(() => process.exit(0), 8000).unref(); // ne olursa olsun kapan
  sim.stop();
  sim.house.flush();
  io.close();
  try {
    await store.close?.(); // bekleyen veritabanı yazmasını bitir
  } catch (err) {
    console.warn('Kayıt kapatılırken hata:', err.message);
  }
  server.close(() => process.exit(0));
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
