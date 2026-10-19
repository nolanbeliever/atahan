import { EVT } from '/shared/constants.js';
import { BASEMENT_RULES as R } from '/shared/basement.js';
import { FOOS_RODS, FOOS_TOP } from '../../world/BasementBuilding.js';

const HL = 0.6; // saha yarı uzunluğu (x)
const HW = 0.35; // saha yarı genişliği (w)
const GOAL = 0.1; // kale yarı genişliği
const BR = 0.017; // top yarıçapı
const FIG = 0.02; // oyuncu figürünün çarpışma yarıçapı
const KICK_MS = 220;
const SEND_MS = 70;

/**
 * Langırt: 1v1, 5 gole. Her oyuncu kendi 4 çubuğunu birlikte kaydırır (W/S, fare / sürükleme yukarı-aşağı) ve
 * E / Aksiyon ile çubukları döndürüp vurur. Top fiziği ev sahibinde (seat 0) çalışır; çubuk konumları ve top
 * BASEMENT_RT ile aktarılır. Tek başına oynayan bilgisayara karşı oynar.
 * seat 0 masanın güneyinde durur ve +x kalesini savunur; seat 1 kuzeyde, −x kalesini savunur.
 */
export class FoosGame {
  constructor({ view, net, hud, sound, now, input, rt }) {
    Object.assign(this, { view, net, hud, sound, now, input, rt });
    this.states = view.map(() => null);
    this.active = -1;
    this.seat = -1;
    this.ball = { x: 0, w: 0, vx: 0, vw: 0 };
    this.off = [0, 0]; // çubuk kaydırma (−1..1)
    this.kickAt = [0, 0];
    this.pauseUntil = 0;
    this.waiting = false;
    this.stillFor = 0;
    this.lastSend = 0;
    this.lastRt = 0;
    this.aiKick = 0;
    this._mv = { x: 0, y: 0 };
  }

  onState(list) {
    list.forEach((s, i) => {
      const prev = this.states[i];
      this.states[i] = s;
      if (i === this.active && s.phase === 'play' && prev?.phase !== 'play') this.drop();
    });
  }

  get state() { return this.states[this.active]; }

  isHost() { return this.seat === 0 && this.state?.phase === 'play'; }

  drop() {
    const b = this.ball;
    b.x = 0;
    b.w = 0;
    // Orta çubukların arasında durup kalmasın: top bir tarafa doğru bırakılır
    b.vx = (Math.random() < 0.5 ? -1 : 1) * (0.6 + Math.random() * 0.3);
    b.vw = (Math.random() - 0.5) * 0.8;
    this.pauseUntil = this.now() + 700;
    this.waiting = false;
    this.stillFor = 0;
  }

  async goal(side) {
    this.waiting = true;
    this.sound(side === this.seat ? 'goal' : 'miss');
    await this.net.request(EVT.BASEMENT_ACT, { act: 'point', game: 'foos', i: this.active, side });
    this.drop();
    this.pauseUntil = this.now() + 1100;
  }

  figW(rod, j, owner) {
    return (j - (rod.n - 1) / 2) * rod.sp + this.off[owner] * rod.range;
  }

