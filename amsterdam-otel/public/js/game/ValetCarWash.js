import * as THREE from 'three';
import { EVT } from '/shared/constants.js';
import { CAR_BY_ID } from '/shared/cars.js';
import {
  VALET, VALET_RULES as R, dirtSpotsLocal, localToWorld, inWashBay, valetBayAt, valetTip,
} from '/shared/valet.js';
import { StaticBatcher } from '../world/StaticBatcher.js';
import { canvasTexture, drawHazard, signMaterial, panel } from '../world/CarWorldKit.js';
import { buildHand, prep, VIEW_SCALE, DEPTH } from './ViewModel.js';

const TOOL = Object.freeze({
  foam: { icon: '🧴', name: 'Köpük tabancası', lower: 'köpük tabancası', verb: 'Köpükle', busy: '🧴 Köpükleniyor…' },
  water: { icon: '💦', name: 'Tazyikli su tabancası', lower: 'tazyikli su tabancası', verb: 'Tazyikli suyla durula', busy: '💦 Tazyikli su püskürtülüyor…' },
});
const STAGE_TOOL = Object.freeze({ foam: 'foam', water: 'water' });
const MAX_PARTICLES = 48;
const _v = new THREE.Vector3();
const _f = new THREE.Vector3();

const mmss = (ms) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

// ---- Dünya: sokaktaki vale kürsüsü + garajdaki yıkama bölmesi ve vale park yerleri ------------------

function grateTexture() {
  return canvasTexture(128, 128, (g, w, h) => {
    g.fillStyle = '#26292d';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#4a4f55';
    for (let i = 0; i < w; i += 16) g.fillRect(i, 0, 4, h);
    for (let j = 0; j < h; j += 32) g.fillRect(0, j, w, 3);
  });
}

function tileTexture() {
  return canvasTexture(128, 128, (g, w, h) => {
    g.fillStyle = '#9fb3c4';
    g.fillRect(0, 0, w, h);
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        g.fillStyle = (x + y) % 2 ? '#2b6fa8' : '#3a83bf';
        g.fillRect(x * 32 + 2, y * 32 + 2, 28, 28);
      }
    }
  });
}

function buildStreet(scene, collision) {
  const group = new THREE.Group();
  group.name = 'valet-street';
  const b = new StaticBatcher();
  const mats = {
    vBrass: new THREE.MeshLambertMaterial({ color: 0xc9a25e }),
    vWood: new THREE.MeshLambertMaterial({ color: 0x3b2618 }),
    vRed: new THREE.MeshLambertMaterial({ color: 0x8f1f2b }),
    vWhite: new THREE.MeshBasicMaterial({ color: 0xf2f2ee }),
    vBlack: new THREE.MeshLambertMaterial({ color: 0x15171a }),
  };
  const S = VALET.stand;
  // Kürsü: koyu ahşap gövde, pirinç tabla, üstünde anahtar kutusu
  b.box('vWood', S.x - 0.4, S.x + 0.4, 0, 1.05, S.z - 0.25, S.z + 0.25);
  b.box('vBrass', S.x - 0.44, S.x + 0.44, 1.05, 1.09, S.z - 0.29, S.z + 0.29);
  b.box('vBlack', S.x - 0.18, S.x + 0.18, 1.09, 1.3, S.z - 0.05, S.z + 0.12);
  for (let i = 0; i < 4; i++) b.box('vBrass', S.x - 0.13 + i * 0.085, S.x - 0.11 + i * 0.085, 1.14, 1.2, S.z - 0.06, S.z - 0.05);
  collision.add(S.x - 0.44, S.x + 0.44, S.z - 0.29, S.z + 0.29);
  // Kırmızı halı (kürsüden kaldırıma) + direkler arasında kadife ip
  b.floor('vRed', S.x - 0.6, S.x + 0.6, -2.6, -0.3, 0.008, { cast: false });
  for (const x of [S.x - 0.75, S.x + 0.75]) {
    for (const z of [-2.5, -1.2]) {
      b.add('vBrass', new THREE.CylinderGeometry(0.03, 0.04, 0.9, 8), { position: [x, 0.45, z] });
      b.add('vBrass', new THREE.SphereGeometry(0.05, 8, 6), { position: [x, 0.93, z] });
    }
    b.add('vRed', new THREE.CylinderGeometry(0.02, 0.02, 1.3, 6).rotateX(Math.PI / 2), { position: [x, 0.8, -1.85], cast: false });
  }
  // Bırakma yeri: boyalı çerçeve
  const d = VALET.dropoff;
  const hw = 1.4;
  const hl = 2.8;
  for (const [x0, x1, z0, z1] of [[d.x - hl, d.x + hl, d.z - hw, d.z - hw + 0.1], [d.x - hl, d.x + hl, d.z + hw - 0.1, d.z + hw], [d.x - hl, d.x - hl + 0.1, d.z - hw, d.z + hw], [d.x + hl - 0.1, d.x + hl, d.z - hw, d.z + hw]]) {
    b.floor('vWhite', x0, x1, z0, z1, 0.01, { cast: false, receive: false });
  }
  b.add('vBrass', new THREE.CylinderGeometry(0.02, 0.02, 0.4, 6), { position: [S.x, 1.3, S.z] });
  b.build(mats, group);
  group.add(panel(signMaterial(['⭐ VIP VALET', 'Vale · anahtar burada'], { bg: '#1b1b22', fg: '#f2c75c', glow: true }), 1.0, 0.32, S.x, 1.62, S.z - 0.06, 'z-'));
  const label = panel(signMaterial(['VALE · VIP'], { bg: 'rgba(0,0,0,0)', fg: '#f2f2ee', border: false, w: 512, h: 128 }), 2.2, 0.55, d.x, 0.013, d.z, 'up');
  label.material.transparent = true;
  label.rotation.z = Math.PI / 2;
  label.updateMatrix();
  group.add(label);
  group.traverse((o) => { o.matrixAutoUpdate = false; o.updateMatrix(); });
  scene.add(group);
  return group;
}

