import { EVT } from '/shared/constants.js';
import { BASEMENT_RULES as R } from '/shared/basement.js';
import { PONG_TOP } from '../../world/BasementBuilding.js';

const G = 6.2; // oynanabilirlik için hafifletilmiş yerçekimi
const PADDLE_OFF = 0.22; // raket düzlemi masanın ucundan bu kadar dışarıda
const REACH = 0.17; // raket merkezine bu kadar yakın top karşılanır
const SEND_MS = 70;

/**
 * Masa tenisi: hızlı 1v1 (7 sayıya). Top fiziği maçın ev sahibinde (seat 0) çalışır; rakibin raketi ve topun
 * durumu BASEMENT_RT ile aktarılır (~14 Hz). Tek başına oynayan bilgisayara (🤖) karşı oynar.
 * Kontroller: fare / sürükleme ya da A/D raketi yana kaydırır; servis ve "smaç" için E / Aksiyon
 * (top gelmeden hemen önce basarsan daha sert vurursun ama hata payı artar).
 */
export class PongGame {
  constructor({ view, net, hud, sound, now, input, rt }) {
    Object.assign(this, { view, net, hud, sound, now, input, rt });
    this.states = view.map(() => null);
    this.active = -1;
    this.seat = -1;
    this.ball = { x: 0, y: 0.3, w: 0, vx: 0, vy: 0, vw: 0 };
    this.pw = [0, 0];
    this.serving = 0; // servis atacak taraf (-1: top oyunda)
    this.hitter = -1;
    this.bounced = false;
    this.pauseUntil = 0;
    this.smashAt = 0;
    this.remoteSmash = 0;
    this.remoteServe = false;
    this.lastSend = 0;
    this.lastRt = 0; // seyirci / misafir: son paket zamanı
    this.aiServeAt = 0;
    this.npcT = 0;
    this._mv = { x: 0, y: 0 };
  }

  get L() { return this.view[0].def.L; }

  get W() { return this.view[0].def.W; }

  onState(list) {
    list.forEach((s, i) => {
      const prev = this.states[i];
      this.states[i] = s;
      if (i === this.active && prev && (prev.phase !== s.phase || prev.score[0] + prev.score[1] !== s.score[0] + s.score[1])) {
        if (s.phase === 'play' && prev.phase !== 'play') this.resetRally(0);
      }
    });
  }

  get state() { return this.states[this.active]; }

  isHost() { return this.seat === 0 && this.state?.phase === 'play'; }

  resetRally(side) {
    this.serving = side;
    this.hitter = -1;
    this.bounced = false;
    this.ball.vx = this.ball.vy = this.ball.vw = 0;
    this.aiServeAt = this.now() + 900;
  }

  paddleX(side) { return (side === 0 ? -1 : 1) * (this.L / 2 + PADDLE_OFF); }

  /** Topu karşı tarafa gönder (iniş noktası seçilir; hata payı vuruşun kenarlığına ve smaça bağlı) */
  launch(side, offset, smash) {
    const b = this.ball;
    const dir = side === 0 ? 1 : -1;
    const err = Math.abs(offset) / REACH;
    const T = smash ? 0.46 : 0.72 + Math.random() * 0.1;
    const depth = 0.3 + Math.random() * 0.6;
    const tx = dir * depth * (this.L / 2);
    let tw = b.w + offset * 3.2 + (Math.random() - 0.5) * 0.3;
    tw += (Math.random() - 0.5) * (smash ? 0.9 : 0.35) * err * err;
    b.vx = (tx - b.x) / T;
    b.vw = (tw - b.w) / T;
    b.vy = (0 - b.y + 0.5 * G * T * T) / T;
    this.hitter = side;
    this.bounced = false;
    this.sound(smash ? 'smash' : 'pong');
  }

  serve(side) {
    const b = this.ball;
    b.x = this.paddleX(side) * 0.92;
    b.y = 0.28;
    b.w = this.pw[side];
    this.serving = -1;
    this.launch(side, 0, false);
  }

  async point(side) {
    this.pauseUntil = this.now() + 1100;
    this.serving = -2; // sunucunun skoru gelene kadar bekle
    this.sound(side === this.seat ? 'score' : 'miss');
    const res = await this.net.request(EVT.BASEMENT_ACT, { act: 'point', game: 'pong', i: this.active, side });
    const s = this.state;
    const total = res.score ? res.score[0] + res.score[1] : (s ? s.score[0] + s.score[1] : 0);
    this.resetRally(Math.floor(total / 2) % 2); // servis 2 sayıda bir değişir
  }

