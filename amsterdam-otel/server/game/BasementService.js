import { EVT, GUEST_SPEED, GUEST_PHASE as GP, ROOM_STATUS, roomFloor } from '../../shared/constants.js';
import { POINTS, ELEVATOR, ROOM_BY_ID } from '../../shared/layout.js';
import { pathLength } from '../../shared/path.js';
import { CARGO_EFFECTS } from '../../shared/cargo.js';
import {
  BASEMENT, BASEMENT_GAMES, BASEMENT_RULES as R, ARCADE_GAMES_DEF, BASEMENT_NPC_NAMES, AI_NAME,
  stationDef, nearStation, bowlingStatus, basementRouteIn, basementRouteOut, basementSpawnFactor, isInsideBasement,
} from '../../shared/basement.js';
import {
  POOL, POOL_POCKETS, POOL_HEAD, POOL_FOOT, poolRack, poolSimulate, poolSpeed, ballGroup,
  BOWL, ALL_PINS, bowlSimulate, bowlSpeed,
} from '../../shared/basementPhysics.js';
import { roomToLobby, lobbyToRoom } from './routes.js';

// NPC fazları (otel misafirleri de bu fazlarla iner; GuestManager g.dining varken dokunmaz)
const PH = Object.freeze({ IN: 'bmIn', PLAY: 'bmPlay', OUT: 'bmOut' });
const LOBBY_LIFT = ELEVATOR.lobby.point;
const XFER_GRACE_MS = 1500;

// İstemci girdileri: yalnızca doğru tipteki değer kabul edilir (Number()/String() ile çevrilmez)
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : NaN);
const int = (v) => (Number.isInteger(v) ? v : -1);
const r3 = (v) => Math.round(v * 1000) / 1000;
const near = (p, [x, z], range) => Math.hypot(p.x - x, p.z - z) <= range;

const seatOf = (t, id) => t.seats.findIndex((s) => s && !s.ai && s.id === id);
const humans = (t) => t.seats.filter((s) => s && !s.ai);
/** Takım adı: langırtta 2'ye 2 (seat 0+2 🔴, seat 1+3 🔵), diğer masalarda tek oyuncu */
const sideName = (t, side) => t.seats.filter((s, k) => s && k % 2 === side).map((s) => s.name).join(' & ');

function newDuel(game) {
  // Langırt 4 koltuk (2'ye 2); masa tenisi 1v1
  const seats = game === 'foos' ? [null, null, null, null] : [null, null];
  return { game, seats, ai: false, phase: 'idle', score: [0, 0], winner: -1, lastPoint: 0, msg: '' };
}

function newPool() {
  return {
    game: 'pool', seats: [null, null], ai: false, phase: 'idle', balls: poolRack(), turn: 0, groups: [null, null],
    winner: -1, shotNo: 0, busyUntil: 0, aiAt: 0, msg: '',
  };
}

function newLane() {
  return { players: [], turn: 0, standing: ALL_PINS, shotNo: 0, busyUntil: 0, over: false, msg: '' };
}

/**
 * −1. Kat VIP Eğlence Katı — sunucu yetkili.
 *  - Bilardo (8-ball): atış (açı + güç) sunucuda deterministik olarak simüle edilir (shared/basementPhysics.js),
 *    kurallar (grup, faul, 8 numara) burada uygulanır; istemciler aynı simülasyonu animasyon için oynatır.
 *    Tek oyuncu "🤖 Robo Ruud"a karşı oynayabilir (bilgisayar atışı da sunucuda).
 *  - Masa tenisi / langırt: gerçek zamanlı top fiziği maçın ev sahibinde (seat 0) çalışır; raket / çubuk
 *    konumları BASEMENT_RT ile aktarılır. Sayıyı yalnızca ev sahibi bildirir (aralık + faz denetimi).
 *  - Bowling (2 kulvar, 5 çerçeve, 4 oyuncuya kadar): atış sunucuda simüle edilir; skor sunucuda tutulur.
 *  - Atari: jeton (€1) oyuncunun cüzdanından kasaya; puan süreye göre makul mü diye doğrulanır, rekorlar kalıcı.
 *  - NPC'ler: odasındaki otel misafirleri (VIP'ler 2× öder) ve dışarıdan gelenler asansörle iner, boş istasyonda
 *    oynar; ücret otelin KASASINA ve günün gelirine. Oyuncu gelince NPC yerini verir.
 */
export class BasementService {
  constructor(sim) {
    this.sim = sim;
    this.pool = BASEMENT.pool.map(newPool);
    this.foos = BASEMENT.foos.map(() => newDuel('foos'));
    this.pong = BASEMENT.pong.map(() => newDuel('pong'));
    this.arcade = BASEMENT.arcade.map(() => ({ player: null, run: null }));
    this.lanes = BASEMENT.lanes.map(newLane);
    this.npcs = new Map(); // id → { id, hotel, e, name, vip, room, session, spot }
    this.sessions = []; // { game, i, members: [npcId], until, cancelled }
    this.high = Object.fromEntries(Object.keys(ARCADE_GAMES_DEF).map((k) => [k, []]));
    this.bowlHigh = [];
    this.stats = { npcIncome: 0, plays: 0 };
    this.nextSpawnAt = null;
    this.runSeq = 1;
  }

  get rng() { return this.sim.rng; }

  // ---- Kalıcılık ---------------------------------------------------------------------

  persisted() {
    return { high: this.high, bowlHigh: this.bowlHigh, stats: { ...this.stats } };
  }

  restore(d) {
    if (!d || typeof d !== 'object') return;
    const clean = (list) => (Array.isArray(list) ? list : [])
      .filter((e) => e && typeof e.name === 'string' && Number.isInteger(e.score) && e.score >= 0 && e.score < 1e7)
      .slice(0, R.HIGH_SCORES).map((e) => ({ name: e.name.slice(0, 16), score: e.score }));
    if (d.high && typeof d.high === 'object') for (const k of Object.keys(this.high)) this.high[k] = clean(d.high[k]);
    this.bowlHigh = clean(d.bowlHigh);
    const s = d.stats;
    if (s && typeof s === 'object') {
      if (Number.isFinite(s.npcIncome) && s.npcIncome >= 0) this.stats.npcIncome = s.npcIncome;
      if (Number.isInteger(s.plays) && s.plays >= 0) this.stats.plays = s.plays;
    }
  }

