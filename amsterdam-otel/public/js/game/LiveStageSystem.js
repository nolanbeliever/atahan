import * as THREE from 'three';
import { EVT, formatMoney, formatClock } from '/shared/constants.js';
import { areaAt, PLAYER_HOUSES } from '/shared/layout.js';
import { STAGE, STAGE_ACTS, STAGE_ACT_BY_ID, STAGE_RULES } from '/shared/stage.js';
import { buildStage } from '../world/StageBuilding.js';
import { makeCharacter, SKIN_COLORS } from './Characters.js';
import { addArms } from './StreetEvents.js';
import { StageMusic } from './StageMusic.js';

const H = STAGE.height;
const [CX] = STAGE.center;
const MUSIC_KEY = 'amsterdam-otel:stageMusic:v1';
const HOUSE_IDS = new Set(PLAYER_HOUSES.map((h) => h.id));

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};

/** Hedef oyuncunun önünde mi (mesafe + bakış açısı) */
function facing(px, pz, f, x, z, range, minDot = 0.3) {
  const dx = x - px;
  const dz = z - pz;
  const d = Math.hypot(dx, dz);
  if (d > range) return false;
  return d < 0.5 || (dx * f.x + dz * f.z) / d >= minDot;
}

const _frustum = new THREE.Frustum();
const _pv = new THREE.Matrix4();
const _sphere = new THREE.Sphere(new THREE.Vector3(CX, 1.6, STAGE.center[1]), 3.4);

// ---- Enstrümanlar (paylaşılan malzemeler, her grup bir kez kurulur) ------------------------------
let M = null;
function mats() {
  if (M) return M;
  const L = (color) => new THREE.MeshLambertMaterial({ color });
  M = {
    wood: L(0xb5793e), darkWood: L(0x6b3a1c), black: L(0x18181c), chrome: L(0xc9ccd2), brass: L(0xd9a842),
    white: L(0xf3efe6), red: L(0xb3262e), hole: L(0x1a0f08), grey: L(0x3a3c42),
    screen: new THREE.MeshBasicMaterial({ color: 0x7fd6ff }),
  };
  return M;
}
const mesh = (geo, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  return m;
};

function canvasMat(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return new THREE.MeshBasicMaterial({ map: tex });
}

/** Müzisyen: kapsül karakter + kollar */
function musician(look, color, x, z) {
  const obj = makeCharacter(look, { color, bag: false });
  obj.position.set(x, H, z);
  const arms = addArms(obj, color, SKIN_COLORS[look.skin % SKIN_COLORS.length]);
  return { obj, inner: obj.userData.inner, arms };
}

/** Akustik gitar (gövde + ses deliği + sap + kafa); sap gitaristin soluna (+X) ve yukarı */
function guitar() {
  const m = mats();
  const g = new THREE.Group();
  const bout = (r, y) => mesh(new THREE.CylinderGeometry(r, r, 0.085, 18), m.wood, 0, y, 0, Math.PI / 2);
  g.add(bout(0.19, 0), bout(0.145, 0.2));
  g.add(mesh(new THREE.CylinderGeometry(0.052, 0.052, 0.01, 14), m.hole, 0, 0.1, 0.044, Math.PI / 2));
  g.add(mesh(new THREE.BoxGeometry(0.055, 0.56, 0.03), m.darkWood, 0, 0.58, 0.01));
  g.add(mesh(new THREE.BoxGeometry(0.08, 0.15, 0.025), m.darkWood, 0, 0.93, 0.0));
  g.add(mesh(new THREE.BoxGeometry(0.1, 0.022, 0.02), m.black, 0, -0.08, 0.045));
  g.position.set(-0.07, 0.86, 0.21);
  g.rotation.set(0.12, 0, -1.08);
  return g;
}

function headphones() {
  const m = mats();
  const g = new THREE.Group();
  g.add(mesh(new THREE.TorusGeometry(0.165, 0.016, 6, 16, Math.PI), m.black, 0, 1.38, 0));
  for (const s of [-1, 1]) g.add(mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.05, 12), m.grey, s * 0.16, 1.36, 0, 0, 0, Math.PI / 2));
  return g;
}

