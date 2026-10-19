import { EVT, GUEST_SPEED } from '../../shared/constants.js';
import { POINTS } from '../../shared/layout.js';
import { pathLength } from '../../shared/path.js';
import { CAR_BY_ID, carSpeedCap } from '../../shared/cars.js';
import {
  VALET, VALET_MODELS, VALET_CUSTOMERS, VALET_RULES as R, valetFee, valetTip, hitDamage, valetSpawnFactor,
  inWashBay, valetBayAt,
} from '../../shared/valet.js';

const str = (v) => (typeof v === 'string' ? v : '');
const int = (v) => (Number.isInteger(v) ? v : -1);
const TOOLS = Object.freeze(Object.assign(Object.create(null), { foam: 'foam', water: 'water' }));
const STAGE_TOOL = Object.freeze({ foam: 'foam', water: 'water' });
const TOOL_NAME = Object.freeze({ foam: 'köpük tabancası', water: 'tazyikli su tabancası' });
const PH = Object.freeze({ ARRIVE: 'v-arrive', WAIT: 'v-wait', LEAVE: 'v-leave' });

/**
 * VIP Vale & Tazyikli Su Oto Yıkama (sunucu yetkili).
 *  - VIP müşteriler (08:00–22:00, otel yıldızı ve Gökdelen VIP suitleri arttıkça daha sık) lüks / spor bir
 *    arabayla otelin önüne gelir; araba çamurludur (VALET_RULES.SPOTS nokta). Müşteri vale kürsüsünün yanında
 *    bekler; anahtar KEY_WAIT_MS içinde alınmazsa kendisi park edip gider.
 *  - Anahtarı alan oyuncu arabanın geçici "sahibi" olur: VehicleService'in ortak araba mekanizmasıyla (sürücü
 *    koltuğu, garaj / sokak / drag bölgeleri, rampa ve tünel geçitleri, hız denetimi) serbestçe sürer. Arabaya
 *    başkası binemez; araba kalıcı değildir (kayda girmez).
 *  - Yıkama: araba garajdaki yıkama bölmesinde park hâlindeyken herhangi bir oyuncu askıdan tabancayı alır;
 *    önce bütün noktalar köpüklenir, sonra tazyikli suyla durulanır. Her nokta 'begin' → en az SPRAY_MS →
 *    'finish' (tamir mini oyunu kalıbı) — tabanca, aşama, konum ve süre burada doğrulanır.
 *  - Hasar: sürücünün istemcisi çarpmaları bildirir (hız, bulunduğu yerin sınırına kırpılır, en sık 0.7 sn'de
 *    bir); ayrıca sunucunun hız denetimine takılan (kırpılan) hareketler küçük hasar yazar.
 *  - Teslim: anahtar sahibi arabayı bir vale park yerinde (V-1…V-3) park edince iş biter, araba kalkar:
 *    vale ücreti otel KASASINA, bahşiş anahtar sahibinin CÜZDANINA (yıkanmış + hasarsız + hızlı → çok yüksek).
 *  - Zamanlayıcı yok: tick(now) içinde update.
 */
export class ValetService {
  constructor(sim) {
    this.sim = sim;
    this.jobs = new Map();
    this.nextJob = 1;
    this.nextSpawnAt = null;
    this.stats = { done: 0, perfect: 0, tips: 0, fees: 0 };
  }

  get rng() { return this.sim.rng; }
  get vehicles() { return this.sim.vehicles; }

  /** VIP'lerin geldiği saatler */
  get open() {
    const c = this.sim.clock;
    return !c.night && c.minute >= R.OPEN_FROM && c.minute < R.OPEN_TO;
  }

  /** Gökdelen VIP suitleri açık mı (VIP'ler daha sık ve daha cömert) */
  get vipSuites() { return (this.sim.arch?.level ?? 0) >= 2; }

  // ---- Kalıcılık (yalnızca istatistik) ---------------------------------------------------------

  persisted() { return { ...this.stats }; }