function buildGarageBay(group, collision) {
  const b = new StaticBatcher();
  const grate = grateTexture();
  const mats = {
    vGrate: new THREE.MeshLambertMaterial({ map: grate }),
    vTile: new THREE.MeshLambertMaterial({ map: tileTexture() }),
    vSteel: new THREE.MeshLambertMaterial({ color: 0x9aa1a8 }),
    vGold: new THREE.MeshBasicMaterial({ color: 0xd9b24a }),
    vHazard: new THREE.MeshLambertMaterial({ map: canvasTexture(128, 32, drawHazard) }),
    vHoseB: new THREE.MeshLambertMaterial({ color: 0x1f6fb2 }),
    vHoseP: new THREE.MeshLambertMaterial({ color: 0xe86aa6 }),
    vYellow: new THREE.MeshLambertMaterial({ color: 0xf2c230 }),
    vOrange: new THREE.MeshLambertMaterial({ color: 0xff7a1a }),
    vBlack: new THREE.MeshLambertMaterial({ color: 0x15171a }),
  };
  const W = VALET.wash;
  // Izgara zemin, mavi fayanslı arka duvar ve iki yan bölme (yarım boy)
  b.floor('vGrate', W.minX, W.maxX, W.minZ, W.maxZ, 0.006, { uvScale: 0.5, cast: false });
  b.box('vTile', W.minX, W.maxX, 0, 2.4, W.maxZ - 0.06, W.maxZ, { uvScale: 0.8, cast: false });
  for (const x of [W.minX - 0.1, W.maxX + 0.05]) {
    b.box('vTile', x, x + 0.12, 0, 1.6, W.minZ + 1.0, W.maxZ, { uvScale: 0.8 });
    b.box('vHazard', x - 0.01, x + 0.13, 1.6, 1.68, W.minZ + 1.0, W.maxZ, { uvScale: 2, cast: false });
    collision.add(x, x + 0.12, W.minZ + 1.0, W.maxZ);
  }
  // Tavanda köpük / su borusu köprüsü + iki hortum makarası
  b.box('vSteel', W.minX + 0.2, W.maxX - 0.2, 2.62, 2.7, W.center[1] - 0.05, W.center[1] + 0.05, { cast: false });
  for (const [x, mat] of [[W.minX + 1.2, 'vHoseP'], [W.maxX - 1.2, 'vHoseB']]) {
    b.add(mat, new THREE.TorusGeometry(0.22, 0.05, 6, 16), { position: [x, 2.0, W.maxZ - 0.15], cast: false });
    b.add('vSteel', new THREE.CylinderGeometry(0.06, 0.06, 0.1, 10).rotateX(Math.PI / 2), { position: [x, 2.0, W.maxZ - 0.12], cast: false });
  }
  // Tabanca askısı (batı bölmesinde): köpük (turuncu + pembe tank) ve tazyikli su (sarı + uzun nozul)
  const K = VALET.rack;
  b.box('vSteel', K.x - 0.04, K.x + 0.05, 0.9, 1.6, K.z - 0.45, K.z + 0.45, { cast: false });
  b.box('vOrange', K.x + 0.05, K.x + 0.15, 1.15, 1.35, K.z - 0.3, K.z - 0.12, { cast: false });
  b.add('vHoseP', new THREE.CylinderGeometry(0.06, 0.06, 0.18, 10), { position: [K.x + 0.12, 1.02, K.z - 0.21], cast: false });
  b.box('vYellow', K.x + 0.05, K.x + 0.15, 1.15, 1.35, K.z + 0.12, K.z + 0.3, { cast: false });
  b.add('vBlack', new THREE.CylinderGeometry(0.012, 0.012, 0.5, 6), { position: [K.x + 0.1, 1.05, K.z + 0.21], cast: false });
  // Vale park yerleri: altın çizgiler + "V-n" yazıları
  for (const bay of VALET.bays) {
    const x0 = bay.x - 1.4;
    const x1 = bay.x + 1.4;
    b.floor('vGold', x0, x0 + 0.08, bay.z - 2.5, bay.z + 2.4, 0.011, { cast: false, receive: false });
    b.floor('vGold', x1 - 0.08, x1, bay.z - 2.5, bay.z + 2.4, 0.011, { cast: false, receive: false });
  }
  b.build(mats, group);
  for (const bay of VALET.bays) {
    const m = panel(signMaterial([`VALE ${bay.id}`], { bg: 'rgba(0,0,0,0)', fg: '#d9b24a', border: false, w: 512, h: 128 }), 2.0, 0.5, bay.x, 0.012, bay.z - 1.6, 'up');
    m.material.transparent = true;
    group.add(m);
  }
  const wz = W.maxZ - 0.07;
  group.add(panel(signMaterial(['🫧 OTO YIKAMA · CAR WASH', 'köpük + tazyikli su · VIP vale'], { bg: '#0f3f6f', glow: true, w: 768, h: 160 }), 3.4, 0.7, W.center[0], 2.3, wz, 'z-'));
  group.add(panel(signMaterial(['⭐ VIP VALET PARKING', 'yalnızca vale · V-1 · V-2 · V-3'], { bg: '#1b1b22', fg: '#f2c75c', glow: true, w: 768, h: 160 }), 3.2, 0.66, VALET.bays[1].x, 2.45, 9.68, 'z-'));
  group.add(panel(signMaterial(['🧴 Köpük · 💦 Su', 'E: tabancayı al'], { bg: '#203a5c', glow: true, w: 384, h: 128 }), 0.8, 0.27, K.x + 0.07, 1.8, K.z, 'x+'));
}