/** Tenor saksafon (pirinç): gövde, alt kıvrım, kalkık çan, ağızlık borusu */
function saxophone() {
  const m = mats();
  const g = new THREE.Group();
  g.add(mesh(new THREE.CylinderGeometry(0.04, 0.03, 0.46, 10), m.brass, 0, 0.28, 0));
  g.add(mesh(new THREE.TorusGeometry(0.065, 0.04, 6, 10, Math.PI), m.brass, 0.065, 0.05, 0, 0, 0, Math.PI));
  g.add(mesh(new THREE.CylinderGeometry(0.1, 0.045, 0.24, 14, 1, true), m.brass, 0.14, 0.2, 0.02, 0, 0, -0.12));
  g.add(mesh(new THREE.CylinderGeometry(0.014, 0.018, 0.22, 6), m.brass, -0.05, 0.58, 0.04, 0.3, 0, 0.6));
  g.add(mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.06, 6), m.black, -0.11, 0.67, 0.06, 0.3, 0, 0.6));
  g.position.set(0.03, 0.62, 0.22);
  g.rotation.set(0.25, 0, 0.18);
  return g;
}

/** Kontrbas: iki şişkin gövde, sap, kafa, ayak */
function doubleBass() {
  const m = mats();
  const g = new THREE.Group();
  const s1 = mesh(new THREE.SphereGeometry(1, 16, 12), m.darkWood, 0, 0.55, 0);
  s1.scale.set(0.3, 0.38, 0.12);
  const s2 = mesh(new THREE.SphereGeometry(1, 16, 12), m.darkWood, 0, 0.95, 0);
  s2.scale.set(0.22, 0.24, 0.11);
  g.add(s1, s2);
  g.add(mesh(new THREE.BoxGeometry(0.06, 0.8, 0.04), m.black, 0, 1.45, 0.05));
  g.add(mesh(new THREE.SphereGeometry(0.05, 8, 6), m.darkWood, 0, 1.88, 0.04));
  g.add(mesh(new THREE.BoxGeometry(0.06, 0.2, 0.06), m.black, 0, 0.62, 0.11));
  g.add(mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.2, 4), m.chrome, 0, 0.08, 0));
  g.add(mesh(new THREE.BoxGeometry(0.035, 1.3, 0.004), m.white, 0, 1.15, 0.125));
  return g;
}

/**
 * Davul seti (davulcunun önünde, +Z). Davulcu −X'e (kendi sağına) ride + floor tom,
 * +X'e (soluna) hi-hat + crash alır; trampet dizlerinin arasında.
 */
function drumKit() {
  const m = mats();
  const g = new THREE.Group();
  const drum = (r, h, x, y, z, rx = 0, shell = m.red) => {
    const d = new THREE.Group();
    d.add(mesh(new THREE.CylinderGeometry(r, r, h, 18), shell));
    d.add(mesh(new THREE.CylinderGeometry(r * 0.98, r * 0.98, 0.006, 18), m.white, 0, h / 2, 0));
    d.position.set(x, y, z);
    d.rotation.x = rx;
    g.add(d);
  };
  const cymbal = (r, x, y, z, tilt) => {
    g.add(mesh(new THREE.CylinderGeometry(0.008, 0.008, y, 5), m.chrome, x, y / 2, z));
    g.add(mesh(new THREE.CylinderGeometry(r, r * 0.9, 0.012, 18), m.brass, x, y, z, tilt, 0, 0));
  };
  drum(0.26, 0.34, 0, 0.27, 0.55, Math.PI / 2); // bas davul (ön derisi seyirciye)
  g.add(mesh(new THREE.CircleGeometry(0.2, 18), mats().black, 0, 0.27, 0.722));
  drum(0.17, 0.13, 0.2, 0.62, 0.3, -0.12, m.chrome); // trampet
  drum(0.12, 0.13, 0.04, 0.72, 0.5, -0.5); // tom
  drum(0.17, 0.3, -0.4, 0.4, 0.28); // floor tom
  cymbal(0.16, 0.5, 0.88, 0.3, -0.05); // hi-hat
  g.add(mesh(new THREE.CylinderGeometry(0.16, 0.15, 0.012, 18), m.brass, 0.5, 0.86, 0.3));
  cymbal(0.23, -0.48, 1.02, 0.48, -0.28); // ride
  cymbal(0.19, 0.32, 1.16, 0.62, -0.4); // crash
  // Tabure
  g.add(mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.07, 14), m.black, 0, 0.44, -0.06));
  g.add(mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.42, 6), m.chrome, 0, 0.21, -0.06));
  return g;
}