  restore(s) {
    if (!s || typeof s !== 'object' || Array.isArray(s)) return;
    for (const k of Object.keys(this.stats)) {
      const v = s[k];
      if (Number.isInteger(v) && v >= 0 && v < 1e9) this.stats[k] = v;
    }
  }

  // ---- Oyuncular ----------------------------------------------------------------------------

  initPlayer(p) {
    p.valet = { job: null, tool: null, spray: null, hitAt: 0, clipAt: 0 };
  }

  /** Anahtar sahibi ayrılırsa müşteri arabasını geri alır (VehicleService.removePlayer'dan ÖNCE çağrılır) */
  removePlayer(p) {
    const job = p.valet?.job != null ? this.jobs.get(p.valet.job) : null;
    if (job) {
      this.sim.notify(`🔑 Vale ayrıldı — ${job.customer} ${this.carName(job)} arabasını geri aldı.`, 'warn');
      this.finish(job);
    }
  }

  // ---- Durum ----------------------------------------------------------------------------------

  carName(job) { return CAR_BY_ID[job.model]?.name ?? 'Araba'; }

  serialize() {
    return {
      jobs: [...this.jobs.values()].map((j) => ({
        id: j.id,
        state: j.state,
        customer: j.customer,
        model: j.model,
        color: j.color,
        carId: j.carId,
        holder: j.holder,
        holderName: j.holderName,
        waitUntil: j.state === 'waiting' ? j.waitUntil : 0,
        deadline: j.deadline,
        keysAt: j.keysAt,
        spots: [...j.spots],
        stage: j.stage,
        damage: Math.round(j.damage),
        fee: valetFee(j.model),
      })),
      stats: { ...this.stats },
    };
  }

  changed() { this.sim.out(EVT.VALET_STATE, this.serialize()); }

  serializeWires() {
    const out = [];
    for (const j of this.jobs.values()) if (j.npc) out.push(this.npcWire(j));
    return out;
  }

  npcWire(j) {
    const n = j.npc;
    return {
      id: n.id, kind: 'valet', look: n.look, phase: n.phase, path: n.path, t0: n.t0,
      speed: GUEST_SPEED, face: n.face, sit: false, roomId: null, vip: true, label: `⭐ ${j.customer}`,
    };
  }

  shiftTime(deltaMs) {
    for (const j of this.jobs.values()) {
      if (j.waitUntil) j.waitUntil += deltaMs;
      if (j.deadline) j.deadline += deltaMs;
      if (j.keysAt) j.keysAt += deltaMs;
      if (j.npc) {
        j.npc.t0 += deltaMs;
        j.npc.phaseEndsAt += deltaMs;
      }
    }
    if (this.nextSpawnAt !== null) this.nextSpawnAt += deltaMs;
  }

  // ---- Döngü ----------------------------------------------------------------------------------

  update(now) {
    if (this.open && this.sim.config.valetCustomers !== false) {
      if (this.nextSpawnAt === null) this.nextSpawnAt = now + R.FIRST_MS * (0.6 + this.rng() * 0.8);
      if (now >= this.nextSpawnAt) {
        const ok = this.spawn(now);
        const f = valetSpawnFactor(this.sim.growth.stars, this.vipSuites);
        this.nextSpawnAt = now + (ok ? (R.SPAWN_MIN_MS + this.rng() * (R.SPAWN_MAX_MS - R.SPAWN_MIN_MS)) * f : 10_000);
      }
    } else {
      this.nextSpawnAt = null;
    }
    for (const j of [...this.jobs.values()]) this.updateJob(j, now);
  }

