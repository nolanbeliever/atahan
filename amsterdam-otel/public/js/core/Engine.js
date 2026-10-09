import * as THREE from 'three';

// Hiçbir sistem aktif değilse bu kadar "zamanı gelmiş" kare sonra döngü uyur.
const IDLE_FRAMES_BEFORE_SLEEP = 8;
// Uyarlanabilir kalite: bu kadar karelik pencerede ortalama kare aralığı
// hedefin DEGRADE_RATIO katını aşarsa kalite bir kademe düşürülür.
const PERF_WINDOW = 90;
const DEGRADE_RATIO = 1.35;

/**
 * Render motoru ve TEK requestAnimationFrame döngüsü.
 *
 * Pil / ısınma koruması:
 *  - FPS sınırı (30/60): ekran 60/90/120 Hz olsa bile yalnızca sınır kadar
 *    kare çizilir; aradaki rAF çağrıları hiçbir iş yapmadan döner.
 *  - Uyku modu: oyuncu durur, misafirler yürümez, animasyon yoksa rAF
 *    döngüsü tamamen DURUR. Girdi / ağ olayı `wake()` ile döngüyü uyandırır.
 *  - Sekme gizlenince, oyun duraklatılınca ya da WebGL bağlamı kaybolunca
 *    hiçbir kare istenmez.
 *  - Gölgeler statiktir: gölge haritası yalnızca bir kez (ya da istek
 *    üzerine) çizilir, her karede değil.
 *  - Uyarlanabilir kalite: cihaz hedef FPS'i tutturamazsa önce render
 *    ölçeği, sonra gölgeler, en son doku çözünürlüğü düşürülür.
 */
