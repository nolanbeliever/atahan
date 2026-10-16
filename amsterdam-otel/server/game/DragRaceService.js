import { EVT } from '../../shared/constants.js';
import { CAR_BY_ID, DRAG_TRACK as T, DRAG_LANES, stageLaneAt, idealRun } from '../../shared/cars.js';

const HASH_RE = /^[0-9a-f]{64}$/;
const BOARD_SIZE = 10;
const MAX_SAMPLES = 600;
const V100 = 100 / 3.6;
const SPEED_WINDOW_MS = 150; // 0–100 için hız en az bu kadar aralıklı iki örnekten ölçülür
const ms3 = (v) => Math.round(v) / 1000; // ms → sn (3 ondalık)

/**
 * Drag pisti yarışları (sunucu yetkili zamanlama).
 *  - Sürücü arabasıyla şeridinde (Sol / Sağ) çizginin gerisinde durunca istemci 'stage' ister;
 *    sunucu konumu doğrular. Solo: ağaç hemen başlar. Düello: ilk gelen bekler (90 sn), ikinci
 *    şerit sahneye girince ortak geri sayım başlar.
 *  - Işık ağacı: sahneden 1 sn sonra 3 sarı (0.5 sn arayla), sonra yeşil. Zamanlar sunucu saatiyle
 *    yayınlanır (treeAt, greenAt); istemciler kendi senkron saatleriyle aynı anda yakar.
 *  - Zamanlama yalnızca sunucuya gelen konum örneklerinden (movePlayer → onMove, varış zamanı) ve
 *    doğrusal ara değerlemeyle hesaplanır: reaksiyon (yeşil → 5 cm, sahne ışığı söner), 0–100 km/s, 1/8 mil (201 m),
 *    1/4 mil (402 m) ET ve hız tuzağı (son 20 m'nin ortalama hızı). Yeşilden önce kalkan → kırmızı
 *    ışık (jump start). Şeridinden çıkan → diskalifiye. 40 sn'de bitirmeyen → DNF.
 *  - Hile denetimi: konumlar zaten GarageService.filterMove'da hız sınırıyla kırpılır; ayrıca ET
 *    modelin kuramsal en iyi koşusundan (shared/cars.idealRun) belirgin hızlıysa koşu geçersizdir.
 *  - Liderlik tablosu: en iyi 10 çeyrek mil ET'si (oyuncu başına bir kayıt), hotelState().drag ile
 *    kalıcı. Bahis yok — saf spor.
 *  - Zamanlayıcı yok: geçişler HotelSimulation.tick → update(now) ile.
 */
export class DragRaceService {
  constructor(sim) {
    this.sim = sim;
    this.phase = 'idle'; // 'idle' | 'waiting' | 'countdown' | 'running'
    this.mode = null; // 'solo' | 'duel'
    this.racers = Object.create(null); // lane → racer
    this.treeAt = 0;
    this.greenAt = 0;
    this.waitUntil = 0;
    this.runNo = 0;
    this.last = null; // son yarışın sonuçları { runNo, mode, results, winner, at }
    this.board = []; // [{ k, name, model, et, trap, rt, at }] (k: anahtar özeti — yayınlanmaz)
  }

  // ---- Kalıcılık ------------------------------------------------------------------------

  restore(data) {
    const list = data && typeof data === 'object' && Array.isArray(data.board) ? data.board : [];
    const seen = new Set();
    for (const raw of list) {
      if (this.board.length >= BOARD_SIZE) break;
      if (!raw || typeof raw !== 'object') continue;
      const k = typeof raw.k === 'string' && HASH_RE.test(raw.k) ? raw.k : null;
      const model = typeof raw.model === 'string' && CAR_BY_ID[raw.model] ? raw.model : null;
      const { et, trap, rt, at } = raw;
      if (!model || (k && seen.has(k))) continue;
      if (!Number.isFinite(et) || et < 3 || et > 60 || !Number.isFinite(trap) || trap < 10 || trap > 500) continue;
      if (!Number.isFinite(rt) || rt < 0 || rt > 10) continue;
      if (k) seen.add(k);
      this.board.push({
        k, name: typeof raw.name === 'string' ? raw.name.slice(0, 16) : '?', model, et, trap, rt,
        at: Number.isFinite(at) ? at : 0,
      });
    }
    this.sortBoard();
  }