  // ---- Paylaşılan durum ---------------------------------------------------------------

  serialize() {
    const seat = (s) => (s ? { id: s.ai ? 0 : s.id, name: s.name, ai: !!s.ai } : null);
    const npc = (game, i) => this.sessions.some((s) => s.game === game && s.i === i && !s.cancelled);
    const duel = (t, i) => ({
      seats: t.seats.map(seat), ai: t.ai, phase: t.phase, score: t.score, winner: t.winner, msg: t.msg, npc: npc(t.game, i),
    });
    return {
      pool: this.pool.map((t, i) => ({
        seats: t.seats.map(seat), ai: t.ai, phase: t.phase, turn: t.turn, groups: t.groups, winner: t.winner, msg: t.msg,
        shotNo: t.shotNo, busyUntil: t.busyUntil, balls: t.balls.map((b) => [b.id, b.x, b.z]), npc: npc('pool', i),
      })),
      foos: this.foos.map(duel),
      pong: this.pong.map(duel),
      arcade: this.arcade.map((a, i) => ({ player: a.player ? { id: a.player.id, name: a.player.name } : null, npc: npc('arcade', i) })),
      lanes: this.lanes.map((l, i) => ({
        players: l.players.map((p) => ({ id: p.id, name: p.name, rolls: p.rolls })),
        turn: l.turn, standing: l.standing, shotNo: l.shotNo, busyUntil: l.busyUntil, over: l.over, msg: l.msg, npc: npc('bowling', i),
      })),
      high: this.high,
      bowlHigh: this.bowlHigh,
    };
  }

  changed() {
    this.sim.out(EVT.BASEMENT_STATE, this.serialize());
  }

  serializeWires() {
    const out = [];
    for (const n of this.npcs.values()) if (!n.hotel) out.push(this.toWire(n));
    return out;
  }

  toWire(n) {
    return {
      id: n.id, look: n.look, phase: n.phase, path: n.path, t0: n.t0,
      speed: GUEST_SPEED, face: n.face, sit: false, roomId: null, kind: 'gamer',
    };
  }

  shiftTime(deltaMs) {
    for (const n of this.npcs.values()) {
      if (n.hotel) continue; // otel misafirlerini GuestManager kaydırır
      n.t0 += deltaMs;
      n.phaseEndsAt += deltaMs;
    }
    for (const s of this.sessions) s.until += deltaMs;
    for (const t of this.pool) {
      if (t.busyUntil) t.busyUntil += deltaMs;
      if (t.aiAt) t.aiAt += deltaMs;
    }
    for (const l of this.lanes) if (l.busyUntil) l.busyUntil += deltaMs;
    if (this.nextSpawnAt !== null) this.nextSpawnAt += deltaMs;
  }

  // ---- Oyuncular ----------------------------------------------------------------------

  /** Oyuncu ayrılınca bütün masalardan kalkar */
  removePlayer(p) {
    let changed = false;
    for (const [game, list] of [['pool', this.pool], ['foos', this.foos], ['pong', this.pong]]) {
      list.forEach((t, i) => { if (seatOf(t, p.id) >= 0) changed = this.leaveTable(p, game, i) || changed; });
    }
    this.lanes.forEach((l, i) => { if (l.players.some((x) => x.id === p.id)) changed = this.leaveLane(p, i) || changed; });
    this.arcade.forEach((a) => {
      if (a.player?.id === p.id) {
        a.player = null;
        a.run = null;
        changed = true;
      }
    });
    if (changed) this.changed();
  }

  /** Bodrumdaki oyuncular (gerçek zamanlı paket alıcıları) */
  playersInside() {
    const out = [];
    for (const p of this.sim.players.values()) if (isInsideBasement(p.x, p.z)) out.push(p);
    return out;
  }

  // ---- Eylemler -----------------------------------------------------------------------

  act(p, data, now) {
    const act = data?.act;
    if (typeof act !== 'string') return { ok: false, error: 'Geçersiz işlem.' };
    if (p.sleeping) return { ok: false, error: 'Uyurken oynayamazsın.' };
    const game = typeof data.game === 'string' ? data.game : '';
    const i = int(data.i);
    switch (act) {
      case 'stairs': return this.stairs(p, now);
      case 'join': return this.join(p, game, i, now);
      case 'ai': return this.startAi(p, game, i, now);
      case 'leave': {
        const ok = game === 'bowling' ? this.leaveLane(p, i) : this.leaveTable(p, game, i);
        if (ok) this.changed();
        return { ok: true };
      }
      case 'shoot': return this.shoot(p, i, data, now);
      case 'point': return this.point(p, game, i, data, now);
      case 'arcade': return this.arcadeStart(p, i, now);
      case 'arcadeEnd': return this.arcadeEnd(p, i, data, now);
      case 'lane': return this.laneJoin(p, i, now);
      case 'bowl': return this.bowl(p, i, data, now);
      default: return { ok: false, error: 'Geçersiz işlem.' };
    }
  }

  /** Lobideki merdiven kapısı ↔ bodrum merdiveni */
  stairs(p, now) {
    if (p.vehicle) return { ok: false, error: 'Önce araçtan in.' };
    const tol = BASEMENT.range + 1;
    let dest;
    if (near(p, BASEMENT.lobbyStairs.point, tol)) dest = BASEMENT.stairs;
    else if (near(p, BASEMENT.stairs.point, tol)) dest = BASEMENT.lobbyStairs;
    else return { ok: false, error: 'Merdivenin önünde olmalısın.' };
    p.x = dest.spawn[0];
    p.z = dest.spawn[1];
    p.yaw = dest.yaw;
    p.xfer = { t: now, x: p.x, z: p.z }; // ışınlanmadan önceki konumdan gecikmiş paketler yok sayılır (GarageService)
    this.sim.dirtyPlayers.add(p.id);
    return { ok: true, x: p.x, z: p.z, yaw: p.yaw, basement: dest === BASEMENT.stairs };
  }

  duelList(game) {
    return game === 'pool' ? this.pool : game === 'foos' ? this.foos : game === 'pong' ? this.pong : null;
  }

