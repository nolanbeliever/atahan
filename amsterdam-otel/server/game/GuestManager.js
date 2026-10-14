import {
  GUEST_PHASE as P, GUEST_SPEED, CHECKIN_MS, MAX_WAITING, WAIT_LIMIT_MIN, ROOM_PRICE, EVT,
} from '../../shared/constants.js';
import { POINTS, RECEPTION, SEATS, ROOM_BY_ID } from '../../shared/layout.js';
import { pathLength, samplePath } from '../../shared/path.js';
import { REPUTATION, roomPrice, spawnFactor } from '../../shared/hotel.js';
import { lobbyToRoom, roomToLobby } from './routes.js';
import { TOURIST, queueSpot } from '../../shared/marketing.js';

const QUEUE = TOURIST.PHASE; // resepsiyon sırasında (sıraya yürüyor ya da sırada bekliyor)

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
    // Turist akını (InstaHotel kampanyası): kafilenin henüz kapıdan girmemiş üyeleri (gerçek ms) ve
    // resepsiyon kuyruğu (misafir id'leri; 0 = masanın hemen arkası, ilk gelen ilk kayıt olur)
    this.pending = [];
    this.queue = [];
  }

  get rng() { return this.sim.rng; }

  serialize() {
    return [...this.guests.values()].map((g) => this.toWire(g));
  }

  toWire(g) {
    return {
      id: g.id, look: g.look, phase: g.phase, path: g.path, t0: g.t0,
      speed: GUEST_SPEED, face: g.face, sit: g.sit, roomId: g.roomId,
      ...(g.tourist ? { tourist: true } : {}), // istemci sırt çantası / fotoğraf makinesi / şapka ekler
    };
  }

  /** Simülasyon duraklatılıp devam ettirildiğinde gerçek zaman damgalarını kaydır */
  shiftTime(deltaMs) {
    for (const g of this.guests.values()) {
      g.t0 += deltaMs;
      g.phaseEndsAt += deltaMs;
    }
    this.pending = this.pending.map((t) => t + deltaMs);
  }

  update(now) {
    const { clock, config } = this.sim;

    if (clock.checkinOpen) {
      if (this.nextSpawnAt === null) this.nextSpawnAt = clock.total + 5 + this.rng() * 15;
      if (clock.total >= this.nextSpawnAt) {
        // Kampanya sürerken tek misafir yerine 2–4 kişilik turist kafilesi (kuyruk / oda kapasitesine göre)
        const rush = !!this.sim.marketing?.rushActive;
        if (rush ? this.spawnGroup(now) : this.canSpawn()) {
          if (!rush) this.spawn(now);
          // Üst katlar açıldıkça misafirler daha sık gelir
          this.nextSpawnAt = clock.total + (config.spawnMinMin
            + this.rng() * (config.spawnMaxMin - config.spawnMinMin)) * spawnFactor(this.sim.growth.floors) / this.sim.boosts.guestSpawn;
        } else {
          this.nextSpawnAt = clock.total + 15;
        }
      }
      this.spawnPending(now);
    } else {
      this.nextSpawnAt = null;
      this.closeQueue(now); // 19:00 / hafta sonu / gece: sıradakiler ve gelmekte olan kafile döner
    }
    this.updateQueue(now);

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
    return atDesk === 0 && waiting < MAX_WAITING && this.queue.length < TOURIST.QUEUE_MAX;
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

  /**
   * @param tourist  turist kafilesinin üyesi (görünüm farkı; bildirimi kafile bir kez verir)
   * Masa doluysa ya da kuyruk varsa misafir sıraya girer.
   */
  spawn(now, { tourist = false } = {}) {
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
      tourist,
    };
    if (tourist) g.look.hat = false; // turist şapkasını istemci takar
    this.guests.set(g.id, g);
    if (this.queue.length || this.deskBusy()) {
      this.queue.push(g.id);
      this.walk(g, QUEUE, [street, POINTS.doorOutside, POINTS.doorInside, queueSpot(this.queue.length - 1)], now);
    } else {
      this.walk(g, P.ARRIVE, [street, POINTS.doorOutside, POINTS.doorInside, RECEPTION.front], now);
    }
    if (!tourist) this.sim.notify('Yeni misafir geldi, resepsiyona yöneliyor.', 'info');
  }

  // ---- Turist kafileleri ve resepsiyon kuyruğu ---------------------------------------

  /** Masada (ona yürüyen ya da kayıt olan) misafir var mı */
  deskBusy() {
    for (const g of this.guests.values()) if (g.phase === P.ARRIVE || g.phase === P.CHECKIN) return true;
    return false;
  }

  /**
   * Kafile planla: üyeler STAGGER_MS arayla kapıdan girer. Kuyruk sınırı (QUEUE_MAX) ve boş oda
   * sayısı aşılmaz — otel dolunca kafile gelmez (kanepede bekleyip itibar kaybettirmesinler).
   * @returns {boolean} kafile planlandı mı
   */
  spawnGroup(now) {
    let desk = 0;
    let waiting = 0;
    for (const g of this.guests.values()) {
      if (g.phase === P.ARRIVE || g.phase === P.CHECKIN) desk++;
      else if (g.phase === P.TO_SEAT || g.phase === P.WAITING) waiting++;
    }
    const line = this.queue.length + this.pending.length; // sıradakiler + kapıdan girecekler
    const empty = this.sim.rooms.emptyRooms(this.sim.growth.floors).length;
    // Masa ve sıra boşsa kafilenin ilki doğrudan masaya gider (sıraya +1 yer)
    const queueCap = TOURIST.QUEUE_MAX - line + (desk === 0 && line === 0 ? 1 : 0);
    const cap = Math.min(queueCap, empty - desk - line - waiting);
    if (cap < 1 || waiting >= MAX_WAITING) return false;
    const want = TOURIST.GROUP_MIN + Math.floor(this.rng() * (TOURIST.GROUP_MAX - TOURIST.GROUP_MIN + 1));
    const n = Math.min(want, cap);
    const t0 = Math.max(now, this.pending[this.pending.length - 1] ?? 0);
    for (let i = 0; i < n; i++) this.pending.push(t0 + i * TOURIST.STAGGER_MS);
    this.sim.notify(n > 1 ? `📸 ${n} kişilik turist kafilesi geldi! Resepsiyonda sıra oluşuyor.` : '📸 Bir turist daha geldi!', 'info');
    return true;
  }

  spawnPending(now) {
    while (this.pending.length && this.pending[0] <= now) {
      this.pending.shift();
      // Güvenlik: sıra bu arada dolduysa (ör. kampanya bitip normal misafir girdi) bu turist gelmez
      if (this.queue.length >= TOURIST.QUEUE_MAX) continue;
      this.spawn(now, { tourist: true });
    }
  }

  /** Misafirin şu anki konumu (rotadan) */
  posOf(g, now) {
    const s = samplePath(g.path, Math.max(0, ((now - g.t0) / 1000) * GUEST_SPEED));
    return [s.x, s.z];
  }

  /**
   * Masa boşalınca sıranın başı (yerine varmışsa) masaya geçer; varmış diğerleri bir öne kayar.
   * Yürümekte olanlar önce hedeflerine varır, sonraki tick'te doğru yerlerine geçer (rota hiç duvardan
   * geçmez: sıradaki noktalar lobinin açık alanında, x ekseni boyunca).
   */
  updateQueue(now) {
    if (!this.queue.length) return;
    const head = this.guests.get(this.queue[0]);
    if (head && now >= head.phaseEndsAt && !this.deskBusy()) {
      this.queue.shift();
      this.walk(head, P.ARRIVE, [this.lastPoint(head), RECEPTION.front], now);
    }
    this.queue.forEach((id, i) => {
      const g = this.guests.get(id);
      if (!g || now < g.phaseEndsAt) return;
      const spot = queueSpot(i);
      const [x, z] = this.lastPoint(g);
      if (Math.abs(x - spot[0]) > 0.01 || Math.abs(z - spot[1]) > 0.01) this.walk(g, QUEUE, [[x, z], spot], now);
    });
  }

  /** Kabul kapandı: planlanan kafile iptal, sıradakiler sokağa döner */
  closeQueue(now) {
    this.pending = [];
    if (!this.queue.length) return;
    for (const id of this.queue) {
      const g = this.guests.get(id);
      if (!g) continue;
      const pos = this.posOf(g, now);
      if (pos[1] < 0.5) this.walk(g, P.LEAVE, [pos, this.rng() < 0.5 ? POINTS.streetWest : POINTS.streetEast], now);
      else this.leave(g, [pos], now);
    }
    this.queue = [];
    this.sim.notify('Resepsiyon kapandı — sıradaki misafirler ayrıldı.', 'warn');
  }

  /**
   * @param legs  asansörle kat değiştiren rotanın kalan bacakları: bu bacak bitince misafir
   *              bir sonrakinin başına ışınlanır (aynı fazda devam eder)
   */
  walk(g, phase, path, now, legs = null) {
    g.legs = legs?.length ? legs : null;
    g.phase = phase;
    g.path = path.map((p) => [p[0], p[1]]);
    g.t0 = now;
    g.sit = false;
    g.phaseEndsAt = now + (pathLength(g.path) / GUEST_SPEED) * 1000;
    this.broadcast(g);
  }

  /** Bacak listesiyle yürüyüş (ilk bacak hemen başlar) */
  walkLegs(g, phase, legs, now) {
    this.walk(g, phase, legs[0], now, legs.slice(1));
  }

  stand(g, phase, point, face, now, durationMs = 0, sit = false) {
    g.legs = null;
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
    // Yalnızca açık katlardaki boş odalar
    const empty = this.sim.rooms.emptyRooms(this.sim.growth.floors);
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
    this.sim.earn(roomPrice(ROOM_PRICE, this.sim.growth.stars), `Oda ${room.id} kiralandı`);
    this.sim.growth.addReputation(REPUTATION.GUEST_CHECKIN);
    this.sim.roomsChanged();
    const layout = ROOM_BY_ID[room.id];
    this.walkLegs(g, P.TO_ROOM, lobbyToRoom(fromPath, layout, [layout.path.stand]), now);
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
      this.sim.growth.addReputation(REPUTATION.GUEST_LOST);
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
    // Asansör: bir sonraki bacağın başına geç
    if (g.legs) {
      this.walk(g, g.phase, g.legs[0], now, g.legs.slice(1));
      return;
    }

    switch (g.phase) {
      case P.ARRIVE:
        // Resepsiyon masası batıda; misafir batıya (-X) bakar
        this.stand(g, P.CHECKIN, RECEPTION.front, -Math.PI / 2, now, g.tourist ? TOURIST.CHECKIN_MS : CHECKIN_MS);
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

      case QUEUE:
        // Sıradaki yerine vardı: masaya (batıya) dönük bekler
        if (g.path.length > 1) this.stand(g, QUEUE, this.lastPoint(g), -Math.PI / 2, now);
        break;

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
    const layout = ROOM_BY_ID[g.roomId];
    this.sim.rooms.makeDirty(room);
    this.sim.roomsChanged();
    this.sim.notify(`Oda ${room.id} boşaltıldı — temizlik gerekiyor!`, 'dirty');
    const street = this.rng() < 0.5 ? POINTS.streetWest : POINTS.streetEast;
    g.roomId = null;
    this.walkLegs(g, P.CHECKOUT, roomToLobby([layout.path.stand], layout, [POINTS.doorInside, POINTS.doorOutside, street]), now);
  }
}
