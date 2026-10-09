import { EventEmitter } from 'node:events';
import {
  EVT, DAY_NAMES, INTERACT_RANGE, TRASH_SPOT_COUNT, formatMoney,
} from '../../shared/constants.js';
import { POINTS, ROOM_BY_ID, WORLD_BOUNDS, pointInBounds } from '../../shared/layout.js';
import { GameClock } from './GameClock.js';
import { RoomManager } from './RoomManager.js';
import { GuestManager } from './GuestManager.js';
import { CoffeeShopService } from './CoffeeShopService.js';
import { HouseService } from '../house/HouseService.js';

const PLAYER_COLORS = ['#e4572e', '#29a3a3', '#f3a712', '#6a4c93', '#3a86ff', '#8ac926', '#ff595e', '#c77dff'];

const round2 = (v) => Math.round(v * 100) / 100;

function sanitizeName(raw) {
  if (typeof raw !== 'string') return '';
  // Kontrol karakterlerini ve açılı parantezleri at, boşlukları sadeleştir
  return raw.replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 16);
}

/**
 * Otelin yetkili (authoritative) simülasyonu.
 * Ağdan bağımsızdır: dışarıya yalnızca `out` olayı yayar, böylece
 * Socket.io olmadan da test edilebilir.
 *
 * Pil/CPU dostu tasarım:
 *  - Oyuncu yokken zamanlayıcı tamamen durur.
 *  - Misafir hareketleri istemcide rota + başlangıç zamanından hesaplanır;
 *    sunucu yalnızca faz değişimlerinde mesaj gönderir.
 *  - Oyuncu konumları sadece değiştiğinde, toplu halde yayınlanır.
 */
export class HotelSimulation extends EventEmitter {
  /**
   * @param house { store, fetchVideoInfo } — Bizim Ev için kalıcılık ve YouTube bilgisi (isteğe bağlı)
   */
  constructor({ config, rng = Math.random, now = Date.now, house = {} }) {
    super();
    this.config = config;
    this.rng = rng;
    this.now = now;
    this.clock = new GameClock({
      dayLengthSec: config.dayLengthSec,
      weekendSpeed: config.weekendSpeed,
      startDay: config.startDay ?? 0,
      startMinute: (config.startHour ?? 7) * 60,
    });
    this.rooms = new RoomManager(rng);
    this.guests = new GuestManager(this);
    this.shop = new CoffeeShopService(this);
    this.house = new HouseService(this, house);
    this.players = new Map();
    this.nextPlayerNo = 1;
    this.money = 0;
    this.today = { earned: 0, guests: 0, cleaned: 0 };
    this.timer = null;
    this.lastTick = 0;
    this.pausedAt = null;
    this.lastClockBroadcast = 0;
    this.lastCheckinOpen = this.clock.checkinOpen;
    this.dirtyPlayers = new Set();
  }

  // ---- Çıkış (yayın) yardımcıları --------------------------------------

  out(event, payload) { this.emit('out', event, payload); }

  /** Yalnızca tek bir oyuncuya giden mesaj (cüzdan, kişisel bildirim) */
  toPlayer(id, event, payload) { this.emit('to', id, event, payload); }

  notify(text, kind = 'info') { this.out(EVT.NOTIFY, { text, kind }); }

  roomsChanged() { this.out(EVT.ROOMS, this.rooms.serialize()); }

  economy(delta = 0, reason = '') {
    return { money: this.money, delta, reason, today: { ...this.today } };
  }

  earn(amount, reason) {
    this.money += amount;
    this.today.earned += amount;
    this.today.guests += 1;
    this.out(EVT.ECONOMY, this.economy(amount, reason));
  }

  broadcastClock(now) {
    this.lastClockBroadcast = now;
    this.out(EVT.CLOCK, this.clock.snapshot(now));
  }

  // ---- Döngü -----------------------------------------------------------

  get running() { return this.timer !== null; }