  stepHost(dt) {
    const b = this.ball;
    const now = this.now();
    const s = this.state;
    if (s.ai) this.stepAi(dt, now);
    if (this.waiting || now < this.pauseUntil) return;
    b.x += b.vx * dt;
    b.w += b.vw * dt;
    const sp = Math.hypot(b.vx, b.vw);
    if (sp > 0) {
      const k = Math.max(0, sp - 0.15 * dt) / sp;
      b.vx *= k;
      b.vw *= k;
    }
    if (Math.abs(b.w) > HW - BR) {
      b.w = Math.sign(b.w) * (HW - BR);
      b.vw = -b.vw * 0.8;
      this.sound('tick');
    }
    if (Math.abs(b.x) > HL - BR) {
      if (Math.abs(b.w) < GOAL) {
        this.goal(b.x > 0 ? 1 : 0); // +x kalesi seat 0'ın → gol seat 1'in
        return;
      }
      b.x = Math.sign(b.x) * (HL - BR);
      b.vx = -b.vx * 0.8;
      this.sound('tick');
    }
    // Figürler
    for (const rod of FOOS_RODS) {
      if (Math.abs(b.x - rod.x) > FIG + BR) continue;
      const o = rod.owner;
      const kicking = now - this.kickAt[o] < KICK_MS;
      for (let j = 0; j < rod.n; j++) {
        const fw = this.figW(rod, j, o);
        const dx = b.x - rod.x;
        const dw = b.w - fw;
        const d = Math.hypot(dx, dw);
        if (d >= FIG + BR || d === 0) continue;
        const nx = dx / d;
        const nw = dw / d;
        b.x = rod.x + nx * (FIG + BR);
        b.w = fw + nw * (FIG + BR);
        if (kicking) {
          const dir = o === 0 ? -1 : 1;
          b.vx = dir * (2.4 + Math.random() * 0.6);
          b.vw = dw * 22 + (Math.random() - 0.5) * 0.4;
          this.sound('kick');
        } else {
          const rv = b.vx * nx + b.vw * nw;
          if (rv < 0) {
            b.vx -= 1.6 * rv * nx;
            b.vw -= 1.6 * rv * nw;
          }
        }
      }
    }
    // Takılan top yeniden ortaya
    this.stillFor = Math.hypot(b.vx, b.vw) < 0.04 ? this.stillFor + dt : 0;
    if (this.stillFor > 2.5) this.drop();
  }

  /** Bilgisayar: topa en yakın çubuğunun en yakın figürünü topun hizasına getirir, menzildeyse vurur */
  stepAi(dt, now) {
    const b = this.ball;
    let best = null;
    for (const rod of FOOS_RODS) {
      if (rod.owner !== 1) continue;
      const dx = Math.abs(b.x - rod.x);
      if (!best || dx < best.dx) best = { rod, dx };
    }
    const rod = best.rod;
    let tgt = 0;
    let bd = Infinity;
    for (let j = 0; j < rod.n; j++) {
      const base = (j - (rod.n - 1) / 2) * rod.sp;
      const t = Math.max(-1, Math.min(1, (b.w - base) / rod.range));
      const err = Math.abs(base + t * rod.range - b.w);
      if (err < bd) { bd = err; tgt = t; }
    }
    const d = tgt - this.off[1];
    this.off[1] += Math.sign(d) * Math.min(Math.abs(d), 3.2 * dt);
    if (best.dx < 0.05 && bd < 0.03 && now - this.aiKick > 450) {
      this.aiKick = now;
      this.kickAt[1] = now;
    }
  }

  update(dt) {
    let active = false;
    const now = this.now();
    if (this.active >= 0) {
      active = true;
      const s = this.state;
      const mv = this.input.moveVector(this._mv);
      if (mv.y) this.slide((this.seat === 0 ? 1 : -1) * mv.y * dt * 3);
      if (s?.phase === 'play') {
        if (this.isHost()) {
          let left = Math.min(dt, 0.05);
          while (left > 0) {
            const h = Math.min(left, 1 / 180);
            this.stepHost(h);
            left -= h;
          }
        } else {
          this.extrapolate(dt);
        }
        if (now - this.lastSend > SEND_MS) {
          this.lastSend = now;
          const b = this.ball;
          const pkt = this.isHost()
            ? [b.x, b.w, b.vx, b.vw, this.off[0], this.off[1], Math.min(9, (now - this.kickAt[0]) / 1000), Math.min(9, (now - this.kickAt[1]) / 1000)]
            : [this.off[1], now - this.kickAt[1] < KICK_MS ? 1 : 0];
          this.rt({ g: 'foos', i: this.active, s: pkt });
        }
      }
    } else {
      this.states.forEach((s) => {
        if (s?.phase === 'play' && now - this.lastRt < 600) {
          this.extrapolate(dt);
          active = true;
        }
      });
    }
    this.render(now);
    return active || now - Math.max(this.kickAt[0], this.kickAt[1]) < KICK_MS + 50;
  }