  /** Masaya otur: boş masada ilk koltuk (rakip beklenir), bekleyen masada ikinci koltuk (maç başlar) */
  join(p, game, i, now) {
    const list = this.duelList(game);
    const t = list?.[i];
    if (!t) return { ok: false, error: 'Böyle bir masa yok.' };
    if (!nearStation(game, i, p.x, p.z, 1)) return { ok: false, error: 'Masanın yanına git.' };
    if (this.atAnotherGame(p, game, i)) return { ok: false, error: 'Önce diğer oyundan kalk.' };
    const mine = seatOf(t, p.id);
    if (mine >= 0) {
      if (t.phase !== 'over') return { ok: true, seat: mine };
      // Rövanş: aynı oyuncularla yeni oyun
      this.resetDuel(t, now);
      t.phase = t.seats[0] && t.seats[1] ? 'play' : 'wait';
      t.msg = '🔁 Yeni oyun!';
      this.changed();
      return { ok: true, seat: mine };
    }
    this.yieldNpc(game, i, now);
    const me = { id: p.id, name: p.name };
    if (!humans(t).length) {
      Object.assign(t, game === 'pool' ? newPool() : newDuel(game));
      t.seats[0] = me;
      t.phase = 'wait';
      t.msg = game === 'foos'
        ? `${p.name} rakip bekliyor — arkadaşların E ile katılabilir (2'ye 2'ye kadar) ya da 🤖 bilgisayara karşı oyna.`
        : `${p.name} rakip bekliyor — bir arkadaşın E ile katılabilir ya da 🤖 bilgisayara karşı oyna.`;
      this.changed();
      return { ok: true, seat: 0 };
    }
    // Arkadaş gelince bilgisayar yerini bırakır: yeni maç insanlara karşı başlar
    if (t.ai) {
      t.seats[1] = me;
      t.ai = false;
      this.resetDuel(t, now);
      t.phase = 'play';
      t.msg = `🤖 Robo Ruud yerini ${p.name}'e bıraktı — ${sideName(t, 0)} ⚔️ ${sideName(t, 1)}, maç başladı!`;
      this.changed();
      return { ok: true, seat: 1 };
    }
    // Önce rakip koltuğu (1), langırtta sonra takım arkadaşları (2: 🔴, 3: 🔵)
    const free = [1, 2, 3].find((k) => k < t.seats.length && !t.seats[k]);
    if (free === undefined) return { ok: false, error: 'Bu masa dolu.' };
    t.seats[free] = me;
    if (free === 1 && t.phase === 'wait') {
      this.resetDuel(t, now);
      t.phase = 'play';
      t.msg = `${sideName(t, 0)} ⚔️ ${sideName(t, 1)} — maç başladı!`;
    } else {
      t.msg = `${p.name} ${free % 2 ? '🔵' : '🔴'} takıma katıldı (${sideName(t, 0)} ⚔️ ${sideName(t, 1) || '…'}).`;
    }
    this.changed();
    return { ok: true, seat: free };
  }

  resetDuel(t, now) {
    t.winner = -1;
    t.score = [0, 0];
    t.lastPoint = now;
    if (t.game === 'pool') {
      Object.assign(t, { balls: poolRack(this.rng), turn: 0, groups: [null, null], shotNo: 0, busyUntil: 0, aiAt: 0 });
    }
  }

  startAi(p, game, i, now) {
    const t = this.duelList(game)?.[i];
    if (!t) return { ok: false, error: 'Böyle bir masa yok.' };
    if (seatOf(t, p.id) !== 0 || t.phase !== 'wait' || t.seats.some((s, k) => s && k % 2 === 1)) {
      return { ok: false, error: 'Bilgisayara karşı yalnızca rakip takım boşken oynanır.' };
    }
    t.seats[1] = { ai: true, name: AI_NAME };
    t.ai = true;
    this.resetDuel(t, now);
    t.phase = 'play';
    t.msg = `${sideName(t, 0)} ⚔️ ${AI_NAME} — maç başladı!`;
    this.changed();
    return { ok: true };
  }

  /** @returns {boolean} değişti mi */
  leaveTable(p, game, i) {
    const t = this.duelList(game)?.[i];
    if (!t) return false;
    const s = seatOf(t, p.id);
    if (s < 0) return false;
    if (game === 'foos') return this.leaveFoos(t, s, p);
    const other = t.seats[1 - s];
    if (other && !other.ai) {
      // Kalan oyuncu ilk koltuğa geçer ve yeni rakip bekler (masa tenisi / langırtta ev sahibi seat 0'dır)
      const playing = t.phase === 'play';
      Object.assign(t, game === 'pool' ? newPool() : newDuel(game));
      t.seats = [other, null];
      t.phase = 'wait';
      t.msg = playing ? `${p.name} masadan kalktı — ${other.name} hükmen kazandı.` : `${p.name} masadan kalktı.`;
    } else {
      Object.assign(t, game === 'pool' ? newPool() : newDuel(game));
    }
    return true;
  }

  /**
   * Langırt (2'ye 2'ye kadar): takım arkadaşı kalırsa maç sürer (arkadaş ana koltuğa geçer); takım boşalırsa
   * rakip takım hükmen kazanır ve kalanlar yeni maç için yeniden oturur. Ev sahibi (topu simüle eden) hep seat 0'dır.
   */
  leaveFoos(t, s, p) {
    t.seats[s] = null;
    const team = s % 2;
    const mate = t.seats[s ^ 2];
    if (mate && s < 2) {
      t.seats[s] = mate;
      t.seats[s ^ 2] = null;
    }
    const left = humans(t);
    if (!left.length) {
      Object.assign(t, newDuel('foos'));
      return true;
    }
    if (t.seats[team] || (team === 1 && t.ai)) {
      t.msg = `${p.name} masadan kalktı — ${sideName(t, team)} devam ediyor.`;
      return true;
    }
    // Takım boşaldı: kalan insanlar baştan oturur (ilk gelen ev sahibi)
    const playing = t.phase === 'play';
    const winners = sideName(t, 1 - team);
    Object.assign(t, newDuel('foos'));
    left.forEach((h, k) => { t.seats[[0, 2, 1, 3][k]] = h; });
    t.phase = t.seats[1] ? 'over' : 'wait';
    t.msg = playing ? `${p.name} masadan kalktı — ${winners} hükmen kazandı.` : `${p.name} masadan kalktı.`;
    return true;
  }

