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
const NROD = FOOS_RODS.length;

// Takımın çubukları kendi kalesinden ileriye: kaleci, defans, orta saha, forvet (🔴 +x kalesini, 🔵 −x kalesini savunur)
const TEAM_RODS = [0, 1].map((team) => FOOS_RODS.map((r, k) => ({ r, k })).filter((o) => o.r.owner === team)
  .sort((a, b) => (team === 0 ? b.r.x - a.r.x : a.r.x - b.r.x)).map((o) => o.k));
const ROD_NAMES = ['🧤 Kaleci', '🛡️ Defans', '⚙️ Orta saha', '⚡ Forvet'];

/**
 * Langırt: 1v1 ya da 2'ye 2 (seat 0+2 🔴, seat 1+3 🔵), 5 gole. Oyuncu kendi çubuklarından birini seçer
 * (1–4, A/D, fare tekerleği ya da HUD düğmeleri; "Oto" açıkken topa en yakın çubuk seçilir) ve yalnızca onu
 * kaydırır (W/S, fare / sürükleme) ve döndürür (E / Aksiyon). 2'ye 2'de ön koltuk (0/1) kaleci + defansı,
 * arka koltuk (2/3) orta saha + forveti oynar; takımda tek kişi kalırsa dört çubuğun hepsi onundur.
 * Top fiziği ev sahibinde (seat 0) çalışır; çubuk konumları ve top BASEMENT_RT ile aktarılır.
 * Tek başına (ya da takım arkadaşınla) bilgisayara karşı oynanabilir; bir arkadaş gelirse bilgisayarın yerine geçer.
 */
export class FoosGame {
  constructor({ view, net, hud, sound, now, input, rt }) {
    Object.assign(this, { view, net, hud, sound, now, input, rt });
    this.states = view.map(() => null);
    this.active = -1;
    this.seat = -1;
    this.ball = { x: 0, w: 0, vx: 0, vw: 0 };
    this.off = new Array(NROD).fill(0); // çubuk kaydırma (−1..1)
    this.kickAt = new Array(NROD).fill(0);
    this.sel = -1; // seçili çubuk (FOOS_RODS indeksi)
    this.auto = true;
    this.pauseUntil = 0;
    this.waiting = false;
    this.stillSince = 0;
    this.lastSend = 0;
    this.lastRt = 0;
    this.aiKick = 0;
    this.prevX = 0;
    this._mv = { x: 0, y: 0 };
  }

  onState(list) {
    list.forEach((s, i) => {
      const prev = this.states[i];
      this.states[i] = s;
      if (i === this.active && s.phase === 'play' && prev?.phase !== 'play') this.drop();
    });
    if (this.seat >= 0 && !this.mine().includes(this.sel)) this.sel = this.mine()[0] ?? -1;
  }

  get state() { return this.states[this.active]; }

  get team() { return this.seat % 2; }

  isHost() { return this.seat === 0 && this.state?.phase === 'play'; }

  /** Bu koltuğun oynadığı çubuklar (takım arkadaşı varsa ikiye bölünür) */
  controls(seat, s = this.state) {
    if (seat < 0 || !s) return [];
    const rods = TEAM_RODS[seat % 2];
    const mate = s.seats[seat ^ 2];
    if (!mate) return rods;
    return seat < 2 ? rods.slice(0, 2) : rods.slice(2);
  }

  mine() { return this.controls(this.seat); }

  drop() {
    const b = this.ball;
    b.x = 0;
    b.w = 0;
    // Orta çubukların arasında durup kalmasın: top bir tarafa doğru bırakılır
    b.vx = (Math.random() < 0.5 ? -1 : 1) * (0.6 + Math.random() * 0.3);
    b.vw = (Math.random() - 0.5) * 0.8;
    this.pauseUntil = this.now() + 700;
    this.waiting = false;
    this.stillSince = 0;
  }

