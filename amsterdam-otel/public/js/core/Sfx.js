// Paylaşılan WebAudio ses sentezi (ses dosyası yok — indirme ve bellek yükü sıfır).
// Kıkırdama (trip) ve bar sesleri: dökme, çalkalama, ısırma, bardak tınlaması,
// yıkama, bahşiş. Ses açık/kapalı kontrolünü (settings.sound) ÇAĞIRAN yapar.
//
// Pil: AudioContext yalnızca bir ses çalarken açık kalır; son sesin bitişinden
// kısa süre sonra askıya alınır. Askıya alma zamanı "en geç biten ses"e göre
// tutulur (busyUntil = max(...)) — kısa bir tınlama uzun bir dökme sesini kesmez.

const rand = (a, b) => a + Math.random() * (b - a);
const NOISE_SEC = 1.0; // bir kez üretilen beyaz gürültü (döngüyle uzatılır)
const TAIL_MS = 400; // son sesten sonra askıya almadan önce bekleme

export class Sfx {
  constructor() {
    this.ctx = null;
    this.timer = 0;
    this.busyUntil = 0; // performance.now() cinsinden
    this.noise = null;
  }

  /** Kullanıcı hareketi (Oyna tıklaması) içinde çağrılmalı (iOS/Chrome kilidi) */
  unlock() {
    try {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        this.ctx = new AC();
      }
      this.ctx.resume?.();
      this.keepAwake(300);
    } catch { /* ses yok */ }
  }

  /** Bağlamı en az ms boyunca açık tut; daha erken biten bir istek zamanlayıcıyı kısaltmaz */
  keepAwake(ms) {
    const now = performance.now();
    const until = now + ms;
    if (until <= this.busyUntil) return;
    this.busyUntil = until;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.busyUntil = 0;
      this.ctx?.suspend?.();
    }, ms);
  }

  /** Çalmaya hazır bağlam (unlock edilmemişse null → sessiz) */
  begin(ms) {
    const ctx = this.ctx;
    if (!ctx) return null;
    try {
      ctx.resume?.();
    } catch { /* yok say */ }
    this.keepAwake(ms + TAIL_MS);
    return ctx;
  }

  noiseBuffer(ctx) {
    if (!this.noise) {
      const n = Math.floor(ctx.sampleRate * NOISE_SEC);
      this.noise = ctx.createBuffer(1, n, ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    }
    return this.noise;
  }

  /** Döngülü gürültü kaynağı (t'de başlar, t + sec'te durur) */
  noiseSource(ctx, t, sec) {
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer(ctx);
    src.loop = true;
    src.loopStart = 0;
    src.loopEnd = NOISE_SEC;
    src.start(t, Math.random() * NOISE_SEC * 0.9);
    src.stop(t + sec + 0.05);
    return src;
  }

  output(ctx, volume) {
    const out = ctx.createGain();
    out.gain.value = volume;
    out.connect(ctx.destination);
    return out;
  }

  /** Kısa bir sinüs/üçgen "ping" (zarf: hızlı atak, üstel sönüm) */
  ping(ctx, dest, t, freq, dur, peak = 0.8, type = 'sine') {
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(dest);
    osc.start(t);
    osc.stop(t + dur + 0.02);
    return osc;
  }

  // ---- Sesler ------------------------------------------------------------------

  /** Trip kıkırdaması (eski GiggleSynth.play) */
  giggle() {
    const n = 4 + Math.floor(Math.random() * 3);
    const ctx = this.begin(n * 160 + 200);
    if (!ctx) return;
    const t0 = ctx.currentTime + 0.03;
    const base = rand(300, 420);
    const out = this.output(ctx, 0.22);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2400;
    lp.connect(out);
    for (let i = 0; i < n; i++) {
      const t = t0 + i * rand(0.12, 0.16);
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(base * (1.3 - i * 0.05), t);
      osc.frequency.exponentialRampToValueAtTime(base * (0.85 - i * 0.04), t + 0.1);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.9, t + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.11);
      osc.connect(g).connect(lp);
      osc.start(t);
      osc.stop(t + 0.12);
    }
  }

  /** Dökme: gürültü → bant geçiren süpürme (bardak doldukça perde yükselir) + hafif lıkırtı */
  pour(durMs = 1500) {
    const sec = Math.max(0.2, durMs / 1000);
    const ctx = this.begin(durMs);
    if (!ctx) return;
    const t = ctx.currentTime + 0.02;
    const out = this.output(ctx, 0.0001);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 5;
    bp.frequency.setValueAtTime(480, t);
    bp.frequency.exponentialRampToValueAtTime(1900, t + sec);
    this.noiseSource(ctx, t, sec).connect(bp).connect(out);
    // Zarf: yumuşak giriş, akış, kısa sönüm
    const g = out.gain;
    g.setValueAtTime(0.0001, t);
    g.exponentialRampToValueAtTime(0.32, t + 0.12);
    g.setValueAtTime(0.32, t + sec * 0.8);
    g.exponentialRampToValueAtTime(0.0001, t + sec);
    // Lıkırtı: genliği ~9 Hz'de hafifçe dalgalandır
    const lfo = ctx.createOscillator();
    lfo.frequency.value = rand(8, 11);
    const depth = ctx.createGain();
    depth.gain.value = 0.08;
    lfo.connect(depth).connect(g);
    lfo.start(t);
    lfo.stop(t + sec);
  }

  /** Çalkalama: yüksek geçiren gürültü darbeleri (ritmik) + rastgele buz şıngırtıları */
  shake(durMs = 1400) {
    const sec = Math.max(0.2, durMs / 1000);
    const ctx = this.begin(durMs);
    if (!ctx) return;
    const t = ctx.currentTime + 0.02;
    const out = this.output(ctx, 0.3);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 2600;
    const env = ctx.createGain();
    env.gain.value = 0.0001;
    this.noiseSource(ctx, t, sec).connect(hp).connect(env).connect(out);
    const beat = 0.105; // ~5 sallama/sn → saniyede ~10 vuruş (yukarı + aşağı)
    const n = Math.max(1, Math.floor(sec / beat));
    for (let i = 0; i < n; i++) {
      const bt = t + i * beat;
      const peak = i % 2 ? 0.55 : 0.9;
      env.gain.setValueAtTime(0.0001, bt);
      env.gain.exponentialRampToValueAtTime(peak, bt + 0.008);
      env.gain.exponentialRampToValueAtTime(0.0001, bt + 0.075);
      if (Math.random() < 0.6) this.ping(ctx, out, bt + rand(0, 0.02), rand(2300, 4200), 0.06, 0.18);
    }
  }

  /** Isırma: birkaç kısa çıtırtı patlaması */
  bite() {
    const ctx = this.begin(260);
    if (!ctx) return;
    const t0 = ctx.currentTime + 0.01;
    const out = this.output(ctx, 0.5);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = rand(1600, 2600);
    bp.Q.value = 1.2;
    bp.connect(out);
    const env = ctx.createGain();
    env.gain.value = 0.0001;
    env.connect(bp);
    this.noiseSource(ctx, t0, 0.22).connect(env);
    let t = t0;
    const n = 3 + Math.floor(Math.random() * 2);
    for (let i = 0; i < n; i++) {
      const peak = 0.9 - i * 0.15;
      env.gain.setValueAtTime(0.0001, t);
      env.gain.exponentialRampToValueAtTime(peak, t + 0.004);
      env.gain.exponentialRampToValueAtTime(0.0001, t + rand(0.025, 0.045));
      t += rand(0.035, 0.06);
    }
  }

  /** Bardak tınlaması: iki uyumsuz kısmi ton + kısa vuruş geçişi */
  clink() {
    const ctx = this.begin(500);
    if (!ctx) return;
    const t = ctx.currentTime + 0.01;
    const out = this.output(ctx, 0.2);
    const f = rand(1900, 2400);
    this.ping(ctx, out, t, f, 0.4, 0.7);
    this.ping(ctx, out, t, f * 2.76, 0.22, 0.3);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 4000;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.5, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.02);
    this.noiseSource(ctx, t, 0.03).connect(hp).connect(g).connect(out);
  }

  /** Yıkama: alçak geçiren, süzgeci dalgalanan su hışırtısı + köpük "blop"ları */
  wash(durMs = 2200) {
    const sec = Math.max(0.2, durMs / 1000);
    const ctx = this.begin(durMs);
    if (!ctx) return;
    const t = ctx.currentTime + 0.02;
    const out = this.output(ctx, 0.0001);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1100;
    lp.Q.value = 2;
    this.noiseSource(ctx, t, sec).connect(lp).connect(out);
    // Ovma: süzgeç frekansı ~3 Hz'de gidip gelir
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 3.2;
    const depth = ctx.createGain();
    depth.gain.value = 500;
    lfo.connect(depth).connect(lp.frequency);
    lfo.start(t);
    lfo.stop(t + sec);
    const g = out.gain;
    g.setValueAtTime(0.0001, t);
    g.exponentialRampToValueAtTime(0.22, t + 0.15);
    g.setValueAtTime(0.22, t + sec * 0.85);
    g.exponentialRampToValueAtTime(0.0001, t + sec);
    // Köpük baloncukları: yukarı süpüren kısa tonlar
    const bubbles = ctx.createGain();
    bubbles.gain.value = 0.12;
    bubbles.connect(ctx.destination);
    const n = Math.floor(sec * 5);
    for (let i = 0; i < n; i++) {
      const bt = t + rand(0.1, sec - 0.1);
      const osc = this.ping(ctx, bubbles, bt, rand(380, 600), 0.05, 0.6);
      osc.frequency.exponentialRampToValueAtTime(rand(900, 1400), bt + 0.045);
    }
  }

  /** Bahşiş: iki notalı parlak "çın-çın" */
  coin() {
    const ctx = this.begin(500);
    if (!ctx) return;
    const t = ctx.currentTime + 0.01;
    const out = this.output(ctx, 0.13);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 5000;
    lp.connect(out);
    this.ping(ctx, lp, t, 988, 0.12, 0.8, 'square'); // B5
    this.ping(ctx, lp, t + 0.08, 1319, 0.34, 0.8, 'square'); // E6
  }
}