  /** Oyuncu başka bir masada / kulvarda / makinede mi */
  atAnotherGame(p, game, i) {
    for (const [g, list] of [['pool', this.pool], ['foos', this.foos], ['pong', this.pong]]) {
      for (let k = 0; k < list.length; k++) if ((g !== game || k !== i) && seatOf(list[k], p.id) >= 0) return true;
    }
    for (let k = 0; k < this.lanes.length; k++) {
      if ((game !== 'bowling' || k !== i) && this.lanes[k].players.some((x) => x.id === p.id && !this.lanes[k].over)) return true;
    }
    return this.arcade.some((a, k) => a.player?.id === p.id && (game !== 'arcade' || k !== i));
  }

  // ---- Bilardo ----------------------------------------------------------------------------

  shoot(p, i, data, now) {
    const t = this.pool[i];
    if (!t) return { ok: false, error: 'Böyle bir masa yok.' };
    const s = seatOf(t, p.id);
    if (s < 0) return { ok: false, error: 'Bu masada oynamıyorsun.' };
    if (t.phase !== 'play') return { ok: false, error: 'Maç başlamadı.' };
    if (t.turn !== s) return { ok: false, error: 'Sıra rakibinde.' };
    if (now < t.busyUntil) return { ok: false, error: 'Toplar hâlâ dönüyor.' };
    const angle = num(data.angle);
    const power = num(data.power);
    if (!(Math.abs(angle) <= 10) || !(power >= 0 && power <= 1)) return { ok: false, error: 'Geçersiz atış.' };
    if (!nearStation('pool', i, p.x, p.z, 1.5)) return { ok: false, error: 'Masanın yanına git.' };
    this.poolShot(t, i, s, angle, power, now);
    return { ok: true };
  }

  poolShot(t, i, s, angle, power, now) {
    const sp = poolSpeed(power);
    const vx = Math.cos(angle) * sp;
    const vz = Math.sin(angle) * sp;
    const before = t.balls.map((b) => ({ id: b.id, x: b.x, z: b.z }));
    const res = poolSimulate(before, vx, vz);
    const brk = t.shotNo === 0;
    t.shotNo++;
    const msg = this.applyPool(t, s, res, brk);
    t.busyUntil = now + Math.ceil(res.steps * POOL.DT * 1000) + 500;
    t.aiAt = 0;
    this.sim.out(EVT.BASEMENT_SHOT, {
      game: 'pool', i, shotNo: t.shotNo, from: before.map((b) => [b.id, b.x, b.z]), vx, vz,
      balls: t.balls.map((b) => [b.id, b.x, b.z]), pocketed: res.pocketed, by: t.seats[s].name, msg,
    });
    this.changed();
  }

  /** 8-ball kuralları (sadeleştirilmiş); @returns {string} atış özeti */
  applyPool(t, s, res, brk) {
    const shooter = t.seats[s].name;
    const balls = res.balls.map((b) => ({ ...b }));
    const scratch = res.pocketed.includes(0);
    const sunk = res.pocketed.filter((id) => id !== 0);
    const eight = sunk.includes(8);
    let own = t.groups[s];
    let foul = '';
    if (scratch) foul = 'beyaz top cebe girdi';
    else if (res.firstHit === null) foul = 'hiçbir topa değmedi';
    else if (own) {
      const ownBefore = t.balls.filter((b) => ballGroup(b.id) === own).length;
      const want = ownBefore === 0 ? 'eight' : own;
      if (ballGroup(res.firstHit) !== want) foul = ownBefore === 0 ? 'önce 8 numaraya vurmalısın' : 'önce kendi grubuna vurmalısın';
    } else if (res.firstHit === 8 && !brk) foul = 'açık masada önce 8 numaraya vurulmaz';

    // 8 numara
    if (eight) {
      if (brk) {
        balls.push({ id: 8, ...this.freeSpot(balls, POOL_FOOT) }); // açılışta 8: yerine konur
      } else {
        const cleared = own && t.balls.filter((b) => ballGroup(b.id) === own).length === 0;
        const win = cleared && !foul;
        t.winner = win ? s : 1 - s;
        t.phase = 'over';
        t.balls = balls;
        const w = t.seats[t.winner].name;
        t.msg = win ? `🏆 ${shooter} 8 numarayı soktu ve kazandı!` : `💥 ${shooter} 8 numarayı ${foul ? 'faulle' : 'erken'} soktu — ${w} kazandı!`;
        this.finishMatch(t);
        return t.msg;
      }
    }
    // Grup ataması (açılıştan sonra, açık masada faulsüz ilk sokuş)
    const scored = sunk.filter((id) => id !== 8);
    let assigned = false;
    if (!own && !foul && scored.length && !brk) {
      own = ballGroup(scored[0]);
      t.groups[s] = own;
      t.groups[1 - s] = own === 'solid' ? 'stripe' : 'solid';
      assigned = true;
    }
    if (scratch) balls.push({ id: 0, ...this.freeSpot(balls, POOL_HEAD) });
    t.balls = balls;
    const keep = !foul && (own ? scored.some((id) => ballGroup(id) === own) : scored.length > 0);
    let msg;
    if (foul) msg = `⚠️ Faul (${shooter}): ${foul}.`;
    else if (keep) msg = `✅ ${shooter} ${scored.length} top soktu — sıra yine onda.`;
    else msg = `${shooter}: top girmedi.`;
    if (assigned) msg += ` ${shooter}: ${own === 'solid' ? 'düz toplar (1–7)' : 'parçalı toplar (9–15)'}.`;
    if (!keep) t.turn = 1 - s;
    t.msg = msg;
    return msg;
  }

  /** Bir noktaya en yakın boş yer (başka topla çakışmayan) */
  freeSpot(balls, [x0, z0]) {
    const d = 2 * POOL.R + 0.002;
    for (let k = 0; k < 40; k++) {
      const x = x0 + (k % 2 ? -1 : 1) * Math.ceil(k / 2) * d;
      if (balls.every((b) => Math.hypot(b.x - x, b.z - z0) >= d)) return { x: r3(x), z: z0 };
    }
    return { x: x0, z: z0 };
  }