  async goal(side) {
    this.waiting = true;
    this.sound(side === this.team ? 'goal' : 'miss');
    await this.net.request(EVT.BASEMENT_ACT, { act: 'point', game: 'foos', i: this.active, side });
    this.drop();
    this.pauseUntil = this.now() + 1100;
  }

  figW(rod, j, k) {
    return (j - (rod.n - 1) / 2) * rod.sp + this.off[k] * rod.range;
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
        this.goal(b.x > 0 ? 1 : 0); // +x kalesi 🔴'nin → gol 🔵'nin
        return;
      }
      b.x = Math.sign(b.x) * (HL - BR);
      b.vx = -b.vx * 0.8;
      this.sound('tick');
    }
    // Figürler (her çubuk kendi kaydırması ve dönüşüyle)
    for (let k = 0; k < NROD; k++) {
      const rod = FOOS_RODS[k];
      if (Math.abs(b.x - rod.x) > FIG + BR) continue;
      const kicking = now - this.kickAt[k] < KICK_MS;
      for (let j = 0; j < rod.n; j++) {
        const fw = this.figW(rod, j, k);
        const dx = b.x - rod.x;
        const dw = b.w - fw;
        const d = Math.hypot(dx, dw);
        if (d >= FIG + BR || d === 0) continue;
        const nx = dx / d;
        const nw = dw / d;
        b.x = rod.x + nx * (FIG + BR);
        b.w = fw + nw * (FIG + BR);
        if (kicking) {
          const dir = rod.owner === 0 ? -1 : 1;
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
    // Takılan top (hiçbir çubuğun yetişemediği ölü bölgede durursa) gerçek zamanla 1.8 sn sonra yeniden bırakılır
    if (Math.hypot(b.vx, b.vw) >= 0.04) this.stillSince = 0;
    else if (!this.stillSince) this.stillSince = now;
    else if (now - this.stillSince > 1800) this.drop();
  }

  /** Bilgisayar (🔵): her çubuğunun en yakın figürünü topun hizasına getirir, menzildeki çubukla vurur */
  stepAi(dt, now) {
    const b = this.ball;
    for (const k of TEAM_RODS[1]) {
      const rod = FOOS_RODS[k];
      let tgt = 0;
      let bd = Infinity;
      for (let j = 0; j < rod.n; j++) {
        const base = (j - (rod.n - 1) / 2) * rod.sp;
        const t = Math.max(-1, Math.min(1, (b.w - base) / rod.range));
        const err = Math.abs(base + t * rod.range - b.w);
        if (err < bd) { bd = err; tgt = t; }
      }
      const d = tgt - this.off[k];
      this.off[k] += Math.sign(d) * Math.min(Math.abs(d), 2.6 * dt);
      if (Math.abs(b.x - rod.x) < 0.05 && bd < 0.03 && now - this.aiKick > 450) {
        this.aiKick = now;
        this.kickAt[k] = now;
      }
    }
  }

  /** "Oto": topa (x ekseninde) en yakın kendi çubuğun seçilir; titremesin diye küçük bir eşik */
  autoPick() {
    const mine = this.mine();
    if (!mine.length) return;
    const bx = this.ball.x;
    let best = mine.includes(this.sel) ? this.sel : mine[0];
    let bd = Math.abs(FOOS_RODS[best].x - bx) - 0.04;
    for (const k of mine) {
      const d = Math.abs(FOOS_RODS[k].x - bx);
      if (d < bd) { bd = d; best = k; }
    }
    this.sel = best;
  }

  /** Takım çubuğu seç (0 kaleci … 3 forvet) */
  pick(n) {
    const k = TEAM_RODS[this.team]?.[n];
    if (k === undefined) return;
    if (!this.mine().includes(k)) {
      this.hud.toast(`${ROD_NAMES[n]} takım arkadaşında.`, 'info');
      return;
    }
    this.auto = false;
    this.sel = k;
  }

  /** Kendi çubukların arasında sıradakine geç (d: +1 ileri / −1 geri) */
  cycle(d) {
    const mine = this.mine();
    if (!mine.length) return;
    this.auto = false;
    const at = Math.max(0, mine.indexOf(this.sel));
    this.sel = mine[(at + d + mine.length) % mine.length];
  }

  update(dt) {
    let active = false;
    const now = this.now();
    if (this.active >= 0) {
      active = true;
      const s = this.state;
      const mv = this.input.moveVector(this._mv);
      // Dokunmatik çubukta titreme çubuk değiştirmesin: belirgin yatay itiş gerekir
      const sx = Math.abs(mv.x) > 0.6 && Math.abs(mv.x) > Math.abs(mv.y) ? Math.sign(mv.x) : 0;
      if (sx && sx !== this.prevX && s?.phase === 'play') this.cycle(sx); // A/D: çubuk değiştir
      this.prevX = sx;
      if (s?.phase === 'play' && this.auto) this.autoPick();
      if (mv.y) this.slide((this.team === 0 ? 1 : -1) * mv.y * dt * 3);
      if (s?.phase === 'play') {
        if (this.isHost()) {
          let left = Math.min(dt, 0.12); // düşük kare hızında da gerçek zamanlı akar (alt adımlarla)
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
          this.rt({ g: 'foos', i: this.active, s: this.packet(now) });
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
    return active || now - Math.max(...this.kickAt) < KICK_MS + 50;
  }

  /** Ev sahibi: top + 8 çubuk + 8 vuruş yaşı; diğerleri: kendi çubukları için [indeks, kaydırma, vuruyor mu] */
  packet(now) {
    if (this.isHost()) {
      const b = this.ball;
      const out = [b.x, b.w, b.vx, b.vw, ...this.off];
      for (let k = 0; k < NROD; k++) out.push(Math.min(9, (now - this.kickAt[k]) / 1000));
      return out;
    }
    const out = [];
    for (const k of this.mine()) out.push(k, this.off[k], now - this.kickAt[k] < KICK_MS ? 1 : 0);
    return out;
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
    const now = this.now();
    if (this.active === msg.i && this.isHost()) {
      // Takım arkadaşı / rakip: yalnızca kendi koltuğunun çubukları kabul edilir
      if (msg.seat > 0) {
        const allowed = this.controls(msg.seat);
        for (let j = 0; j + 2 < s.length; j += 3) {
          const k = s[j];
          if (!allowed.includes(k)) continue;
          this.off[k] = Math.max(-1, Math.min(1, s[j + 1]));
          if (s[j + 2] && now - this.kickAt[k] > KICK_MS) this.kickAt[k] = now;
        }
      }
      return;
    }
    if (msg.seat !== 0 || s.length < 4 + NROD * 2) return;
    const b = this.ball;
    [b.x, b.w, b.vx, b.vw] = s;
    const mine = this.active === msg.i ? this.mine() : [];
    for (let k = 0; k < NROD; k++) {
      if (mine.includes(k)) continue;
      this.off[k] = s[4 + k];
      const age = s[4 + NROD + k];
      if (age < 0.2) this.kickAt[k] = now - age * 1000;
    }
  }

  slide(d) {
    if (this.seat < 0 || this.sel < 0) return;
    this.off[this.sel] = Math.max(-1, Math.min(1, this.off[this.sel] + d));
  }

  render(now) {
    const idx = this.active >= 0 ? this.active : this.states.findIndex((s) => s?.phase === 'play');
    const v = this.view[Math.max(0, idx)];
    const b = this.ball;
    v.ball.position.set(v.cx + b.x, FOOS_TOP - 0.043, v.cz + b.w);
    FOOS_RODS.forEach((rod, k) => {
      const g = v.rods[k];
      g.position.z = v.cz + this.off[k] * rod.range;
      const t = (now - this.kickAt[k]) / KICK_MS;
      g.rotation.z = t >= 0 && t < 1 ? (rod.owner === 0 ? 1 : -1) * t * Math.PI * 2 : 0;
      g.userData.mark.visible = this.active === idx && k === this.sel;
    });
  }

  camera(out) {
    const v = this.view[this.active];
    const team = this.team;
    const sgn = team === 1 ? 1 : -1;
    // 2'ye 2: ön koltuk (kaleci + defans) kendi kalesine, arka koltuk (orta saha + forvet) rakip kaleye yakın durur
    const mate = this.state?.seats[this.seat ^ 2];
    const own = team === 0 ? 1 : -1;
    out.x = v.cx + (mate ? (this.seat < 2 ? own : -own) * 0.28 : 0);
    out.z = v.cz + sgn * 0.95;
    out.eye = 1.6;
    out.yaw = sgn < 0 ? Math.PI : 0;
    out.pitch = -0.98;
    return out;
  }

  enter(i, seat) {
    this.active = i;
    this.seat = seat;
    this.off.fill(0);
    this.sel = this.mine()[0] ?? -1;
  }

  exit() {
    if (this.active >= 0) for (const g of this.view[this.active].rods) g.userData.mark.visible = false;
    this.active = -1;
    this.seat = -1;
    this.sel = -1;
  }

  look(dx, dy) {
    this.slide((this.team === 0 ? -1 : 1) * dy * 2.2);
  }

  /** Klavye / tekerlek: 1–4 çubuk seç, tekerlek / R sıradaki, T "Oto" aç-kapa. @returns {boolean} işlendi mi */
  command(cmd) {
    if (this.state?.phase !== 'play' || this.seat < 0) return false;
    const m = /^select:(\d)$/.exec(cmd);
    if (m && Number(m[1]) < 4) this.pick(Number(m[1]));
    else if (cmd === 'selNext' || cmd === 'rotate') this.cycle(1);
    else if (cmd === 'selPrev') this.cycle(-1);
    else if (cmd === 'tv') this.toggleAuto();
    else return false;
    return true;
  }

  toggleAuto() {
    this.auto = !this.auto;
    this.hud.toast(this.auto ? '🔄 Oto çubuk: topa en yakın çubuk seçilir' : '✋ Çubuğu sen seçiyorsun (1–4 / A-D)', 'info');
  }

  async action() {
    const s = this.state;
    if (!s) return;
    if (s.phase === 'over') {
      await this.net.request(EVT.BASEMENT_ACT, { act: 'join', game: 'foos', i: this.active });
      return;
    }
    if (s.phase !== 'play' || this.sel < 0) return;
    if (this.now() - this.kickAt[this.sel] > KICK_MS) {
      this.kickAt[this.sel] = this.now();
      this.sound('whoosh');
    }
  }

  status() {
    const s = this.state;
    if (!s) return { title: '⚽ Langırt', lines: [] };
    const side = (team) => s.seats.filter((x, k) => x && k % 2 === team).map((x) => x.name).join(' & ') || '—';
    const lines = [`🔴 ${side(0)}  ${s.score[0]} – ${s.score[1]}  ${side(1)} 🔵  (${R.FOOS_TO} gole)`];
    const blueEmpty = !s.seats.some((x, k) => x && k % 2 === 1);
    let rods = null;
    if (s.phase === 'wait') lines.push('Rakip bekleniyor — arkadaşların masaya gelip E\'ye basabilir (2\'ye 2\'ye kadar).');
    else if (s.phase === 'over') lines.push('Maç bitti — E: rövanş');
    else {
      lines.push(`W/S ya da fare: çubuğu kaydır · E: vur · 1–4 / A-D: çubuk seç · T: Oto ${this.auto ? 'açık' : 'kapalı'}`);
      const mine = this.mine();
      rods = TEAM_RODS[this.team].map((k, n) => ({ n, label: ROD_NAMES[n], sel: k === this.sel, mine: mine.includes(k) }));
      if (s.seats.length > 2 && !s.ai && s.seats.filter(Boolean).length < 4) lines.push('Arkadaşların masaya gelip takımlara katılabilir.');
    }
    if (s.msg) lines.push(s.msg);
    return { title: '⚽ Langırt', lines, rods, auto: this.auto, ai: s.phase === 'wait' && this.seat === 0 && blueEmpty };
  }
}