  start() {
    if (this.timer) return;
    const now = this.now();
    if (this.pausedAt !== null) {
      // Duraklama süresince yürüyen misafirlerin zaman damgalarını kaydır
      this.guests.shiftTime(now - this.pausedAt);
      this.pausedAt = null;
    }
    this.lastTick = now;
    this.timer = setInterval(() => this.tick(this.now()), this.config.tickMs);
    this.timer.unref?.();
  }

  stop() {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
    this.pausedAt = this.now();
  }

  tick(now) {
    const dt = Math.min(Math.max((now - this.lastTick) / 1000, 0), 1);
    this.lastTick = now;

    const prevDay = this.clock.dayOfWeek;
    if (this.clock.advance(dt)) this.onNewDay(prevDay, now);

    const open = this.clock.checkinOpen;
    if (open !== this.lastCheckinOpen) {
      this.lastCheckinOpen = open;
      if (!this.clock.weekend) {
        this.notify(open ? 'Resepsiyon açıldı — misafir kabulü başladı.' : 'Resepsiyon kapandı (19:00).', 'info');
      }
      this.broadcastClock(now);
    }

    this.guests.update(now);
    this.shop.update(now);

    if (now - this.lastClockBroadcast >= this.config.clockBroadcastMs) this.broadcastClock(now);
    this.flushPlayers();
  }

  onNewDay(prevDay, now) {
    const t = this.today;
    let text = `${DAY_NAMES[prevDay]} bitti: ${t.guests} misafir, ${formatMoney(t.earned)} gelir, ${t.cleaned} oda temizlendi.`;
    this.today = { earned: 0, guests: 0, cleaned: 0 };
    const day = this.clock.dayOfWeek;
    if (day === 5) text += ' Hafta sonu başladı — otel kapalı. 🏠 Bizim Ev\'de takılma zamanı!';
    else if (day === 0) text += ' Yeni hafta! Otel misafirlere açık.';
    else text += ` ${DAY_NAMES[day]} başladı.`;
    this.notify(text, 'day');
    this.out(EVT.ECONOMY, this.economy());
    this.broadcastClock(now);
  }

  // ---- Oyuncular -------------------------------------------------------

  addPlayer(rawName) {
    const no = this.nextPlayerNo++;
    const p = {
      id: no,
      name: sanitizeName(rawName) || `Görevli ${no}`,
      color: PLAYER_COLORS[(no - 1) % PLAYER_COLORS.length],
      x: POINTS.playerSpawn[0] + (this.rng() - 0.5) * 2,
      z: POINTS.playerSpawn[1] + (this.rng() - 0.5),
      yaw: Math.PI,
    };
    this.shop.initPlayer(p);
    this.players.set(p.id, p);
    if (this.players.size === 1) this.start();
    this.out(EVT.PLAYER_JOIN, this.publicPlayer(p));
    return p;
  }

  removePlayer(id) {
    if (!this.players.delete(id)) return;
    this.dirtyPlayers.delete(id);
    this.out(EVT.PLAYER_LEAVE, id);
    if (this.players.size === 0) this.stop();
  }

  publicPlayer(p) {
    return {
      id: p.id, name: p.name, color: p.color, x: round2(p.x), z: round2(p.z), yaw: round2(p.yaw),
      trip: this.shop.publicTrip(p),
    };
  }

  movePlayer(id, x, z, yaw) {
    const p = this.players.get(id);
    if (!p || !Number.isFinite(x) || !Number.isFinite(z) || !Number.isFinite(yaw)) return;
    const b = WORLD_BOUNDS;
    p.x = Math.min(Math.max(x, b.minX), b.maxX);
    p.z = Math.min(Math.max(z, b.minZ), b.maxZ);
    p.yaw = Math.atan2(Math.sin(yaw), Math.cos(yaw));
    this.dirtyPlayers.add(id);
  }