  /** Ev sahibi: bir fizik adımı */
  stepHost(dt) {
    const b = this.ball;
    const now = this.now();
    const s = this.state;
    const ai = s.ai;
    // Bilgisayarın raketi topu izler (gecikmeli, sınırlı hız)
    if (ai) {
      const coming = b.vx > 0 || this.serving === 1;
      const target = coming ? b.w + (b.vx > 0 ? b.vw * Math.max(0, (this.paddleX(1) - b.x) / b.vx) * 0.85 : 0) : 0;
      const d = target - this.pw[1];
      this.pw[1] += Math.sign(d) * Math.min(Math.abs(d), 1.35 * dt);
    }
    if (this.serving === -2 || now < this.pauseUntil) return;
    if (this.serving >= 0) {
      const side = this.serving;
      b.x = this.paddleX(side) * 0.92;
      b.y = 0.28;
      b.w = this.pw[side];
      if (side === 1 && ai && now >= this.aiServeAt) this.serve(1);
      if (side === 1 && !ai && this.remoteServe) this.serve(1);
      this.remoteServe = false;
      return;
    }
    b.vy -= G * dt;
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.w += b.vw * dt;
    const onTable = Math.abs(b.x) <= this.L / 2 && Math.abs(b.w) <= this.W / 2;
    if (b.y <= 0 && b.vy < 0) {
      if (onTable) {
        b.y = 0;
        b.vy = -b.vy * 0.86;
        this.bounced = true;
        this.sound('bounce');
      } else if (b.y < -0.6) {
        // Masaya değmeden dışarı: vuran kaybeder; karşı tarafta sekip kaçtıysa vuran kazanır
        this.point(this.bounced ? this.hitter : 1 - this.hitter);
        return;
      }
    }
    // Karşılayanın raket düzlemi
    const recv = 1 - this.hitter;
    const px = this.paddleX(recv);
    if ((recv === 1 && b.x >= px) || (recv === 0 && b.x <= px)) {
      const off = b.w - this.pw[recv];
      if (this.bounced && Math.abs(off) < REACH && b.y > -0.05) {
        b.x = px;
        const smash = recv === this.seat ? now - this.smashAt < 300 : recv === 1 && !ai ? now - this.remoteSmash < 400 : Math.random() < 0.15;
        this.launch(recv, ai && recv === 1 ? off + (Math.random() - 0.5) * 0.08 : off, smash);
      } else {
        this.point(this.hitter);
      }
    }
  }