/** DJ masası: önünde neon panel, iki pikap (dönen plaklar), mikser, standlı dizüstü */
function djBooth() {
  const m = mats();
  const g = new THREE.Group();
  g.add(mesh(new THREE.BoxGeometry(1.36, 0.88, 0.6), m.black, 0, 0.44, 0));
  const front = canvasMat(512, 256, (ctx, w, h) => {
    ctx.fillStyle = '#0d0b14';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#4fc3ff';
    ctx.lineWidth = 10;
    ctx.shadowColor = '#4fc3ff';
    ctx.shadowBlur = 24;
    ctx.strokeRect(18, 18, w - 36, h - 36);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ff9fd2';
    ctx.shadowColor = '#ff4fa3';
    ctx.font = '900 92px system-ui, sans-serif';
    ctx.fillText('DJ ♫', w / 2, h * 0.45);
    ctx.font = '700 40px system-ui, sans-serif';
    ctx.fillStyle = '#d9f4ff';
    ctx.fillText('KABİNİ', w / 2, h * 0.78);
  });
  g.add(mesh(new THREE.PlaneGeometry(1.2, 0.6), front, 0, 0.47, 0.302));
  const platters = [];
  for (const x of [-0.4, 0.4]) {
    g.add(mesh(new THREE.BoxGeometry(0.44, 0.05, 0.38), m.grey, x, 0.905, -0.02));
    const p = mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.012, 20), m.black, x - 0.03, 0.937, -0.02);
    p.add(mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.004, 10), m.red, 0, 0.008, 0));
    p.add(mesh(new THREE.BoxGeometry(0.02, 0.006, 0.12), m.chrome, 0.08, 0.009, 0)); // etiket çizgisi (dönüşü görünür kılar)
    platters.push(p);
    g.add(p);
    g.add(mesh(new THREE.BoxGeometry(0.02, 0.02, 0.2), m.chrome, x + 0.16, 0.95, -0.05, 0, 0.3, 0));
  }
  g.add(mesh(new THREE.BoxGeometry(0.26, 0.07, 0.34), m.grey, 0, 0.915, -0.02));
  for (let i = 0; i < 3; i++) g.add(mesh(new THREE.BoxGeometry(0.03, 0.012, 0.1), m.chrome, -0.07 + i * 0.07, 0.955, 0.02));
  // Standlı dizüstü (ekran DJ'e dönük; kapağın arkası seyirciye)
  g.add(mesh(new THREE.BoxGeometry(0.05, 0.16, 0.05), m.chrome, 0, 0.98, 0.18));
  g.add(mesh(new THREE.BoxGeometry(0.34, 0.016, 0.24), m.grey, 0, 1.065, 0.16, 0.25));
  const lid = new THREE.Group();
  lid.add(mesh(new THREE.BoxGeometry(0.34, 0.23, 0.012), m.grey, 0, 0.115, 0));
  lid.add(mesh(new THREE.PlaneGeometry(0.31, 0.2), m.screen, 0, 0.115, -0.008, 0, Math.PI));
  lid.add(mesh(new THREE.CircleGeometry(0.035, 12), m.white, 0, 0.12, 0.007));
  lid.position.set(0, 1.09, 0.28);
  lid.rotation.x = 0.2;
  g.add(lid);
  return { group: g, platters };
}

