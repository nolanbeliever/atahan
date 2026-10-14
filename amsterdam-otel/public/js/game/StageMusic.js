import { STAGE, STAGE_ACT_BY_ID } from '/shared/stage.js';

// Achterstraat sahnesinin PROSEDÜREL müziği (WebAudio, ses dosyası yok).
//  - 🎸 Akustik: parmakla çalınan akor arpejleri (C–G–Am–F), bas notası + ara sıra tıngırdatma.
//  - 🎧 DJ: dört vuruşlu kick, offbeat hi-hat, clap, offbeat bas synth, akor "stab"ları ve
//    8 ölçülük bölümlerle değişen arpej (Am–F–C–G).
//  - 🎷 Caz: swing; yürüyen kontrbas (ii–V–I–VI), ride zili, hi-hat "chick", fısıltı trampet
//    ve filtreli testere dalgası + vibratolu saksafon melodisi (motifler ölçü numarasından seçilir).
// Her nota sunucunun set başlangıcına (setAt) göre hesaplanan "şarkı zamanına" bağlıdır ve
// rastgelelik ölçü / adım numarasından türetilir → aynı anda dinleyen oyuncular aynı ölçüyü,
// aynı melodiyi duyar (ağ gecikmesi kadar fark).
//
// 3D ses: kaynak sahnede bir PannerNode (equalpower — HRTF'den çok daha ucuz; mobil pil),
// doğrusal mesafe modeli (3 m → 35 m'de sıfır). AudioListener yalnızca oyuncu hareket edince
// güncellenir. Ev içinde alçak geçiren süzgeçle boğuklaşır.
//
// Pil: zamanlayıcı (setTimeout ~100 ms, 0.25 sn ileriye planlama) YALNIZCA çalarken çalışır;
// durunca hiçbir zamanlayıcı kalmaz ve Sfx bağlamı kendi kuralıyla askıya alınır.

const LOOKAHEAD = 0.25; // sn: bu kadar ileriye nota planla
const TICK_MS = 100;
const midi = (m) => 440 * 2 ** ((m - 69) / 12);