// ---- Birinci şahıs tabanca ------------------------------------------------------------------------

function gunGeometry(kind) {
  const parts = [];
  const add = (geo, hex) => {
    const c = new THREE.Color(hex);
    const n = geo.attributes.position.count;
    const a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) a.set([c.r, c.g, c.b], i * 3);
    geo.setAttribute('color', new THREE.BufferAttribute(a, 3));
    parts.push(geo.index ? geo.toNonIndexed() : geo);
  };
  if (kind === 'foam') {
    add(new THREE.BoxGeometry(0.05, 0.07, 0.16).translate(0, 0.03, -0.06), '#ff7a1a');
    add(new THREE.CylinderGeometry(0.035, 0.035, 0.1, 12).translate(0, -0.04, -0.07), '#e86aa6');
    add(new THREE.CylinderGeometry(0.018, 0.026, 0.08, 10).rotateX(Math.PI / 2).translate(0, 0.045, -0.18), '#2a2a2c');
  } else {
    add(new THREE.BoxGeometry(0.05, 0.07, 0.14).translate(0, 0.03, -0.05), '#f2c230');
    add(new THREE.CylinderGeometry(0.008, 0.008, 0.42, 8).rotateX(Math.PI / 2).translate(0, 0.05, -0.32), '#2a2a2c');
    add(new THREE.CylinderGeometry(0.014, 0.01, 0.04, 8).rotateX(Math.PI / 2).translate(0, 0.05, -0.54), '#9aa1a8');
  }
  for (const g of parts) g.deleteAttribute('uv');
  let total = 0;
  for (const g of parts) total += g.attributes.position.count;
  const pos = new Float32Array(total * 3);
  const nor = new Float32Array(total * 3);
  const col = new Float32Array(total * 3);
  let o = 0;
  for (const g of parts) {
    pos.set(g.attributes.position.array, o * 3);
    nor.set(g.attributes.normal.array, o * 3);
    col.set(g.attributes.color.array, o * 3);
    o += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return out;
}

