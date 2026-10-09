import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { TRIP } from '/shared/constants.js';
import { areaAt } from '/shared/layout.js';

const FADE_IN = 2.0; // sn
const FADE_OUT = 2.5;
const rand = (a, b) => a + Math.random() * (b - a);

// Tek tam ekran geçişte: doygunluk + parlaklık + vignette + dalgalanma.
// Render hedefi 8-bit sRGB (HalfFloat yerine) → mobilde yarı bant genişliği.
const TripShader = {
  name: 'TripShader',
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uSaturation: { value: 1 },
    uBrightness: { value: 1 },
    uVignette: { value: 0 },
    uWave: { value: 0 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uSaturation;
    uniform float uBrightness;
    uniform float uVignette;
    uniform float uWave;
    varying vec2 vUv;
    void main() {
      vec2 uv = vUv;
      if (uWave > 0.001) {
        uv += vec2(sin(uv.y * 14.0 + uTime * 1.6), cos(uv.x * 11.0 + uTime * 1.2)) * 0.0045 * uWave;
      }
      vec4 c = texture2D(tDiffuse, uv);
      float l = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
      c.rgb = max(mix(vec3(l), c.rgb, uSaturation), 0.0) * uBrightness;
      if (uVignette > 0.001) {
        float d = length((vUv - 0.5) * vec2(1.15, 1.0));
        float v = smoothstep(0.3, 0.78, d) * uVignette;
        c.rgb = mix(c.rgb, vec3(0.22, 0.0, 0.015), v);
      }
      gl_FragColor = c;
      #include <colorspace_fragment>
    }`,
};

const GIGGLE_LINES = [
  'Hahaha! Duvar kâğıdı bana göz kırptı 😂',
  'Laleler neden bu kadar güzel?!',
  'Bisikletler… iki tekerlekli. NEDEN? 🤯',
  'Yatak düzeltmek hiç bu kadar eğlenceli olmamıştı!',
  'Kanal bana el salladı 👋',
  'Hihihi… peynir! 🧀',
  'Bu otelin adı neden Lale? …OHHH! 🌷',
  'Her şey çok parlak ve çok güzel ✨',
  'Resepsiyondaki adam aslında bir yel değirmeni mi?',
  'Kahkahamı durduramıyorum, yardım edin 🤣',
];

// ---------------------------------------------------------------------------
// Sentezlenmiş kıkırdama (ses dosyası yok). AudioContext yalnızca çalarken
// açık kalır, sonra askıya alınır (boşta CPU/pil harcamaz).
class GiggleSynth {
  constructor() {
    this.ctx = null;
    this.timer = 0;
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
      this.suspendLater(300);
    } catch { /* ses yok */ }
  }

  suspendLater(ms) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.ctx?.suspend?.(), ms);
  }

  play() {
    const ctx = this.ctx;
    if (!ctx) return;
    ctx.resume?.();
    const t0 = ctx.currentTime + 0.03;
    const base = rand(300, 420);
    const n = 4 + Math.floor(Math.random() * 3);
    const out = ctx.createGain();
    out.gain.value = 0.22;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2400;
    lp.connect(out).connect(ctx.destination);
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
    this.suspendLater(n * 160 + 600);
  }
}

// ---------------------------------------------------------------------------

function makeSplatterImage() {
  const c = document.createElement('canvas');
  c.width = 640;
  c.height = 360;
  const ctx = c.getContext('2d');
  for (let i = 0; i < 26; i++) {
    const edge = Math.random() < 0.7;
    const x = edge ? (Math.random() < 0.5 ? rand(0, 140) : rand(500, 640)) : rand(120, 520);
    const y = edge ? rand(0, 360) : rand(220, 360);
    const r = rand(14, 70);
    const g = ctx.createRadialGradient(x, y, r * 0.1, x, y, r);
    g.addColorStop(0, 'rgba(150,0,18,0.95)');
    g.addColorStop(0.7, 'rgba(110,0,12,0.85)');
    g.addColorStop(1, 'rgba(90,0,10,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    if (Math.random() < 0.5) {
      ctx.fillStyle = 'rgba(120,0,14,0.85)';
      const w = rand(3, 8);
      ctx.fillRect(x - w / 2, y, w, rand(30, 110));
    }
  }
  return c.toDataURL('image/png');
}

function makeHahaTexture() {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fffbea';
  ctx.strokeStyle = '#1b1b1b';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.ellipse(128, 56, 118, 48, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(90, 98);
  ctx.lineTo(70, 124);
  ctx.lineTo(116, 102);
  ctx.fill();
  ctx.fillStyle = '#d7263d';
  ctx.font = '900 46px "Comic Sans MS", Impact, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('HA HA HA!', 128, 58);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Trip efektleri.
 *
 * KİŞİYE ÖZEL (yalnızca bu istemci): renk/vignette/dalga shader'ı, kamera
 * sallanması, halüsinasyon hayaletleri, baloncuklar, kıkırdama sesi, kan
 * sıçraması. Diğer oyunculara yalnızca kıkırdama/kusma "emote"u gider; onlar
 * bu oyuncunun karakterinde animasyon görür (bkz. playRemoteEmote).
 *
 * Pil: Son işlem (EffectComposer) yalnızca trip sürerken takılır, bitince
 * çıkarılıp render hedefleri serbest bırakılır. İyi trip efektleri statiktir
 * (motor boştayken yine uyur). Kötü trip'te sallanma/dalga için FPS sınırında
 * sürekli çizim gerekir; "hareketi azalt" ayarı bunu da kapatır.
 */
export class TripEffects {
  constructor({ engine, player, collision, hud, net, remotes, settings }) {
    this.engine = engine;
    this.player = player;
    this.collision = collision;
    this.hud = hud;
    this.net = net;
    this.remotes = remotes;
    this.settings = settings;
    this.camera = engine.camera;
    this.baseFov = engine.camera.fov;

    this.kind = null; // ekranda gösterilen trip ('good' | 'bad'), sönerken de korunur
    this.endsAt = 0; // sunucu zamanı
    this.mix = 0;
    this.target = 0;
    this.fadeFrom = 0; // geçişler gerçek zamana bağlı (yavaş cihazda da süre aynı)
    this.fadeAt = 0;
    this.time = 0;
    this.composer = null;
    this.pass = null;
    this.cssFallback = false;
    this.eventTimer = 0;
    this.bannerTimer = 0;
    this.dipStart = -1;
    this.shakePitch = 0;
    this.nextVomitAt = 0;

    this.ghosts = [];
    this.remoteFx = [];
    this.audio = new GiggleSynth();
    this.bubbles = document.getElementById('trip-bubbles');
    this.splatter = document.getElementById('splatter');
    this.splatterReady = false;
    this.hahaMat = null;
    this.particleGeo = null;
    this.particleMat = null;
    this._dummy = new THREE.Object3D();
    this._v = new THREE.Vector3();
  }

  get active() { return this.kind !== null; }

  // ---- Trip yaşam döngüsü ------------------------------------------------------

  /** Sunucudan gelen kendi trip durumum ({type, endsAt} | null) */
  setSelfTrip(trip) {
    if (trip && trip.type) {
      if (this.kind === trip.type && this.target === 1) {
        this.endsAt = trip.endsAt;
        return;
      }
      this.begin(trip.type, trip.endsAt);
    } else if (this.target === 1) {
      this.end();
    }
  }

  begin(type, endsAt) {
    if (this.kind && this.kind !== type) this.reset();
    this.kind = type;
    this.endsAt = endsAt;
    this.startFade(1);
    this.time = 0;
    this.attachPost();
    this.player.speedMul = type === TRIP.BAD ? TRIP.BAD_SPEED : 1;
    this.nextVomitAt = performance.now() + rand(9000, 15000); // ilk olaylar hayalet olsun
    if (type === TRIP.GOOD) {
      this.hud.toast(`🌈 İyi trip! Dünya rengârenk. Şans bonusu: slot +%${Math.round((TRIP.SLOT_LUCK - 1) * 100)}, bahşiş +%${Math.round((TRIP.TIP_LUCK - 1) * 100)}`, 'clean');
    } else {
      this.hud.toast(`💀 Kötü trip… Yürüyüşün %${Math.round((1 - TRIP.BAD_SPEED) * 100)} yavaşladı. Gözlerine güvenme.`, 'warn');
    }
    this.scheduleEvent(rand(2500, 5000));
    clearInterval(this.bannerTimer);
    this.updateBanner();
    this.bannerTimer = setInterval(() => this.updateBanner(), 1000);
    this.engine.requestRender();
  }

  end() {
    this.startFade(0);
    this.player.speedMul = 1;
    clearTimeout(this.eventTimer);
    for (const g of this.ghosts) if (g.active) g.ttl = Math.min(g.ttl, g.life + 0.6);
    this.hud.toast('Etkisi geçti, kendine geliyorsun.', 'info');
    this.engine.requestRender();
  }

  /** Sönme tamamlanınca her şeyi temizle */
  reset() {
    clearTimeout(this.eventTimer);
    clearInterval(this.bannerTimer);
    this.kind = null;
    this.mix = 0;
    this.target = 0;
    this.player.speedMul = 1;
    for (const g of this.ghosts) {
      g.active = false;
      g.obj.visible = false;
    }
    this.player.viewOffset.pitch = 0;
    this.player.viewOffset.yaw = 0;
    this.player.viewOffset.roll = 0;
    this.player.apply();
    this.camera.fov = this.baseFov;
    this.camera.updateProjectionMatrix();
    this.hud.setTrip(null);
    this.detachPost();
    this.engine.requestRender();
  }

  startFade(target) {
    this.fadeFrom = this.mix;
    this.fadeAt = performance.now();
    this.target = target;
  }

  updateBanner() {
    if (!this.kind || this.target === 0) {
      clearInterval(this.bannerTimer);
      return;
    }
    const left = Math.max(0, Math.ceil((this.endsAt - this.net.serverNow()) / 1000));
    const mm = Math.floor(left / 60);
    const ss = String(left % 60).padStart(2, '0');
    this.hud.setTrip(this.kind, `${this.kind === TRIP.GOOD ? '🌈 İyi Trip' : '💀 Kötü Trip'} · ${mm}:${ss}`);
  }

  /** Kıkırdama / kusma / hayalet olayları — rAF yerine zamanlayıcı (motor uyurken de çalışır) */
  scheduleEvent(ms) {
    clearTimeout(this.eventTimer);
    this.eventTimer = setTimeout(() => this.fireEvent(), ms);
  }

  fireEvent() {
    if (this.target !== 1 || document.hidden || this.engine.paused) {
      if (this.target === 1) this.scheduleEvent(2000);
      return;
    }
    if (this.kind === TRIP.GOOD) {
      this.giggle();
      this.scheduleEvent(rand(8000, 15000));
    } else {
      // Kötü trip: çoğunlukla hayalet, arada bir kusma
      const now = performance.now();
      if (now >= this.nextVomitAt) {
        this.vomit();
        this.nextVomitAt = now + rand(18000, 30000);
      } else {
        this.spawnGhost();
      }
      this.scheduleEvent(rand(4500, 8000));
    }
  }

  // ---- Son işlem (post-processing) ---------------------------------------------

  attachPost() {
    if (this.composer) return;
    const r = this.engine.renderer;
    try {
      const size = r.getSize(new THREE.Vector2());
      const pr = this.engine.pixelRatio;
      const rt = new THREE.WebGLRenderTarget(size.x * pr, size.y * pr, {
        type: THREE.UnsignedByteType,
        colorSpace: THREE.SRGBColorSpace,
      });
      this.composer = new EffectComposer(r, rt);
      this.composer.addPass(new RenderPass(this.engine.scene, this.camera));
      this.pass = new ShaderPass(TripShader);
      this.composer.addPass(this.pass);
      this.cssFallback = false;
      this.engine.setPostProcessor(this);
    } catch (err) {
      console.warn('[Trip] Son işlem kullanılamıyor, CSS filtresine geçiliyor:', err);
      this.composer = null;
      this.cssFallback = true;
    }
  }

  detachPost() {
    if (this.composer) {
      this.engine.setPostProcessor(null);
      this.composer.dispose();
      this.pass.material.dispose();
      this.composer = null;
      this.pass = null;
    }
    if (this.cssFallback) {
      this.engine.canvas.style.filter = '';
      this.bubbles.style.background = '';
    }
  }

  /** Engine çağırır */
  render() { this.composer.render(); }

  /** Engine çağırır — mobilde pixelRatio ≤ 1.0 olduğundan efekt de o ölçekte çalışır */
  setSize(w, h, pixelRatio) {
    if (!this.composer) return;
    this.composer.setPixelRatio(pixelRatio);
    this.composer.setSize(w, h);
  }

  // ---- Kare güncellemesi -------------------------------------------------------

  /** @returns {boolean} sürekli çizim gerekiyor mu */
  update(dt) {
    let active = false;
    const now = performance.now();

    if (this.kind) {
      if (this.mix !== this.target) {
        const k = (now - this.fadeAt) / 1000 / (this.target ? FADE_IN : FADE_OUT);
        this.mix = this.target
          ? Math.min(1, this.fadeFrom + k)
          : Math.max(0, this.fadeFrom - k);
        active = true;
      }
      this.time += dt;
      const motion = !this.settings.reduceMotion;
      if (this.kind === TRIP.GOOD) this.applyGood();
      else if (this.applyBad(motion)) active = true;
      if (this.mix === 0 && this.target === 0) this.reset();
    }

    if (this.updateDip(now)) active = true;
    if (this.updateGhosts(dt)) active = true;
    if (this.updateRemote(dt)) active = true;
    return active;
  }

  setUniforms(sat, bright, vig, wave) {
    if (this.pass) {
      const u = this.pass.uniforms;
      u.uTime.value = this.time;
      u.uSaturation.value = sat;
      u.uBrightness.value = bright;
      u.uVignette.value = vig;
      u.uWave.value = wave;
    } else if (this.cssFallback) {
      this.engine.canvas.style.filter = `saturate(${sat.toFixed(2)}) brightness(${bright.toFixed(2)})`;
      this.bubbles.style.background = vig > 0.01
        ? `radial-gradient(ellipse at center, transparent 45%, rgba(60,0,4,${(0.8 * vig).toFixed(2)}) 100%)`
        : '';
    }
  }

  applyGood() {
    const m = this.mix;
    this.setUniforms(1 + 0.8 * m, 1 + 0.12 * m, 0, 0);
  }

  /** @returns {boolean} animasyon (sallanma/kalp atışı) sürüyor mu */
  applyBad(motion) {
    const m = this.mix;
    const t = this.time;
    let beat = 0.85;
    if (motion) {
      const ph = (t * 1.15) % 1;
      beat = 0.8 + 0.2 * (Math.exp(-ph * 10) + 0.6 * (ph > 0.2 ? Math.exp(-(ph - 0.2) * 10) : 0));
    }
    this.setUniforms(1 - 0.28 * m, 1 - 0.08 * m, m * beat, motion ? m : 0);

    const o = this.player.viewOffset;
    if (motion) {
      o.yaw = (Math.sin(t * 2.3) * 0.6 + Math.sin(t * 5.7) * 0.4) * 0.012 * m;
      o.roll = Math.sin(t * 1.3) * 0.02 * m;
      this.shakePitch = (Math.sin(t * 3.1) * 0.6 + Math.sin(t * 7.3) * 0.4) * 0.01 * m;
      this.camera.fov = this.baseFov + Math.sin(t * 0.9) * 2.2 * m;
    } else {
      o.yaw = 0;
      o.roll = 0;
      this.shakePitch = 0;
      this.camera.fov = this.baseFov;
    }
    this.camera.updateProjectionMatrix();
    o.pitch = this.shakePitch + this.dipPitch(performance.now());
    this.player.apply();
    return motion && m > 0;
  }

  // ---- İyi trip: baloncuk + kıkırdama ---------------------------------------------

  giggle() {
    this.net.emote('giggle');
    if (this.settings.sound) this.audio.play();
    const b = document.createElement('div');
    b.className = 'bubble';
    b.textContent = GIGGLE_LINES[Math.floor(Math.random() * GIGGLE_LINES.length)];
    const leftSide = Math.random() < 0.5;
    b.style.left = `${leftSide ? rand(6, 28) : rand(52, 70)}%`;
    b.style.top = `${rand(22, 52)}%`;
    this.bubbles.append(b);
    requestAnimationFrame(() => b.classList.add('show'));
    setTimeout(() => {
      b.classList.remove('show');
      setTimeout(() => b.remove(), 300);
    }, 3200);
  }

  // ---- Kötü trip: kusma + hayaletler ------------------------------------------------

  vomit() {
    this.net.emote('vomit');
    if (!this.splatterReady) {
      this.splatter.style.backgroundImage = `url(${makeSplatterImage()})`;
      this.splatterReady = true;
    }
    const s = this.splatter;
    s.classList.remove('fade');
    s.classList.add('show');
    setTimeout(() => {
      s.classList.remove('show');
      s.classList.add('fade');
    }, 450);
    this.player.stunUntil = performance.now() + 900;
    this.dipStart = performance.now();
    this.engine.wake();
  }

  dipPitch(now) {
    if (this.dipStart < 0) return 0;
    const k = (now - this.dipStart) / 900;
    if (k >= 1) return 0;
    return -0.42 * Math.sin(Math.PI * k);
  }

  updateDip(now) {
    if (this.dipStart < 0) return false;
    const dip = this.dipPitch(now);
    if (this.kind !== TRIP.BAD) {
      this.player.viewOffset.pitch = dip;
      this.player.apply();
    }
    if (now - this.dipStart >= 900) {
      this.dipStart = -1;
      this.player.viewOffset.pitch = this.kind === TRIP.BAD ? this.shakePitch || 0 : 0;
      this.player.apply();
    }
    return true;
  }

  ghostGeometry() {
    if (!this.ghostGeo) {
      const eyes = mergeGeometries([
        new THREE.SphereGeometry(0.03, 6, 4).translate(-0.06, 1.45, 0.15),
        new THREE.SphereGeometry(0.03, 6, 4).translate(0.06, 1.45, 0.15),
      ]);
      this.ghostGeo = {
        body: mergeGeometries([
          new THREE.CapsuleGeometry(0.26, 0.85, 3, 8).translate(0, 0.7, 0),
          new THREE.SphereGeometry(0.18, 10, 8).translate(0, 1.44, 0),
        ]),
        eyes,
      };
    }
    return this.ghostGeo;
  }

  getGhost() {
    let g = this.ghosts.find((x) => !x.active);
    if (g) return g;
    if (this.ghosts.length >= 3) return null;
    const geo = this.ghostGeometry();
    const mat = new THREE.MeshBasicMaterial({ color: 0x06060b, transparent: true, opacity: 0, depthWrite: false });
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xff2a2a, transparent: true, opacity: 0, depthWrite: false });
    const obj = new THREE.Group();
    obj.add(new THREE.Mesh(geo.body, mat), new THREE.Mesh(geo.eyes, eyeMat));
    obj.visible = false;
    this.engine.scene.add(obj);
    g = { obj, mat, eyeMat, life: 0, ttl: 0, active: false };
    this.ghosts.push(g);
    return g;
  }

  /** Oyuncunun önünde, aynı bölgede, engelsiz bir noktada gölge figür belirir */
  spawnGhost() {
    const p = this.player.pos;
    const area = areaAt(p.x, p.z);
    if (!area) return;
    const g = this.getGhost();
    if (!g) return;
    const yaw = this.player.yaw;
    const fx = -Math.sin(yaw);
    const fz = -Math.cos(yaw);
    const rx = Math.cos(yaw);
    const rz = -Math.sin(yaw);
    for (let i = 0; i < 10; i++) {
      const d = rand(3.2, 8.5);
      const lat = rand(-2.2, 2.2);
      const x = p.x + fx * d + rx * lat;
      const z = p.z + fz * d + rz * lat;
      if (areaAt(x, z) !== area || this.blocked(x, z)) continue;
      g.obj.position.set(x, 0, z);
      g.life = 0;
      g.ttl = rand(4, 6);
      g.active = true;
      g.obj.visible = true;
      this.engine.wake();
      return;
    }
  }

  blocked(x, z) {
    const m = 0.35;
    return this.collision.boxes.some((b) => b.enabled
      && x > b.minX - m && x < b.maxX + m && z > b.minZ - m && z < b.maxZ + m);
  }

  updateGhosts(dt) {
    let any = false;
    const p = this.player.pos;
    for (const g of this.ghosts) {
      if (!g.active) continue;
      any = true;
      g.life += dt;
      const o = g.obj.position;
      const dx = p.x - o.x;
      const dz = p.z - o.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 1.6) g.ttl = Math.min(g.ttl, g.life + 0.3); // yaklaşınca kaybolur
      if (dist > 0.01) {
        g.obj.rotation.y = Math.atan2(dx, dz);
        const drift = 0.22 * dt;
        o.x += (dx / dist) * drift;
        o.z += (dz / dist) * drift;
      }
      const fadeIn = Math.min(1, g.life / 0.8);
      const fadeOut = Math.min(1, Math.max(0, (g.ttl - g.life) / 0.9));
      const flicker = 0.85 + 0.15 * Math.sin(g.life * 23);
      const a = fadeIn * fadeOut * flicker;
      g.mat.opacity = 0.72 * a;
      g.eyeMat.opacity = a;
      if (g.life >= g.ttl) {
        g.active = false;
        g.obj.visible = false;
      }
    }
    return any;
  }

  // ---- Diğer oyuncuların emote animasyonları --------------------------------------

  playRemoteEmote(id, type) {
    const it = this.remotes.get(id);
    if (!it) return;
    const obj = it.obj;
    if (type === 'giggle') {
      if (!this.hahaMat) this.hahaMat = new THREE.SpriteMaterial({ map: makeHahaTexture(), transparent: true, depthWrite: false });
      const sprite = new THREE.Sprite(this.hahaMat);
      sprite.scale.set(0.9, 0.45, 1);
      sprite.position.set(0.35, 2.15, 0);
      obj.add(sprite);
      this.remoteFx.push({ type, obj, sprite, t: 0, dur: 2.4 });
    } else {
      if (!this.particleGeo) {
        this.particleGeo = new THREE.SphereGeometry(0.045, 5, 4);
        this.particleMat = new THREE.MeshBasicMaterial({ color: 0x9c0014 });
      }
      const count = 22;
      const mesh = new THREE.InstancedMesh(this.particleGeo, this.particleMat, count);
      mesh.frustumCulled = false;
      const start = obj.localToWorld(this._v.set(0, 1.3, 0.22)).clone();
      const fwdX = Math.sin(obj.rotation.y);
      const fwdZ = Math.cos(obj.rotation.y);
      const parts = [];
      for (let i = 0; i < count; i++) {
        const sp = rand(1.0, 2.0);
        parts.push({
          p: start.clone(),
          v: new THREE.Vector3(fwdX * sp + rand(-0.35, 0.35), rand(0.2, 1.0), fwdZ * sp + rand(-0.35, 0.35)),
          delay: i * 0.035,
        });
      }
      this.engine.scene.add(mesh);
      this.remoteFx.push({ type, obj, mesh, parts, t: 0, dur: 1.5 });
    }
    this.engine.wake();
  }

  updateRemote(dt) {
    if (!this.remoteFx.length) return false;
    const d = this._dummy;
    for (let i = this.remoteFx.length - 1; i >= 0; i--) {
      const fx = this.remoteFx[i];
      fx.t += dt;
      const inner = fx.obj.userData.inner;
      const done = fx.t >= fx.dur || !fx.obj.parent;
      if (fx.type === 'giggle') {
        inner.position.y = done ? 0 : Math.abs(Math.sin(fx.t * 14)) * 0.05;
        fx.sprite.position.y = 2.15 + fx.t * 0.08;
        if (done) fx.obj.remove(fx.sprite);
      } else {
        const k = Math.min(1, fx.t / fx.dur);
        inner.rotation.x = done ? 0 : 0.5 * Math.sin(Math.PI * Math.min(1, k * 1.4));
        fx.parts.forEach((pt, j) => {
          const tt = fx.t - pt.delay;
          if (tt > 0 && pt.p.y > 0.03) {
            pt.v.y -= 9.8 * dt;
            pt.p.addScaledVector(pt.v, dt);
            if (pt.p.y < 0.03) pt.p.y = 0.03;
          }
          d.position.copy(pt.p);
          d.scale.setScalar(tt > 0 ? 1 : 0.0001);
          d.updateMatrix();
          fx.mesh.setMatrixAt(j, d.matrix);
        });
        fx.mesh.instanceMatrix.needsUpdate = true;
        if (done) {
          this.engine.scene.remove(fx.mesh);
          fx.mesh.dispose();
        }
      }
      if (done) this.remoteFx.splice(i, 1);
    }
    return true;
  }
}