  /** Bilgisayarın atışı: cebe en düz giden hedef topu seçer (hayalet top yöntemi), biraz sapma ekler */
  aiShot(t, i, now) {
    const cue = t.balls.find((b) => b.id === 0);
    if (!cue) return;
    const own = t.groups[1];
    const ownLeft = own ? t.balls.filter((b) => ballGroup(b.id) === own) : [];
    let targets = own ? (ownLeft.length ? ownLeft : t.balls.filter((b) => b.id === 8)) : t.balls.filter((b) => b.id !== 0 && b.id !== 8);
    if (!targets.length) targets = t.balls.filter((b) => b.id !== 0);
    const R2 = 2 * POOL.R;
    const clear = (ax, az, bx, bz, skip) => t.balls.every((o) => {
      if (o.id === 0 || o.id === skip) return true;
      const vx = bx - ax;
      const vz = bz - az;
      const len2 = vx * vx + vz * vz || 1;
      const u = Math.max(0, Math.min(1, ((o.x - ax) * vx + (o.z - az) * vz) / len2));
      return Math.hypot(ax + vx * u - o.x, az + vz * u - o.z) > R2;
    });
    let best = null;
    for (const b of targets) {
      for (const [px, pz] of POOL_POCKETS) {
        const dx = px - b.x;
        const dz = pz - b.z;
        const d = Math.hypot(dx, dz);
        const gx = b.x - (dx / d) * R2;
        const gz = b.z - (dz / d) * R2;
        const cx = gx - cue.x;
        const cz = gz - cue.z;
        const cd = Math.hypot(cx, cz);
        const cos = (cx * dx + cz * dz) / (cd * d || 1);
        if (cos < 0.25) continue;
        if (!clear(cue.x, cue.z, gx, gz, b.id) || !clear(b.x, b.z, px, pz, b.id)) continue;
        const score = cos * 2 - (cd + d) * 0.35;
        if (!best || score > best.score) best = { score, angle: Math.atan2(cz, cx), dist: cd + d };
      }
    }
    let angle;
    let power;
    if (best) {
      angle = best.angle + (this.rng() - 0.5) * 0.045;
      power = Math.min(0.85, 0.32 + best.dist * 0.2);
    } else {
      const b = targets.reduce((a, c) => (Math.hypot(c.x - cue.x, c.z - cue.z) < Math.hypot(a.x - cue.x, a.z - cue.z) ? c : a));
      angle = Math.atan2(b.z - cue.z, b.x - cue.x) + (this.rng() - 0.5) * 0.08;
      power = 0.55;
    }
    if (t.shotNo === 0) { angle = (this.rng() - 0.5) * 0.02; power = 0.95; }
    this.poolShot(t, i, 1, angle, power, now);
  }

  // ---- Masa tenisi / langırt -------------------------------------------------------------

  /** Sayı: yalnızca maçın ev sahibi (seat 0, topu simüle eden) bildirir */
  point(p, game, i, data, now) {
    if (game !== 'pong' && game !== 'foos') return { ok: false, error: 'Geçersiz oyun.' };
    const t = this.duelList(game)[i];
    if (!t) return { ok: false, error: 'Böyle bir masa yok.' };
    if (seatOf(t, p.id) !== 0) return { ok: false, error: 'Sayıyı yalnızca ev sahibi bildirir.' };
    if (t.phase !== 'play') return { ok: false, error: 'Maç sürmüyor.' };
    const side = int(data.side);
    if (side !== 0 && side !== 1) return { ok: false, error: 'Geçersiz sayı.' };
    if (now - t.lastPoint < 700) return { ok: false, error: 'Çok hızlı!' };
    t.lastPoint = now;
    t.score[side]++;
    const to = game === 'pong' ? R.PONG_TO : R.FOOS_TO;
    const who = sideName(t, side);
    if (t.score[side] >= to) {
      t.phase = 'over';
      t.winner = side;
      t.msg = `🏆 ${who} ${t.score[0]}–${t.score[1]} kazandı! (Rövanş için E)`;
      this.finishMatch(t);
    } else {
      t.msg = game === 'pong' ? `🏓 Sayı ${who}: ${t.score[0]}–${t.score[1]}` : `⚽ GOL! ${who}: ${t.score[0]}–${t.score[1]}`;
    }
    this.changed();
    return { ok: true, score: t.score };
  }

  finishMatch(t) {
    this.stats.plays++;
    this.sim.house.scheduleSave?.();
    void t;
  }

  /** Gerçek zamanlı paket: masadaki oyuncudan bodrumdaki diğer oyunculara (raket / top / çubuk konumu) */
  relay(p, data) {
    const game = data?.g;
    if (game !== 'pong' && game !== 'foos') return false;
    const i = int(data.i);
    const t = this.duelList(game)[i];
    if (!t || t.phase !== 'play') return false;
    const s = seatOf(t, p.id);
    if (s < 0) return false;
    const raw = data.s;
    if (!Array.isArray(raw) || raw.length > R.RT_MAX) return false;
    const vals = [];
    for (const v of raw) {
      if (typeof v !== 'number' || !Number.isFinite(v) || Math.abs(v) > 100) return false;
      vals.push(r3(v));
    }
    const msg = { g: game, i, seat: s, s: vals };
    for (const o of this.playersInside()) if (o.id !== p.id) this.sim.toPlayer(o.id, EVT.BASEMENT_RT, msg);
    return true;
  }

  // ---- Atari ------------------------------------------------------------------------------

  arcadeStart(p, i, now) {
    const a = this.arcade[i];
    if (!a) return { ok: false, error: 'Böyle bir makine yok.' };
    if (!nearStation('arcade', i, p.x, p.z, 1)) return { ok: false, error: 'Makinenin önüne geç.' };
    if (a.player && a.player.id !== p.id) return { ok: false, error: `${a.player.name} bu makinede oynuyor.` };
    if (this.atAnotherGame(p, 'arcade', i)) return { ok: false, error: 'Önce diğer oyundan kalk.' };
    const price = R.ARCADE_PRICE;
    if (p.wallet < price) return { ok: false, error: `Jeton için cüzdanında €${price} olmalı.` };
    this.yieldNpc('arcade', i, now);
    p.wallet -= price;
    this.sim.shop.sendSelf(p);
    this.sim.earn(price, `🕹️ Atari jetonu (${p.name})`, { guest: false });
    const game = BASEMENT.arcade[i].game;
    a.player = { id: p.id, name: p.name };
    a.run = { id: this.runSeq++, game, at: now };
    this.changed();
    return { ok: true, run: a.run.id, game };
  }

