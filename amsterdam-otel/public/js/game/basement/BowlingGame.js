import * as THREE from 'three';
import { EVT } from '/shared/constants.js';
import { BASEMENT_RULES as R, bowlingStatus } from '/shared/basement.js';
import { BOWL, BOWL_PINS, ALL_PINS, bowlSimStart, bowlStep, bowlSpeed } from '/shared/basementPhysics.js';

const SPINS = [0, 0.6, -0.6];
const SPIN_TEXT = { 0: 'düz', 0.6: '↪ sağa falso', '-0.6': '↩ sola falso' };
const _axis = new THREE.Vector3();

/**
 * 2 hatlı VIP bowling istemcisi. Atış sunucuda simüle edilir; burada aynı simülasyon animasyon için oynatılır
 * (top, devrilen labutlar), ardından labutlar sunucunun durumuna göre dizilir. Skor ekranı yalnızca durum
 * değişince yeniden çizilir. NPC misafirlerin oynadığı kulvarda ara sıra süs atışları (yalnızca yerel görsel).
 * Kontroller: A/D (joystick) bırakış noktası, fare / sürükleme yön, F / "Falso" düğmesi falso,
 * E / Aksiyon güç çubuğu → ikinci basış atış.
 */
export class BowlingGame {
  constructor({ view, net, hud, sound, now, input, me }) {
    Object.assign(this, { view, net, hud, sound, now, input, me });
    this.states = view.map(() => null);
    this.anims = view.map(() => null);
    this.npcAt = view.map(() => 0);
    this.active = -1;
    this.u = 0;
    this.angle = 0;
    this.spin = 0;
    this.mode = 'aim';
    this.power = 0;
    this.powerT = 0;
    this.sending = false;
    this._mv = { x: 0, y: 0 };
    view.forEach((v, i) => this.drawScore(i));
  }

  onState(list) {
    list.forEach((s, i) => {
      const prev = this.states[i];
      this.states[i] = s;
      if (!this.anims[i] && (!prev || prev.standing !== s.standing || prev.shotNo !== s.shotNo)) this.setPins(i, s.standing);
      this.drawScore(i);
      if (i === this.active && prev && prev.turn !== s.turn) this.mode = 'aim';
    });
  }

  setPins(i, mask) {
    const v = this.view[i];
    v.pins.forEach((m, k) => {
      m.visible = !!((mask >> k) & 1);
      m.position.set(v.x + BOWL_PINS[k][0], 0, v.fz - BOWL_PINS[k][1]);
      m.rotation.set(0, 0, 0);
      m.userData.fall = 0;
    });
  }

  onShot(msg) {
    this.play(msg.i, msg.from, msg.u, msg.vu, msg.vv, msg.spin, msg.standing, msg.knocked);
  }

  play(i, from, u, vu, vv, spin, after, knocked) {
    const v = this.view[i];
    if (!v) return;
    this.setPins(i, from);
    this.anims[i] = { st: bowlSimStart(from, u, vu, vv, spin), acc: 0, after, hold: 0, crashed: false, knocked };
    v.ball.visible = true;
    this.sound('roll');
    if (i === this.active) this.mode = 'aim';
  }

