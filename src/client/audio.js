// Procedural WebAudio: ambience, positional SFX (HRTF/equal-power panners), engine.
// Everything is synthesised; no audio files are needed. iOS requires a user gesture
// before the context can start, so init() is called from the "Play" button.

export class AudioSys {
  constructor(settings) {
    this.s = settings;
    this.ctx = null;
    this.ok = false;
    this.engines = new Map();
  }
  init() {
    if (this.ctx) { this.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try { this.ctx = new AC(); } catch (e) { return; }
    const c = this.ctx;
    this.master = c.createGain(); this.master.connect(c.destination);
    this.comp = c.createDynamicsCompressor(); this.comp.connect(this.master);
    this.sfx = c.createGain(); this.sfx.connect(this.comp);
    this.amb = c.createGain(); this.amb.connect(this.comp);
    this.applyVolumes();
    // noise buffers
    const len = c.sampleRate * 2;
    this.white = c.createBuffer(1, len, c.sampleRate);
    const w = this.white.getChannelData(0);
    for (let i = 0; i < len; i++) w[i] = Math.random() * 2 - 1;
    this.brown = c.createBuffer(1, len, c.sampleRate);
    const b = this.brown.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; b[i] = last * 3.5; }
    this._ambience();
    this.ok = true;
    this.resume();
  }
  resume() { if (this.ctx && this.ctx.state !== 'running') this.ctx.resume().catch(() => {}); }
  suspend() { if (this.ctx && this.ctx.state === 'running') this.ctx.suspend().catch(() => {}); }
  applyVolumes() {
    if (!this.ctx) return;
    this.master.gain.value = this.s.master;
    this.sfx.gain.value = this.s.sfx;
    this.amb.gain.value = this.s.ambient;
  }
  get now() { return this.ctx.currentTime; }

  _src(buf, loop = false) { const s = this.ctx.createBufferSource(); s.buffer = buf; s.loop = loop; if (!loop) s.loopStart = 0; return s; }

  _ambience() {
    const c = this.ctx;
    // wind
    const wind = this._src(this.brown, true);
    const wf = c.createBiquadFilter(); wf.type = 'lowpass'; wf.frequency.value = 500;
    this.windG = c.createGain(); this.windG.gain.value = 0.25;
    wind.connect(wf); wf.connect(this.windG); this.windG.connect(this.amb);
    const lfo = c.createOscillator(); lfo.frequency.value = 0.07;
    const lg = c.createGain(); lg.gain.value = 0.12; lfo.connect(lg); lg.connect(this.windG.gain);
    const lfo2 = c.createOscillator(); lfo2.frequency.value = 0.11; const lg2 = c.createGain(); lg2.gain.value = 250; lfo2.connect(lg2); lg2.connect(wf.frequency);
    wind.start(); lfo.start(); lfo2.start();
    // rain
    const rain = this._src(this.white, true);
    const rf = c.createBiquadFilter(); rf.type = 'bandpass'; rf.frequency.value = 2500; rf.Q.value = 0.4;
    const rf2 = c.createBiquadFilter(); rf2.type = 'lowpass'; rf2.frequency.value = 7000;
    this.rainG = c.createGain(); this.rainG.gain.value = 0;
    rain.connect(rf); rf.connect(rf2); rf2.connect(this.rainG); this.rainG.connect(this.amb);
    rain.start();
    // indoor room tone / outdoor distant hum
    this.nextDistant = 8;
  }

  setListener(cam) {
    if (!this.ok) return;
    const L = this.ctx.listener, p = cam.position;
    const f = cam.getWorldDirection(this._v || (this._v = cam.position.clone()));
    const t = this.now;
    if (L.positionX) {
      L.positionX.setTargetAtTime(p.x, t, 0.02); L.positionY.setTargetAtTime(p.y, t, 0.02); L.positionZ.setTargetAtTime(p.z, t, 0.02);
      L.forwardX.setTargetAtTime(f.x, t, 0.02); L.forwardY.setTargetAtTime(f.y, t, 0.02); L.forwardZ.setTargetAtTime(f.z, t, 0.02);
      L.upX.value = 0; L.upY.value = 1; L.upZ.value = 0;
    } else { L.setPosition(p.x, p.y, p.z); L.setOrientation(f.x, f.y, f.z, 0, 1, 0); }
  }