  arcadeEnd(p, i, data, now) {
    const a = this.arcade[i];
    if (!a || a.player?.id !== p.id || !a.run) return { ok: false, error: 'Bu makinede oyun yok.' };
    if (int(data.run) !== a.run.id) return { ok: false, error: 'Geçersiz oyun.' };
    const score = int(data.score);
    const def = ARCADE_GAMES_DEF[a.run.game];
    const sec = Math.min(now - a.run.at, R.ARCADE_MAX_RUN_MS) / 1000;
    const max = def.base + def.rate * sec;
    const game = a.run.game;
    a.player = null;
    a.run = null;
    if (score < 0 || score > max) {
      this.changed();
      return { ok: false, error: 'Puan doğrulanamadı.' };
    }
    this.stats.plays++;
    const rank = this.addHigh(this.high[game], p.name, score);
    this.changed();
    this.sim.house.scheduleSave?.();
    return { ok: true, score, rank, best: this.high[game][0]?.score ?? score };
  }

  /** Rekor listesine ekle; @returns {number} sıra (1..5) ya da 0 */
  addHigh(list, name, score) {
    if (score <= 0) return 0;
    list.push({ name, score });
    list.sort((a, b) => b.score - a.score);
    list.length = Math.min(list.length, R.HIGH_SCORES);
    const k = list.findIndex((e) => e.name === name && e.score === score);
    return k + 1;
  }

  // ---- Bowling ----------------------------------------------------------------------------

  laneJoin(p, i, now) {
    const l = this.lanes[i];
    if (!l) return { ok: false, error: 'Böyle bir kulvar yok.' };
    if (!nearStation('bowling', i, p.x, p.z, 1)) return { ok: false, error: 'Kulvarın başına git.' };
    if (l.players.some((x) => x.id === p.id) && !l.over) return { ok: true };
    if (this.atAnotherGame(p, 'bowling', i)) return { ok: false, error: 'Önce diğer oyundan kalk.' };
    if (!l.over && l.players.length >= R.BOWL_MAX_PLAYERS) return { ok: false, error: 'Kulvar dolu (en fazla 4 oyuncu).' };
    const price = R.LANE_PRICE;
    if (p.wallet < price) return { ok: false, error: `Kulvar ücreti €${price} — cüzdanında yeterli para yok.` };
    this.yieldNpc('bowling', i, now);
    if (l.over) Object.assign(l, newLane());
    p.wallet -= price;
    this.sim.shop.sendSelf(p);
    this.sim.earn(price, `🎳 Bowling kulvarı (${p.name})`, { guest: false });
    l.players.push({ id: p.id, name: p.name, rolls: [] });
    l.msg = `${p.name} ${BASEMENT.lanes[i].name}'a katıldı.`;
    this.changed();
    return { ok: true };
  }

  /** @returns {boolean} değişti mi */
  leaveLane(p, i) {
    const l = this.lanes[i];
    if (!l) return false;
    const k = l.players.findIndex((x) => x.id === p.id);
    if (k < 0) return false;
    l.players.splice(k, 1);
    if (!l.players.length) {
      Object.assign(l, newLane());
      return true;
    }
    if (k < l.turn) l.turn--;
    if (l.turn >= l.players.length) l.turn = 0;
    if (!l.over) {
      l.standing = ALL_PINS;
      this.advanceLane(l, l.turn, true);
    }
    l.msg = `${p.name} kulvardan ayrıldı.`;
    return true;
  }

  bowl(p, i, data, now) {
    const l = this.lanes[i];
    if (!l) return { ok: false, error: 'Böyle bir kulvar yok.' };
    if (l.over || !l.players.length) return { ok: false, error: 'Önce kulvara katıl.' };
    const cur = l.players[l.turn];
    if (cur?.id !== p.id) return { ok: false, error: l.players.some((x) => x.id === p.id) ? `Sıra ${cur.name}'da.` : 'Önce kulvara katıl.' };
    if (now < l.busyUntil) return { ok: false, error: 'Labutlar diziliyor…' };
    if (!nearStation('bowling', i, p.x, p.z, 1.5)) return { ok: false, error: 'Kulvarın başına git.' };
    const u = num(data.u);
    const angle = num(data.angle);
    const power = num(data.power);
    const spin = data.spin === undefined ? 0 : num(data.spin);
    if (!(Math.abs(u) <= BOWL.MAX_U) || !(Math.abs(angle) <= BOWL.MAX_ANGLE) || !(power >= 0 && power <= 1) || !(Math.abs(spin) <= 1)) {
      return { ok: false, error: 'Geçersiz atış.' };
    }
    const st = bowlingStatus(cur.rolls);
    const from = st.reset ? ALL_PINS : l.standing;
    const sp = bowlSpeed(power);
    const vu = Math.sin(angle) * sp;
    const vv = Math.cos(angle) * sp;
    const res = bowlSimulate(from, u, vu, vv, spin);
    cur.rolls.push(res.knocked);
    const after = bowlingStatus(cur.rolls);
    l.shotNo++;
    l.busyUntil = now + Math.ceil(res.steps * BOWL.DT * 1000) + 1200;
    const strike = st.standing === 10 && res.knocked === 10;
    const spare = !strike && res.knocked === st.standing && st.ball > 0;
    l.msg = strike ? `💥 STRIKE! (${cur.name})` : spare ? `✨ SPARE! (${cur.name})` : res.gutter ? `😬 Oluk… (${cur.name})` : `${cur.name}: ${res.knocked} labut`;
    this.sim.out(EVT.BASEMENT_SHOT, {
      game: 'bowling', i, shotNo: l.shotNo, u, vu, vv, spin, from, standing: res.standing, knocked: res.knocked, by: cur.name, msg: l.msg,
    });
    if (after.done || after.frame !== st.frame) {
      l.standing = ALL_PINS;
      this.advanceLane(l, l.turn);
    } else {
      l.standing = after.reset ? ALL_PINS : res.standing;
    }
    this.changed();
    return { ok: true, knocked: res.knocked };
  }