/**
 * Achterstraat Canlı Müzik Sahnesi — istemci (sunucu: server/game/StageService.js).
 *  - Satın alınmadan önce işaretli boş alan; alınınca sahne herkes için belirir (StageBuilding).
 *  - Resepsiyon PC → Yükseltmeler'de "🎤 Canlı Müzik Sahnesi" satırı (renderUpgradeRow).
 *  - Sahnenin önünde E → grup paneli: günlük ücretle 🎸 / 🎧 / 🎷 kirala (kasadan), günün durumu.
 *  - Müzisyenler (makeCharacter + kollar + enstrüman) sahnede durur; set çalarken vuruşa göre
 *    çalar: gitarda tıngırdatma, DJ'de pikap + kafa sallama + yumruk, cazda saksafon kaldırma,
 *    kontrbasta parmak, davulda bagetler. Spotlar vuruşla nabız gibi atar.
 *  - Müzik: StageMusic (prosedürel, 3D konumlu), sunucunun set başlangıcına senkron.
 * Pil: müzisyen / ışık animasyonu YALNIZCA set çalarken, oyuncu 30 m içindeyken ve sahne görüş
 * alanındayken (motor sistemi ancak o zaman true döner). Müzik zamanlayıcısı yalnızca açık
 * havada (Achterstraat / steeg) ya da oyuncu evlerinin içinde (boğuk), 35 m içinde, ses açıkken
 * ve oyun duraklatılmamışken çalışır; dinleyici konumu yalnızca oyuncu hareket edince güncellenir.
 */
export class LiveStageSystem {
  constructor({ engine, net, hud, interaction, player, modal, sfx, settings, state, mats: worldMats, collision, isPaused }) {
    this.engine = engine;
    this.net = net;
    this.hud = hud;
    this.interaction = interaction;
    this.player = player;
    this.modal = modal;
    this.settings = settings;
    this.state = state;
    this.isPaused = isPaused ?? (() => document.hidden);
    this.st = { owned: false, booking: null, phase: 'idle', setNo: -1, setAt: null, to: null };
    this.building = buildStage({ scene: engine.scene, mats: worldMats, collision });
    this.bands = {}; // actId → { group, rigs, platters }
    this.band = null; // sahnedeki grup
    this.music = new StageMusic(sfx);
    this.musicOn = true;
    try { this.musicOn = localStorage.getItem(MUSIC_KEY) !== 'off'; } catch { /* yok say */ }
    this.animating = false;
    this.busy = false;
    this.pc = null;
    this._f = { x: 0, z: 0 };

    const $ = (id) => document.getElementById(id);
    this.el = {
      panel: $('stage-panel'), status: $('stage-status'), acts: $('stage-acts'), msg: $('stage-msg'), music: $('stage-music'),
    };
    $('stage-close').addEventListener('click', () => this.modal.close(this.el.panel));
    this.el.music.checked = this.musicOn;
    this.el.music.addEventListener('change', () => {
      this.musicOn = this.el.music.checked;
      try { localStorage.setItem(MUSIC_KEY, this.musicOn ? 'on' : 'off'); } catch { /* yok say */ }
      this.evaluateAudio();
    });
    interaction.addProvider({ find: (px, pz, f) => this.findTarget(px, pz, f) });
    document.addEventListener('visibilitychange', () => this.evaluateAudio());
  }

  get act() { return this.st.booking ? STAGE_ACT_BY_ID[this.st.booking.act] : null; }

  get playing() { return this.st.phase === 'set' && this.st.setAt !== null && !!this.act; }

  // ---- Durum -----------------------------------------------------------------------------------