  updateJob(j, now) {
    const n = j.npc;
    if (n && n.phase !== PH.WAIT && now >= n.phaseEndsAt) {
      if (n.phase === PH.ARRIVE) this.npcStand(j, now);
      else this.npcRemove(j);
    }
    if (j.state === 'waiting' && now >= j.waitUntil) {
      // Vale gelmedi: müşteri arabasıyla kendisi gider
      this.sim.notify(`😤 ${j.customer} vale bulamadı, arabasını kendisi park etti. (Vale kürsüsü: otelin önü)`, 'warn');
      this.sim.growth.addReputation(-1);
      this.finish(j);
      return;
    }
    if (j.state === 'keys' && !j.lateWarned && now >= j.deadline) {
      j.lateWarned = true;
      this.sim.toPlayer(j.holder, EVT.NOTIFY, { text: `⏰ ${j.customer} çok bekledi — teslim süresi doldu, bahşiş düşük olacak.`, kind: 'warn' });
    }
  }

  /** Kürsüde bekleyen var mı / bırakma yeri boş mu */
  dropoffFree() {
    for (const j of this.jobs.values()) if (j.state === 'waiting') return false;
    const d = VALET.dropoff;
    for (const v of this.vehicles.vehicles.values()) if (Math.hypot(v.x - d.x, v.z - d.z) < 3.5) return false;
    return true;
  }

  spawn(now) {
    if (this.jobs.size >= R.MAX_JOBS || !this.dropoffFree() || !this.sim.players.size) return false;
    const model = VALET_MODELS[Math.floor(this.rng() * VALET_MODELS.length)];
    const def = CAR_BY_ID[model];
    const color = Math.floor(this.rng() * def.colors.length);
    const used = new Set([...this.jobs.values()].map((j) => j.customer));
    const names = VALET_CUSTOMERS.filter((c) => !used.has(c));
    const customer = names[Math.floor(this.rng() * names.length)] ?? VALET_CUSTOMERS[0];
    const d = VALET.dropoff;
    const v = this.vehicles.spawn({ id: 0, keyHash: null, name: `⭐ ${customer}` }, 'car', { x: d.x, z: d.z, yaw: d.yaw });
    v.model = model;
    v.color = color;
    const job = {
      id: this.nextJob++,
      state: 'waiting',
      customer,
      model,
      color,
      carId: v.id,
      holder: null,
      holderName: null,
      waitUntil: now + R.KEY_WAIT_MS,
      keysAt: 0,
      deadline: 0,
      spots: new Array(R.SPOTS).fill(0), // 0 çamurlu · 1 köpüklü · 2 temiz
      stage: 'foam',
      damage: 0,
      clipDmg: 0,
      lateWarned: false,
      npc: null,
    };
    v.valet = job.id;
    this.jobs.set(job.id, job);
    // Müşteri sürücü kapısından iner, kürsünün yanına yürür
    const look = this.sim.guests.randomLook();
    look.bag = true;
    look.hat = false;
    job.npc = { id: this.sim.guests.nextId++, look, phase: null, path: null, t0: now, phaseEndsAt: 0, face: 0 };
    this.npcWalk(job, PH.ARRIVE, [[d.x + 0.4, d.z + 1.5], VALET.vipSpot], now);
    this.vehicles.broadcast();
    this.changed();
    this.sim.notify(`⭐ VIP müşteri ${customer}, ${def.name} ile otelin önüne geldi — vale kürsüsünden anahtarı al! (€${valetFee(model)} vale ücreti + bahşiş)`, 'info');
    return true;
  }

  npcWalk(j, phase, path, now) {
    const n = j.npc;
    n.phase = phase;
    n.path = path.map((pt) => [pt[0], pt[1]]);
    n.t0 = now;
    n.phaseEndsAt = now + (pathLength(n.path) / GUEST_SPEED) * 1000;
    this.sim.out(EVT.GUEST_UPSERT, this.npcWire(j));
  }

  /** Kürsünün yanında, kürsüye (batıya) dönük bekler */
  npcStand(j, now) {
    const n = j.npc;
    n.phase = PH.WAIT;
    n.path = [[...VALET.vipSpot]];
    n.t0 = now;
    n.face = Math.PI / 2;
    this.sim.out(EVT.GUEST_UPSERT, this.npcWire(j));
  }