  persisted() {
    return { board: this.board.map((e) => ({ ...e })) };
  }

  sortBoard() {
    this.board.sort((a, b) => a.et - b.et || a.at - b.at);
    this.board.length = Math.min(this.board.length, BOARD_SIZE);
  }

  // ---- Durum ------------------------------------------------------------------------------

  serialize() {
    return {
      phase: this.phase,
      mode: this.mode,
      runNo: this.runNo,
      treeAt: this.treeAt,
      greenAt: this.greenAt,
      waitUntil: this.phase === 'waiting' ? this.waitUntil : 0,
      racers: DRAG_LANES.filter((l) => this.racers[l]).map((l) => {
        const r = this.racers[l];
        return { lane: l, id: r.id, name: r.name, model: r.model, foul: r.foul, done: r.done };
      }),
      last: this.last,
      board: this.board.map(({ k, ...e }) => e),
    };
  }

  broadcast() { this.sim.out(EVT.DRAG_STATE, this.serialize()); }

  racerOf(p) {
    for (const l of DRAG_LANES) if (this.racers[l]?.id === p.id) return this.racers[l];
    return null;
  }

  // ---- Eylemler ------------------------------------------------------------------------------

  act(p, data, now) {
    const act = typeof data?.act === 'string' ? data.act : '';
    if (act === 'stage') return this.stage(p, data, now);
    if (act === 'unstage') return this.unstage(p);
    return { ok: false, error: 'Geçersiz işlem.' };
  }

  stage(p, data, now) {
    const lane = data.lane;
    if (lane !== 'L' && lane !== 'R') return { ok: false, error: 'Şerit seç (Sol / Sağ).' };
    const mode = data.mode;
    if (mode !== 'solo' && mode !== 'duel') return { ok: false, error: 'Mod seç (solo / düello).' };
    const seat = p.vehicle;
    const v = seat?.seat === 'driver' ? this.sim.vehicles.vehicles.get(seat.id) : null;
    if (!v || v.type !== 'car') return { ok: false, error: 'Drag için arabanla şeride gir.' };
    if (this.racerOf(p)) return { ok: false, error: 'Zaten sahnedesin.' };
    // Konum: şeridin sahne kutusu (1 m gecikme toleransı)
    const tol = { min: T.stage.min - 1, max: T.stage.max + 1 };
    if (stageLaneAt(p.x, p.z, tol) !== lane) return { ok: false, error: 'Şeridinde çizginin hemen gerisinde dur.' };
    if (this.racers[lane]) return { ok: false, error: 'Bu şerit dolu.' };
    const racer = {
      id: p.id, name: p.name, lane, model: v.model, k: p.keyHash ?? `s${p.id}`, stageZ: p.z, samples: [[now, 0]],
      launchAt: null, t8: null, tTrap: null, tFin: null, t100: null, vPrev: null, foul: null, done: false,
    };
    if (this.phase === 'idle') {
      this.racers[lane] = racer;
      if (mode === 'solo') this.startTree(now, 'solo');
      else {
        this.phase = 'waiting';
        this.mode = 'duel';
        this.waitUntil = now + T.waitMs;
        this.sim.notify(`🏁 ${p.name} drag pistinde rakip bekliyor (${T.lanes[lane].name}) — düello için diğer şeride gel!`, 'info');
      }
    } else if (this.phase === 'waiting') {
      // Bekleyen bir rakip var: hangi mod seçilirse seçilsin düello başlar
      this.racers[lane] = racer;
      this.startTree(now, 'duel');
    } else {
      return { ok: false, error: 'Pistte yarış sürüyor — bitmesini bekle.' };
    }
    this.broadcast();
    return { ok: true, phase: this.phase, treeAt: this.treeAt, greenAt: this.greenAt };
  }