  /** snapshot.stage / EVT.STAGE_STATE */
  onState(s) {
    if (!s || typeof s !== 'object') return;
    this.st = s;
    this.building.setOwned(!!s.owned);
    // Sahnedeki grup: bugünün rezervasyonu (gece ve ertesi gün yok)
    const want = s.owned && s.booking && s.phase !== 'over' ? s.booking.act : null;
    this.showBand(want);
    this.building.setLights(this.playing, 0.5);
    if (!this.playing) this.resetBand();
    this.evaluateAudio();
    this.interaction.invalidate();
    if (!this.el.panel.hidden) this.renderPanel();
    this.pc?.refresh();
    this.engine.requestRender();
  }

  showBand(actId) {
    const cur = this.band?.id ?? null;
    if (cur === actId) return;
    if (this.band) this.band.group.visible = false;
    this.band = null;
    if (!actId) return;
    if (!this.bands[actId]) this.bands[actId] = this.buildBand(actId);
    this.band = this.bands[actId];
    this.band.group.visible = true;
  }

  buildBand(id) {
    const group = new THREE.Group();
    const rigs = [];
    let platters = [];
    const z0 = STAGE.center[1];
    if (id === 'guitar') {
      const r = musician({ skin: 1, hair: 2 }, '#3f7d3a', CX, z0 + 0.25);
      r.inner.add(guitar());
      r.role = 'guitar';
      rigs.push(r);
      // Gitaristin yanında amfi
      const amp = mesh(new THREE.BoxGeometry(0.4, 0.36, 0.25), mats().grey, CX + 0.85, H + 0.18, z0 - 0.15);
      amp.add(mesh(new THREE.PlaneGeometry(0.32, 0.26), mats().black, 0, 0, 0.126));
      group.add(amp);
    } else if (id === 'dj') {
      const r = musician({ skin: 3, hair: 0 }, '#1f1f24', CX, z0 - 0.5);
      r.inner.add(headphones());
      r.role = 'dj';
      rigs.push(r);
      const booth = djBooth();
      booth.group.position.set(CX, H, z0 + 0.02);
      group.add(booth.group);
      platters = booth.platters;
    } else {
      const sax = musician({ skin: 4, hair: 3, hat: true }, '#2d4f7c', CX - 1.15, z0 + 0.2);
      sax.inner.add(saxophone());
      sax.role = 'sax';
      sax.obj.rotation.y = 0.18;
      const bass = musician({ skin: 0, hair: 0 }, '#3a3a3a', CX + 0.05, z0 - 0.35);
      bass.role = 'bass';
      bass.obj.rotation.y = -0.15;
      const db = doubleBass();
      db.position.set(CX + 0.27, H, z0 - 0.02);
      db.rotation.set(-0.12, -0.35, -0.22);
      group.add(db);
      const drums = musician({ skin: 2, hair: 4 }, '#9c2f2f', CX + 1.3, z0 - 0.42);
      drums.obj.position.y = H - 0.27; // taburede oturur
      drums.role = 'drums';
      const kit = drumKit();
      kit.position.set(CX + 1.3, H, z0 - 0.42);
      group.add(kit);
      rigs.push(sax, bass, drums);
    }
    for (const r of rigs) {
      r.base = { y: r.obj.position.y, ry: r.obj.rotation.y };
      group.add(r.obj);
    }
    this.engine.scene.add(group);
    const band = { id, group, rigs, platters };
    this.poseBand(band, 0, 0);
    return band;
  }

  resetBand() {
    if (this.band) this.poseBand(this.band, 0, 0);
  }

  // ---- Animasyon -----------------------------------------------------------------------------------

  /** Şu anki vuruş (set çalmıyorsa null) — StreetEvents de kullanır */
  beatAt() {
    if (!this.playing) return null;
    return ((this.net.serverNow() - this.st.setAt) / 1000) * (this.act.bpm / 60);
  }

