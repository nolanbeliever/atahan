import { io } from '/socket.io/socket.io.esm.min.js';
import { EVT } from '/shared/constants.js';

const MOVE_INTERVAL = 100; // ms → en fazla 10 Hz konum gönderimi

/**
 * Socket.io sarmalayıcı.
 *  - Doğrudan WebSocket ile bağlanır (HTTP long-polling'in sürekli istekleri
 *    mobil radyoyu uyanık tutar ve pil tüketir); WebSocket engelliyse
 *    otomatik olarak polling'e geri düşer.
 *  - Konum yalnızca değiştiğinde ve en fazla 10 Hz gönderilir.
 *  - Sunucu saatiyle senkron (misafir rotaları sunucu zamanına göre çizilir).
 */
export class Network {
  constructor() {
    this.offset = 0;
    this.socket = io({
      transports: ['websocket'],
      reconnectionDelay: 1000,
      reconnectionDelayMax: 8000,
    });
    this.socket.on('connect_error', () => {
      const t = this.socket.io.opts.transports;
      if (t.length === 1 && t[0] === 'websocket') this.socket.io.opts.transports = ['polling', 'websocket'];
    });

    this.lastMoveSent = 0;
    this.pendingMove = null;
    this.moveTimer = 0;
    this.lastSent = null;
  }

  on(event, fn) { this.socket.on(event, fn); }

  get connected() { return this.socket.connected; }

  serverNow() { return Date.now() + this.offset; }

  /** Gecikmesi en düşük ölçümü seçerek sunucu saat farkını hesaplar */
  async syncClock(samples = 4) {
    let best = null;
    for (let i = 0; i < samples; i++) {
      const t0 = Date.now();
      // eslint-disable-next-line no-await-in-loop
      const server = await new Promise((resolve) => {
        const timer = setTimeout(() => resolve(null), 3000);
        this.socket.emit(EVT.SYNC, (ts) => {
          clearTimeout(timer);
          resolve(ts);
        });
      });
      if (typeof server !== 'number') continue;
      const t1 = Date.now();
      const rtt = t1 - t0;
      if (!best || rtt < best.rtt) best = { rtt, offset: server + rtt / 2 - t1 };
    }
    if (best) this.offset = best.offset;
    return best;
  }

  join(name) {
    this.socket.emit(EVT.JOIN, { name });
  }

  interact(roomId, target) {
    this.socket.emit(EVT.INTERACT, { roomId, target });
  }

  /** Sunucudan onay (ack) bekleyen istek; zaman aşımında { ok:false } döner */
  request(event, data, timeoutMs = 5000) {
    return new Promise((resolve) => {
      if (!this.socket.connected) {
        resolve({ ok: false, error: 'Sunucuya bağlı değilsin.' });
        return;
      }
      const timer = setTimeout(() => resolve({ ok: false, error: 'Sunucu yanıt vermedi.' }), timeoutMs);
      this.socket.emit(event, data, (res) => {
        clearTimeout(timer);
        resolve(res || { ok: false });
      });
    });
  }

  emote(type) {
    if (this.socket.connected) this.socket.emit(EVT.EMOTE, { type });
  }

  /** Kısıtlı (throttle) konum gönderimi; son konum her zaman iletilir */
  sendMove(x, z, yaw) {
    const m = [Math.round(x * 100) / 100, Math.round(z * 100) / 100, Math.round(yaw * 100) / 100];
    const l = this.lastSent;
    if (l && l[0] === m[0] && l[1] === m[1] && l[2] === m[2]) return;
    this.pendingMove = m;
    const wait = MOVE_INTERVAL - (Date.now() - this.lastMoveSent);
    if (wait <= 0) this.flushMove();
    else if (!this.moveTimer) this.moveTimer = setTimeout(() => this.flushMove(), wait);
  }

  flushMove() {
    clearTimeout(this.moveTimer);
    this.moveTimer = 0;
    if (!this.pendingMove || !this.socket.connected) return;
    this.socket.emit(EVT.MOVE, this.pendingMove);
    this.lastSent = this.pendingMove;
    this.pendingMove = null;
    this.lastMoveSent = Date.now();
  }
}
