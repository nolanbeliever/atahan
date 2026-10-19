import * as THREE from 'three';
import { EVT } from '/shared/constants.js';
import { POOL, poolSimStart, poolStep, ballGroup } from '/shared/basementPhysics.js';
import { POOL_TOP } from '../../world/BasementBuilding.js';

const _q = new THREE.Quaternion();
const _axis = new THREE.Vector3();
const GROUP_TEXT = { solid: 'düz (1–7)', stripe: 'parçalı (9–15)' };

/**
 * Bilardo (8-ball) istemcisi: iki masanın topları, sunucudan gelen atışların yeniden oynatılması (aynı deterministik
 * simülasyon) ve yerel oyuncunun FPV nişanı. Nişan: fare / sağ taraf sürükleme ıstakayı beyaz topun etrafında
 * döndürür; E / Aksiyon güç çubuğunu başlatır, ikinci basış vurur. Sıra sende değilken kamera masanın üstündedir.
 */
export class PoolGame {
  constructor({ view, net, hud, sound, group, now }) {
    Object.assign(this, { view, net, hud, sound, now });
    this.states = view.map(() => null);
    this.anims = view.map(() => null);
    this.active = -1; // yerel oyuncunun masası
    this.seat = -1;
    this.angle = Math.PI; // beyaz toptan masanın batısına (rakip toplara)
    this.mode = 'aim'; // 'aim' | 'power'
    this.power = 0;
    this.powerT = 0;
    this.sending = false;
    // Istaka + nişan çizgisi (yalnızca sıra sendeyken)
    const cue = new THREE.Group();
    const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.013, 1.45, 8).rotateZ(Math.PI / 2).translate(-0.78, 0, 0),
      new THREE.MeshLambertMaterial({ color: 0xc89a5a, emissive: 0x2a1a08 }));
    const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.0062, 0.0062, 0.02, 8).rotateZ(Math.PI / 2).translate(-0.05, 0, 0),
      new THREE.MeshBasicMaterial({ color: 0x2a6bff }));
    cue.add(stick, tip);
    cue.visible = false;
    group.add(cue);
    this.cue = cue;
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    this.line = new THREE.Line(lg, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55 }));
    this.line.visible = false;
    this.line.frustumCulled = false;
    group.add(this.line);
    this.ghost = new THREE.Mesh(new THREE.RingGeometry(POOL.R * 0.85, POOL.R, 16).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6 }));
    this.ghost.visible = false;
    group.add(this.ghost);
  }

  // ---- Sunucu durumu ----------------------------------------------------------------------

  onState(list) {
    list.forEach((s, i) => {
      const prev = this.states[i];
      this.states[i] = s;
      if (!this.anims[i] && (!prev || prev.shotNo !== s.shotNo || prev.phase !== s.phase || prev.balls.length !== s.balls.length)) this.placeBalls(i, s.balls);
      if (i === this.active && prev && prev.turn !== s.turn) this.mode = 'aim';
    });
  }

  placeBalls(i, balls) {
    const v = this.view[i];
    for (const m of v.balls.values()) m.visible = false;
    for (const [id, x, z] of balls) {
      const m = v.balls.get(id);
      if (!m) continue;
      m.visible = true;
      m.position.set(v.x0 + x, POOL_TOP + POOL.R, v.z0 + z);
    }
  }

  onShot(msg) {
    const i = msg.i;
    if (!this.view[i]) return;
    this.placeBalls(i, msg.from);
    const st = poolSimStart(msg.from.map(([id, x, z]) => ({ id, x, z })), msg.vx, msg.vz);
    this.anims[i] = { st, acc: 0, final: msg.balls, hits: 0 };
    this.sound('cue');
    if (i === this.active) this.mode = 'aim';
  }

  // ---- Kare ----------------------------------------------------------------------------------

  /** @returns {boolean} animasyon / nişan sürüyor mu */
  update(dt) {
    let active = false;
    this.anims.forEach((a, i) => {
      if (!a) return;
      active = true;
      a.acc += dt / POOL.DT;
      const v = this.view[i];
      const before = a.st.pocketed.length;
      const hit0 = a.st.firstHit;
      let n = 0;
      while (a.acc >= 1 && !a.st.done && n++ < 40) {
        a.acc -= 1;
        poolStep(a.st);
      }
      if (a.st.firstHit !== null && hit0 === null) this.sound('clack');
      if (a.st.pocketed.length > before) this.sound('pocket');
      for (const b of a.st.balls) {
        const m = v.balls.get(b.id);
        if (!m) continue;
        if (!b.on) { m.visible = false; continue; }
        const nx = v.x0 + b.x;
        const nz = v.z0 + b.z;
        const dx = nx - m.position.x;
        const dz = nz - m.position.z;
        const d = Math.hypot(dx, dz);
        if (d > 1e-5) {
          _axis.set(dz / d, 0, -dx / d);
          _q.setFromAxisAngle(_axis, d / POOL.R);
          m.quaternion.premultiply(_q);
        }
        m.position.x = nx;
        m.position.z = nz;
      }
      if (a.st.done) {
        this.anims[i] = null;
        this.placeBalls(i, a.final);
      }
    });
    if (this.active >= 0) {
      this.updateAim(dt);
      active = true;
    }
    return active;
  }

  get state() { return this.states[this.active]; }

  myTurn() {
    const s = this.state;
    if (!s || s.phase !== 'play' || this.anims[this.active]) return false;
    return s.turn === this.seat && this.now() >= (s.busyUntil ?? 0) - 50;
  }

  cueBall() {
    const v = this.view[this.active];
    const m = v?.balls.get(0);
    return m?.visible ? m.position : null;
  }

  updateAim(dt) {
    const turn = this.myTurn();
    const c = this.cueBall();
    const show = turn && !!c;
    this.cue.visible = show;
    this.line.visible = show;
    this.ghost.visible = false;
    if (!show) return;
    if (this.mode === 'power') {
      this.powerT += dt * 0.85;
      this.power = 1 - Math.abs(1 - (this.powerT % 2)); // 0 → 1 → 0
    }
    const dx = Math.cos(this.angle);
    const dz = Math.sin(this.angle);
    const pull = 0.02 + (this.mode === 'power' ? this.power * 0.22 : 0);
    this.cue.position.set(c.x - dx * pull, c.y + 0.012, c.z - dz * pull);
    this.cue.rotation.set(0, -this.angle, 0.06);
    // Nişan çizgisi: beyaz toptan ilk temas noktasına (top ya da bant)
    const v = this.view[this.active];
    let tMin = 3;
    let hit = null;
    for (const [id, m] of v.balls) {
      if (id === 0 || !m.visible) continue;
      const ox = m.position.x - c.x;
      const oz = m.position.z - c.z;
      const proj = ox * dx + oz * dz;
      if (proj <= 0) continue;
      const perp2 = ox * ox + oz * oz - proj * proj;
      const r2 = 4 * POOL.R * POOL.R;
      if (perp2 > r2) continue;
      const t = proj - Math.sqrt(r2 - perp2);
      if (t < tMin) { tMin = t; hit = m; }
    }
    const lx = c.x - v.x0;
    const lz = c.z - v.z0;
    const tx = dx > 0 ? (POOL.L - POOL.R - lx) / dx : dx < 0 ? (POOL.R - lx) / dx : 9;
    const tz = dz > 0 ? (POOL.W - POOL.R - lz) / dz : dz < 0 ? (POOL.R - lz) / dz : 9;
    if (!hit) tMin = Math.min(tMin, tx, tz);
    const p = this.line.geometry.attributes.position;
    p.setXYZ(0, c.x, c.y, c.z);
    p.setXYZ(1, c.x + dx * tMin, c.y, c.z + dz * tMin);
    p.needsUpdate = true;
    if (hit) {
      this.ghost.visible = true;
      this.ghost.position.set(c.x + dx * tMin, POOL_TOP + 0.002, c.z + dz * tMin);
    }
  }

  /** Kamera: sıra sendeyse beyaz topun arkasından, değilse masanın üstünden */
  camera(out) {
    const v = this.view[this.active];
    const c = this.cueBall();
    if (this.myTurn() && c) {
      const dx = Math.cos(this.angle);
      const dz = Math.sin(this.angle);
      out.x = c.x - dx * 0.62;
      out.z = c.z - dz * 0.62;
      out.eye = POOL_TOP + 0.3;
      out.yaw = Math.atan2(-dx, -dz);
      out.pitch = -0.36;
      return out;
    }
    const side = this.seat === 1 ? -1 : 1;
    out.x = v.cx;
    out.z = v.cz + side * 1.55;
    out.eye = 2.25;
    out.yaw = side > 0 ? 0 : Math.PI;
    out.pitch = -0.95;
    return out;
  }

  // ---- Yerel oyuncu ---------------------------------------------------------------------------

  enter(i, seat) {
    this.active = i;
    this.seat = seat;
    this.mode = 'aim';
    const c = this.view[i];
    // Beyaz toptan masanın uzak (üçgen) tarafına bak
    const cue = this.cueBall();
    if (cue) this.angle = Math.atan2(c.cz - cue.z, (c.x0 + POOL.L * 0.73) - cue.x);
  }

  exit() {
    this.active = -1;
    this.seat = -1;
    this.cue.visible = false;
    this.line.visible = false;
    this.ghost.visible = false;
  }

  look(dx) {
    if (!this.myTurn()) return;
    this.angle += dx * (this.mode === 'power' ? 0.15 : 0.4);
  }

  async action() {
    const s = this.state;
    if (!s) return;
    if (s.phase === 'over') {
      await this.net.request(EVT.BASEMENT_ACT, { act: 'join', game: 'pool', i: this.active });
      return;
    }
    if (!this.myTurn() || this.sending) return;
    if (this.mode === 'aim') {
      this.mode = 'power';
      this.powerT = 0;
      this.power = 0;
      return;
    }
    this.sending = true;
    const power = Math.max(0.04, this.power);
    const res = await this.net.request(EVT.BASEMENT_ACT, { act: 'shoot', i: this.active, angle: this.angle, power });
    this.sending = false;
    this.mode = 'aim';
    if (!res.ok) this.hud.toast(res.error || 'Atış olmadı.', 'warn');
  }

  /** HUD satırları */
  status() {
    const s = this.state;
    if (!s) return { title: '🎱 Bilardo', lines: [] };
    const name = (k) => s.seats[k]?.name ?? '—';
    const lines = [];
    const grp = (k) => (s.groups[k] ? ` · ${GROUP_TEXT[s.groups[k]]}` : '');
    lines.push(`${name(0)}${grp(0)}  ⚔️  ${name(1)}${grp(1)}`);
    if (s.phase === 'wait') lines.push('Rakip bekleniyor — arkadaşın masada E\'ye basarak katılabilir.');
    else if (s.phase === 'over') lines.push('Oyun bitti — E: rövanş');
    else if (this.anims[this.active]) lines.push('Toplar dönüyor…');
    else if (this.myTurn()) lines.push(this.mode === 'power' ? `Güç: %${Math.round(this.power * 100)} — E: vur!` : 'Sıra sende — fare/sürükle: nişan · E: güç');
    else lines.push(`Sıra ${name(s.turn)}'da…`);
    if (s.msg) lines.push(s.msg);
    const mine = s.groups[this.seat];
    if (mine && s.phase === 'play') {
      const left = s.balls.filter(([id]) => ballGroup(id) === mine).length;
      lines.push(left ? `Kalan topların: ${left}` : 'Gruplar bitti — sıra 8 numarada!');
    }
    return { title: '🎱 Bilardo · 8-ball', lines, power: this.mode === 'power' && this.myTurn() ? this.power : null, ai: s.phase === 'wait' && this.seat === 0 };
  }
}