/** Kameraya bağlı el + tabanca (ViewModel'in küçültme hilesi); yalnızca püskürtürken kıpırdar */
class WashGun {
  constructor(camera) {
    this.camera = camera;
    this.root = new THREE.Group();
    this.root.name = 'wash-gun';
    this.root.scale.setScalar(VIEW_SCALE);
    this.root.visible = false;
    camera.add(this.root);
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.hand = new THREE.Group();
    this.hand.add(prep(new THREE.Mesh(buildHand(1), mat)));
    this.guns = { foam: prep(new THREE.Mesh(gunGeometry('foam'), mat)), water: prep(new THREE.Mesh(gunGeometry('water'), mat)) };
    for (const g of Object.values(this.guns)) {
      g.position.set(0, 0.02, -0.02);
      this.hand.add(g);
    }
    this.root.add(this.hand);
    this.key = '';
    this.tool = null;
  }

  layout() {
    const cam = this.camera;
    const key = `${cam.fov.toFixed(2)}|${cam.aspect.toFixed(3)}`;
    if (key === this.key) return false;
    this.key = key;
    const tanH = Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2);
    const rx = cam.aspect < 1 ? 0.24 : 0.3;
    this.base = [rx * DEPTH * tanH * cam.aspect, -0.5 * DEPTH * tanH, -DEPTH];
    return true;
  }

  setTool(tool) {
    this.tool = tool;
    this.root.visible = !!tool;
    for (const [k, g] of Object.entries(this.guns)) g.visible = k === tool;
    this.layout();
    this.pose(0);
  }

  /** k: 0 dinlenme … 1 püskürtme (nişan + titreşim) */
  pose(k, t = 0) {
    const [x, y, z] = this.base;
    const shake = k ? Math.sin(t * 60) * 0.004 : 0;
    this.hand.position.set(x - 0.08 * k, y + 0.06 * k + shake, z - 0.02 * k);
    this.hand.rotation.set(0.1 - 0.05 * k, -0.12 + 0.1 * k, 0);
  }
}

// ---- Sistem -----------------------------------------------------------------------------------

/**
 * VIP Vale & Tazyikli Su Oto Yıkama — istemci.
 *  - Sokakta (otelin önü, garaj rampasının doğusu) vale kürsüsü: VIP müşteri lüks / spor arabasıyla gelir,
 *    E → anahtarı al. Araba CityVehicleSystem + UndergroundGarage ile sürülür (garaj, sokak, drag pisti).
 *  - Garajda (rampadan inince kuzey koridor) 🫧 Oto Yıkama bölmesi: arabayı park et, askıdan köpük
 *    tabancasını al, çamurlu noktalara nişan alıp E (püskürt), sonra tazyikli su tabancasıyla durula.
 *    Elde birinci şahıs tabanca, köpük / su parçacıkları, ses; arabanın üstünde çamur ve köpük lekeleri
 *    (herkes görür).
 *  - V-1…V-3 vale park yerine park edip inince teslim: vale ücreti kasaya, bahşiş cüzdana (sunucu hesaplar).
 *  - Sürerken çarpmalar (ani hız kaybı) sunucuya bildirilir; HUD'da süre, çamur, hasar ve sıradaki adım.
 * Pil: dünyada dinamik olan yalnızca lekeler (liste değişince) ve püskürtürken parçacıklar; HUD saniyede bir.
 */