  flushPlayers() {
    if (!this.dirtyPlayers.size) return;
    const batch = [];
    for (const id of this.dirtyPlayers) {
      const p = this.players.get(id);
      if (p) batch.push([p.id, round2(p.x), round2(p.z), round2(p.yaw)]);
    }
    this.dirtyPlayers.clear();
    if (batch.length) this.out(EVT.PLAYERS, batch);
  }

  /**
   * Temizlik etkileşimi. Oyuncunun gerçekten odada ve hedefin yakınında
   * olduğu sunucuda doğrulanır.
   * @returns {boolean}
   */
  interact(playerId, roomId, target) {
    const p = this.players.get(playerId);
    const layout = ROOM_BY_ID[roomId];
    const room = layout && this.rooms.get(layout.id);
    if (!p || !room) return false;
    if (!pointInBounds(p.x, p.z, layout.bounds, 0.3)) return false;

    let tx; let tz; let range;
    if (target === 'bed') {
      tx = layout.bed.x; tz = layout.bed.z; range = INTERACT_RANGE.bed;
    } else if (Number.isInteger(target) && target >= 0 && target < TRASH_SPOT_COUNT) {
      [tx, tz] = layout.trashSpots[target];
      range = INTERACT_RANGE.trash;
    } else {
      return false;
    }
    // Ağ gecikmesi için biraz tolerans
    if (Math.hypot(p.x - tx, p.z - tz) > range + 1.0) return false;

    const res = this.rooms.clean(room, target);
    if (!res.ok) return false;
    this.roomsChanged();
    if (res.finished) {
      this.today.cleaned += 1;
      this.notify(`Oda ${room.id} temizlendi ✓ (${p.name})`, 'clean');
      const tip = this.shop.tip(p);
      this.toPlayer(p.id, EVT.NOTIFY, {
        text: `Misafir odada €${tip.amount} bahşiş bırakmış!${tip.lucky ? ' 🍀 Şans bonusu +%20' : ''}`,
        kind: 'money',
      });
    }
    return true;
  }

  // ---- Coffee shop (kişisel cüzdan / envanter / trip) -------------------

  buy(playerId, productId) {
    const p = this.players.get(playerId);
    return p ? this.shop.buy(p, productId) : { ok: false };
  }

  consume(playerId, productId) {
    const p = this.players.get(playerId);
    return p ? this.shop.consume(p, productId, this.now()) : { ok: false };
  }

  spin(playerId) {
    const p = this.players.get(playerId);
    return p ? this.shop.spin(p) : { ok: false };
  }

  // ---- Bizim Ev ------------------------------------------------------------

  withPlayer(playerId, fn) {
    const p = this.players.get(playerId);
    return p ? fn(p) : { ok: false };
  }

  housePlace(playerId, data) { return this.withPlayer(playerId, (p) => this.house.place(p, data)); }

  houseRemove(playerId, itemId) { return this.withPlayer(playerId, (p) => this.house.remove(p, itemId)); }

  houseLights(playerId) { return this.withPlayer(playerId, (p) => this.house.toggleLights(p)); }

  async houseTvSet(playerId, itemId, link) {
    const p = this.players.get(playerId);
    return p ? this.house.setTv(p, itemId, link) : { ok: false };
  }

  houseTvStop(playerId, itemId) { return this.withPlayer(playerId, (p) => this.house.stopTv(p, itemId)); }

  emote(playerId, type) {
    const p = this.players.get(playerId);
    return p ? this.shop.emote(p, type, this.now()) : false;
  }

  snapshot(selfId) {
    const now = this.now();
    return {
      selfId,
      serverTime: now,
      clock: this.clock.snapshot(now),
      rooms: this.rooms.serialize(),
      guests: this.guests.serialize(),
      players: [...this.players.values()].map((p) => this.publicPlayer(p)),
      economy: this.economy(),
      self: this.players.has(selfId) ? this.shop.privateState(this.players.get(selfId)) : null,
      house: this.house.serialize(),
    };
  }
}