  npcRemove(j) {
    if (!j.npc) return;
    this.sim.out(EVT.GUEST_REMOVE, j.npc.id);
    j.npc = null;
  }

  /** İşi kapat: araba ve müşteri dünyadan kalkar, anahtar sahibi serbest kalır */
  finish(j) {
    const v = this.vehicles.vehicles.get(j.carId);
    if (v) {
      if (v.driver != null) {
        const d = this.sim.players.get(v.driver);
        if (d) d.vehicle = null;
      }
      this.vehicles.vehicles.delete(v.id);
      this.vehicles.broadcast();
    }
    if (j.holder != null) {
      const h = this.sim.players.get(j.holder);
      if (h?.valet?.job === j.id) h.valet.job = null;
    }
    for (const p of this.sim.players.values()) if (p.valet?.spray?.job === j.id) p.valet.spray = null;
    this.npcRemove(j);
    this.jobs.delete(j.id);
    this.changed();
  }

  // ---- Eylemler ----------------------------------------------------------------------------------

  /** @returns {{ ok: true, ... } | { ok: false, error }} */
  act(p, data, now) {
    const act = str(data?.act);
    if (act === 'keys') return this.keys(p, data, now);
    if (act === 'tool') return this.tool(p, data);
    if (act === 'spray') return this.spray(p, data, now);
    if (act === 'hit') return this.hit(p, data, now);
    return { ok: false, error: 'Geçersiz işlem.' };
  }

  keys(p, data, now) {
    if (p.vehicle) return { ok: false, error: 'Önce araçtan in.' };
    const st = VALET.stand;
    if (Math.hypot(p.x - st.point[0], p.z - st.point[1]) > st.range + 1) return { ok: false, error: 'Vale kürsüsüne yaklaş.' };
    if (p.valet.job != null) return { ok: false, error: 'Zaten bir VIP aracının anahtarı sende — önce onu teslim et.' };
    const j = this.jobs.get(int(data?.job));
    if (!j || j.state !== 'waiting') return { ok: false, error: 'Anahtarını bekleyen VIP müşteri yok.' };
    const v = this.vehicles.vehicles.get(j.carId);
    if (!v) return { ok: false, error: 'Araba bulunamadı.' };
    j.state = 'keys';
    j.holder = p.id;
    j.holderName = p.name;
    j.keysAt = now;
    j.deadline = now + R.JOB_MS;
    j.waitUntil = 0;
    p.valet.job = j.id;
    v.ownerId = p.id; // sürücü koltuğu artık onun (kayda girmez: v.rec yok)
    // Müşteri otele girer
    if (j.npc) this.npcWalk(j, PH.LEAVE, [VALET.vipSpot, POINTS.doorOutside, POINTS.doorInside], now);
    this.vehicles.broadcast();
    this.changed();
    return { ok: true, job: j.id, carId: v.id, deadline: j.deadline };
  }

  tool(p, data) {
    const t = data?.tool === null ? null : TOOLS[str(data?.tool)];
    if (t === undefined) return { ok: false, error: 'Böyle bir tabanca yok.' };
    if (p.vehicle) return { ok: false, error: 'Önce araçtan in.' };
    const r = VALET.rack;
    if (Math.hypot(p.x - r.point[0], p.z - r.point[1]) > r.range + 1) return { ok: false, error: 'Tabanca askısına yaklaş.' };
    p.valet.tool = t;
    p.valet.spray = null;
    return { ok: true, tool: t };
  }