export class ValetCarWash {
  constructor({ engine, net, hud, interaction, player, vehicles, garage, collision, settings, sfx, device }) {
    Object.assign(this, { engine, net, hud, interaction, player, vehicles, garage, settings, sfx, device });
    this.state = { jobs: [], stats: null };
    this.tool = null;
    this.spraying = null; // { job, spot, tool, t0, ms, target: Vector3 }
    this.pending = false;
    this.prevVel = 0;
    this.hitSentAt = 0;
    this.dirt = new Map(); // carId → { obj, meshes[], key }

    buildStreet(engine.scene, collision);
    buildGarageBay(garage.garage.group, collision);
    this.gun = new WashGun(engine.camera);

    // Lekeler: paylaşılan geometri / malzeme
    this.mudGeo = new THREE.SphereGeometry(0.16, 8, 6).scale(1, 0.55, 1);
    this.foamGeo = new THREE.SphereGeometry(0.2, 8, 6).scale(1, 0.7, 1);
    this.mudMat = new THREE.MeshLambertMaterial({ color: 0x5a3f22 });
    this.foamMat = new THREE.MeshLambertMaterial({ color: 0xfbfbff });
    // Parçacıklar (püskürtürken)
    this.particles = [];
    this.pGeo = new THREE.SphereGeometry(0.035, 6, 4);
    this.pMats = { foam: new THREE.MeshBasicMaterial({ color: 0xffffff }), water: new THREE.MeshBasicMaterial({ color: 0x9fd8ff, transparent: true, opacity: 0.8 }) };
    for (let i = 0; i < MAX_PARTICLES; i++) {
      const m = new THREE.Mesh(this.pGeo, this.pMats.foam);
      m.visible = false;
      m.userData = { life: 0, vx: 0, vy: 0, vz: 0 };
      engine.scene.add(m);
      this.particles.push(m);
    }

    // Araç listesi değişince lekeleri yeniden bağla (arabaların mesh'leri CityVehicleSystem'de)
    const hooks = vehicles.cars;
    const onList = hooks.onList.bind(hooks);
    hooks.onList = (list, meshes) => {
      onList(list, meshes);
      this.syncDirt();
    };

    const $ = (id) => document.getElementById(id);
    this.el = { hud: $('valet-hud'), progress: $('valet-progress'), fill: $('valet-progress').firstElementChild };
    interaction.providers.unshift({ find: (px, pz, f) => this.findTarget(px, pz, f) }); // arabaya binme hedefinden önce
    setInterval(() => this.renderHud(), 1000);
  }

  get selfId() { return this.vehicles.selfId; }

  /** Anahtarı bende olan iş */
  get myJob() { return this.state.jobs.find((j) => j.holder === this.selfId) ?? null; }

  // ---- Sunucu durumu ----------------------------------------------------------------------------

  onState(s) {
    const prev = this.myJob;
    this.state = s ?? { jobs: [], stats: null };
    const mine = this.myJob;
    if (prev && mine && mine.damage > prev.damage) this.hud.toast(`💥 Çarpma! VIP aracında hasar %${mine.damage}`, 'warn');
    this.syncDirt();
    this.renderHud();
    this.interaction.invalidate();
    this.engine.requestRender();
  }

  /** Arabaların üstündeki çamur (0) / köpük (1) lekeleri; temiz (2) nokta görünmez */
  syncDirt() {
    const seen = new Set();
    for (const j of this.state.jobs) {
      const m = this.vehicles.meshes.get(j.carId);
      if (!m) continue;
      seen.add(j.carId);
      let d = this.dirt.get(j.carId);
      if (!d || d.obj !== m.obj) {
        if (d) d.group.removeFromParent();
        const group = new THREE.Group();
        const meshes = dirtSpotsLocal(j.model).map((s) => {
          const mesh = new THREE.Mesh(this.mudGeo, this.mudMat);
          // Model yereli: ön +z, sol +x (paylaşılan tabloda sağ +x, ön −z)
          mesh.position.set(-s.x, s.y, -s.z);
          if (s.side) mesh.rotation.z = Math.PI / 2;
          group.add(mesh);
          return mesh;
        });
        m.obj.add(group);
        d = { obj: m.obj, group, meshes, key: '' };
        this.dirt.set(j.carId, d);
      }
      const key = j.spots.join('');
      if (d.key === key) continue;
      d.key = key;
      j.spots.forEach((st, i) => {
        const mesh = d.meshes[i];
        mesh.visible = st < 2;
        mesh.geometry = st === 1 ? this.foamGeo : this.mudGeo;
        mesh.material = st === 1 ? this.foamMat : this.mudMat;
      });
    }
    for (const [id, d] of this.dirt) {
      if (seen.has(id)) continue;
      d.group.removeFromParent();
      this.dirt.delete(id);
    }
  }

  /** Arabanın park yeri (sunucu listesi) */
  car(j) { return this.vehicles.byId?.get(j.carId) ?? null; }