  update(dt, env) {
    if (!this.ok) return;
    const t = this.now;
    this.rainG.gain.setTargetAtTime(env.rain * (env.indoor ? 0.25 : 0.55), t, 0.5);
    this.windG.gain.setTargetAtTime(env.indoor ? 0.08 : 0.22 + env.rain * 0.1, t, 0.5);
    this.nextDistant -= dt;
    if (this.nextDistant <= 0) {
      this.nextDistant = 10 + Math.random() * 25;
      const a = Math.random() * 6.28, d = 120 + Math.random() * 100;
      const p = env.pos;
      const r = Math.random();
      if (r < 0.35) this.gunshot(p.x + Math.cos(a) * d, 1, p.z + Math.sin(a) * d, 'pistol', 0.5);
      else if (r < 0.7) this.groan(p.x + Math.cos(a) * 60, 1.5, p.z + Math.sin(a) * 60, 'alert', 0.6);
      else this.dog(p.x + Math.cos(a) * d, p.z + Math.sin(a) * d);
    }
    if (env.hp < 30 && !env.dead) {
      this.hbT = (this.hbT || 0) - dt;
      if (this.hbT <= 0) { this.hbT = 0.55 + env.hp / 60; this.heartbeat(); }
    }
  }

  // positional output node
  _out(x, y, z, vol = 1, ref = 4) {
    const c = this.ctx;
    const g = c.createGain(); g.gain.value = vol;
    if (x === undefined) { g.connect(this.sfx); return g; }
    const p = c.createPanner();
    p.panningModel = this.s.preset === 'low' ? 'equalpower' : 'HRTF';
    p.distanceModel = 'inverse'; p.refDistance = ref; p.maxDistance = 400; p.rolloffFactor = 1.1;
    if (p.positionX) { p.positionX.value = x; p.positionY.value = y; p.positionZ.value = z; } else p.setPosition(x, y, z);
    g.connect(p); p.connect(this.sfx);
    g._p = p;
    return g;
  }
  _noiseBurst(out, { dur = 0.2, f = 1000, type = 'lowpass', q = 0.7, vol = 1, attack = 0.002, buf, sweep }) {
    const c = this.ctx, t = this.now;
    const s = this._src(buf || this.white);
    const fl = c.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q;
    if (sweep) fl.frequency.exponentialRampToValueAtTime(sweep, t + dur);
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(fl); fl.connect(g); g.connect(out);
    s.start(t, Math.random() * 1.5); s.stop(t + dur + 0.05);
  }
  _tone(out, { f = 100, f2, dur = 0.2, type = 'sine', vol = 0.5, attack = 0.005, delay = 0 }) {
    const c = this.ctx, t = this.now + delay;
    const o = c.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, t);
    if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur);
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(out); o.start(t); o.stop(t + dur + 0.05);
  }

  step(x, y, z, surface = 'hard', vol = 0.3) {
    if (!this.ok) return;
    const o = this._out(x, y, z, vol, 2);
    this._noiseBurst(o, { dur: 0.09, f: surface === 'soft' ? 450 : surface === 'metal' ? 2400 : 900, type: surface === 'metal' ? 'bandpass' : 'lowpass', vol: 0.8, q: 1.2 });
    this._tone(o, { f: 70, f2: 50, dur: 0.07, vol: 0.25 });
  }
  gunshot(x, y, z, w = 'pistol', vol = 1) {
    if (!this.ok) return;
    const o = this._out(x, y, z, vol, 10);
    const big = w === 'shotgun' || w === 'rifle';
    this._noiseBurst(o, { dur: big ? 0.6 : 0.32, f: big ? 2200 : 3000, sweep: 300, vol: 1, attack: 0.001 });
    this._tone(o, { f: big ? 90 : 130, f2: 40, dur: big ? 0.35 : 0.2, vol: 0.9, type: 'sine', attack: 0.001 });
    this._noiseBurst(o, { dur: 1.2, f: 400, vol: 0.15, attack: 0.05, buf: this.brown }); // echo tail
  }
  click(vol = 0.3) { if (!this.ok) return; const o = this._out(undefined, 0, 0, vol); this._tone(o, { f: 2200, f2: 1200, dur: 0.03, type: 'square', vol: 0.3 }); }
  reload() { if (!this.ok) return; const o = this._out(undefined, 0, 0, 0.4); this._noiseBurst(o, { dur: 0.06, f: 3000, type: 'bandpass', vol: 0.6 }); this._tone(o, { f: 900, f2: 600, dur: 0.05, type: 'square', vol: 0.15, delay: 0.35 }); this._noiseBurst(o, { dur: 0.08, f: 2000, type: 'bandpass', vol: 0.6 }); }
  swing(vol = 0.5) { if (!this.ok) return; const o = this._out(undefined, 0, 0, vol); this._noiseBurst(o, { dur: 0.22, f: 600, sweep: 2500, type: 'bandpass', q: 2, vol: 0.6, attack: 0.05 }); }
  hit(x, y, z, flesh = true) {
    if (!this.ok) return;
    const o = this._out(x, y, z, 0.8, 3);
    this._tone(o, { f: flesh ? 120 : 300, f2: 50, dur: 0.15, vol: 0.8 });
    this._noiseBurst(o, { dur: flesh ? 0.18 : 0.08, f: flesh ? 700 : 4000, vol: 0.7, type: flesh ? 'lowpass' : 'bandpass' });
  }
  ricochet(x, y, z) { if (!this.ok) return; const o = this._out(x, y, z, 0.4, 3); this._tone(o, { f: 2800, f2: 1400, dur: 0.15, type: 'triangle', vol: 0.3 }); }
  glass(x, y, z) { if (!this.ok) return; const o = this._out(x, y, z, 0.5, 3); for (let i = 0; i < 4; i++) this._tone(o, { f: 3000 + Math.random() * 3000, dur: 0.2, type: 'triangle', vol: 0.15, delay: i * 0.03 }); }
  groan(x, y, z, kind = 'idle', vol = 1) {
    if (!this.ok) return;
    const c = this.ctx, t = this.now;
    const o = this._out(x, y, z, vol, 3);
    const alert = kind === 'alert';
    const dur = alert ? 1.1 : 1.4 + Math.random();
    const osc = c.createOscillator(); osc.type = 'sawtooth';
    const f0 = (alert ? 170 : 85) + Math.random() * 30;
    osc.frequency.setValueAtTime(f0, t); osc.frequency.linearRampToValueAtTime(f0 * (alert ? 0.7 : 0.85), t + dur);
    const vib = c.createOscillator(); vib.frequency.value = 5 + Math.random() * 4; const vg = c.createGain(); vg.gain.value = f0 * 0.06; vib.connect(vg); vg.connect(osc.frequency);
    const f1 = c.createBiquadFilter(); f1.type = 'bandpass'; f1.frequency.value = alert ? 900 : 550; f1.Q.value = 3;
    const f2 = c.createBiquadFilter(); f2.type = 'bandpass'; f2.frequency.value = alert ? 1700 : 1100; f2.Q.value = 4;
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(alert ? 0.9 : 0.5, t + 0.15); g.gain.setValueAtTime(alert ? 0.8 : 0.45, t + dur * 0.6); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(f1); osc.connect(f2); f1.connect(g); f2.connect(g); g.connect(o);
    osc.start(t); vib.start(t); osc.stop(t + dur + 0.1); vib.stop(t + dur + 0.1);
    this._noiseBurst(o, { dur, f: 1200, type: 'bandpass', q: 1, vol: alert ? 0.25 : 0.12, attack: 0.1 });
  }
  hurt() { if (!this.ok) return; const o = this._out(undefined, 0, 0, 0.7); this._tone(o, { f: 180, f2: 110, dur: 0.25, type: 'sawtooth', vol: 0.25 }); this._noiseBurst(o, { dur: 0.15, f: 500, vol: 0.8 }); }
  heartbeat() { if (!this.ok) return; const o = this._out(undefined, 0, 0, 0.6); this._tone(o, { f: 55, f2: 40, dur: 0.12, vol: 0.9 }); this._tone(o, { f: 50, f2: 38, dur: 0.12, vol: 0.7, delay: 0.18 }); }
  pickup() { if (!this.ok) return; const o = this._out(undefined, 0, 0, 0.35); this._tone(o, { f: 660, dur: 0.07, vol: 0.4 }); this._tone(o, { f: 990, dur: 0.1, vol: 0.4, delay: 0.07 }); }
  ui() { if (!this.ok) return; const o = this._out(undefined, 0, 0, 0.25); this._tone(o, { f: 440, f2: 660, dur: 0.06, type: 'triangle', vol: 0.4 }); }
  door(x, y, z, bash = false) {
    if (!this.ok) return;
    const o = this._out(x, y, z, 0.7, 3);
    if (bash) { this._tone(o, { f: 90, f2: 40, dur: 0.3, vol: 1 }); this._noiseBurst(o, { dur: 0.35, f: 900, vol: 0.9 }); return; }
    const c = this.ctx, t = this.now;
    const osc = c.createOscillator(); osc.type = 'sawtooth'; osc.frequency.setValueAtTime(260, t); osc.frequency.linearRampToValueAtTime(180, t + 0.5);
    const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1200; f.Q.value = 6;
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.08, t + 0.05); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
    osc.connect(f); f.connect(g); g.connect(o); osc.start(t); osc.stop(t + 0.6);
    this._tone(o, { f: 110, f2: 60, dur: 0.15, vol: 0.4, delay: 0.45 });
  }
  dog(x, z) { if (!this.ok) return; const o = this._out(x, 1, z, 0.5, 20); for (let i = 0; i < 3; i++) { this._tone(o, { f: 500, f2: 300, dur: 0.12, type: 'sawtooth', vol: 0.2, delay: i * 0.35 }); } }
  thunder() { if (!this.ok) return; const o = this._out(undefined, 0, 0, 0.9); this._noiseBurst(o, { dur: 3.5, f: 180, vol: 1, attack: 0.3, buf: this.brown }); }
  horn(x, y, z) { if (!this.ok) return; const o = this._out(x, y, z, 0.6, 10); this._tone(o, { f: 420, dur: 0.5, type: 'square', vol: 0.18 }); this._tone(o, { f: 520, dur: 0.5, type: 'square', vol: 0.14 }); }
  helicopter(x, y, z, dur = 8) {
    if (!this.ok) return;
    const c = this.ctx, t = this.now;
    const o = this._out(x, y, z, 1.4, 40);
    const src = this._src(this.brown, true);
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 400;
    const g = c.createGain(); g.gain.value = 0;
    const lfo = c.createOscillator(); lfo.frequency.value = 11; const lg = c.createGain(); lg.gain.value = 0.6; lfo.connect(lg); lg.connect(g.gain);
    const env = c.createGain(); env.gain.setValueAtTime(0.0001, t); env.gain.exponentialRampToValueAtTime(1, t + 2); env.gain.setValueAtTime(1, t + dur - 2); env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(env); env.connect(o);
    src.start(t); lfo.start(t); src.stop(t + dur); lfo.stop(t + dur);
  }

  // continuous engine (one per vehicle id)
  engine(id, on, rpm, x, y, z, local) {
    if (!this.ok) return;
    let e = this.engines.get(id);
    if (!on) { if (e) { e.g.gain.setTargetAtTime(0, this.now, 0.15); setTimeout(() => { try { e.o1.stop(); e.o2.stop(); } catch (er) { /* */ } }, 600); this.engines.delete(id); } return; }
    const c = this.ctx;
    if (!e) {
      const o1 = c.createOscillator(); o1.type = 'sawtooth';
      const o2 = c.createOscillator(); o2.type = 'square';
      const f = c.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = 2;
      const g = c.createGain(); g.gain.value = 0;
      o1.connect(f); o2.connect(f); f.connect(g);
      const out = local ? this._out(undefined, 0, 0, 0.5) : this._out(x, y, z, 0.6, 6);
      g.connect(out);
      o1.start(); o2.start();
      e = { o1, o2, f, g, out };
      this.engines.set(id, e);
    }
    const t = this.now, base = 32 + rpm * 110;
    e.o1.frequency.setTargetAtTime(base, t, 0.05);
    e.o2.frequency.setTargetAtTime(base * 0.5, t, 0.05);
    e.f.frequency.setTargetAtTime(250 + rpm * 1400, t, 0.05);
    e.g.gain.setTargetAtTime(0.12 + rpm * 0.12, t, 0.1);
    if (e.out._p && x !== undefined) { const P = e.out._p; if (P.positionX) { P.positionX.setTargetAtTime(x, t, 0.05); P.positionY.setTargetAtTime(y, t, 0.05); P.positionZ.setTargetAtTime(z, t, 0.05); } else P.setPosition(x, y, z); }
  }
}