  update(dt) {
    let active = false;
    const now = this.now();
    if (this.active >= 0) {
      active = true;
      const s = this.state;
      // Yerel raket: fare / sürükleme (look) + A/D
      const mv = this.input.moveVector(this._mv);
      const sign = this.seat === 0 ? 1 : -1;
      if (mv.x) this.movePaddle(sign * mv.x * dt * 1.6);
      if (s?.phase === 'play') {
        if (this.isHost()) {
          let left = Math.min(dt, 0.12); // düşük kare hızında da gerçek zamanlı akar (alt adımlarla)
          while (left > 0) {
            const h = Math.min(left, 1 / 120);
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
            ? [b.x, b.y, b.w, b.vx, b.vy, b.vw, this.pw[0], this.pw[1], this.serving]
            : [this.pw[1], now - this.smashAt < 300 ? 1 : 0, this.serveReq ? 1 : 0];
          this.serveReq = false;
          this.rt({ g: 'pong', i: this.active, s: pkt });
        }
      }
    } else {
      // Seyirci: yakın zamanda paket geldiyse topu tahmin et; NPC masasında süs ralli
      this.states.forEach((s) => {
        if (s?.phase === 'play' && now - this.lastRt < 600) {
          this.extrapolate(dt);
          active = true;
        } else if (s?.npc && !s.seats[0]) {
          this.npcRally(dt);
          active = true;
        }
      });
    }
    this.render();
    return active;
  }

  /** Paket gelmeyen aralıkta topu fizikle ilerlet (misafir / seyirci) */
  extrapolate(dt) {
    const b = this.ball;
    if (this.serving !== -1) return;
    b.vy -= G * dt;
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.w += b.vw * dt;
    if (b.y <= 0 && b.vy < 0 && Math.abs(b.x) <= this.L / 2 && Math.abs(b.w) <= this.W / 2) {
      b.y = 0;
      b.vy = -b.vy * 0.86;
    }
  }

  npcRally(dt) {
    this.npcT += dt;
    const b = this.ball;
    const ph = (this.npcT % 1.6) / 1.6;
    const dir = Math.floor(this.npcT / 1.6) % 2 ? -1 : 1;
    b.x = dir * (-1 + 2 * ph) * (this.L / 2 + 0.1);
    b.y = 0.05 + Math.abs(Math.sin(ph * Math.PI * 2)) * 0.3;
    b.w = Math.sin(this.npcT * 1.3) * 0.4;
    this.pw[0] = b.w * 0.9;
    this.pw[1] = b.w * 0.9;
  }

  onRt(msg) {
    if (msg.g !== 'pong') return;
    this.lastRt = this.now();
    const s = msg.s;
    if (this.active === msg.i && this.isHost()) {
      // Misafirin raketi + smaç / servis isteği
      if (msg.seat === 1) {
        this.pw[1] = s[0];
        if (s[1]) this.remoteSmash = this.now();
        if (s[2]) this.remoteServe = true;
      }
      return;
    }
    if (msg.seat !== 0) return;
    const b = this.ball;
    [b.x, b.y, b.w, b.vx, b.vy, b.vw] = s;
    this.pw[0] = s[6];
    if (this.seat !== 1 || this.active !== msg.i) this.pw[1] = s[7];
    this.serving = s[8];
  }

  movePaddle(d) {
    const s = this.seat;
    if (s < 0) return;
    this.pw[s] = Math.max(-this.W / 2 - 0.1, Math.min(this.W / 2 + 0.1, this.pw[s] + d));
  }

  render() {
    const v = this.view[this.active >= 0 ? this.active : 0];
    const b = this.ball;
    v.ball.position.set(v.cx + b.x, PONG_TOP + 0.02 + Math.max(-0.7, b.y), v.cz + b.w);
    v.paddles.forEach((p, k) => {
      p.position.set(v.cx + this.paddleX(k), PONG_TOP + 0.2, v.cz + this.pw[k]);
      p.rotation.z = (k === 0 ? 1 : -1) * 0.25;
    });
  }

  camera(out) {
    const v = this.view[this.active];
    const sgn = this.seat === 1 ? 1 : -1;
    out.x = v.cx + sgn * (this.L / 2 + 0.85);
    out.z = v.cz + this.pw[Math.max(0, this.seat)] * 0.45;
    out.eye = 1.4;
    out.yaw = sgn < 0 ? -Math.PI / 2 : Math.PI / 2;
    out.pitch = -0.42;
    return out;
  }

  enter(i, seat) {
    this.active = i;
    this.seat = seat;
    this.pw = [0, 0];
    this.resetRally(0);
  }

  exit() {
    this.active = -1;
    this.seat = -1;
  }

  look(dx) {
    this.movePaddle((this.seat === 0 ? 1 : -1) * dx * 1.1);
  }

  async action() {
    const s = this.state;
    if (!s) return;
    if (s.phase === 'over') {
      await this.net.request(EVT.BASEMENT_ACT, { act: 'join', game: 'pong', i: this.active });
      return;
    }
    if (s.phase !== 'play') return;
    this.smashAt = this.now();
    if (this.serving === this.seat) {
      if (this.isHost()) this.serve(0);
      else this.serveReq = true;
    }
  }

  status() {
    const s = this.state;
    if (!s) return { title: '🏓 Masa tenisi', lines: [] };
    const n = (k) => s.seats[k]?.name ?? '—';
    const lines = [`${n(0)}  ${s.score[0]} – ${s.score[1]}  ${n(1)}  (${R.PONG_TO} sayıya)`];
    if (s.phase === 'wait') lines.push('Rakip bekleniyor — arkadaşın masaya gelip E\'ye basabilir.');
    else if (s.phase === 'over') lines.push('Maç bitti — E: rövanş');
    else if (this.serving === this.seat) lines.push('Servis sende — E: servis at');
    else lines.push('Fare/sürükle ya da A/D: raket · E (vuruştan hemen önce): smaç');
    if (s.msg) lines.push(s.msg);
    return { title: '🏓 Masa tenisi', lines, ai: s.phase === 'wait' && this.seat === 0 };
  }
}