  /** Yıkama bölmesinde park etmiş (sürücüsüz) VIP aracı olan iş */
  washJob() {
    return this.state.jobs.find((j) => {
      const v = this.car(j);
      return j.state === 'keys' && v && v.driver == null && inWashBay(v.x, v.z);
    }) ?? null;
  }

  // ---- Etkileşim ------------------------------------------------------------------------------

  findTarget(px, pz, f) {
    if (this.vehicles.seat || this.spraying || this.pending) return null;
    const near = (x, z, range, cone = 0.35) => {
      const dx = x - px;
      const dz = z - pz;
      const d = Math.hypot(dx, dz);
      if (d > range) return null;
      if (d > 0.8 && (dx * f.x + dz * f.z) / d < cone) return null;
      return d;
    };
    // Sokak: vale kürsüsü
    const S = VALET.stand;
    if (near(S.point[0], S.point[1] + 0.4, S.range) !== null) {
      const wait = this.state.jobs.find((j) => j.state === 'waiting');
      const mine = this.myJob;
      const at = { x: S.x, z: S.z, marker: false, short: 'Vale' };
      if (mine) return { ...at, label: `🔑 Anahtar sende: ${CAR_BY_ID[mine.model]?.name} — garaja çek, V-1…V-3'e park et`, use: () => this.hud.toast('Önce elindeki VIP aracını teslim et.', 'info') };
      if (wait) {
        const name = CAR_BY_ID[wait.model]?.name ?? 'araba';
        return { ...at, label: `🔑 VIP anahtarını al: ${wait.customer} · ${name} (€${wait.fee} + bahşiş)`, use: () => this.keys(wait) };
      }
      return { ...at, label: '⭐ Vale kürsüsü — VIP müşteri bekleniyor', use: () => this.hud.toast('VIP müşteriler 08:00–22:00 arasında lüks arabalarıyla gelir.', 'info') };
    }
    // Garaj: tabanca askısı
    const K = VALET.rack;
    const wj = this.washJob();
    if (near(K.point[0], K.point[1], K.range, 0.2) !== null) {
      const want = wj && wj.stage !== 'done' ? STAGE_TOOL[wj.stage] : null;
      const at = { x: K.x, z: K.z, marker: false };
      if (want && this.tool !== want) return { ...at, short: TOOL[want].icon, label: `${TOOL[want].icon} ${TOOL[want].name}nı al`, use: () => this.setTool(want) };
      if (this.tool) return { ...at, short: 'As', label: `↩ ${TOOL[this.tool].name}nı askıya as`, use: () => this.setTool(null) };
      return { ...at, short: '🧴', label: '🧴 Köpük tabancasını al', use: () => this.setTool('foam') };
    }
    // Çamurlu noktalar
    if (!wj || wj.stage === 'done') return null;
    const v = this.car(wj);
    if (Math.hypot(v.x - px, v.z - pz) > R.WASH_RANGE) return null;
    const need = STAGE_TOOL[wj.stage];
    if (this.tool !== need) {
      return { x: v.x, z: v.z, marker: false, short: TOOL[need].icon, label: `🫧 Önce askıdan ${TOOL[need].lower}nı al`, use: () => this.hud.toast(`Bölmenin batı duvarındaki askıdan ${TOOL[need].lower}nı al.`, 'info') };
    }
    const want = wj.stage === 'foam' ? 0 : 1;
    const left = wj.spots.filter((s) => s === want).length;
    const spots = dirtSpotsLocal(wj.model);
    let best = null;
    let bestScore = Infinity;
    spots.forEach((s, i) => {
      if (wj.spots[i] !== want) return;
      const [x, z] = localToWorld(v.x, v.z, v.yaw, s.x, s.z);
      const dx = x - px;
      const dz = z - pz;
      const d = Math.hypot(dx, dz);
      if (d > R.WASH_RANGE) return;
      const dot = d > 1e-3 ? (dx * f.x + dz * f.z) / d : 1;
      if (dot < 0.8) return;
      const score = d - dot * 2;
      if (score < bestScore) {
        bestScore = score;
        best = { i, x, z, y: s.y };
      }
    });
    if (!best) return null;
    const t = TOOL[need];
    return {
      x: best.x, z: best.z, marker: true, short: t.icon,
      label: `${t.icon} ${t.verb} (${left} nokta kaldı · ${(R.SPRAY_MS[need] / 1000).toFixed(1)} sn)`,
      use: () => this.spray(wj, best),
    };
  }