  unstage(p) {
    const r = this.racerOf(p);
    if (!r) return { ok: false, error: 'Sahnede değilsin.' };
    if (this.phase === 'waiting') {
      this.reset();
      this.broadcast();
      return { ok: true };
    }
    this.dnf(r, 'Sahneden çıktı');
    return { ok: true };
  }

  startTree(now, mode) {
    this.mode = mode;
    this.phase = 'countdown';
    this.runNo += 1;
    this.treeAt = now + T.treeDelayMs;
    this.greenAt = this.treeAt + T.amberMs * 3;
    for (const l of DRAG_LANES) {
      const r = this.racers[l];
      if (r) r.samples = [[now, 0]];
    }
  }

  reset() {
    this.phase = 'idle';
    this.mode = null;
    this.racers = Object.create(null);
    this.treeAt = 0;
    this.greenAt = 0;
    this.waitUntil = 0;
  }

  // ---- Örnekler (movePlayer'dan) --------------------------------------------------------------

  /** Sürücünün konumu uygulandıktan sonra (HotelSimulation.movePlayer) */
  onMove(p, now) {
    if (this.phase === 'idle') return;
    const r = this.racerOf(p);
    if (!r || r.done) return;
    if (p.vehicle?.seat !== 'driver') {
      this.onLeave(p); // arabadan indi
      return;
    }
    const d = r.stageZ - p.z; // ileri = −Z
    if (Math.abs(p.x - T.lanes[r.lane].x) > T.laneHalf) {
      if (this.phase === 'waiting') this.unstage(p);
      else this.foul(r, 'lane', now);
      return;
    }
    if (this.phase === 'waiting') {
      if (Math.abs(d) > 1.5) this.unstage(p); // bekleyen sahneden ayrıldı
      return;
    }
    const prev = r.samples[r.samples.length - 1];
    if (now <= prev[0]) return; // aynı anda gelen iki paket: ara değerleme için zaman farkı yok
    r.samples.push([now, d]);
    if (r.samples.length > MAX_SAMPLES) r.samples.shift();
    if (now < this.greenAt) {
      if (d > T.rollout) this.foul(r, 'jump', now);
      return;
    }
    const cross = (D) => (prev[1] < D && d >= D ? prev[0] + ((D - prev[1]) / (d - prev[1])) * (now - prev[0]) : null);
    if (r.launchAt === null) {
      const t = cross(T.rollout);
      if (t === null) return;
      // Yeşilden önce çizgiyi geçtiği bir ÖRNEKLE görüldüyse yukarıda kırmızı yandı. Burada önceki örnek
      // yeşilden önce, bu örnek sonra: doğrusal ara değer yeşilden önceye düşebilir (örnekleme aralığı) →
      // lehine yorumlanır: en erken yeşil anı (RT 0.000).
      r.launchAt = Math.max(t, this.greenAt);
    }
    // 0–100: en az 150 ms aralıklı iki örnekten ortalama hız (paket kümelenmesine dayanıklı)
    if (r.t100 === null) {
      for (let i = r.samples.length - 2; i >= 0; i--) {
        const [ti, di] = r.samples[i];
        if (now - ti < SPEED_WINDOW_MS) continue;
        const v = (d - di) / ((now - ti) / 1000);
        const tm = (now + ti) / 2;
        if (v >= V100) {
          const pv = r.vPrev;
          const t = pv && pv.v < V100 ? pv.t + ((V100 - pv.v) / (v - pv.v)) * (tm - pv.t) : tm;
          r.t100 = Math.max(0, t - r.launchAt);
        } else {
          r.vPrev = { t: tm, v };
        }
        break;
      }
    }
    r.t8 ??= cross(T.eighth);
    r.tTrap ??= cross(T.quarter - T.trap);
    const fin = cross(T.quarter);
    if (fin !== null) {
      r.tFin = fin;
      this.finish(r);
    }
  }

