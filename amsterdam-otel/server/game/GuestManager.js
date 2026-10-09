import {
  GUEST_PHASE as P, GUEST_SPEED, CHECKIN_MS, MAX_WAITING, WAIT_LIMIT_MIN, ROOM_PRICE, EVT,
} from '../../shared/constants.js';
import { POINTS, RECEPTION, SEATS, ROOM_BY_ID } from '../../shared/layout.js';
import { pathLength } from '../../shared/path.js';

/**
 * Misafir yaşam döngüsü:
 *   ARRIVE → CHECKIN → (TO_ROOM → IN_ROOM → CHECKOUT) ya da (TO_SEAT → WAITING → TO_ROOM ...)
 *   Bekleme süresi dolarsa ya da resepsiyon kapanırsa → LEAVE.
 * Yürüyüşler gerçek zamanla, konaklama süreleri oyun saatiyle ölçülür.
 */
export class GuestManager {
  constructor(sim) {
    this.sim = sim;
    this.guests = new Map();
    this.nextId = 1;
    this.nextSpawnAt = null;
    this.fromWest = true;
  }

  get rng() { return this.sim.rng; }

  serialize() {
    return [...this.guests.values()].map((g) => this.toWire(g));
  }

  toWire(g) {
    return {
      id: g.id, look: g.look, phase: g.phase, path: g.path, t0: g.t0,
      speed: GUEST_SPEED, face: g.face, sit: g.sit, roomId: g.roomId,
    };
  }

  /** Simülasyon duraklatılıp devam ettirildiğinde gerçek zaman damgalarını kaydır */
  shiftTime(deltaMs) {
    for (const g of this.guests.values()) {
      g.t0 += deltaMs;
      g.phaseEndsAt += deltaMs;
    }
  }

  update(now) {
    const { clock, config } = this.sim;

    if (clock.checkinOpen) {
      if (this.nextSpawnAt === null) this.nextSpawnAt = clock.total + 5 + this.rng() * 15;
      if (clock.total >= this.nextSpawnAt) {
        if (this.canSpawn()) {
          this.spawn(now);
          this.nextSpawnAt = clock.total + config.spawnMinMin
            + this.rng() * (config.spawnMaxMin - config.spawnMinMin);
        } else {
          this.nextSpawnAt = clock.total + 15;
        }
      }
    } else {
      this.nextSpawnAt = null;
    }

    // Bekleyenler önce (ilk gelen ilk yerleşir)
    for (const g of this.guests.values()) {
      if (g.phase === P.WAITING) this.updateWaiting(g, now);
    }
    for (const g of this.guests.values()) {
      if (g.phase !== P.WAITING) this.updateGuest(g, now);
    }
  }

  canSpawn() {
    let atDesk = 0;
    let waiting = 0;
    for (const g of this.guests.values()) {
      if (g.phase === P.ARRIVE || g.phase === P.CHECKIN) atDesk++;
      if (g.phase === P.TO_SEAT || g.phase === P.WAITING) waiting++;
    }
    return atDesk === 0 && waiting < MAX_WAITING;
  }

  randomLook() {
    const r = this.rng;
    return {
      body: Math.floor(r() * 8),
      skin: Math.floor(r() * 5),
      hair: Math.floor(r() * 5),
      hat: r() < 0.3,
      bag: r() < 0.75,
    };
  }

  spawn(now) {
    const street = this.fromWest ? POINTS.streetWest : POINTS.streetEast;
    this.fromWest = !this.fromWest;
    const g = {
      id: this.nextId++,
      look: this.randomLook(),
      phase: null,
      path: null,
      t0: now,
      phaseEndsAt: 0,
      face: 0,
      sit: false,
      roomId: null,
      seat: -1,
      waitUntil: 0,
      checkoutAt: 0,
    };
    this.guests.set(g.id, g);
    this.walk(g, P.ARRIVE, [street, POINTS.doorOutside, POINTS.doorInside, RECEPTION.front], now);
    this.sim.notify('Yeni misafir geldi, resepsiyona yöneliyor.', 'info');
  }

  walk(g, phase, path, now) {
    g.phase = phase;
    g.path = path.map((p) => [p[0], p[1]]);
    g.t0 = now;
    g.sit = false;
    g.phaseEndsAt = now + (pathLength(g.path) / GUEST_SPEED) * 1000;
    this.broadcast(g);
  }

  stand(g, phase, point, face, now, durationMs = 0, sit = false) {
    g.phase = phase;
    g.path = [[point[0], point[1]]];
    g.t0 = now;
    g.face = face;
    g.sit = sit;
    g.phaseEndsAt = now + durationMs;
    this.broadcast(g);
  }