/** Adım numarasından deterministik [0,1) */
function hash(n) {
  let x = Math.imul((n | 0) ^ 0x9e3779b9, 0x85ebca6b);
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

// ---- Parçalar ----------------------------------------------------------------------------

const GUITAR_CHORDS = [
  [48, 55, 60, 64, 67], // C
  [43, 55, 59, 62, 67], // G
  [45, 57, 60, 64, 69], // Am
  [41, 53, 57, 60, 65], // F
];
const GUITAR_PICK = [0, 2, 3, 4, 1, 3, 2, 4];

const DJ_ROOTS = [33, 29, 36, 31]; // A1, F1, C2, G1
const DJ_STABS = [[57, 60, 64], [53, 57, 60], [55, 60, 64], [55, 59, 62]];

const JAZZ_TONES = [
  [38, 41, 45, 48], // Dm7
  [43, 47, 50, 53], // G7
  [36, 40, 43, 47], // Cmaj7
  [45, 49, 52, 55], // A7
];
const SAX_SCALE = [60, 62, 63, 64, 67, 69, 70, 72, 74, 75, 76, 79]; // C blues/bebop karışımı
// İki ölçülük motifler (8'lik notalar; null = es)
const SAX_MOTIFS = [
  [0, 1, 3, 4, 3, 1, 0, null, 4, null, 7, null, 5, 4, 3, null],
  [null, 3, 4, 5, 7, 5, 4, 3, 1, null, 0, 1, 3, null, null, null],
  [7, null, 5, 4, 2, 3, 4, null, 7, 8, 7, 5, 4, 1, 0, null],
  [0, null, 0, 1, 3, null, 3, 4, 5, null, null, 8, 7, 5, 4, null],
  [4, 5, 7, 9, 10, 9, 7, null, 5, 4, 3, 1, 0, null, null, null],
];

const ACTS = {
  guitar: {
    gain: 0.9,
    steps: 2, // vuruş başına adım (8'lik)
    stepTime(k, beat) { return k * beat / 2; },
    play(m, k, t) {
      const bar = Math.floor(k / 8);
      const s = k % 8;
      const chord = GUITAR_CHORDS[bar % 4];
      const note = chord[GUITAR_PICK[s]];
      m.pluck(t, midi(note), s === 0 ? 1.6 : 1.1, s === 0 ? 0.32 : 0.2);
      // Her 4. ölçünün sonunda kısa tıngırdatma
      if (bar % 4 === 3 && s === 6) for (let i = 1; i < 5; i++) m.pluck(t + i * 0.018, midi(chord[i]), 0.9, 0.12);
      // Ara sıra üstte bir melodi notası
      if ((s === 0 || s === 5) && hash(k * 7 + 3) < 0.45) m.pluck(t, midi(chord[4] + (hash(k) < 0.5 ? 5 : 7)), 1.0, 0.1);
    },
  },
  dj: {
    gain: 0.75,
    steps: 4, // 16'lık
    stepTime(k, beat) { return k * beat / 4; },
    play(m, k, t, sd) {
      const bar = Math.floor(k / 16);
      const s = k % 16;
      const sec = Math.floor(bar / 8) % 4; // 8 ölçülük bölüm
      const ch = bar % 4;
      const drop = bar % 16 === 15 && s >= 8; // her 16 ölçüde yarım ölçü boşluk
      if (s % 4 === 0 && !drop) m.kick(t, 0.95);
      if ((s === 4 || s === 12) && !drop) m.clap(t, 0.32);
      if (s % 4 === 2) m.hat(t, 0.16, true);
      else if (sec >= 1 && s % 2 === 1) m.hat(t, 0.05, false);
      if (s % 4 === 2 || (s === 15 && hash(bar) < 0.5)) m.bassSynth(t, midi(DJ_ROOTS[ch] + (s === 15 ? 12 : 0)), sd * 1.6, 0.36);
      if ((sec === 1 || sec === 3) && (s === 6 || s === 14)) m.stab(t, DJ_STABS[ch].map((n) => midi(n)), 0.13);
      if (sec >= 2) {
        const arp = DJ_STABS[ch];
        m.pluck(t, midi(arp[s % 3] + 12 + (s % 8 >= 6 ? 12 : 0)), 0.22, 0.07, 'sawtooth');
      }
    },
  },
  jazz: {
    gain: 0.85,
    steps: 2, // swing 8'lik
    stepTime(k, beat) { return Math.floor(k / 2) * beat + (k % 2 ? beat * 0.66 : 0); },
    play(m, k, t, sd) {
      const bar = Math.floor(k / 8);
      const s = k % 8;
      const ch = bar % 4;
      const tones = JAZZ_TONES[ch];
      const beat = sd * 2;
      // Yürüyen bas (dörtlükler)
      if (s % 2 === 0) {
        const i = s / 2;
        let note;
        if (i < 3) note = tones[i === 0 ? 0 : i === 1 ? (hash(bar * 4 + 1) < 0.5 ? 1 : 2) : (hash(bar * 4 + 2) < 0.5 ? 2 : 3)];
        else note = JAZZ_TONES[(ch + 1) % 4][0] + (hash(bar * 4 + 3) < 0.5 ? -1 : 1); // bir sonraki köke yarım ses yaklaşma
        m.walkBass(t, midi(note), beat * 0.95, 0.5);
      }
      // Ride: ding — ding-ga-ding
      if (s % 2 === 0 || s === 3 || s === 7) m.ride(t, s % 4 === 2 ? 0.2 : 0.14);
      if (s === 2 || s === 6) m.hat(t, 0.07, false);
      if (s % 2 === 1 && hash(k * 13) < 0.3) m.brush(t, 0.05);
      if (s === 0 && bar % 2 === 0) m.kick(t, 0.25);
      // Saksafon: 8 ölçünün 6'sında çalar, 2 ölçü bas + davula kalır
      if (bar % 8 < 6) {
        const phrase = Math.floor(bar / 2);
        const motif = SAX_MOTIFS[Math.floor(hash(phrase * 31 + 5) * SAX_MOTIFS.length)];
        const pos = (bar % 2) * 8 + s;
        const deg = motif[pos];
        if (deg !== null && deg !== undefined) {
          let len = 1;
          while (pos + len < motif.length && motif[pos + len] === null && len < 4) len++;
          const shift = hash(phrase * 7) < 0.5 ? 0 : 2;
          const idx = Math.min(SAX_SCALE.length - 1, deg + shift);
          m.sax(t, midi(SAX_SCALE[idx] - 12), len * sd * 1.05, 0.2);
        }
      }
    },
  },
};

export class StageMusic {
  constructor(sfx) {
    this.sfx = sfx;
    this.graph = null; // { ctx, bus, filter, master, panner }
    this.actId = null;
    this.setAt = 0;
    this.serverNow = null;
    this.timer = 0;
    this.nextStep = 0;
    this.offset = null; // ctx.currentTime − şarkı zamanı
    this.notes = 0; // planlanan nota sayısı (test / hata ayıklama)
    this.muffle = -1;
  }

  get playing() { return this.timer !== 0; }

  /** Ses grafiği (bağlam başına bir kez): bus → yankı → süzgeç → ana kazanç → panner → çıkış */
  ensureGraph(ctx) {
    if (this.graph?.ctx === ctx) return this.graph;
    const bus = ctx.createGain();
    // Dar sokak yankısı: kısa geri beslemeli gecikme
    const delay = ctx.createDelay(0.5);
    delay.delayTime.value = 0.17;
    const fb = ctx.createGain();
    fb.gain.value = 0.22;
    const wet = ctx.createGain();
    wet.gain.value = 0.28;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 16000;
    const master = ctx.createGain();
    master.gain.value = 0;
    const panner = ctx.createPanner();
    panner.panningModel = 'equalpower';
    panner.distanceModel = 'linear';
    panner.refDistance = 3;
    panner.maxDistance = STAGE.HEAR_RANGE;
    panner.rolloffFactor = 1;
    const [x, z] = STAGE.center;
    if (panner.positionX) {
      panner.positionX.value = x;
      panner.positionY.value = 1.8;
      panner.positionZ.value = z;
    } else {
      panner.setPosition(x, 1.8, z);
    }
    bus.connect(filter);
    bus.connect(delay);
    delay.connect(fb).connect(delay);
    delay.connect(wet).connect(filter);
    filter.connect(master).connect(panner).connect(ctx.destination);
    this.graph = { ctx, bus, filter, master, panner };
    return this.graph;
  }

  /**
   * Çalmaya başla ya da sürdür (aynı grup + aynı set ise yalnızca devam eder).
   * @returns {boolean} çalıyor mu (bağlam yoksa false)
   */
  start(actId, setAt, serverNow) {
    const ctx = this.sfx.ctx;
    if (!ctx || !ACTS[actId] || !STAGE_ACT_BY_ID[actId]) return false;
    const g = this.ensureGraph(ctx);
    if (this.playing && this.actId === actId && this.setAt === setAt) return true;
    this.stopTimer();
    this.actId = actId;
    this.setAt = setAt;
    this.serverNow = serverNow;
    this.offset = null;
    const act = ACTS[actId];
    const beat = 60 / STAGE_ACT_BY_ID[actId].bpm;
    const song = (serverNow() - setAt) / 1000;
    // İlk planlanacak adım: şu anki şarkı zamanından sonraki
    let k = Math.max(0, Math.floor((song / beat) * act.steps) - 1);
    while (act.stepTime(k, beat) < song) k++;
    this.nextStep = k;
    try { ctx.resume?.(); } catch { /* yok say */ }
    const now = ctx.currentTime;
    g.master.gain.cancelScheduledValues(now);
    g.master.gain.setValueAtTime(g.master.gain.value, now);
    g.master.gain.linearRampToValueAtTime(act.gain * 0.55, now + 0.6);
    this.tick();
    return true;
  }

  stop() {
    this.stopTimer();
    const g = this.graph;
    if (!g) return;
    const now = g.ctx.currentTime;
    g.master.gain.cancelScheduledValues(now);
    g.master.gain.setValueAtTime(g.master.gain.value, now);
    g.master.gain.linearRampToValueAtTime(0, now + 0.25);
  }

  stopTimer() {
    clearTimeout(this.timer);
    this.timer = 0;
  }

  /** AudioListener: oyuncunun konumu ve bakış yönü (yalnızca hareket edince çağrılır) */
  setListener(x, z, fx, fz) {
    const ctx = this.graph?.ctx;
    if (!ctx) return;
    const l = ctx.listener;
    if (l.positionX) {
      const t = ctx.currentTime;
      l.positionX.setValueAtTime(x, t);
      l.positionY.setValueAtTime(1.65, t);
      l.positionZ.setValueAtTime(z, t);
      l.forwardX.setValueAtTime(fx, t);
      l.forwardY.setValueAtTime(0, t);
      l.forwardZ.setValueAtTime(fz, t);
      l.upX.setValueAtTime(0, t);
      l.upY.setValueAtTime(1, t);
      l.upZ.setValueAtTime(0, t);
    } else {
      l.setPosition(x, 1.65, z);
      l.setOrientation(fx, 0, fz, 0, 1, 0);
    }
  }

  /** 0: açık hava · 1: ev içi (duvar arkası, boğuk) */
  setMuffle(level) {
    if (this.muffle === level || !this.graph) return;
    this.muffle = level;
    const { filter, ctx } = this.graph;
    const t = ctx.currentTime;
    filter.frequency.cancelScheduledValues(t);
    filter.frequency.setTargetAtTime(level ? 420 : 16000, t, 0.08);
  }

  tick() {
    const g = this.graph;
    const act = ACTS[this.actId];
    if (!g || !act) return;
    const ctx = g.ctx;
    this.sfx.keepAwake(TICK_MS * 6); // Sfx bağlamı çalarken askıya alınmasın
    const beat = 60 / STAGE_ACT_BY_ID[this.actId].bpm;
    const song = (this.serverNow() - this.setAt) / 1000;
    const off = ctx.currentTime - song;
    // Saat titremesini yut: yalnızca 40 ms'den büyük kaymada yeniden hizala
    if (this.offset === null || Math.abs(off - this.offset) > 0.04) this.offset = off;
    const sd = beat / act.steps;
    for (;;) {
      const st = act.stepTime(this.nextStep, beat);
      if (st > song + LOOKAHEAD) break;
      if (st >= song - 0.05) {
        try {
          act.play(this, this.nextStep, Math.max(ctx.currentTime, st + this.offset), sd);
        } catch { /* tek nota hatası çalmayı durdurmasın */ }
      }
      this.nextStep++;
    }
    this.timer = setTimeout(() => this.tick(), TICK_MS);
  }

  // ---- Enstrümanlar (her nota kısa ömürlü düğümler) ------------------------------------------

  env(gainNode, t, peak, attack, dur) {
    const g = gainNode.gain;
    g.setValueAtTime(0.0001, t);
    g.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t + attack);
    g.exponentialRampToValueAtTime(0.0001, t + dur);
  }

  /** Telli çalgı: üçgen + oktav sinüs, parlaklığı hızla sönen alçak geçiren */
  pluck(t, f, dur, vol, type = 'triangle') {
    const { ctx, bus } = this.graph;
    this.notes++;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = f;
    const o2 = ctx.createOscillator();
    o2.type = 'sine';
    o2.frequency.value = f * 2;
    const g2 = ctx.createGain();
    g2.gain.value = 0.3;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(type === 'sawtooth' ? 2600 : 3400, t);
    lp.frequency.exponentialRampToValueAtTime(type === 'sawtooth' ? 700 : 900, t + Math.min(0.35, dur));
    const g = ctx.createGain();
    this.env(g, t, vol, 0.004, dur);
    o.connect(lp);
    o2.connect(g2).connect(lp);
    lp.connect(g).connect(bus);
    o.start(t);
    o2.start(t);
    o.stop(t + dur + 0.05);
    o2.stop(t + dur + 0.05);
  }

  kick(t, vol) {
    const { ctx, bus } = this.graph;
    this.notes++;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(44, t + 0.12);
    const g = ctx.createGain();
    this.env(g, t, vol, 0.003, 0.34);
    o.connect(g).connect(bus);
    o.start(t);
    o.stop(t + 0.4);
  }

  noise(t, dur, type, freq, q, vol, attack = 0.002) {
    const { ctx, bus } = this.graph;
    this.notes++;
    const src = this.sfx.noiseSource(ctx, t, dur);
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    this.env(g, t, vol, attack, dur);
    src.connect(f).connect(g).connect(bus);
    return g;
  }

  hat(t, vol, open) { this.noise(t, open ? 0.16 : 0.045, 'highpass', 7200, 0.7, vol); }

  clap(t, vol) {
    const g = this.noise(t, 0.2, 'bandpass', 1300, 0.9, vol);
    // Üç hızlı vuruş (el çırpma)
    g.gain.setValueAtTime(vol * 0.6, t + 0.011);
    g.gain.setValueAtTime(vol, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
  }

  brush(t, vol) { this.noise(t, 0.12, 'bandpass', 2600, 0.6, vol, 0.01); }

  ride(t, vol) {
    this.noise(t, 0.45, 'bandpass', 6800, 1.4, vol);
    const { ctx, bus } = this.graph;
    const o = ctx.createOscillator();
    o.type = 'square';
    o.frequency.value = 3150;
    const g = ctx.createGain();
    this.env(g, t, vol * 0.08, 0.002, 0.3);
    o.connect(g).connect(bus);
    o.start(t);
    o.stop(t + 0.32);
  }

  bassSynth(t, f, dur, vol) {
    const { ctx, bus } = this.graph;
    this.notes++;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = f;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 7;
    lp.frequency.setValueAtTime(1300, t);
    lp.frequency.exponentialRampToValueAtTime(220, t + dur);
    const g = ctx.createGain();
    this.env(g, t, vol, 0.005, dur);
    o.connect(lp).connect(g).connect(bus);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  stab(t, freqs, vol) {
    const { ctx, bus } = this.graph;
    this.notes++;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1900;
    const g = ctx.createGain();
    this.env(g, t, vol, 0.004, 0.24);
    lp.connect(g).connect(bus);
    for (const f of freqs) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      o.connect(lp);
      o.start(t);
      o.stop(t + 0.28);
    }
  }

  walkBass(t, f, dur, vol) {
    const { ctx, bus } = this.graph;
    this.notes++;
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.value = f;
    const o2 = ctx.createOscillator();
    o2.type = 'sine';
    o2.frequency.value = f;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 850;
    const g = ctx.createGain();
    this.env(g, t, vol, 0.01, dur);
    o.connect(lp);
    o2.connect(lp);
    lp.connect(g).connect(bus);
    o.start(t);
    o2.start(t);
    o.stop(t + dur + 0.05);
    o2.stop(t + dur + 0.05);
  }

  /** Saksafon benzeri: iki testere dalgası → açılan alçak geçiren, vibrato */
  sax(t, f, dur, vol) {
    const { ctx, bus } = this.graph;
    this.notes++;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = f;
    const o2 = ctx.createOscillator();
    o2.type = 'triangle';
    o2.frequency.value = f * 1.004;
    const vib = ctx.createOscillator();
    vib.frequency.value = 5.3;
    const depth = ctx.createGain();
    depth.gain.setValueAtTime(0, t);
    depth.gain.linearRampToValueAtTime(f * 0.007, t + Math.min(0.25, dur));
    vib.connect(depth);
    depth.connect(o.frequency);
    depth.connect(o2.frequency);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 2.2;
    lp.frequency.setValueAtTime(700, t);
    lp.frequency.linearRampToValueAtTime(2100, t + 0.06);
    lp.frequency.linearRampToValueAtTime(1500, t + dur);
    const g = ctx.createGain();
    const gg = g.gain;
    gg.setValueAtTime(0.0001, t);
    gg.exponentialRampToValueAtTime(vol, t + 0.045);
    gg.setValueAtTime(vol, t + Math.max(0.05, dur - 0.07));
    gg.exponentialRampToValueAtTime(0.0001, t + dur + 0.04);
    o.connect(lp);
    o2.connect(lp);
    lp.connect(g).connect(bus);
    const end = t + dur + 0.08;
    for (const x of [o, o2, vib]) {
      x.start(t);
      x.stop(end);
    }
  }
}