  update(dt) {
    let active = false;
    const now = this.now();
    this.anims.forEach((a, i) => {
      if (!a) return;
      active = true;
      const v = this.view[i];
      if (a.st.done) {
        a.hold += dt;
        if (a.hold > 1.1) {
          this.anims[i] = null;
          v.ball.visible = false;
          const s = this.states[i];
          this.setPins(i, s ? s.standing : ALL_PINS);
        }
        return;
      }
      a.acc += dt / BOWL.DT;
      let n = 0;
      while (a.acc >= 1 && !a.st.done && n++ < 40) {
        a.acc -= 1;
        bowlStep(a.st);
      }
      const b = a.st.ball;
      v.ball.position.set(v.x + b.u, b.gutter ? BOWL.BALL_R - 0.06 : BOWL.BALL_R, v.fz - b.v);
      v.ball.rotation.x -= b.vv * dt / BOWL.BALL_R;
      if (b.v > BOWL.DECK_END + 0.4) v.ball.visible = false;
      for (const p of a.st.pins) {
        const m = v.pins[p.i];
        if (!p.on) continue;
        m.position.x = v.x + p.u;
        m.position.z = v.fz - p.v;
        if (p.down && m.userData.fall < 1.45) {
          if (!a.crashed) {
            a.crashed = true;
            this.sound(a.knocked >= 10 ? 'strike' : 'pins');
          }
          const sp = Math.hypot(p.vu, p.vv) || 1;
          _axis.set(-p.vv / sp, 0, -p.vu / sp).normalize();
          const step = Math.min(1.45 - m.userData.fall, dt * 7);
          m.userData.fall += step;
          m.rotateOnWorldAxis(_axis, step);
        }
      }
    });
    // NPC kulvarı: ara sıra süs atışı (yalnızca kulvarda oyuncu yokken)
    this.states.forEach((s, i) => {
      if (!s?.npc || s.players.length || this.anims[i]) return;
      if (now < this.npcAt[i]) return;
      this.npcAt[i] = now + 7000 + Math.random() * 5000;
      const sp = bowlSpeed(0.55 + Math.random() * 0.4);
      const a = (Math.random() - 0.5) * 0.03;
      this.play(i, ALL_PINS, (Math.random() - 0.5) * 0.3, Math.sin(a) * sp, Math.cos(a) * sp, 0, ALL_PINS, 0);
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
    if (!s || s.over || !s.players.length || this.anims[this.active]) return false;
    return s.players[s.turn]?.id === this.me() && this.now() >= s.busyUntil - 50;
  }

  joined() {
    const s = this.state;
    return !!s && s.players.some((p) => p.id === this.me()) && !s.over;
  }

  updateAim(dt) {
    const v = this.view[this.active];
    if (!this.myTurn()) return;
    const mv = this.input.moveVector(this._mv);
    if (mv.x) this.u = Math.max(-BOWL.MAX_U, Math.min(BOWL.MAX_U, this.u + mv.x * dt * 0.45));
    if (this.mode === 'power') {
      this.powerT += dt * 0.8;
      this.power = 1 - Math.abs(1 - (this.powerT % 2));
    }
    // Elde tutulan top (kameranın önünde)
    v.ball.visible = true;
    const fwd = -Math.cos(this.angle);
    v.ball.position.set(v.x + this.u + Math.sin(this.angle) * 0.5 + 0.18, 0.95 - (this.mode === 'power' ? this.power * 0.25 : 0), v.fz + 1.2 + fwd * 0.5);
  }

  camera(out) {
    const v = this.view[this.active];
    out.x = v.x + this.u;
    out.z = v.fz + 1.75;
    out.eye = 1.5;
    out.yaw = -this.angle;
    out.pitch = this.anims[this.active] ? -0.08 : -0.16;
    return out;
  }

  enter(i) {
    this.active = i;
    this.u = 0;
    this.angle = 0;
    this.mode = 'aim';
  }

  exit() {
    const v = this.view[this.active];
    if (v && !this.anims[this.active]) v.ball.visible = false;
    this.active = -1;
  }

  look(dx) {
    if (!this.myTurn()) return;
    this.angle = Math.max(-BOWL.MAX_ANGLE, Math.min(BOWL.MAX_ANGLE, this.angle + dx * 0.08));
  }

  cycleSpin() {
    this.spin = SPINS[(SPINS.indexOf(this.spin) + 1) % SPINS.length];
    return SPIN_TEXT[this.spin];
  }

  async action() {
    const s = this.state;
    if (!s) return;
    if (!this.joined()) {
      const res = await this.net.request(EVT.BASEMENT_ACT, { act: 'lane', i: this.active });
      if (!res.ok) this.hud.toast(res.error || 'Kulvara katılamadın.', 'warn');
      else this.sound('coin');
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
    const res = await this.net.request(EVT.BASEMENT_ACT, {
      act: 'bowl', i: this.active, u: this.u, angle: this.angle, power: Math.max(0.05, this.power), spin: this.spin,
    });
    this.sending = false;
    this.mode = 'aim';
    if (!res.ok) this.hud.toast(res.error || 'Atış olmadı.', 'warn');
  }

  status() {
    const s = this.state;
    const name = this.view[this.active]?.def.name ?? 'Kulvar';
    if (!s) return { title: `🎳 ${name}`, lines: [] };
    const lines = [];
    if (!this.joined()) {
      lines.push(s.over || !s.players.length ? `E: oyuna başla (€${R.LANE_PRICE}, ${R.BOWL_FRAMES} çerçeve)` : `E: oyuna katıl (€${R.LANE_PRICE}) · ${s.players.length}/${R.BOWL_MAX_PLAYERS} oyuncu`);
    } else if (this.anims[this.active]) lines.push('Top yuvarlanıyor…');
    else if (this.myTurn()) {
      const st = bowlingStatus(s.players[s.turn].rolls);
      lines.push(`Çerçeve ${st.frame + 1}/${R.BOWL_FRAMES} · ${st.ball + 1}. atış · ${SPIN_TEXT[this.spin]}`);
      lines.push(this.mode === 'power' ? `Güç: %${Math.round(this.power * 100)} — E: at!` : 'A/D: yer · fare/sürükle: yön · F: falso · E: güç');
    } else lines.push(`Sıra ${s.players[s.turn]?.name ?? '—'}'da…`);
    if (s.msg) lines.push(s.msg);
    for (const p of s.players) lines.push(`${p.id === this.me() ? '▶ ' : ''}${p.name}: ${bowlingStatus(p.rolls).total}`);
    return { title: `🎳 VIP Bowling · ${name}`, lines, power: this.mode === 'power' && this.myTurn() ? this.power : null, spin: this.joined() };
  }

  /** Kulvarın skor ekranı (tavandan asılı) */
  drawScore(i) {
    const v = this.view[i];
    const s = this.states[i];
    const { canvas, tex } = v.score;
    const g = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    g.fillStyle = '#07040f';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = i ? '#28e7ff' : '#ff2bd6';
    g.lineWidth = 4;
    g.strokeRect(2, 2, w - 4, h - 4);
    g.textBaseline = 'middle';
    g.fillStyle = '#ffffff';
    g.font = 'bold 22px system-ui, sans-serif';
    g.textAlign = 'left';
    g.fillText(`🎳 ${v.def.name}`, 14, 22);
    if (!s || !s.players.length) {
      g.textAlign = 'center';
      g.font = 'bold 26px system-ui, sans-serif';
      g.fillStyle = '#ffd23f';
      g.fillText(s?.npc ? 'Misafirler oynuyor 🎳' : `Boş · €${R.LANE_PRICE} / oyun`, w / 2, h / 2 + 10);
      tex.needsUpdate = true;
      return;
    }
    const rowH = Math.min(36, (h - 44) / s.players.length);
    const cw = (w - 190) / R.BOWL_FRAMES;
    s.players.forEach((p, k) => {
      const y = 44 + k * rowH;
      const st = bowlingStatus(p.rolls);
      g.fillStyle = k === s.turn && !s.over ? 'rgba(255,43,214,0.25)' : 'rgba(255,255,255,0.05)';
      g.fillRect(8, y, w - 16, rowH - 4);
      g.fillStyle = '#fff';
      g.font = `bold ${Math.round(rowH * 0.5)}px system-ui, sans-serif`;
      g.textAlign = 'left';
      g.fillText(p.name.slice(0, 9), 14, y + rowH / 2 - 2);
      g.textAlign = 'center';
      st.frames.forEach((fr, f) => {
        const x = 120 + f * cw;
        const txt = fr.map((r, j) => (r === 10 && (j === 0 || f === R.BOWL_FRAMES - 1) ? 'X' : j > 0 && fr[j - 1] !== 10 && fr[j - 1] + r === 10 ? '/' : r === 0 ? '–' : String(r))).join(' ');
        g.fillStyle = '#9fe8ff';
        g.fillText(txt, x + cw / 2, y + rowH * 0.32);
        if (st.cum[f] != null) {
          g.fillStyle = '#fff';
          g.fillText(String(st.cum[f]), x + cw / 2, y + rowH * 0.72);
        }
      });
      g.fillStyle = '#ffd23f';
      g.fillText(String(st.total), w - 40, y + rowH / 2 - 2);
    });
    tex.needsUpdate = true;
  }
}