  spray(p, data, now) {
    const step = data?.step;
    if (step !== 'begin' && step !== 'finish') return { ok: false, error: 'Geçersiz işlem.' };
    const j = this.jobs.get(int(data?.job));
    if (!j || j.state !== 'keys') return { ok: false, error: 'Yıkanacak VIP aracı yok.' };
    if (p.vehicle) return { ok: false, error: 'Önce araçtan in.' };
    const v = this.vehicles.vehicles.get(j.carId);
    if (!v || v.driver != null) return { ok: false, error: 'Araba yıkama bölmesinde park etmiş olmalı.' };
    if (!inWashBay(v.x, v.z)) return { ok: false, error: 'Arabayı önce garajdaki yıkama bölmesine çek.' };
    if (Math.hypot(p.x - v.x, p.z - v.z) > R.WASH_RANGE + 1) return { ok: false, error: 'Arabaya yaklaş.' };
    if (j.stage === 'done') return { ok: false, error: 'Araba zaten pırıl pırıl.' };
    const need = STAGE_TOOL[j.stage];
    if (p.valet.tool !== need) return { ok: false, error: `Önce askıdan ${TOOL_NAME[need]} al.` };
    const i = int(data?.spot);
    if (i < 0 || i >= j.spots.length) return { ok: false, error: 'Geçersiz nokta.' };
    const want = j.stage === 'foam' ? 0 : 1;
    if (j.spots[i] !== want) return { ok: false, error: j.stage === 'foam' ? 'Burası zaten köpüklü.' : 'Burası zaten temiz.' };
    const ms = R.SPRAY_MS[need];
    if (step === 'begin') {
      p.valet.spray = { job: j.id, spot: i, stage: j.stage, at: now };
      return { ok: true, ms };
    }
    const s = p.valet.spray;
    if (!s || s.job !== j.id || s.spot !== i || s.stage !== j.stage) return { ok: false, error: 'Önce püskürtmeye başla.' };
    if (now - s.at < ms - R.SLACK_MS) return { ok: false, error: 'Biraz daha tut — tam temizlenmedi.' };
    p.valet.spray = null;
    j.spots[i] = want + 1;
    let stageDone = false;
    if (j.spots.every((x) => x > want)) {
      stageDone = true;
      if (j.stage === 'foam') {
        j.stage = 'water';
        this.sim.toPlayer(p.id, EVT.NOTIFY, { text: '🫧 Bütün çamur köpüklendi — şimdi tazyikli su tabancasıyla durula!', kind: 'info' });
      } else {
        j.stage = 'done';
        const msg = `✨ ${this.carName(j)} pırıl pırıl! Şimdi vale park yerine (V-1…V-3) çek.`;
        this.sim.toPlayer(p.id, EVT.NOTIFY, { text: msg, kind: 'info' });
        if (j.holder != null && j.holder !== p.id) this.sim.toPlayer(j.holder, EVT.NOTIFY, { text: `${p.name}: ${msg}`, kind: 'info' });
      }
    }
    this.changed();
    return { ok: true, stage: j.stage, stageDone };
  }

  /** Sürücünün istemcisinden çarpma bildirimi (hız, bulunduğu yerin sınırına kırpılır; seyreltilir) */
  hit(p, data, now) {
    const j = p.valet.job != null ? this.jobs.get(p.valet.job) : null;
    const v = j ? this.vehicles.vehicles.get(j.carId) : null;
    if (!v || p.vehicle?.id !== v.id || p.vehicle.seat !== 'driver') return { ok: false, error: 'VIP aracını sürmüyorsun.' };
    const kmh = data?.kmh;
    if (typeof kmh !== 'number' || !Number.isFinite(kmh) || kmh < 0) return { ok: false, error: 'Geçersiz değer.' };
    if (now - p.valet.hitAt < R.HIT_GAP_MS) return { ok: true, damage: Math.round(j.damage) };
    p.valet.hitAt = now;
    const cap = carSpeedCap(CAR_BY_ID[j.model], p.x, p.z) * 3.6 * 1.3 + 5;
    const add = hitDamage(Math.min(kmh, cap));
    if (add > 0) {
      j.damage = Math.min(100, j.damage + add);
      this.changed();
    }
    return { ok: true, damage: Math.round(j.damage), add: Math.round(add) };
  }