  /**
   * Müzisyen pozu. beat: vuruş sayısı (ondalıklı), amp 0 → dinlenme pozu.
   */
  poseBand(band, beat, amp) {
    const TAU = Math.PI * 2;
    for (const r of band.rigs) {
      const { inner, arms } = r;
      const bounce = Math.abs(Math.sin(Math.PI * beat)) * amp;
      inner.position.y = 0;
      inner.rotation.set(0, 0, 0);
      if (r.role === 'guitar') {
        inner.rotation.z = 0.05 * Math.sin((Math.PI * beat) / 2) * amp;
        inner.position.y = 0.012 * bounce;
        arms.r.rotation.set(-0.55 + 0.22 * Math.sin(TAU * beat) * amp, 0, -0.05); // tıngırdatma (8'likler)
        arms.l.rotation.set(-1.25, 0.2, 0.62); // sapı tutan el
      } else if (r.role === 'dj') {
        inner.position.y = 0.035 * bounce;
        inner.rotation.x = 0.1 * bounce; // kafa sallama
        arms.r.rotation.set(-1.05, 0.25 * Math.sin(TAU * beat * 0.5) * amp, -0.28); // pikapta scratch
        const pump = amp && Math.floor(beat / 8) % 2 === 1 ? 1 : 0; // 8 vuruşta bir yumruk havaya
        arms.l.rotation.set(pump ? -2.75 + 0.35 * bounce : -1.0, 0, pump ? 0.15 : 0.28);
      } else if (r.role === 'sax') {
        // Cümle boyunca saksafonu kaldırıp geriye yaslanır
        const lift = amp * (0.5 + 0.5 * Math.sin((Math.PI * beat) / 4));
        inner.rotation.x = -0.1 * lift;
        inner.position.y = 0.01 * bounce;
        inner.rotation.z = 0.04 * Math.sin((Math.PI * beat) / 2) * amp;
        arms.l.rotation.set(-0.85 - 0.25 * lift, 0, 0.12);
        arms.r.rotation.set(-0.6 - 0.25 * lift, 0, -0.08);
      } else if (r.role === 'bass') {
        inner.rotation.z = -0.04 * Math.sin((Math.PI * beat) / 2) * amp;
        arms.l.rotation.set(-2.15, 0, 0.35); // sapta
        arms.r.rotation.set(-0.55 + 0.18 * Math.max(0, Math.sin(TAU * beat)) * amp, 0, 0.1); // parmak
      } else if (r.role === 'drums') {
        const sw = beat % 1 < 0.66 ? (beat % 1) / 0.66 : 1; // swing
        const ride = Math.pow(Math.max(0, Math.cos(Math.PI * 2 * sw)), 4) * amp;
        const snare = (Math.floor(beat) % 2 === 1 ? Math.pow(Math.max(0, Math.cos(TAU * (beat % 1))), 6) : 0) * amp;
        arms.r.rotation.set(-1.25 + 0.4 * ride, 0, -0.3);
        arms.l.rotation.set(-0.95 + 0.45 * snare, 0, 0.18);
        inner.position.y = 0.01 * bounce;
      }
    }
  }

  /** @returns {boolean} bu karede animasyon çizildi mi (motor yalnızca o zaman çizer) */
  update(dt) {
    this.animating = false;
    if (!this.band || !this.playing) return false;
    const p = this.player.pos;
    if (Math.hypot(p.x - CX, p.z - STAGE.center[1]) > STAGE.ANIM_RANGE) return false;
    const cam = this.engine.camera;
    cam.updateMatrixWorld();
    _pv.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    _frustum.setFromProjectionMatrix(_pv);
    if (!_frustum.intersectsSphere(_sphere)) return false;
    const beat = this.beatAt();
    const amp = this.settings?.reduceMotion ? 0.5 : 1;
    this.poseBand(this.band, beat, amp);
    for (const pl of this.band.platters) pl.rotation.y -= dt * 3.5;
    const frac = beat - Math.floor(beat);
    this.building.setLights(true, (1 - frac) * (1 - frac));
    this.animating = true;
    return true;
  }

  setNight(t) { this.building.setNight(t); }

  // ---- Ses ------------------------------------------------------------------------------------------

