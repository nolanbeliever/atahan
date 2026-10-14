import { EVT, formatMoney } from '../../shared/constants.js';
import { ALLEY, BAR, POINTS } from '../../shared/layout.js';
import { pathLength, samplePath } from '../../shared/path.js';
import {
  STAGE, STAGE_ACT_BY_ID, STAGE_RULES as R, CROWD_SPOTS, stagePhaseAt, faceStage, nearStage,
} from '../../shared/stage.js';

// Kalabalığın geldiği / gittiği yerler (Achterstraat'ın iki ucu, otelin arka kapısı)
const BACK_DOOR = [(ALLEY.backDoor.from + ALLEY.backDoor.to) / 2, 26];
const ROUTES = Object.freeze({
  // Otel misafirleri arka kapıdan çıkıp sahneye gelir
  hotel: [[BACK_DOOR[0], 24.8], [BACK_DOOR[0], 27.4], [-5.5, 28.2], [-9.2, 29.3]],
  // Steeg'den (barın arkasındaki ara sokak) kemerin altından
  steeg: [[17, 15.5], [17, 26.7], [13.2, 29.4], [-9.2, 29.4]],
  // Batı ucundaki kemerli geçitten (Achterstraat'ın batı ucu)
  gate: [[-17.55, 29.5], [-16.2, 29.9]],
});
// Set bitince: arka kapı → koridor → lobi → Bar De Tulp'un kapısı (burada kaybolur)
// (sahnenin ön köşesinden uzak dur: önce sahnenin doğusundaki boşluğa)
const TO_BAR = Object.freeze([[-9.2, 29.3], [-5.5, 28.2], [BACK_DOOR[0], 27.4], [BACK_DOOR[0], 25.4], [0, 12.6], POINTS.hub, BAR.points.lobby, BAR.points.doorWest, BAR.points.doorEast]);
// Steeg üzerinden sokağa (barın sokak tarafına) — steeg'in sokak ağzında kaybolur
const TO_STEEG = Object.freeze([[-9.2, 29.4], [13.2, 29.4], [17, 26.7], [17, -0.6]]);
// Gece (23:00): bar kapalı, kalabalık evine dağılır (batı geçidi)
const TO_GATE = Object.freeze([[-16.2, 29.9], [-17.55, 29.5]]);

const C = Object.freeze({ WALK: 'c-walk', DANCE: 'c-dance', CLAP: 'c-clap', LEAVE: 'c-leave' });

/**
 * Achterstraat Canlı Müzik Sahnesi (sunucu, yetkili).
 *  - Sahne Resepsiyon PC'den kasa parasıyla BİR KEZ alınır (STAGE.PRICE); herkes için belirir.
 *  - Sahnenin önünde E → grup kirala (günlük ücret kasadan): günde tek grup, gece / 22:00'den
 *    sonra kiralanamaz. Grup 23:00'e kadar SET (240 oyun dk) → MOLA (60 oyun dk) döngüsüyle çalar.
 *    Takvim oyun dakikasıyla (clock.total) hesaplanır: duraklatma / hafta sonu hızı doğru işler.
 *  - Set başlarken kalabalık NPC'leri birer birer gelir (otelin arka kapısından, steeg'den, batı
 *    geçidinden) ve sahnenin önünde yarım çemberde dans eder / alkışlar. Misafirlerle aynı ağ biçimi
 *    (GUEST_UPSERT / GUEST_REMOVE, kind: 'crowd', kimlik sim.guests.nextId) — istemci rotayı kendisi
 *    oynatır, sunucu yalnızca faz değişiminde mesaj yollar.
 *  - Set bitince (mola ya da gün sonu) kalabalık arka kapıdan bara (ya da steeg'den sokağa) yürür;
 *    ilk kişi barın kapısına varınca geçici bar bonusu (BoostService, source 'stage') verilir.
 *    23:00'te biten son sette bar kapalıdır: kalabalık dağılır, bonus yok.
 *  - Pil / CPU: zamanlayıcı yok; HotelSimulation.tick → update(now). Sahne ya da rezervasyon yoksa
 *    update hemen döner. Yayın yalnızca evre değişiminde (STAGE_STATE) ve NPC faz değişiminde.
 *  - Kalıcı: { owned, booking } (hotelState.stage). Kalabalık kalıcı değil (yeniden yüklenince
 *    süren sete yeniden gelir).
 */