export class Engine {
  constructor({ canvas, device, quality, fpsCap }) {
    this.canvas = canvas;
    this.device = device;
    this.quality = quality;

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: quality.antialias,
      alpha: false,
      stencil: false,
      depth: true,
      preserveDrawingBuffer: false,
      powerPreference: device.touch ? 'low-power' : 'default',
    });

    // Mobil/tablette render ölçeği 1.0 ile sınırlı (Settings.resolveQuality)
    this.maxPixelRatio = Math.min(device.dpr, quality.pixelRatioCap);
    this.minPixelRatio = Math.max(0.5, this.maxPixelRatio * 0.6);
    this.pixelRatio = this.maxPixelRatio;

    const shadows = quality.shadowSize > 0;
    this.renderer.shadowMap.enabled = shadows;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.shadowMap.autoUpdate = false; // statik gölge
    this.renderer.shadowMap.needsUpdate = shadows;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(device.phone ? 75 : 70, 1, 0.05, 90);
    this.camera.rotation.order = 'YXZ';

    this.systems = [];
    this.userFpsCap = fpsCap;
    this.batterySaver = false;
    this.running = false;
    this.paused = false;
    this.contextLost = false;
    this.rafId = 0;
    this.lastFrame = 0;
    this.lastRender = 0;
    this.resumed = true;
    this.idleFrames = 0;
    this.dirty = true;
    this.renderedFrames = 0;
    this.perf = { sum: 0, n: 0 };
    this.texturesReduced = false;
    this.onDegrade = null;
    // İsteğe bağlı son işlem (trip efektleri): { render(), setSize(w, h, pixelRatio) }
    this.post = null;

    this._frame = this._frame.bind(this);

    let resizeTimer = 0;
    const onResize = () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => this.resize(), 120);
    };
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) this.requestRender();
    });
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.contextLost = true;
    });
    canvas.addEventListener('webglcontextrestored', () => {
      this.contextLost = false;
      this.renderer.shadowMap.needsUpdate = this.renderer.shadowMap.enabled;
      this.requestRender();
    });

    this.resize();
  }

  get fpsCap() { return this.batterySaver ? Math.min(30, this.userFpsCap) : this.userFpsCap; }
  get frameInterval() { return 1000 / this.fpsCap; }
  get sleeping() { return this.rafId === 0; }

  setFpsCap(fps) {
    this.userFpsCap = fps;
    this.resetPerf();
    this.requestRender();
  }

  /** Düşük pil + şarjda değil: FPS 30'a kilitlenir */
  setBatterySaver(on) {
    if (this.batterySaver === on) return;
    this.batterySaver = on;
    this.resetPerf();
  }

  resetPerf() {
    this.perf.sum = 0;
    this.perf.n = 0;
    this.resumed = true;
  }

  /** @param {(dt:number, now:number) => boolean} fn  aktifse true döner */
  addSystem(fn) { this.systems.push(fn); }

  start() {
    this.running = true;
    this.requestRender();
  }

  setPaused(paused) {
    this.paused = paused;
    if (!paused) this.requestRender();
  }

  requestRender() {
    this.dirty = true;
    this.wake();
  }

  /** Döngüden bağımsız tek kare (ör. menü arka planı) */
  renderOnce() {
    if (this.contextLost) return;
    this.draw();
    this.renderedFrames++;
  }

  /** Son işlem etkinse onunla, değilse doğrudan çizer */
  draw() {
    if (this.post) this.post.render();
    else this.renderer.render(this.scene, this.camera);
  }

  /** Son işlemciyi tak/çıkar (null → doğrudan render, ekstra GPU geçişi yok) */
  setPostProcessor(post) {
    this.post = post;
    if (post) post.setSize(window.innerWidth, window.innerHeight, this.pixelRatio);
    this.requestRender();
  }

  requestShadowUpdate() {
    if (!this.renderer.shadowMap.enabled) return;
    this.renderer.shadowMap.needsUpdate = true;
    this.requestRender();
  }

  canRun() {
    return this.running && !this.paused && !document.hidden && !this.contextLost;
  }

  /** Döngü uyuyorsa yeniden başlatır (girdi ve ağ olayları çağırır) */
  wake() {
    this.idleFrames = 0;
    if (this.rafId || !this.canRun()) return;
    this.lastFrame = performance.now() - this.frameInterval;
    this.resumed = true;
    this.rafId = requestAnimationFrame(this._frame);
  }

  _frame(now) {
    this.rafId = 0;
    if (!this.canRun()) return;

    const interval = this.frameInterval;
    const elapsed = now - this.lastFrame;
    if (elapsed < interval - 2) {
      // FPS sınırı: bu ekran yenilemesini atla
      this.rafId = requestAnimationFrame(this._frame);
      return;
    }
    this.lastFrame = elapsed > interval * 3 ? now : now - (elapsed % interval);

    const dt = Math.min(elapsed, 100) / 1000;
    let active = false;
    for (let i = 0; i < this.systems.length; i++) {
      if (this.systems[i](dt, now)) active = true;
    }

    if (active || this.dirty) {
      this.dirty = false;
      this.draw();
      this.renderedFrames++;
      this.trackPerf(now);
      this.idleFrames = 0;
    } else {
      this.idleFrames++;
      this.resumed = true;
    }

    if (this.idleFrames < IDLE_FRAMES_BEFORE_SLEEP) {
      this.rafId = requestAnimationFrame(this._frame);
    }
    // aksi halde: uyku — wake() çağrılana kadar hiç rAF istenmez
  }

  trackPerf(now) {
    if (this.resumed) {
      this.resumed = false;
      this.lastRender = now;
      return;
    }
    this.perf.sum += now - this.lastRender;
    this.perf.n++;
    this.lastRender = now;
    if (this.perf.n < PERF_WINDOW) return;
    const avg = this.perf.sum / this.perf.n;
    this.perf.sum = 0;
    this.perf.n = 0;
    if (avg > this.frameInterval * DEGRADE_RATIO) this.degrade(avg);
  }

  degrade(avgMs) {
    let step;
    if (this.pixelRatio > this.minPixelRatio + 0.01) {
      this.pixelRatio = Math.max(this.minPixelRatio, Math.round(this.pixelRatio * 0.85 * 100) / 100);
      this.resize();
      step = `render ölçeği ${this.pixelRatio}`;
    } else if (this.renderer.shadowMap.enabled) {
      this.setShadowsEnabled(false);
      step = 'gölgeler kapatıldı';
    } else if (!this.texturesReduced && this.onDegrade) {
      this.texturesReduced = true;
      this.onDegrade('textures');
      step = 'doku çözünürlüğü yarıya indirildi';
    } else {
      return;
    }
    console.info(`[Motor] Ortalama kare ${avgMs.toFixed(1)} ms → ${step}`);
  }

  setShadowsEnabled(on) {
    this.renderer.shadowMap.enabled = on;
    this.renderer.shadowMap.needsUpdate = on;
    // Gölge değişince shader'ların yeniden derlenmesi gerekir
    this.scene.traverse((o) => {
      if (!o.material) return;
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) m.needsUpdate = true;
    });
    this.requestRender();
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(w, h, false);
    this.post?.setSize(w, h, this.pixelRatio);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.requestRender();
  }
}