  /** GarageService.filterMove: VIP aracı sürücüsünün hareketi hız denetiminde kırpıldı */
  onClip(p, v, d) {
    if (!v.valet || d > 15) return; // ışınlanma sonrası bayat paket hız ihlali sayılmaz
    const j = this.jobs.get(v.valet);
    const now = this.sim.now();
    if (!j || now - p.valet.clipAt < 1000 || j.clipDmg >= R.CLIP_MAX) return;
    p.valet.clipAt = now;
    j.clipDmg += R.CLIP_PCT;
    j.damage = Math.min(100, j.damage + R.CLIP_PCT);
    this.changed();
  }

  /** VehicleService.mount: VIP aracına yalnızca anahtar sahibi biner */
  canMount(p, v) {
    if (!v.valet) return null;
    const j = this.jobs.get(v.valet);
    if (!j || j.holder !== p.id) return j?.state === 'waiting' ? 'Bu bir VIP aracı — önce vale kürsüsünden anahtarı al.' : 'Bu VIP aracının anahtarı başkasında.';
    return null;
  }

  /**
   * VehicleService.dismount (sürücü indi, araba park etti): vale park yerindeyse teslim tamam.
   * @returns {object | null} sonuç
   */
  onDismount(p, v) {
    if (!v.valet) return null;
    const j = this.jobs.get(v.valet);
    if (!j || j.holder !== p.id) return null;
    const bay = valetBayAt(v.x, v.z);
    if (!bay) {
      if (inWashBay(v.x, v.z) && j.stage !== 'done') {
        this.sim.toPlayer(p.id, EVT.NOTIFY, { text: `🫧 Yıkama bölmesi: askıdan ${TOOL_NAME[STAGE_TOOL[j.stage]]} al, çamurlu noktalara nişan alıp basılı tut.`, kind: 'info' });
      }
      return null;
    }
    const now = this.sim.now();
    const washed = j.stage === 'done';
    const late = now > j.deadline;
    const fast = now - j.keysAt <= R.FAST_MS;
    const damage = Math.round(j.damage);
    const fee = valetFee(j.model);
    const tip = valetTip({ model: j.model, washed, damage, late, fast, stars: this.sim.growth.stars, vipSuites: this.vipSuites });
    const name = this.carName(j);
    this.sim.earn(fee, `🔑 Vale: ${name} (${j.customer})`, { guest: false });
    if (tip > 0) {
      p.wallet += tip;
      this.sim.shop.sendSelf(p);
    }
    this.stats.done += 1;
    this.stats.fees += fee;
    this.stats.tips += tip;
    const perfect = washed && damage === 0;
    if (perfect) {
      this.stats.perfect += 1;
      this.sim.growth.addReputation(R.REP_PERFECT);
    } else if (damage >= R.NO_TIP_DAMAGE) {
      this.sim.growth.addReputation(R.REP_COMPLAINT);
    }
    const parts = [washed ? '✨ yıkanmış' : '🟤 çamurlu', damage ? `💥 hasar %${damage}` : '🛡️ hasarsız'];
    if (late) parts.push('⏰ geç');
    else if (fast) parts.push('⚡ hızlı');
    let text;
    if (damage >= R.NO_TIP_DAMAGE) text = `😡 ${j.customer}: "Arabama ne yaptınız?!" ${name} ${bay.id} park yerinde (${parts.join(' · ')}) — bahşiş yok, şikâyet edildi.`;
    else text = `🔑 ${name} ${bay.to} teslim edildi (${parts.join(' · ')}) — ${j.customer} €${tip} bahşiş bıraktı!${perfect ? ' ⭐ Kusursuz vale!' : ''}`;
    this.sim.toPlayer(p.id, EVT.NOTIFY, { text, kind: tip > 0 ? 'money' : 'warn' });
    this.sim.house.scheduleSave();
    // VehicleService.dismount yayınlar; araba burada kalkar
    this.vehicles.vehicles.delete(v.id);
    j.holder = null;
    p.valet.job = null;
    this.finish(j);
    return { tip, fee, washed, damage, bay: bay.id };
  }
}