  /**
   * Müzik çalsın mı: set çalıyor, ses açık, oyun duraklatılmamış, oyuncu açık havada
   * (Achterstraat / steeg) ya da bir oyuncu evinin içinde (boğuk) ve 35 m içinde.
   */
  evaluateAudio() {
    const p = this.player.pos;
    let muffle = -1;
    if (this.playing && this.settings.sound && this.musicOn && !this.isPaused()) {
      const d = Math.hypot(p.x - CX, p.z - STAGE.center[1]);
      if (d <= STAGE.HEAR_RANGE) {
        const area = areaAt(p.x, p.z);
        if (area === 'alley' || area === 'steeg') muffle = 0;
        else if (area && HOUSE_IDS.has(area)) muffle = 1;
      }
    }
    if (muffle < 0) {
      if (this.music.playing) this.music.stop();
      return;
    }
    if (this.music.start(this.st.booking.act, this.st.setAt, () => this.net.serverNow())) {
      this.music.setMuffle(muffle);
      this.updateListener();
    }
  }

  updateListener() {
    if (!this.music.playing) return;
    const f = this.player.forward(this._f);
    this.music.setListener(this.player.pos.x, this.player.pos.z, f.x, f.z);
  }

  /** Motor sistemi: yalnızca oyuncu hareket edince (dinleyici + bölge kontrolü) */
  onMoved() {
    if (!this.playing) return;
    this.evaluateAudio();
  }

  /** Saniyede bir (saat göstergesiyle): ayar / duraklatma değişikliklerini yakala */
  onClock() {
    if (this.playing || this.music.playing) this.evaluateAudio();
    if (!this.el.panel.hidden) this.renderStatus();
  }

  // ---- Etkileşim ----------------------------------------------------------------------------------

  findTarget(px, pz, f) {
    const [x, z] = STAGE.point;
    if (!facing(px, pz, f, x, z, STAGE.range) || !facing(px, pz, f, CX, STAGE.center[1], STAGE.range + 2.5, 0.2)) return null;
    if (!this.st.owned) {
      return {
        x, z, short: 'Sahne',
        label: `🎤 Sahne alanı — Resepsiyon PC'den satın al (${formatMoney(STAGE.PRICE)})`,
        use: () => this.hud.toast(`🎤 Sahne alanı boş. Resepsiyon PC → 🏗️ Yükseltmeler'den ${formatMoney(STAGE.PRICE)}'a kurdurabilirsin.`, 'info'),
      };
    }
    const act = this.act;
    const label = act && this.st.phase !== 'over'
      ? `🎤 Achterstraat Live — bugün ${act.icon} ${act.name}`
      : '🎤 Achterstraat Live — müzisyen kirala';
    return { x, z, short: 'Sahne', label, use: () => this.openPanel() };
  }

  openPanel() {
    this.el.msg.textContent = '';
    this.renderPanel();
    this.modal.open(this.el.panel);
  }

  say(text, ok = false) {
    this.el.msg.textContent = text || '';
    this.el.msg.className = `note ${ok ? 'ok' : ''}`;
  }

  statusText() {
    const s = this.st;
    const c = this.state.clock;
    const minute = c ? this.state.minuteAt(this.net.serverNow()) : 0;
    if (c?.night) return '🌙 Gece — sahne kapalı. Sabah 07:00\'den sonra yeni bir grup kiralayabilirsin.';
    const act = this.act;
    if (!act) {
      if (minute >= STAGE_RULES.HIRE_UNTIL_MIN) return 'Bugün için çok geç (22:00\'den sonra grup tutulmaz). Yarın tekrar gel!';
      return 'Bugün sahne boş. Bir grup kirala: ücret otelin kasasından, günlük (23:00\'e kadar). Günde tek grup.';
    }
    const until = s.to != null ? formatClock(s.to % 1440) : '23:00';
    if (s.phase === 'set') return `Bugün: ${act.icon} ${act.name} · ${s.setNo + 1}. set çalıyor · set sonu ${until}`;
    if (s.phase === 'break') return `Bugün: ${act.icon} ${act.name} · mola · sonraki set ${until}`;
    return `Bugün ${act.icon} ${act.name} çaldı. Yarın yeni bir grup kiralayabilirsin.`;
  }