  /** Sıradaki (oyunu bitmemiş) oyuncuya geç; herkes bitirdiyse oyun biter (rekorlar) */
  advanceLane(l, from, includeSelf = false) {
    const n = l.players.length;
    for (let k = includeSelf ? 0 : 1; k <= n; k++) {
      const j = (from + k) % n;
      if (!bowlingStatus(l.players[j].rolls).done) {
        l.turn = j;
        return;
      }
    }
    l.over = true;
    this.stats.plays++;
    const ranked = l.players.map((x) => ({ name: x.name, total: bowlingStatus(x.rolls).total })).sort((a, b) => b.total - a.total);
    for (const r of ranked) this.addHigh(this.bowlHigh, r.name, r.total);
    l.msg = `🏁 Oyun bitti! ${ranked.map((r) => `${r.name} ${r.total}`).join(' · ')} — yeni oyun için E (€${R.LANE_PRICE}).`;
    this.sim.house.scheduleSave?.();
  }

  // ---- Döngü ------------------------------------------------------------------------------

  get open() {
    const m = this.sim.clock.minute;
    return m >= R.OPEN_MIN && m < R.CLOSE_MIN;
  }

  update(now) {
    let changed = false;
    // Bilgisayarın bilardo sırası
    this.pool.forEach((t, i) => {
      if (t.phase !== 'play' || !t.ai || t.turn !== 1 || now < t.busyUntil) return;
      if (!t.aiAt) t.aiAt = now + R.AI_DELAY_MS;
      else if (now >= t.aiAt) this.aiShot(t, i, now);
    });
    // Masadan uzaklaşan oyuncu maçtan çıkar
    for (const [game, list] of [['pool', this.pool], ['foos', this.foos], ['pong', this.pong]]) {
      list.forEach((t, i) => {
        for (const s of humans(t)) {
          const p = this.sim.players.get(s.id);
          if (!p || !nearStation(game, i, p.x, p.z, R.LEAVE_DIST)) changed = this.leaveTable(p ?? s, game, i) || changed;
        }
      });
    }
    this.lanes.forEach((l, i) => {
      for (const x of [...l.players]) {
        const p = this.sim.players.get(x.id);
        if (!p || !nearStation('bowling', i, p.x, p.z, R.LEAVE_DIST)) changed = this.leaveLane(p ?? x, i) || changed;
      }
    });
    this.arcade.forEach((a, i) => {
      const p = a.player && this.sim.players.get(a.player.id);
      if (a.player && (!p || !nearStation('arcade', i, p.x, p.z, R.LEAVE_DIST))) {
        a.player = null;
        a.run = null;
        changed = true;
      }
    });
    // NPC misafirler
    if (this.open && this.sim.config.basementGuests !== false) {
      if (this.nextSpawnAt === null) this.nextSpawnAt = now + R.FIRST_SPAWN_MS * (0.5 + this.rng());
      if (now >= this.nextSpawnAt) {
        if (this.spawnSession(now)) {
          changed = true;
          const f = basementSpawnFactor(this.sim.growth.stars, this.occupancy());
          this.nextSpawnAt = now + (R.SPAWN_MIN_MS + this.rng() * (R.SPAWN_MAX_MS - R.SPAWN_MIN_MS)) * f;
        } else {
          this.nextSpawnAt = now + R.RETRY_MS;
        }
      }
    } else {
      this.nextSpawnAt = null;
    }
    for (const n of [...this.npcs.values()]) if (this.updateNpc(n, now)) changed = true;
    for (const s of [...this.sessions]) {
      if (!s.cancelled && now >= s.until && s.members.every((id) => this.npcs.get(id)?.e.phase === PH.PLAY)) {
        s.cancelled = true;
        for (const id of s.members) this.npcLeave(this.npcs.get(id), now);
        changed = true;
      }
      if (s.members.every((id) => !this.npcs.has(id))) this.sessions.splice(this.sessions.indexOf(s), 1);
    }
    if (changed) this.changed();
  }

  occupancy() {
    const floors = this.sim.growth.floors;
    let total = 0;
    let busy = 0;
    for (const room of this.sim.rooms.rooms.values()) {
      if (roomFloor(room.id) > floors) continue;
      total++;
      if (room.status === ROOM_STATUS.OCCUPIED) busy++;
    }
    return total ? busy / total : 0;
  }

  /** İstasyon boş mu (oyuncu yok, NPC oturumu yok) */
  stationFree(game, i) {
    if (this.sessions.some((s) => s.game === game && s.i === i && !s.cancelled)) return false;
    if (game === 'arcade') return !this.arcade[i].player;
    if (game === 'bowling') return !this.lanes[i].players.length || this.lanes[i].over;
    const t = this.duelList(game)[i];
    return !t.seats.some(Boolean);
  }

  /** Oyuncu gelince NPC oturumu biter (ücret ödendiyse kasada kalır) */
  yieldNpc(game, i, now) {
    const s = this.sessions.find((x) => x.game === game && x.i === i && !x.cancelled);
    if (!s) return;
    s.cancelled = true;
    for (const id of s.members) {
      const n = this.npcs.get(id);
      if (n && n.e.phase === PH.PLAY) this.npcLeave(n, now);
    }
    this.sim.notify(`🙂 Misafirler ${BASEMENT_GAMES[game].icon} ${stationDef(game, i).name} için sana yer verdi.`, 'info');
  }

  hotelCandidates() {
    const total = this.sim.clock.total;
    const out = [];
    for (const g of this.sim.guests.guests.values()) {
      if (g.phase !== GP.IN_ROOM || g.dining || !g.roomId) continue;
      if (g.checkoutAt - total < R.GUEST_MIN_LEFT_MIN) continue;
      if (g.playedAt != null && total - g.playedAt < R.GUEST_REPEAT_MIN) continue;
      out.push(g);
    }
    return out;
  }