export class StageService {
  constructor(sim) {
    this.sim = sim;
    this.owned = false;
    this.booking = null; // { act, day, startTotal, endTotal }
    this.phase = 'idle'; // 'idle' | 'set' | 'break' | 'over'
    this.setNo = -1;
    this.setAt = null; // sürmekte olan setin başladığı gerçek zaman (ms, sunucu saati) — müzik senkronu
    this.to = 0; // içinde bulunulan evrenin bitişi (oyun dakikası)
    this.crowd = new Map(); // id → kalabalık NPC'si
    this.queue = []; // gelmeyi bekleyen kalabalık { at, spot, route }
    this.boostPending = null; // set bitti, ilk kişi bara varınca verilecek bonus { act, fans }
  }

  get rng() { return this.sim.rng; }

  get actDef() { return this.booking ? STAGE_ACT_BY_ID[this.booking.act] : null; }

  // ---- Kalıcılık -------------------------------------------------------------------

  persisted() {
    return { owned: this.owned, booking: this.booking ? { ...this.booking } : null };
  }

  restore(s) {
    if (!s || typeof s !== 'object') return;
    this.owned = s.owned === true;
    const b = s.booking;
    if (!this.owned || !b || typeof b !== 'object') return;
    if (typeof b.act !== 'string' || !STAGE_ACT_BY_ID[b.act]) return;
    if (!Number.isInteger(b.day) || b.day < 0 || b.day >= 1e6) return;
    if (!Number.isFinite(b.startTotal) || !Number.isFinite(b.endTotal) || b.endTotal <= b.startTotal) return;
    if (b.endTotal - b.startTotal > 24 * 60) return;
    // Gün kontrolü update'te yapılır (saat restoreHotel'in sonunda geri yüklenir)
    this.booking = { act: b.act, day: b.day, startTotal: b.startTotal, endTotal: b.endTotal };
  }

  // ---- Ağ ------------------------------------------------------------------------------

  serialize() {
    return {
      owned: this.owned,
      booking: this.booking ? { ...this.booking } : null,
      phase: this.phase,
      setNo: this.setNo,
      setAt: this.phase === 'set' ? this.setAt : null,
      to: Number.isFinite(this.to) ? this.to : null,
      crowd: this.crowd.size,
    };
  }

  changed() { this.sim.out(EVT.STAGE_STATE, this.serialize()); }

  toWire(c) {
    return {
      id: c.id,
      kind: 'crowd',
      look: c.look,
      phase: c.phase,
      path: c.path,
      t0: c.t0,
      speed: R.CROWD_SPEED,
      face: c.face,
      sit: false,
      roomId: null,
      style: c.style, // istemci: dans biçimi (deterministik varyasyon id'den)
    };
  }

  serializeWires() { return [...this.crowd.values()].map((c) => this.toWire(c)); }

  broadcast(c) { this.sim.out(EVT.GUEST_UPSERT, this.toWire(c)); }

  shiftTime(deltaMs) {
    for (const c of this.crowd.values()) {
      c.t0 += deltaMs;
      c.phaseEndsAt += deltaMs;
    }
    for (const q of this.queue) q.at += deltaMs;
    if (this.setAt !== null) this.setAt += deltaMs;
  }

  // ---- Eylemler ----------------------------------------------------------------------

  act(p, data, now) {
    if (!data || typeof data !== 'object') return { ok: false, error: 'Geçersiz işlem.' };
    if (data.act === 'buy') return this.buy(p);
    if (data.act === 'hire') return this.hire(p, data.id, now);
    return { ok: false, error: 'Geçersiz işlem.' };
  }

  /** Resepsiyon PC → Yükseltmeler: sahneyi kasa parasıyla bir kez satın al */
  buy(p) {
    if (!this.sim.growth.nearPc(p)) return { ok: false, error: 'Resepsiyon bilgisayarının başında olmalısın.' };
    if (this.owned) return { ok: false, error: 'Sahne zaten kurulu.' };
    if (this.sim.money < STAGE.PRICE) return { ok: false, error: `Kasada yeterli para yok (${formatMoney(STAGE.PRICE)} gerekiyor).` };
    this.owned = true;
    this.sim.spend(STAGE.PRICE, '🎤 Canlı müzik sahnesi kuruldu');
    this.sim.notify(`🎤 ${p.name} Achterstraat'a canlı müzik sahnesi kurdurdu! Sahnenin önünde E → müzisyen kirala.`, 'day');
    this.changed();
    return { ok: true };
  }