  /** main.js onAction zinciri: püskürtürken girdi yutulur */
  onAction() { return !!(this.spraying || this.pending); }

  async keys(j) {
    if (this.pending) return;
    this.pending = true;
    const res = await this.net.request(EVT.VALET_ACT, { act: 'keys', job: j.id });
    this.pending = false;
    if (!res?.ok) {
      this.hud.toast(res?.error || 'Olmadı.', 'warn');
      return;
    }
    this.sound('clink');
    this.hud.toast(`🔑 Anahtar sende! ${CAR_BY_ID[j.model]?.name} — istediğin gibi sür; garajdaki 🫧 Oto Yıkama'da yıka, V-1…V-3'e park et. Hasarsız + yıkanmış = büyük bahşiş.`, 'info');
    this.renderHud();
  }

  async setTool(tool) {
    if (this.pending) return;
    this.pending = true;
    const res = await this.net.request(EVT.VALET_ACT, { act: 'tool', tool });
    this.pending = false;
    if (!res?.ok) {
      this.hud.toast(res?.error || 'Olmadı.', 'warn');
      return;
    }
    this.tool = res.tool ?? null;
    this.gun.setTool(this.tool);
    this.sound('clink');
    this.interaction.invalidate();
    this.engine.requestRender();
  }

  async spray(j, spot) {
    if (this.spraying || this.pending) return;
    const tool = this.tool;
    this.pending = true;
    const res = await this.net.request(EVT.VALET_ACT, { act: 'spray', job: j.id, spot: spot.i, step: 'begin' });
    this.pending = false;
    if (!res?.ok) {
      this.hud.toast(res?.error || 'Olmadı.', 'warn');
      return;
    }
    const ms = res.ms ?? R.SPRAY_MS[tool];
    const now = performance.now();
    this.spraying = { job: j.id, spot: spot.i, tool, t0: now, ms, target: new THREE.Vector3(spot.x, spot.y, spot.z) };
    this.player.lockUntil = now + ms;
    this.interaction.setBusy(TOOL[tool].busy);
    this.el.progress.hidden = false;
    this.el.fill.style.transform = 'scaleX(0)';
    this.sound('spray', ms, tool === 'foam');
    this.engine.wake();
  }

  async finishSpray() {
    const s = this.spraying;
    this.spraying = null;
    this.el.progress.hidden = true;
    this.interaction.setBusy(null);
    this.gun.pose(0);
    this.pending = true;
    const res = await this.net.request(EVT.VALET_ACT, { act: 'spray', job: s.job, spot: s.spot, step: 'finish' });
    this.pending = false;
    if (!res?.ok) this.hud.toast(res?.error || 'Olmadı.', 'warn');
    this.interaction.invalidate();
  }

  sound(name, ...args) {
    if (!this.settings.sound) return;
    this.sfx?.[name]?.(...args);
  }

  // ---- Kare ----------------------------------------------------------------------------------

  /** @returns {boolean} animasyon sürüyor mu */
  update(dt) {
    let active = false;
    if (this.gun.layout() && this.gun.root.visible) {
      this.gun.pose(this.spraying ? 1 : 0);
      active = true;
    }
    // Araca binince tabanca saklanır (sunucuda elde kalır)
    const showGun = !!this.tool && !this.vehicles.seat;
    if (this.gun.root.visible !== showGun) {
      this.gun.root.visible = showGun;
      active = true;
    }
    const s = this.spraying;
    if (s) {
      const t = performance.now();
      const k = Math.min(1, (t - s.t0) / s.ms);
      this.el.fill.style.transform = `scaleX(${k.toFixed(3)})`;
      this.gun.pose(1, t / 1000);
      this.emit(s, dt);
      if (k >= 1) this.finishSpray();
      active = true;
    }
    if (this.updateParticles(dt)) active = true;
    this.checkHit();
    return active;
  }