  foul(r, why, now) {
    r.foul = why;
    r.done = true;
    r.doneAt = now;
    this.broadcast(); // ağaçta kırmızı ışık hemen yansın
    this.checkEnd(now);
  }

  dnf(r, why = 'DNF') {
    if (r.done) return;
    r.foul = r.launchAt === null && this.phase === 'countdown' ? 'left' : 'dnf';
    r.why = why;
    r.done = true;
    this.checkEnd(this.sim.now());
  }

  finish(r) {
    r.done = true;
    const ideal = idealRun(CAR_BY_ID[r.model]);
    r.et = r.tFin - r.launchAt;
    r.trap = this.trapSpeed(r);
    // Kuramsal en iyi koşudan belirgin hızlı → geçersiz (hile / bozuk örnek)
    if (r.et / 1000 < ideal.et * 0.92 - 0.1 || r.trap > CAR_BY_ID[r.model].topKmh * 1.25) r.foul = 'invalid';
    this.checkEnd(this.sim.now());
  }

  /**
   * Hız tuzağı (km/s): son 20 m'nin ortalama hızı. Paketler kümelenip (istemci takılması / ağ) aradaki
   * süre çok kısa kalırsa pencere en az 120 ms'lik bir örneğe kadar geriye genişletilir.
   */
  trapSpeed(r) {
    let t0 = r.tTrap;
    let d0 = T.quarter - T.trap;
    if (t0 === null || r.tFin - t0 < 120) {
      for (let i = r.samples.length - 1; i >= 0; i--) {
        const [t, d] = r.samples[i];
        if (d <= T.quarter - T.trap && r.tFin - t >= 120) {
          t0 = t;
          d0 = d;
          break;
        }
      }
    }
    if (t0 === null || r.tFin <= t0) return 0;
    return ((T.quarter - d0) / ((r.tFin - t0) / 1000)) * 3.6;
  }