  /** Sahnenin önünde: bugünlük grup kirala (günlük ücret kasadan) */
  hire(p, id, now) {
    if (!this.owned) return { ok: false, error: 'Önce sahne kurulmalı (Resepsiyon PC → Yükseltmeler).' };
    if (!nearStage(p.x, p.z, 1)) return { ok: false, error: 'Sahnenin önünde olmalısın.' };
    const act = typeof id === 'string' ? STAGE_ACT_BY_ID[id] : undefined;
    if (!act) return { ok: false, error: 'Böyle bir grup yok.' };
    const { clock } = this.sim;
    if (clock.night) return { ok: false, error: 'Gece müzisyen tutulamaz — sabah 07:00\'den sonra gel.' };
    if (clock.minute >= R.HIRE_UNTIL_MIN) return { ok: false, error: 'Bugün için çok geç (22:00\'den sonra grup tutulmaz). Yarın tekrar dene.' };
    if (this.booking && this.booking.day === clock.dayCount) {
      const cur = STAGE_ACT_BY_ID[this.booking.act];
      return { ok: false, error: `Bugün sahnede zaten ${cur.icon} ${cur.name} var — günde tek grup.` };
    }
    if (this.sim.money < act.fee) return { ok: false, error: `Kasada yeterli para yok (${formatMoney(act.fee)} gerekiyor).` };
    this.clearCrowd();
    const dayBase = clock.dayCount * 24 * 60;
    this.booking = {
      act: act.id,
      day: clock.dayCount,
      startTotal: clock.total,
      endTotal: dayBase + R.END_MIN,
    };
    this.phase = 'idle';
    this.sim.spend(act.fee, `${act.icon} ${act.name} bugün için kiralandı`);
    this.update(now); // ilk set hemen başlar
    return { ok: true, act: act.id };
  }

  // ---- Döngü ----------------------------------------------------------------------------

  update(now) {
    if (!this.booking && !this.crowd.size) return;
    const { clock } = this.sim;
    // Gün değişti: dünkü rezervasyon biter (gece kalabalık zaten dağıldı)
    if (this.booking && this.booking.day !== clock.dayCount) {
      // Gece kapalıyken (23:00 → doğrudan sabah) set sürüyor olabilir: kalabalık evine dağılır
      if (this.phase === 'set' && this.actDef) this.endSet(this.actDef, true, now);
      this.booking = null;
      this.phase = 'idle';
      this.setNo = -1;
      this.setAt = null;
      this.to = 0;
      this.queue = [];
      this.changed();
      this.sim.house.scheduleSave();
    }
    if (this.booking) {
      const st = stagePhaseAt(this.booking, clock.total);
      if (st.phase !== this.phase || st.setNo !== this.setNo) this.enter(st, now);
    }
    this.updateCrowd(now);
  }

  enter(st, now) {
    const prev = this.phase;
    const act = this.actDef;
    this.phase = st.phase;
    this.setNo = st.setNo;
    this.to = st.to;
    if (st.phase === 'set') {
      this.setAt = now;
      this.planCrowd(act, now);
      this.sim.notify(st.setNo === 0
        ? `${act.icon} ${act.name} sahnede! Achterstraat'ta canlı müzik başladı.`
        : `${act.icon} ${act.name} ${st.setNo + 1}. sete başladı — Achterstraat'a gel!`, 'info');
    } else {
      this.setAt = null;
      if (prev === 'set') this.endSet(act, st.phase === 'over' && this.sim.clock.night, now);
    }
    this.changed();
    this.sim.house.scheduleSave();
  }

  /** Set başı: kalabalık birer birer gelir (ilk kişi hemen) */
  planCrowd(act, now) {
    const n = Math.min(act.crowd, R.MAX_CROWD, CROWD_SPOTS.length);
    // Önceki setten bara yürüyenler sayılmaz (noktaları boşaldı)
    const used = new Set([...this.crowd.values()].filter((c) => c.phase !== C.LEAVE).map((c) => c.spot));
    this.queue = [];
    let k = 0;
    for (let spot = 0; spot < CROWD_SPOTS.length && this.queue.length + used.size < n; spot++) {
      if (used.has(spot)) continue;
      const route = ['hotel', 'steeg', 'gate'][k % 3];
      this.queue.push({ at: now + k * R.CROWD_GAP_MS, spot, route });
      k++;
    }
  }