  extrapolate(dt) {
    const b = this.ball;
    b.x = Math.max(-HL, Math.min(HL, b.x + b.vx * dt));
    b.w = Math.max(-HW, Math.min(HW, b.w + b.vw * dt));
  }

  onRt(msg) {
    if (msg.g !== 'foos') return;
    this.lastRt = this.now();
    const s = msg.s;
    if (this.active === msg.i && this.isHost()) {
      if (msg.seat === 1) {
        this.off[1] = Math.max(-1, Math.min(1, s[0]));
        if (s[1] && this.now() - this.kickAt[1] > KICK_MS) this.kickAt[1] = this.now();
      }
      return;
    }
    if (msg.seat !== 0) return;
    const b = this.ball;
    [b.x, b.w, b.vx, b.vw] = s;
    this.off[0] = s[4];
    if (this.seat !== 1 || this.active !== msg.i) this.off[1] = s[5];
    const now = this.now();
    if (s[6] < 0.2) this.kickAt[0] = now - s[6] * 1000;
    if (this.seat !== 1 && s[7] < 0.2) this.kickAt[1] = now - s[7] * 1000;
  }

  slide(d) {
    if (this.seat < 0) return;
    this.off[this.seat] = Math.max(-1, Math.min(1, this.off[this.seat] + d));
  }

  render(now) {
    const idx = this.active >= 0 ? this.active : this.states.findIndex((s) => s?.phase === 'play');
    const v = this.view[Math.max(0, idx)];
    const b = this.ball;
    v.ball.position.set(v.cx + b.x, FOOS_TOP - 0.043, v.cz + b.w);
    FOOS_RODS.forEach((rod, k) => {
      const g = v.rods[k];
      g.position.z = v.cz + this.off[rod.owner] * rod.range;
      const t = (now - this.kickAt[rod.owner]) / KICK_MS;
      g.rotation.z = t >= 0 && t < 1 ? (rod.owner === 0 ? 1 : -1) * t * Math.PI * 2 : 0;
    });
  }

  camera(out) {
    const v = this.view[this.active];
    const sgn = this.seat === 1 ? 1 : -1;
    out.x = v.cx;
    out.z = v.cz + sgn * 0.95;
    out.eye = 1.6;
    out.yaw = sgn < 0 ? Math.PI : 0;
    out.pitch = -0.98;
    return out;
  }

  enter(i, seat) {
    this.active = i;
    this.seat = seat;
    this.off = [0, 0];
  }

  exit() {
    this.active = -1;
    this.seat = -1;
  }

  look(dx, dy) {
    this.slide((this.seat === 0 ? -1 : 1) * dy * 2.2);
  }

  async action() {
    const s = this.state;
    if (!s) return;
    if (s.phase === 'over') {
      await this.net.request(EVT.BASEMENT_ACT, { act: 'join', game: 'foos', i: this.active });
      return;
    }
    if (s.phase !== 'play' || this.seat < 0) return;
    if (this.now() - this.kickAt[this.seat] > KICK_MS) {
      this.kickAt[this.seat] = this.now();
      this.sound('whoosh');
    }
  }

  status() {
    const s = this.state;
    if (!s) return { title: '⚽ Langırt', lines: [] };
    const n = (k) => s.seats[k]?.name ?? '—';
    const lines = [`🔴 ${n(0)}  ${s.score[0]} – ${s.score[1]}  ${n(1)} 🔵  (${R.FOOS_TO} gole)`];
    if (s.phase === 'wait') lines.push('Rakip bekleniyor — arkadaşın masaya gelip E\'ye basabilir.');
    else if (s.phase === 'over') lines.push('Maç bitti — E: rövanş');
    else lines.push('W/S ya da fare yukarı-aşağı: çubuklar · E: çubukları döndür (vur!)');
    if (s.msg) lines.push(s.msg);
    return { title: '⚽ Langırt', lines, ai: s.phase === 'wait' && this.seat === 0 };
  }
}