  /** Namludan hedefe doğru parçacık */
  emit(s, dt) {
    const cam = this.engine.camera;
    cam.getWorldDirection(_f);
    _v.copy(cam.position).addScaledVector(_f, 0.5);
    _v.y -= 0.2;
    const right = new THREE.Vector3().crossVectors(_f, cam.up).normalize();
    _v.addScaledVector(right, 0.15);
    const n = Math.max(1, Math.round(dt * 60));
    for (let i = 0; i < n; i++) {
      const p = this.particles.find((q) => !q.visible);
      if (!p) break;
      const dir = s.target.clone().sub(_v);
      const dist = dir.length();
      dir.normalize();
      const sp = s.tool === 'water' ? 9 : 5;
      const jit = s.tool === 'water' ? 0.25 : 0.6;
      p.position.copy(_v);
      p.material = this.pMats[s.tool];
      p.scale.setScalar(s.tool === 'foam' ? 1.6 : 0.8);
      p.userData.vx = dir.x * sp + (Math.random() - 0.5) * jit;
      p.userData.vy = dir.y * sp + (Math.random() - 0.5) * jit + 0.6;
      p.userData.vz = dir.z * sp + (Math.random() - 0.5) * jit;
      p.userData.life = Math.min(0.9, dist / sp + 0.08);
      p.visible = true;
    }
  }

  updateParticles(dt) {
    let any = false;
    for (const p of this.particles) {
      if (!p.visible) continue;
      const u = p.userData;
      u.life -= dt;
      if (u.life <= 0) {
        p.visible = false;
        continue;
      }
      u.vy -= 6 * dt;
      p.position.x += u.vx * dt;
      p.position.y += u.vy * dt;
      p.position.z += u.vz * dt;
      any = true;
    }
    return any;
  }

  /** Sürerken ani hız kaybı (duvara / arabaya çarpma) → sunucuya bildir */
  checkHit() {
    const seat = this.vehicles.seat;
    const mine = this.myJob;
    if (seat?.seat !== 'driver' || !mine || seat.id !== mine.carId) {
      this.prevVel = 0;
      return;
    }
    const v = Math.abs(this.player.vel);
    const prev = this.prevVel;
    this.prevVel = v;
    // PlayerController duvara sürtünce hızı tek karede %60 düşürür; frenle bu kadar düşmez
    if (prev > 1.8 && v < prev * 0.55) {
      const now = performance.now();
      if (now - this.hitSentAt < R.HIT_GAP_MS) return;
      this.hitSentAt = now;
      this.net.request(EVT.VALET_ACT, { act: 'hit', kmh: Math.round(prev * 3.6 * 10) / 10 });
      if (this.settings.sound) this.sfx?.clink?.();
    }
  }

  // ---- HUD ----------------------------------------------------------------------------------

  renderHud() {
    const e = this.el.hud;
    const mine = this.myJob;
    const wj = !mine ? this.washJob() : null;
    const j = mine ?? (wj && this.inGarageBay() ? wj : null);
    if (!j) {
      if (!e.hidden) e.hidden = true;
      return;
    }
    const v = this.car(j);
    const name = CAR_BY_ID[j.model]?.name ?? 'Araba';
    const left = j.deadline ? j.deadline - this.net.serverNow() : 0;
    const clean = j.spots.filter((s) => s === 2).length;
    let next;
    if (j.stage === 'done') next = '✨ Yıkandı → V-1…V-3 vale park yerine park et ve in';
    else if (v && inWashBay(v.x, v.z) && v.driver == null) next = j.stage === 'foam' ? '🧴 Askıdan köpük tabancasını al, çamura nişan al, E' : '💦 Tazyikli su tabancasıyla köpüğü durula';
    else if (v && valetBayAt(v.x, v.z)) next = 'Arabadan in → teslim';
    else next = '🫧 Garajdaki Oto Yıkama bölmesine çek (bahşiş ×2.5) ya da V-1…V-3\'e park et';
    const tip = valetTip({ model: j.model, washed: j.stage === 'done', damage: j.damage, late: left < 0, fast: false });
    const lines = [
      `🔑 VIP: ${j.customer} · ${name}${mine ? '' : ` · vale: ${j.holderName}`}`,
      `${left >= 0 ? `⏱ ${mmss(left)}` : '⏰ süre doldu'} · 🧽 Temiz ${clean}/${j.spots.length} · 💥 Hasar %${j.damage} · 💶 ~€${tip} bahşiş`,
      `→ ${next}`,
    ];
    const text = lines.join('\n');
    if (e.textContent !== text) e.textContent = text;
    e.classList.toggle('late', left < 0);
    e.classList.toggle('hurt', j.damage >= R.NO_TIP_DAMAGE);
    if (e.hidden) e.hidden = false;
  }

  inGarageBay() {
    const { x, z } = this.player.pos;
    return inWashBay(x, z, 2.5);
  }
}