  broadcast(g) {
    this.sim.out(EVT.GUEST_UPSERT, this.toWire(g));
  }

  remove(g) {
    this.guests.delete(g.id);
    this.sim.out(EVT.GUEST_REMOVE, g.id);
  }

  lastPoint(g) { return g.path[g.path.length - 1]; }

  pickRoom() {
    const empty = this.sim.rooms.emptyRooms();
    if (!empty.length) return null;
    return empty[Math.floor(this.rng() * empty.length)];
  }

  freeSeat() {
    const taken = new Set([...this.guests.values()].map((g) => g.seat));
    return SEATS.findIndex((_, i) => !taken.has(i));
  }

  /** Odayı ver, ücreti tahsil et ve misafiri odasına yürüt */
  assignRoom(g, room, fromPath, now) {
    this.sim.rooms.occupy(room, g.id);
    g.roomId = room.id;
    g.seat = -1;
    this.sim.earn(ROOM_PRICE, `Oda ${room.id} kiralandı`);
    this.sim.roomsChanged();
    const rp = ROOM_BY_ID[room.id].path;
    this.walk(g, P.TO_ROOM, [...fromPath, POINTS.hub, rp.corridor, rp.doorOut, rp.doorIn, rp.stand], now);
  }

  leave(g, fromPath, now) {
    const street = this.rng() < 0.5 ? POINTS.streetWest : POINTS.streetEast;
    g.seat = -1;
    this.walk(g, P.LEAVE, [...fromPath, POINTS.doorInside, POINTS.doorOutside, street], now);
  }

  updateWaiting(g, now) {
    const seat = SEATS[g.seat];
    const room = this.pickRoom();
    if (room) {
      this.assignRoom(g, room, [seat.seat, seat.approach], now);
      return;
    }
    if (this.sim.clock.total >= g.waitUntil || !this.sim.clock.checkinOpen) {
      this.sim.notify('Bir misafir boş oda bulamadığı için ayrıldı. Odaları hızlı temizleyin!', 'warn');
      this.leave(g, [seat.seat, seat.approach], now);
    }
  }

  updateGuest(g, now) {
    const { clock } = this.sim;
    if (g.phase === P.IN_ROOM) {
      if (clock.total >= g.checkoutAt) this.checkout(g, now);
      return;
    }
    if (now < g.phaseEndsAt) return;

    switch (g.phase) {
      case P.ARRIVE:
        // Resepsiyon masası batıda; misafir batıya (-X) bakar
        this.stand(g, P.CHECKIN, RECEPTION.front, -Math.PI / 2, now, CHECKIN_MS);
        break;

      case P.CHECKIN: {
        const room = this.pickRoom();
        if (room) {
          this.assignRoom(g, room, [RECEPTION.front], now);
          break;
        }
        const seat = this.freeSeat();
        if (seat >= 0 && clock.checkinOpen) {
          g.seat = seat;
          g.waitUntil = clock.total + WAIT_LIMIT_MIN;
          const s = SEATS[seat];
          this.walk(g, P.TO_SEAT, [RECEPTION.front, s.approach, s.seat], now);
          this.sim.notify('Boş oda yok! Misafir lobide bekliyor.', 'warn');
        } else {
          this.sim.notify('Boş oda olmadığı için misafir geri döndü.', 'warn');
          this.leave(g, [RECEPTION.front], now);
        }
        break;
      }

      case P.TO_SEAT:
        // Kanepe doğu duvarında; misafir batıya bakarak oturur
        this.stand(g, P.WAITING, SEATS[g.seat].seat, -Math.PI / 2, now, 0, true);
        break;

      case P.TO_ROOM: {
        const stay = this.sim.config.stayMinMin
          + this.rng() * (this.sim.config.stayMaxMin - this.sim.config.stayMinMin);
        g.checkoutAt = clock.total + stay;
        this.stand(g, P.IN_ROOM, this.lastPoint(g), 0, now);
        break;
      }

      case P.CHECKOUT:
      case P.LEAVE:
        this.remove(g);
        break;

      default:
        break;
    }
  }

  checkout(g, now) {
    const room = this.sim.rooms.get(g.roomId);
    const rp = ROOM_BY_ID[g.roomId].path;
    this.sim.rooms.makeDirty(room);
    this.sim.roomsChanged();
    this.sim.notify(`Oda ${room.id} boşaltıldı — temizlik gerekiyor!`, 'dirty');
    const street = this.rng() < 0.5 ? POINTS.streetWest : POINTS.streetEast;
    g.roomId = null;
    this.walk(g, P.CHECKOUT, [
      rp.stand, rp.doorIn, rp.doorOut, rp.corridor, POINTS.hub,
      POINTS.doorInside, POINTS.doorOutside, street,
    ], now);
  }
}