  /** Set bitti: kalabalık bara (gece: evine) yürür; bahşiş kavanozu */
  endSet(act, night, now) {
    this.queue = [];
    let fans = 0;
    let i = 0;
    for (const c of this.crowd.values()) {
      fans += 1;
      if (night) this.leave(c, TO_GATE, now);
      else this.leave(c, i % 4 === 3 ? TO_STEEG : TO_BAR, now);
      i++;
    }
    if (!fans) return;
    // Sahnenin yanında dinleyen bir oyuncu varsa seyirciler kavanoza bahşiş bırakır (kasaya)
    const [sx, sz] = STAGE.center;
    const listener = [...this.sim.players.values()].some((p) => Math.hypot(p.x - sx, p.z - sz) <= R.TIP_RANGE);
    if (listener) this.sim.earn(fans * R.TIP_PER_FAN, `🎩 Sahnedeki bahşiş kavanozu (${fans} seyirci)`, { guest: false });
    if (night) {
      this.sim.notify(`🌙 ${act.icon} Konser bitti — bar kapalı, kalabalık evine dağılıyor.`, 'info');
      return;
    }
    this.boostPending = { act: act.id, fans };
  }

  /** İlk kişi barın kapısına vardı: geçici bar bonusu + duyuru */
  applyBoost() {
    const pend = this.boostPending;
    this.boostPending = null;
    const act = STAGE_ACT_BY_ID[pend.act];
    if (!act) return;
    const tip = act.barTip;
    this.sim.boosts.add({
      source: 'stage',
      label: 'Konser kalabalığı barda',
      icon: act.icon,
      minutes: R.BOOST_MIN,
      barSpawn: act.barSpawn,
      barTip: tip,
      guestSpawn: 1,
    });
    this.sim.notify(`${act.icon} Set bitti! Kalabalık Bar De Tulp'a akın ediyor — bar bahşişleri %${Math.round((tip - 1) * 100)} arttı.`, 'money');
  }

  clearCrowd() {
    for (const id of [...this.crowd.keys()]) {
      this.crowd.delete(id);
      this.sim.out(EVT.GUEST_REMOVE, id);
    }
    this.queue = [];
    this.boostPending = null;
  }

  // ---- Kalabalık NPC'leri --------------------------------------------------------------------

  updateCrowd(now) {
    if (this.queue.length && this.phase === 'set') {
      while (this.queue.length && this.queue[0].at <= now) this.spawn(this.queue.shift(), now);
    }
    for (const c of [...this.crowd.values()]) {
      if (now < c.phaseEndsAt) continue;
      if (c.phase === C.WALK) {
        const [x, z] = CROWD_SPOTS[c.spot];
        this.stand(c, x, z, now);
      } else if (c.phase === C.LEAVE) {
        this.crowd.delete(c.id);
        this.sim.out(EVT.GUEST_REMOVE, c.id);
        if (c.toBar && this.boostPending) this.applyBoost();
      }
    }
    // Herkes gitti ama kimse bara varmadı (hepsi steeg'den): bonus yine verilir
    if (this.boostPending && !this.crowd.size) this.applyBoost();
  }

  randomLook() {
    const r = this.rng;
    return {
      body: Math.floor(r() * 8), skin: Math.floor(r() * 5), hair: Math.floor(r() * 5), hat: r() < 0.25, bag: r() < 0.2,
    };
  }

  spawn(q, now) {
    const act = this.actDef;
    const id = this.sim.guests.nextId++; // misafirlerle ortak kimlik sayacı → çakışma yok
    // DJ'de herkes dans eder; gitar ve cazda kimi alkışlar, kimi sallanır
    const style = act?.id === 'dj' ? C.DANCE : (id % 2 ? C.CLAP : C.DANCE);
    const c = {
      id, look: this.randomLook(), phase: C.WALK, path: null, t0: now, phaseEndsAt: 0, face: 0, spot: q.spot, style, toBar: false,
    };
    this.crowd.set(id, c);
    this.walk(c, [...ROUTES[q.route], CROWD_SPOTS[q.spot]], now, C.WALK);
  }

  walk(c, path, now, phase) {
    c.phase = phase;
    c.path = path.map((pt) => [pt[0], pt[1]]);
    c.t0 = now;
    c.phaseEndsAt = now + (pathLength(c.path) / R.CROWD_SPEED) * 1000;
    this.broadcast(c);
  }

  stand(c, x, z, now) {
    c.phase = c.style;
    c.path = [[x, z]];
    c.t0 = now;
    c.face = faceStage(x, z);
    c.phaseEndsAt = Infinity;
    this.broadcast(c);
  }

  /** O anki konum (yürürken rota + zamandan) */
  posOf(c, now) {
    if (c.path.length === 1) return c.path[0];
    const s = samplePath(c.path, Math.max(0, ((now - c.t0) / 1000) * R.CROWD_SPEED));
    return [Math.round(s.x * 100) / 100, Math.round(s.z * 100) / 100];
  }

  leave(c, route, now) {
    const from = this.posOf(c, now);
    c.toBar = route === TO_BAR;
    this.walk(c, [from, ...route], now, C.LEAVE);
  }
}
