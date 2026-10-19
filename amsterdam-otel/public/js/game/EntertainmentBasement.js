import * as THREE from 'three';
import { EVT } from '/shared/constants.js';
import { EYE_HEIGHT } from '/shared/layout.js';
import {
  BASEMENT, BASEMENT_FLOOR, BASEMENT_GAMES, BASEMENT_RULES as R, ARCADE_GAMES_DEF, isInsideBasement,
} from '/shared/basement.js';
import { buildBasement } from '../world/BasementBuilding.js';
import { signMaterial, panel, canvasTexture } from '../world/CarWorldKit.js';
import { PoolGame } from './basement/PoolGame.js';
import { BowlingGame } from './basement/BowlingGame.js';
import { PongGame } from './basement/PongGame.js';
import { FoosGame } from './basement/FoosGame.js';
import { makeArcadeGame, drawArcade, drawAttract, ARCADE_W, ARCADE_H } from './basement/ArcadeGames.js';

const HOTEL_LAYER = 3; // UndergroundGarage ile aynı: otel dünyası katmanı

/** Hedef oyuncunun önünde mi (mesafe + bakış açısı) */
function facing(px, pz, f, x, z, range, minDot = 0.3) {
  const dx = x - px;
  const dz = z - pz;
  const d = Math.hypot(dx, dz);
  if (d > range) return false;
  return d < 0.7 || (dx * f.x + dz * f.z) / d > minDot;
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

const lerpAngle = (a, b, t) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * t;

/**
 * −1. Kat VIP Eğlence Katı ("Neon Kelder"): bilardo, langırt, masa tenisi, retro atari, 2 hatlı bowling.
 *
 *  - Erişim: lobideki "−1 🎳" merdiven kapısı (E), asansörün "−1" durağı ve hızlı ışınlanma (🎳). Bodrum
 *    UndergroundGarage'ın alan yöneticisine 'basement' alanı olarak eklenir: oradayken otel dünyası çizilmez.
 *  - Oyun modu: masaya / kulvara E ile oturulur; oyuncu kamerası oyunun FPV pozisyonuna geçer (bilardoda
 *    beyaz topun arkası, bowlingde atış çizgisi, masa tenisinde masanın ucu, langırtta masanın kenarı).
 *    Fare / sağ taraf sürükleme ve hareket tuşları oyuna gider; E / Aksiyon oyunun eylemi, Q / ✕ kalk.
 *  - Atari: jeton (€1, cüzdandan) → makinenin ekranı panel olarak açılır (3D render durur), puan sunucuya.
 *  - NPC misafirler sunucuda (BasementService); burada yalnızca bodrumdayken görünür kalmaları sağlanır.
 */
export class EntertainmentBasement {
  constructor({
    engine, net, hud, interaction, player, input, modal, device, settings, sfx, collision, garage, reception, guests, touch, remotes,
  }) {
    Object.assign(this, { engine, net, hud, interaction, player, input, modal, device, settings, sfx, collision, garage, reception, guests, touch, remotes });
    this.hiddenRemotes = new Set(); // oyun kamerasının dibindeki (aynı masadaki) oyuncular görüşü kapatmasın
    this.view = buildBasement({ collision });
    engine.scene.add(this.view.group);
    garage.addArea('basement', this.view.group);
    this.buildLobbyDoor();
    this.state = null;
    this.mode = null; // { game, i, seat }
    this.pending = false;
    this.cam = { x: 0, z: 0, eye: EYE_HEIGHT, yaw: 0, pitch: 0 };
    this.camPos = { x: 0, z: 0 };
    this.camReady = false;
    this._look = { x: 0, y: 0 };
    this.hudKey = '';
    this.hudAt = 0;

    const now = () => net.serverNow();
    const me = () => this.selfId;
    const sound = (n) => this.sound(n);
    const rt = (pkt) => { if (net.socket?.connected) net.socket.emit(EVT.BASEMENT_RT, pkt); };
    const ctx = { net, hud, sound, now, input, me, rt, group: this.view.group };
    this.games = {
      pool: new PoolGame({ ...ctx, view: this.view.pool }),
      bowling: new BowlingGame({ ...ctx, view: this.view.lanes }),
      pong: new PongGame({ ...ctx, view: this.view.pong }),
      foos: new FoosGame({ ...ctx, view: this.view.foos }),
    };

    this.buildArcadeScreens();
    this.buildHud();
    this.buildArcadePanel();

    interaction.addProvider({ find: (px, pz, f) => this.findTarget(px, pz, f) });
    // Oyun modunda bakış (fare / sürükleme) oyuna gider: oyuncu güncellemesinden ÖNCE tüketilir
    engine.systems.unshift(() => {
      if (!this.mode) return false;
      const l = input.consumeLook(this._look);
      if (l.x || l.y) this.games[this.mode.game]?.look(l.x, l.y);
      return false;
    });
    this.patchLift();
    this.patchGuests();
    const prevArea = garage.onArea;
    garage.onArea = (id, from) => {
      prevArea?.(id, from);
      this.onArea(id, from);
    };
  }

  // ---- Dünya ------------------------------------------------------------------------------

  /** Lobideki merdiven kapısı (otel dünyasının parçası; partitionWorld'den önce eklenir) */
  buildLobbyDoor() {
    const D = BASEMENT.lobbyStairs;
    const g = new THREE.Group();
    const z = D.z - 0.11;
    const dark = new THREE.MeshLambertMaterial({ color: 0x14101f, emissive: 0x0a0812 });
    const frame = new THREE.MeshLambertMaterial({ color: 0x2b2340, emissive: 0x0c0a14 });
    const door = new THREE.Mesh(new THREE.BoxGeometry(1.1, 2.2, 0.04), dark);
    door.position.set(D.x, 1.1, z);
    const top = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.1, 0.06), frame);
    top.position.set(D.x, 2.25, z);
    const neon = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.03, 0.03), new THREE.MeshBasicMaterial({ color: 0xff2bd6 }));
    neon.position.set(D.x, 2.32, z - 0.02);
    g.add(door, top, neon);
    for (let k = 0; k < 4; k++) {
      const step = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.02, 0.2), new THREE.MeshBasicMaterial({ color: k % 2 ? 0x28e7ff : 0x8a5bff }));
      step.position.set(D.x, 0.25 + k * 0.4, z - 0.03);
      g.add(step);
    }
    g.add(panel(signMaterial(['−1 🎳 EĞLENCE KATI', 'Bilardo · Bowling · Atari ⬇'], { bg: '#12051e', fg: '#ff7ae6', glow: true, w: 512, h: 128 }), 1.4, 0.35, D.x, 2.62, z - 0.02, 'z-'));
    g.traverse((o) => { o.matrixAutoUpdate = false; o.updateMatrix(); });
    this.engine.scene.add(g);
    this.collision.add(D.x - 0.6, D.x + 0.6, D.z - 0.16, D.z);
  }

  buildArcadeScreens() {
    this.screens = Object.create(null);
    const make = (game, playing) => {
      const def = ARCADE_GAMES_DEF[game];
      const tex = canvasTexture(256, 192, (g, w, h) => drawAttract(g, w, h, `${def.icon} ${def.name}`, playing, game.length), { repeat: false });
      return new THREE.MeshBasicMaterial({ map: tex });
    };
    for (const game of Object.keys(ARCADE_GAMES_DEF)) this.screens[game] = { idle: make(game, false), busy: make(game, true) };
    for (const a of this.view.arcade) a.screen.material = this.screens[a.def.game].idle;
  }

  // ---- Durum ------------------------------------------------------------------------------

  reset(selfId) {
    this.selfId = selfId;
  }

  onState(s) {
    if (!s) return;
    this.state = s;
    this.games.pool.onState(s.pool);
    this.games.bowling.onState(s.lanes);
    this.games.pong.onState(s.pong);
    this.games.foos.onState(s.foos);
    s.arcade.forEach((a, i) => {
      const v = this.view.arcade[i];
      const mat = this.screens[v.def.game][a.player || a.npc ? 'busy' : 'idle'];
      if (v.screen.material !== mat) v.screen.material = mat;
    });
    // Sunucu masadan kaldırdıysa (uzaklaşma, rakip ayrıldı) oyun modundan çık
    if (this.mode && !this.pending && this.mode.game !== 'bowling' && this.mode.game !== 'arcade') {
      const t = s[this.mode.game]?.[this.mode.i];
      const seat = t ? t.seats.findIndex((x) => x && !x.ai && x.id === this.selfId) : -1;
      if (seat < 0) this.exitGame(false);
      else if (seat !== this.mode.seat) {
        this.mode.seat = seat;
        this.games[this.mode.game].enter(this.mode.i, seat);
      }
    }
    this.interaction.invalidate();
    this.hudKey = '';
    this.engine.requestRender();
  }

  onShot(msg) {
    if (msg.game === 'pool') this.games.pool.onShot(msg);
    else if (msg.game === 'bowling') this.games.bowling.onShot(msg);
    if (this.mode?.game === msg.game && this.mode.i === msg.i && msg.msg) this.hud.toast(msg.msg, 'info');
    this.engine.wake();
  }

  onRt(msg) {
    if (msg.g === 'pong') this.games.pong.onRt(msg);
    else if (msg.g === 'foos') this.games.foos.onRt(msg);
    this.engine.wake();
  }

  // ---- Alan ve NPC görünürlüğü --------------------------------------------------------------

  get inBasement() { return this.garage.area === 'basement'; }

  onArea(id) {
    if (id === 'basement') {
      // Alan yöneticisi sahnedeki her şeyi otel katmanına aldı: bodrumdaki misafirler (NPC) görünür kalsın
      for (const it of this.guests.items.values()) it.obj.traverse((o) => o.layers.set(0));
    } else if (this.mode) {
      this.exitGame(true);
    }
    this.closeArcade();
    this.interaction.invalidate(); // hedefler bölgeye bağlı (alan, etkileşimden sonra değişir)
  }

  patchGuests() {
    const upsert = this.guests.upsert.bind(this.guests);
    this.guests.upsert = (data) => {
      upsert(data);
      if (this.inBasement) {
        const it = this.guests.items.get(data.id);
        if (it && it.obj.layers.mask === 1 << HOTEL_LAYER) it.obj.traverse((o) => o.layers.set(0));
      }
    };
  }

  /** Asansör paneline "−1 🎳" durağı; lobi asansörü "üst kat yok" demesin */
  patchLift() {
    const rec = this.reception;
    if (!rec) return;
    const render = rec.renderLift.bind(rec);
    rec.renderLift = () => {
      render();
      const b = el('button', 'lift-btn basement', '−1 🎳');
      b.type = 'button';
      const here = rec.liftFrom === BASEMENT_FLOOR;
      b.classList.toggle('here', here);
      b.disabled = here;
      b.title = here ? 'Buradasın' : '−1. Kat · VIP Eğlence Katı';
      b.addEventListener('click', () => rec.ride(BASEMENT_FLOOR));
      rec.el.liftList.append(b);
      if (rec.el.liftMsg.textContent.startsWith('Henüz üst kat yok')) rec.el.liftMsg.textContent = '−1: VIP Eğlence Katı 🎳 · üst katlar Resepsiyon PC\'den eklenir.';
    };
    const ride = rec.ride.bind(rec);
    rec.ride = async (floor) => {
      await ride(floor);
      if (floor === BASEMENT_FLOOR && !rec.el.fade.hidden) rec.el.fade.textContent = '🛗 −1 · VIP Eğlence Katı 🎳';
    };
    const find = rec.findTarget.bind(rec);
    rec.findTarget = (px, pz, f) => {
      const t = find(px, pz, f);
      if (t && t.short === 'Asansör' && t.label.includes('üst kat yok')) t.label = '🛗 Asansör (−1 🎳 Eğlence Katı)';
      return t;
    };
  }

  // ---- Etkileşim ------------------------------------------------------------------------------

  findTarget(px, pz, f) {
    if (this.mode || this.player.drive || this.player.follow) return null;
    if (!this.inBasement) {
      const D = BASEMENT.lobbyStairs;
      if (this.garage.area === 'city' && facing(px, pz, f, D.point[0], D.point[1], BASEMENT.range)) {
        return { x: D.point[0], z: D.point[1], short: 'İn', label: '⬇ Merdivenden −1. kata in (🎳 VIP Eğlence Katı)', use: () => this.stairs() };
      }
      return null;
    }
    const S = BASEMENT.stairs;
    if (facing(px, pz, f, S.point[0], S.point[1], BASEMENT.range)) {
      return { x: S.point[0], z: S.point[1], short: 'Çık', label: '⬆ Merdivenden lobiye çık', use: () => this.stairs() };
    }
    const E = BASEMENT.elevator;
    if (facing(px, pz, f, E.point[0], E.point[1], BASEMENT.range)) {
      return { x: E.point[0], z: E.point[1], short: 'Asansör', label: '🛗 Asansör (−1. kattasın)', use: () => this.reception?.openLift(BASEMENT_FLOOR) };
    }
    const s = this.state;
    if (!s) return null;
    let best = null;
    let bestD = Infinity;
    for (const [game, g] of Object.entries(BASEMENT_GAMES)) {
      g.list.forEach((st, i) => {
        const [cx, cz] = st.center;
        const range = g.range + (game === 'pool' ? 0.6 : 0);
        if (!facing(px, pz, f, cx, cz, range, 0.1)) return;
        const d = Math.hypot(cx - px, cz - pz);
        if (d < bestD) {
          bestD = d;
          best = { game, i, st };
        }
      });
    }
    if (!best) return null;
    const { game, i, st } = best;
    const g = BASEMENT_GAMES[game];
    const t = this.stationTarget(game, i, st, g);
    return t ? { x: st.center[0], z: st.center[1], marker: false, ...t } : null;
  }

  stationTarget(game, i, st, g) {
    const s = this.state;
    if (game === 'arcade') {
      const a = s.arcade[i];
      const def = ARCADE_GAMES_DEF[st.game];
      if (a.player && a.player.id !== this.selfId) return { short: 'Dolu', label: `🕹️ ${a.player.name} ${def.name} oynuyor`, use: () => {} };
      return { short: 'Jeton', label: `🕹️ ${def.icon} ${def.name} — jeton at (€${R.ARCADE_PRICE})${a.npc ? ' · misafir yer verir' : ''}`, use: () => this.startArcade(i) };
    }
    if (game === 'bowling') {
      const l = s.lanes[i];
      const n = l.over ? 0 : l.players.length;
      const txt = n ? `katıl (${n}/${R.BOWL_MAX_PLAYERS} oyuncu)` : 'oyuna başla';
      return { short: 'Bowling', label: `🎳 ${st.name} — ${txt} · €${R.LANE_PRICE}${l.npc ? ' · misafirler yer verir' : ''}`, use: () => this.joinLane(i) };
    }
    const t = s[game][i];
    const seats = t.seats.filter(Boolean);
    const humans = seats.filter((x) => !x.ai);
    const full = !t.ai && seats.length >= t.seats.length;
    let txt;
    if (!humans.length) txt = 'otur ve oyna';
    else if (t.ai) txt = `🤖 yerine geç, ${humans.map((x) => x.name).join(' & ')} ile oyna`;
    else if (t.phase === 'wait') txt = `${t.seats[0]?.name} ile oyna`;
    else if (full) txt = `dolu (${seats.map((x) => x.name).join(' – ')})`;
    else txt = `takıma katıl (${seats.length}/${t.seats.length} oyuncu)`;
    return { short: 'Oyna', label: `${g.icon} ${st.name} — ${txt}${t.npc ? ' · misafirler yer verir' : ''}`, use: () => this.joinTable(game, i) };
  }

  async request(data) {
    if (this.pending) return { ok: false };
    this.pending = true;
    const res = await this.net.request(EVT.BASEMENT_ACT, data);
    this.pending = false;
    if (!res.ok && res.error) this.hud.toast(res.error, 'warn');
    return res;
  }

  async stairs() {
    const fade = this.reception?.el?.fade ?? document.getElementById('lift-fade');
    const res = await this.request({ act: 'stairs' });
    if (!res.ok) return;
    fade.textContent = res.basement ? '⬇ −1 · VIP Eğlence Katı 🎳' : '⬆ Lobi';
    fade.hidden = false;
    fade.classList.add('on');
    this.player.setPose(res.x, res.z, res.yaw);
    this.net.sendMove(res.x, res.z, res.yaw);
    this.net.flushMove?.();
    this.sound('step');
    this.interaction.invalidate();
    this.engine.wake();
    setTimeout(() => {
      fade.classList.remove('on');
      setTimeout(() => { fade.hidden = true; }, 320);
    }, 420);
  }

  async joinTable(game, i) {
    const res = await this.request({ act: 'join', game, i });
    if (!res.ok) return;
    this.enterGame(game, i, res.seat ?? 0);
  }

  async joinLane(i) {
    const l = this.state?.lanes[i];
    const mine = l && !l.over && l.players.some((p) => p.id === this.selfId);
    if (!mine) {
      const res = await this.request({ act: 'lane', i });
      if (!res.ok) return;
      this.sound('coin');
    }
    this.enterGame('bowling', i, 0);
  }

  // ---- Oyun modu ------------------------------------------------------------------------------

  enterGame(game, i, seat) {
    this.mode = { game, i, seat };
    this.games[game].enter(i, seat);
    this.camReady = false;
    this.player.setFollow(() => this.camPos, this.cam.eye);
    this.interaction.setEnabled(false);
    this.hud.setPrompt(null);
    this.touch?.setLabel(game === 'bowling' ? 'At' : 'Vur');
    document.body.classList.add('bm-playing');
    this.el.hud.hidden = false;
    this.hudKey = '';
    this.engine.wake();
  }

  /** @param silent sunucuya "kalk" gönderilmez (sunucu zaten kaldırdı / alan değişti) */
  exitGame(send = true) {
    const m = this.mode;
    if (!m) return;
    this.mode = null;
    this.games[m.game].exit();
    this.showRemotes();
    this.player.setFollow(null);
    const st = BASEMENT_GAMES[m.game].list[m.i];
    const sp = st.spots[m.seat % st.spots.length]; // langırt 2'ye 2: seat 2/3 kendi takımının tarafına
    this.player.pitch = 0;
    this.player.setPose(sp.at[0], sp.at[1], Math.atan2(-(st.center[0] - sp.at[0]), -(st.center[1] - sp.at[1])));
    this.net.sendMove(sp.at[0], sp.at[1], this.player.yaw);
    this.interaction.setEnabled(true);
    this.touch?.setLabel(null);
    document.body.classList.remove('bm-playing');
    this.el.hud.hidden = true;
    if (send) this.net.request(EVT.BASEMENT_ACT, { act: 'leave', game: m.game, i: m.i });
    this.engine.wake();
  }

  /** Aksiyon (E / tık / dokunmatik buton): oyun modunda oyuna gider */
  onAction() {
    if (!this.mode) return false;
    this.games[this.mode.game].action();
    this.hudKey = '';
    return true;
  }

  command(cmd) {
    if (!this.mode) return false;
    if (cmd === 'cycle') this.exitGame(true); // Q: kalk
    else if (this.games[this.mode.game].command?.(cmd)) { /* oyuna özel tuş (langırt: çubuk seçimi) */ }
    else if (cmd === 'select:0') this.startAi();
    else if (cmd === 'consume' && this.mode.game === 'bowling') this.hud.toast(`🎳 Falso: ${this.games.bowling.cycleSpin()}`, 'info');
    this.hudKey = '';
    return true; // oyun modunda diğer komutlar (envanter, dekor…) kapalı
  }

  onEscape() {
    if (!this.mode) return false;
    this.exitGame(true);
    return true;
  }

  async startAi() {
    const m = this.mode;
    if (!m || m.game === 'bowling') return;
    await this.request({ act: 'ai', game: m.game, i: m.i });
  }

  update(dt) {
    let active = false;
    if (this.inBasement || this.mode) {
      for (const g of Object.values(this.games)) if (g.update(dt)) active = true;
    }
    if (this.mode) {
      active = true;
      const c = this.games[this.mode.game].camera({});
      const k = this.camReady ? Math.min(1, dt * 7) : 1;
      this.camReady = true;
      const cam = this.cam;
      cam.x += (c.x - cam.x) * k;
      cam.z += (c.z - cam.z) * k;
      cam.eye += (c.eye - cam.eye) * k;
      cam.yaw = lerpAngle(cam.yaw, c.yaw, k);
      cam.pitch += (c.pitch - cam.pitch) * k;
      this.camPos.x = cam.x;
      this.camPos.z = cam.z;
      const p = this.player;
      p.eye = cam.eye;
      p.yaw = cam.yaw;
      p.pitch = cam.pitch;
      p.pos.x = cam.x;
      p.pos.z = cam.z;
      p.apply();
      this.hideNearRemotes(cam.x, cam.z);
      this.renderHud();
    }
    return active;
  }

  /** Kameraya 0.8 m'den yakın diğer oyuncuları (langırtta takım arkadaşı, masa başındakiler) gizler */
  hideNearRemotes(x, z) {
    if (!this.remotes) return;
    for (const [id, it] of this.remotes.items) {
      const near = Math.hypot(it.obj.position.x - x, it.obj.position.z - z) < 0.8;
      if (near === this.hiddenRemotes.has(id)) continue;
      it.obj.visible = !near;
      if (near) this.hiddenRemotes.add(id);
      else this.hiddenRemotes.delete(id);
    }
  }

  showRemotes() {
    for (const id of this.hiddenRemotes) {
      const it = this.remotes?.get(id);
      if (it) it.obj.visible = true;
    }
    this.hiddenRemotes.clear();
  }

  // ---- HUD --------------------------------------------------------------------------------------

  buildHud() {
    const hud = el('div', 'panel');
    hud.id = 'bm-hud';
    hud.hidden = true;
    const title = el('div', 'bm-title');
    const lines = el('div', 'bm-lines');
    const bar = el('div', 'bm-power');
    const fill = el('i');
    bar.append(fill);
    const rods = el('div', 'bm-rods'); // langırt: çubuk seçimi (dokunmatikte de)
    rods.hidden = true;
    rods.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b || !this.mode) return;
      const foos = this.games.foos;
      if (b.dataset.rod === 'auto') foos.toggleAuto();
      else foos.pick(Number(b.dataset.rod));
      this.hudKey = '';
    });
    const btns = el('div', 'bm-btns');
    const ai = el('button', 'bm-ai', '🤖 Bilgisayara karşı (1)');
    const spin = el('button', 'bm-spin', '🌀 Falso (F)');
    const quit = el('button', 'bm-quit', '✕ Kalk (Q)');
    for (const b of [ai, spin, quit]) b.type = 'button';
    ai.addEventListener('click', () => this.startAi());
    spin.addEventListener('click', () => this.command('consume'));
    quit.addEventListener('click', () => this.exitGame(true));
    btns.append(ai, spin, quit);
    hud.append(title, lines, bar, rods, btns);
    document.body.append(hud);
    this.el = { hud, title, lines, bar, fill, ai, spin, rods };
  }

  renderHud() {
    const m = this.mode;
    const st = this.games[m.game].status();
    if (st.power != null) this.el.fill.style.transform = `scaleX(${st.power.toFixed(3)})`;
    const key = JSON.stringify([st.title, st.lines, st.power != null, !!st.ai, !!st.spin, st.rods, st.auto]);
    if (key === this.hudKey) return;
    this.hudKey = key;
    this.el.title.textContent = st.title;
    this.el.lines.replaceChildren(...st.lines.map((t) => el('div', null, t)));
    this.el.bar.hidden = st.power == null;
    this.el.ai.hidden = !st.ai;
    this.el.spin.hidden = !st.spin;
    this.el.rods.hidden = !st.rods;
    if (st.rods) {
      // Düğmeler bir kez kurulur, sonra yerinde güncellenir (dokunurken DOM'dan kopmasın)
      if (!this.el.rods.childElementCount) {
        const btn = (rod, icon, name) => {
          const b = el('button', 'bm-rod');
          b.type = 'button';
          b.dataset.rod = rod;
          b.append(el('span', 'ic', icon), el('span', 'nm', name));
          return b;
        };
        this.el.rods.append(...st.rods.map((r) => btn(String(r.n), `${r.n + 1} ${r.label.split(' ')[0]}`, r.label.split(' ').slice(1).join(' '))), btn('auto', '🔄', 'Oto (T)'));
        this.el.rods.lastChild.classList.add('bm-auto');
      }
      const kids = this.el.rods.children;
      st.rods.forEach((r, k) => {
        kids[k].classList.toggle('on', r.sel);
        kids[k].disabled = !r.mine;
      });
      kids[kids.length - 1].classList.toggle('on', st.auto);
    }
  }

  // ---- Atari -------------------------------------------------------------------------------------

  buildArcadePanel() {
    const panelEl = el('div', 'overlay');
    panelEl.id = 'bm-arcade';
    panelEl.hidden = true;
    const card = el('div', 'card bm-arcade-card');
    const title = el('h2', null, '🕹️');
    const canvas = el('canvas', 'bm-screen');
    canvas.width = ARCADE_W;
    canvas.height = ARCADE_H;
    const pad = el('div', 'bm-pad touch-only');
    const keys = { left: false, right: false, up: false, down: false, fire: false, pointer: null };
    const mk = (label, k) => {
      const b = el('button', `bm-key bm-${k}`, label);
      b.type = 'button';
      const on = (v) => (e) => { e.preventDefault(); keys[k] = v; };
      b.addEventListener('pointerdown', on(true));
      b.addEventListener('pointerup', on(false));
      b.addEventListener('pointerleave', on(false));
      b.addEventListener('pointercancel', on(false));
      return b;
    };
    pad.append(mk('◀', 'left'), mk('▲', 'up'), mk('▼', 'down'), mk('▶', 'right'), mk('🔥', 'fire'));
    const info = el('p', 'sub', 'Ok tuşları / WASD: hareket · Boşluk: ateş / başlat · Esc: kapat');
    info.classList.add('desktop-only');
    const board = el('div', 'bm-board');
    const actions = el('div', 'bm-actions');
    const again = el('button', 'primary', `🪙 Tekrar (€${R.ARCADE_PRICE})`);
    const close = el('button', 'secondary', 'Kapat');
    again.type = 'button';
    close.type = 'button';
    again.addEventListener('click', () => this.startArcade(this.arc?.i ?? 0, true));
    close.addEventListener('click', () => this.modal.close(panelEl));
    actions.append(again, close);
    card.append(title, canvas, pad, info, board, actions);
    panelEl.append(card);
    document.body.append(panelEl);
    this.arcEl = { panel: panelEl, title, canvas, board, again, keys, g: canvas.getContext('2d') };
    // Fare / dokunuş ile raket (Tuğla Kırıcı, Lale İstilası)
    canvas.addEventListener('pointermove', (e) => {
      const r = canvas.getBoundingClientRect();
      keys.pointer = ((e.clientX - r.left) / r.width) * ARCADE_W;
    });
    canvas.addEventListener('pointerleave', () => { keys.pointer = null; });
    canvas.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      keys.fire = true;
      setTimeout(() => { keys.fire = false; }, 120);
    });
    const map = { ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right', ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down', Space: 'fire', KeyE: 'fire' };
    this.onKey = (e) => {
      const k = map[e.code];
      if (!k || !this.arc) return;
      e.preventDefault();
      keys[k] = e.type === 'keydown';
    };
  }

  async startArcade(i, again = false) {
    if (this.arc?.run && !this.arc.game.over) return;
    const res = await this.request({ act: 'arcade', i });
    if (!res.ok) return;
    this.sound('coin');
    const def = ARCADE_GAMES_DEF[res.game];
    const best = this.state?.high?.[res.game]?.[0]?.score ?? 0;
    this.arc = { i, run: res.run, id: res.game, def, game: makeArcadeGame(res.game), best, sent: false, last: performance.now() };
    const a = this.arcEl;
    a.title.textContent = `${def.icon} ${def.name}`;
    a.again.hidden = true;
    this.renderBoard();
    if (!again) {
      window.addEventListener('keydown', this.onKey);
      window.addEventListener('keyup', this.onKey);
      this.modal.open(a.panel, () => this.onArcadeClosed());
    }
    this.arcadeLoop();
  }

  arcadeLoop() {
    const arc = this.arc;
    if (!arc) return;
    const t = performance.now();
    const dt = Math.min(0.05, (t - arc.last) / 1000);
    arc.last = t;
    const g = arc.game;
    if (!g.over) {
      g.step(dt, this.arcEl.keys);
      if (g.ate || g.hit || g.fired) this.sound(g.ate ? 'coin' : 'blip');
      if (g.hurt) this.sound('miss');
      g.ate = g.hit = g.fired = g.hurt = false;
    }
    drawArcade(this.arcEl.g, g, arc.best, arc.def.name);
    if (g.over && !arc.sent) this.finishArcade();
    if (!g.over) this.raf = requestAnimationFrame(() => this.arcadeLoop());
  }

  async finishArcade() {
    const arc = this.arc;
    if (!arc || arc.sent) return;
    arc.sent = true;
    const res = await this.net.request(EVT.BASEMENT_ACT, { act: 'arcadeEnd', i: arc.i, run: arc.run, score: arc.game.score });
    if (res.ok && res.rank) this.hud.toast(`🏆 ${arc.def.name}: ${res.score} puan — rekor listesinde ${res.rank}. sıra!`, 'money');
    else if (!res.ok && res.error) this.hud.toast(res.error, 'warn');
    if (this.arc === arc) {
      this.arcEl.again.hidden = false;
      this.renderBoard();
    }
  }

  renderBoard() {
    const arc = this.arc;
    const list = this.state?.high?.[arc?.id] ?? [];
    const b = this.arcEl.board;
    b.replaceChildren(el('div', 'bm-board-t', '🏆 Rekorlar'));
    if (!list.length) b.append(el('div', 'muted', 'Henüz rekor yok — ilk sen ol!'));
    list.forEach((e, k) => b.append(el('div', null, `${k + 1}. ${e.name} — ${e.score}`)));
  }

  onArcadeClosed() {
    window.removeEventListener('keydown', this.onKey);
    window.removeEventListener('keyup', this.onKey);
    cancelAnimationFrame(this.raf);
    const arc = this.arc;
    this.arc = null;
    for (const k of ['left', 'right', 'up', 'down', 'fire']) this.arcEl.keys[k] = false;
    if (arc && !arc.sent) {
      // Yarıda bırakılan oyun: o ana kadarki puan kaydedilir
      arc.sent = true;
      this.net.request(EVT.BASEMENT_ACT, { act: 'arcadeEnd', i: arc.i, run: arc.run, score: arc.game.score });
    }
  }

  closeArcade() {
    if (!this.arcEl.panel.hidden) this.modal.close(this.arcEl.panel);
  }

  // ---- Ses --------------------------------------------------------------------------------------

  sound(name) {
    if (!this.settings.sound || !this.inBasement) return;
    const sfx = this.sfx;
    if (name === 'coin') { sfx.coin(); return; }
    const ctx = sfx.begin(700);
    if (!ctx) return;
    const t = ctx.currentTime + 0.01;
    const out = sfx.output(ctx, 0.12);
    const P = (f, d, peak = 0.8, type = 'sine', dt = 0) => sfx.ping(ctx, out, t + dt, f, d, peak, type);
    switch (name) {
      case 'cue': P(900, 0.05, 0.9, 'triangle'); break;
      case 'clack': P(2200, 0.04, 0.9, 'square'); P(1500, 0.06, 0.5, 'triangle'); break;
      case 'pocket': P(180, 0.18, 0.9, 'sine'); P(120, 0.22, 0.6, 'sine', 0.05); break;
      case 'roll': P(70, 0.9, 0.7, 'sawtooth'); break;
      case 'pins': for (let k = 0; k < 5; k++) P(500 + Math.random() * 900, 0.08, 0.6, 'square', k * 0.03); break;
      case 'strike': for (let k = 0; k < 10; k++) P(400 + Math.random() * 1400, 0.1, 0.7, 'square', k * 0.025); P(523, 0.3, 0.5, 'triangle', 0.3); P(784, 0.4, 0.5, 'triangle', 0.42); break;
      case 'pong': case 'bounce': P(name === 'pong' ? 1250 : 950, 0.035, 0.9, 'triangle'); break;
      case 'smash': P(1600, 0.05, 1, 'square'); break;
      case 'kick': case 'tick': P(name === 'kick' ? 700 : 1100, 0.04, 0.8, 'square'); break;
      case 'whoosh': P(300, 0.12, 0.3, 'sawtooth'); break;
      case 'goal': case 'score': P(660, 0.12, 0.7, 'square'); P(880, 0.12, 0.7, 'square', 0.12); P(1320, 0.25, 0.7, 'square', 0.24); break;
      case 'miss': P(300, 0.18, 0.6, 'square'); P(200, 0.25, 0.6, 'square', 0.15); break;
      case 'blip': P(1400, 0.03, 0.5, 'square'); break;
      case 'step': P(160, 0.08, 0.6, 'triangle'); P(140, 0.08, 0.6, 'triangle', 0.15); break;
      default: break;
    }
  }

  /** Bodrumdaysa geçerli (konsol / test) */
  get here() { return isInsideBasement(this.player.pos.x, this.player.pos.z); }
}