  renderStatus() {
    this.el.status.textContent = this.statusText();
  }

  renderPanel() {
    this.renderStatus();
    const list = this.el.acts;
    list.replaceChildren();
    const money = this.state.economy?.money ?? 0;
    const c = this.state.clock;
    const minute = c ? this.state.minuteAt(this.net.serverNow()) : 0;
    const booked = !!this.st.booking;
    const closed = !!c?.night || minute >= STAGE_RULES.HIRE_UNTIL_MIN;
    for (const a of STAGE_ACTS) {
      const row = el('div', 'product stage-act');
      const info = el('div');
      const on = this.st.booking?.act === a.id;
      info.append(
        el('div', 'name', `${a.name}${a.members > 1 ? ` (${a.members} kişi)` : ''}`),
        el('div', 'desc', a.desc),
        el('div', on ? 'owned' : 'desc', on ? 'Bugün sahnede ✓' : `${formatMoney(a.fee)} / gün · ~${a.crowd} seyirci · set sonu bar bahşişi +%${Math.round((a.barTip - 1) * 100)}`),
      );
      const btn = el('button', null, on ? '✓' : 'Kirala');
      btn.type = 'button';
      btn.disabled = booked || closed || money < a.fee;
      btn.title = booked ? 'Günde tek grup' : closed ? 'Bugün için kapalı' : money < a.fee ? 'Kasada yeterli para yok' : '';
      btn.addEventListener('click', () => this.hire(a.id, btn));
      row.append(el('div', 'icon', a.icon), info, btn);
      list.append(row);
    }
    const foot = el('p', 'pc-small', `Kasa: ${formatMoney(money)} · Set ${STAGE_RULES.SET_MIN / 60} saat, mola ${STAGE_RULES.BREAK_MIN} dk (oyun saati). Set bitince kalabalık bara akar.`);
    list.append(foot);
  }

  async hire(id, btn) {
    if (this.busy) return;
    this.busy = true;
    btn.disabled = true;
    const res = await this.net.request(EVT.STAGE_ACT, { act: 'hire', id });
    this.busy = false;
    if (!res.ok) {
      this.say(res.error || 'Olmadı.');
      btn.disabled = false;
      return;
    }
    const a = STAGE_ACT_BY_ID[id];
    this.say(`${a.icon} ${a.name} sahneye çıkıyor!`, true);
    setTimeout(() => { if (!this.el.panel.hidden) this.modal.close(this.el.panel); }, 900);
  }

  // ---- Resepsiyon PC → Yükseltmeler ------------------------------------------------------------

  /** ReceptionPC.renderUpgrades listesine sahne satırı */
  renderUpgradeRow(list, pc) {
    this.pc = pc;
    const money = pc.state.economy?.money ?? 0;
    const owned = !!this.st.owned;
    const row = el('div', 'product stage-row');
    const info = el('div');
    info.append(
      el('div', 'name', 'Canlı Müzik Sahnesi · Achterstraat'),
      owned
        ? el('div', 'owned', 'Kurulu ✓ — sahnenin önünde E ile müzisyen kirala')
        : el('div', 'desc', `${formatMoney(STAGE.PRICE)} · bir kez · günlük müzisyen kirala, konser kalabalığı bara akar`),
    );
    const btn = el('button', null, owned ? '✓' : 'Kur');
    btn.type = 'button';
    btn.disabled = owned || money < STAGE.PRICE;
    btn.addEventListener('click', async () => {
      if (this.busy) return;
      this.busy = true;
      btn.disabled = true;
      const res = await this.net.request(EVT.STAGE_ACT, { act: 'buy' });
      this.busy = false;
      if (!res.ok) {
        pc.say(res.error || 'Olmadı.');
        btn.disabled = false;
        return;
      }
      pc.say('🎤 Sahne kuruldu! Achterstraat\'a git, sahnenin önünde E → müzisyen kirala.', true);
    });
    row.append(el('div', 'icon', '🎤'), info, btn);
    list.append(row);
  }
}