  spawnSession(now) {
    if (this.sessions.length >= R.MAX_NPC_SESSIONS) return false;
    const weights = { arcade: 3, bowling: 2, pool: 2, pong: 1, foos: 1 };
    const free = [];
    for (const game of Object.keys(weights)) {
      BASEMENT_GAMES[game].list.forEach((_, i) => { if (this.stationFree(game, i)) free.push({ game, i, w: weights[game] }); });
    }
    if (!free.length) return false;
    let r = this.rng() * free.reduce((a, f) => a + f.w, 0);
    let pick = free[0];
    for (const f of free) {
      r -= f.w;
      if (r < 0) { pick = f; break; }
    }
    const st = stationDef(pick.game, pick.i);
    const sess = {
      game: pick.game, i: pick.i, members: [], cancelled: false,
      until: now + R.NPC_PLAY_MIN_MS + this.rng() * (R.NPC_PLAY_MAX_MS - R.NPC_PLAY_MIN_MS),
    };
    const cands = this.hotelCandidates();
    const hotelChance = cands.length ? 0.45 + 0.4 * this.occupancy() : 0;
    st.spots.forEach((sp) => {
      let n;
      if (cands.length && this.rng() < hotelChance) {
        const vips = cands.filter((g) => g.vip);
        const pool = vips.length && this.rng() < 0.5 ? vips : cands;
        const g = pool[Math.floor(this.rng() * pool.length)];
        cands.splice(cands.indexOf(g), 1);
        g.dining = 'basement';
        g.playedAt = this.sim.clock.total;
        n = { id: g.id, hotel: true, e: g, vip: !!g.vip, room: g.roomId, name: g.vip ? `⭐ VIP · Oda ${g.roomId}` : `Oda ${g.roomId} misafiri` };
        const layout = ROOM_BY_ID[g.roomId];
        n.spot = sp;
        n.session = sess;
        this.npcs.set(n.id, n);
        this.walk(n, PH.IN, [...roomToLobby([layout.path.stand], layout, [LOBBY_LIFT]), basementRouteIn(sp)], now);
      } else {
        const street = this.rng() < 0.5 ? POINTS.streetWest : POINTS.streetEast;
        n = {
          id: this.sim.guests.nextId++, hotel: false, look: this.sim.guests.randomLook(), vip: false, room: null,
          name: BASEMENT_NPC_NAMES[Math.floor(this.rng() * BASEMENT_NPC_NAMES.length)],
          phase: null, path: null, legs: null, t0: now, phaseEndsAt: 0, face: 0, street,
        };
        n.look.bag = false; // ziyaretçi: valizsiz
        n.e = n;
        n.spot = sp;
        n.session = sess;
        this.npcs.set(n.id, n);
        this.walk(n, PH.IN, [[street, POINTS.doorOutside, POINTS.doorInside, LOBBY_LIFT], basementRouteIn(sp)], now);
      }
      sess.members.push(n.id);
    });
    this.sessions.push(sess);
    return true;
  }

  walk(n, phase, legs, now) {
    const e = n.e;
    e.legs = legs.length > 1 ? legs.slice(1) : null;
    e.phase = phase;
    e.path = legs[0].map((pt) => [pt[0], pt[1]]);
    e.t0 = now;
    e.sit = false;
    e.phaseEndsAt = now + (pathLength(e.path) / GUEST_SPEED) * 1000;
    this.broadcast(n);
  }

  stand(n, phase, point, face, now) {
    const e = n.e;
    e.legs = null;
    e.phase = phase;
    e.path = [[point[0], point[1]]];
    e.t0 = now;
    e.face = face;
    e.sit = false;
    e.phaseEndsAt = now;
    this.broadcast(n);
  }

  broadcast(n) {
    if (n.hotel) this.sim.guests.broadcast(n.e);
    else this.sim.out(EVT.GUEST_UPSERT, this.toWire(n));
  }

  /** @returns {boolean} BASEMENT_STATE değişti mi */
  updateNpc(n, now) {
    const e = n.e;
    if (e.phase === PH.PLAY || now < e.phaseEndsAt) return false;
    if (e.legs) {
      this.walk(n, e.phase, e.legs, now); // asansör: sonraki bacağın başına ışınlan
      return false;
    }
    if (e.phase === PH.IN) {
      if (n.session.cancelled) {
        this.walkOut(n, now); // oyuncu yeri aldı: ödemeden döner
        return false;
      }
      this.stand(n, PH.PLAY, n.spot.at, n.spot.face, now);
      // Ücret varışta kasaya (VIP 2×)
      const g = BASEMENT_GAMES[n.session.game];
      // Depoda eğlence katı malzemesi (Mal Kabul Rampası) varsa +€ (1 birim stok)
      const fee = g.npcFee * (n.vip ? R.VIP_MUL : 1) + (this.sim.cargo?.use('fun') ? CARGO_EFFECTS.fun.bonus : 0);
      this.stats.npcIncome += fee;
      this.sim.earn(fee, `${g.icon} Eğlence Katı: ${g.name} (${n.name})`, { guest: false });
      return true;
    }
    if (e.phase === PH.OUT) this.npcDone(n, now);
    return false;
  }

  /** Oyunu bırak: oynuyorsa hemen çıkar; henüz yoldaysa (oturum iptal) varınca döner */
  npcLeave(n, now) {
    if (!n || n.e.phase !== PH.PLAY) return;
    this.walkOut(n, now);
  }

  walkOut(n, now) {
    const out = [basementRouteOut(n.spot)];
    if (n.hotel) {
      const layout = ROOM_BY_ID[n.room];
      out.push(...lobbyToRoom([LOBBY_LIFT], layout, [layout.path.stand]));
    } else {
      out.push([LOBBY_LIFT, POINTS.doorInside, POINTS.doorOutside, n.street]);
    }
    this.walk(n, PH.OUT, out, now);
  }

  npcDone(n, now) {
    this.npcs.delete(n.id);
    if (n.hotel) {
      const g = n.e;
      g.dining = false;
      const layout = ROOM_BY_ID[n.room];
      this.sim.guests.stand(g, GP.IN_ROOM, layout.path.stand, 0, now);
      return;
    }
    this.sim.out(EVT.GUEST_REMOVE, n.id);
  }
}