  /** Bütün yarışçılar bittiyse sonuçları yayınla */
  checkEnd(now) {
    const list = DRAG_LANES.map((l) => this.racers[l]).filter(Boolean);
    if (!list.length || list.some((r) => !r.done)) return;
    const results = list.map((r) => this.result(r));
    let winner = null;
    if (this.mode === 'duel' && results.length === 2) {
      const clean = results.filter((x) => !x.foul && x.et !== null);
      if (clean.length === 2) winner = clean[0].total <= clean[1].total ? clean[0].lane : clean[1].lane;
      else if (clean.length === 1) winner = clean[0].lane;
      else {
        // İkisi de bitiremedi: kırmızı ışığı yakan kaybeder, diğeri hükmen kazanır
        const ok = results.filter((x) => x.foul !== 'jump' && x.foul !== 'lane' && x.foul !== 'invalid');
        if (ok.length === 1) winner = ok[0].lane;
      }
    }
    for (const x of results) x.win = winner === x.lane;
    this.last = { runNo: this.runNo, mode: this.mode, results, winner, at: now };
    for (const r of list) this.toBoard(r, now);
    for (const x of results) {
      this.sim.toPlayer(x.id, EVT.NOTIFY, { text: resultText(x, this.mode, winner), kind: x.foul ? 'warn' : 'money' });
    }
    if (this.mode === 'duel' && winner) {
      const w = results.find((x) => x.lane === winner);
      const l = results.find((x) => x.lane !== winner);
      this.sim.notify(`🏁 Drag düellosu: ${w.name} kazandı${l ? ` (${l.name}'e karşı)` : ''}${w.et !== null ? ` · ${w.et.toFixed(3)} sn` : ''}`, 'info');
    }
    this.reset();
    this.broadcast();
  }

  result(r) {
    const done = !r.foul && r.tFin !== null;
    const rt = r.launchAt !== null ? ms3(r.launchAt - this.greenAt) : null;
    const et = done ? ms3(r.et) : null;
    return {
      lane: r.lane, id: r.id, name: r.name, model: r.model, foul: r.foul,
      rt, t100: done && r.t100 !== null ? ms3(r.t100) : null,
      e8: done && r.t8 !== null ? ms3(r.t8 - r.launchAt) : null,
      et, trap: done ? Math.round(r.trap * 10) / 10 : null,
      total: done ? Math.round((rt + et) * 1000) / 1000 : null,
    };
  }

  /** Geçerli koşu → liderlik tablosu (oyuncu başına en iyi ET) */
  toBoard(r, now) {
    if (r.foul || r.tFin === null) return;
    const entry = {
      k: r.k, name: r.name, model: r.model, et: ms3(r.et), trap: Math.round(r.trap * 10) / 10,
      rt: ms3(r.launchAt - this.greenAt), at: now,
    };
    const i = this.board.findIndex((e) => e.k === r.k);
    if (i >= 0) {
      if (this.board[i].et <= entry.et) return;
      this.board.splice(i, 1);
    }
    this.board.push(entry);
    this.sortBoard();
    if (this.board.includes(entry)) this.sim.house.scheduleSave();
  }

  // ---- Zaman ------------------------------------------------------------------------------------

  update(now) {
    if (this.phase === 'waiting' && now >= this.waitUntil) {
      const r = DRAG_LANES.map((l) => this.racers[l]).find(Boolean);
      if (r) this.sim.toPlayer(r.id, EVT.NOTIFY, { text: '🏁 Rakip gelmedi — düello iptal. Solo koşabilirsin.', kind: 'info' });
      this.reset();
      this.broadcast();
    } else if (this.phase === 'countdown' && now >= this.greenAt) {
      this.phase = 'running';
      // Yeşilde sahnedeki konumu örnek olarak ekle (ilk paketin ara değerlemesi için)
      for (const l of DRAG_LANES) {
        const r = this.racers[l];
        if (r && !r.done) {
          const p = this.sim.players.get(r.id);
          const last = r.samples[r.samples.length - 1];
          if (p && last[0] < this.greenAt) r.samples.push([this.greenAt, Math.max(last[1], 0)]);
        }
      }
      this.broadcast();
    } else if (this.phase === 'running' && now >= this.greenAt + T.runMs) {
      for (const l of DRAG_LANES) {
        const r = this.racers[l];
        if (r && !r.done) {
          r.foul = 'dnf';
          r.done = true;
        }
      }
      this.checkEnd(now);
    }
  }

  /** Oyuncu pistten ayrıldı (garaja geçti) / arabadan indi / oyundan çıktı */
  onLeave(p) {
    const r = this.racerOf(p);
    if (!r) return;
    if (this.phase === 'waiting') {
      this.reset();
      this.broadcast();
      return;
    }
    this.dnf(r, 'Pistten ayrıldı');
  }

  removePlayer(p) { this.onLeave(p); }
}

const FOUL_TEXT = Object.freeze({
  jump: '🔴 Kırmızı ışık! Yeşilden önce kalktın (jump start).',
  lane: '🚫 Şeridinden çıktın — diskalifiye.',
  invalid: '⚠️ Koşu geçersiz (şüpheli hız ölçümü).',
  dnf: '⏱️ Bitiremedin (DNF).',
  left: 'Sahneden ayrıldın.',
});

function resultText(x, mode, winner) {
  if (x.foul) return `🏁 ${FOUL_TEXT[x.foul] ?? 'Yarış bitti.'}${mode === 'duel' && winner === x.lane ? ' — rakip de elendi, hükmen kazandın!' : ''}`;
  const head = mode === 'duel' ? (x.win ? '🏆 Kazandın! ' : '🥈 Kaybettin. ') : '🏁 ';
  return `${head}RT ${x.rt.toFixed(3)} · 1/4 mil ${x.et.toFixed(3)} sn · ${Math.round(x.trap)} km/s`;
}
