import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { EVT } from '/shared/constants.js';
import { HOUSE, isInsideHouse } from '/shared/layout.js';
import {
  FURNITURE, FURNITURE_BY_ID, HOUSE_RULES, itemBox, itemRotationY, candidateFromPoint,
  validatePlacement, itemAtPoint, blocksPlayer,
} from '/shared/house.js';
import { buildFurniture, makeGlowTexture } from './FurnitureModels.js';

const DOOR_OPEN = (Math.PI / 2) * 0.9;
const LIGHTS_OFF = 0.26; // ışıklar kapalıyken ev kabuğu ve mobilyaların parlaklığı
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _one = new THREE.Vector3(1, 1, 1);
const _up = new THREE.Vector3(0, 1, 0);
const _dir = new THREE.Vector3();
// Sunucu konumu ~100 ms geriden gelir: istemci biraz daha katı davranır ki
// yeşil görünen yerleşim sunucuda reddedilmesin
const REACH_MARGIN = 0.25;

/**
 * Bizim Ev: eşyaların çizimi, dekorasyon modu, ışık anahtarı, kapı.
 *
 * Performans: tüm mobilyalar (en fazla 80) üç birleştirilmiş mesh'e toplanır
 * (ışık alan / kendi ışığı olan / LED duvar ışığı). Eşya eklenip kaldırıldığında
 * — nadir bir olay — geometri yeniden birleştirilir; karede ekstra iş yoktur.
 * LED "ışıkları" gerçek ışık kaynağı değildir (pahalı); duvara vuran additive
 * bir degrade ile taklit edilir.
 */
export class HouseSystem {
  constructor({ engine, building, collision, net, hud, interaction, player, remotes, device, tv }) {
    this.engine = engine;
    this.scene = engine.scene;
    this.building = building;
    this.collision = collision;
    this.net = net;
    this.hud = hud;
    this.interaction = interaction;
    this.player = player;
    this.remotes = remotes;
    this.device = device;
    this.tv = tv;

    this.items = new Map();
    this.getWallet = () => Infinity; // main.js bağlar (coffee shop cüzdanı)
    this.selfId = null; // iade önizlemesi için (yalnızca kendi aldığın eşya)
    this.lightsOn = true;
    this.inside = false;
    this.greeted = false;
    this.colliders = [];
    this.screens = new Map(); // itemId → mesh

    this.solidMat = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.unlitMat = new THREE.MeshBasicMaterial({ vertexColors: true });
    this.glowMat = new THREE.MeshBasicMaterial({
      map: makeGlowTexture(), vertexColors: true, transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    this.meshes = { solid: null, unlit: null, glow: null };
    this.dimmable = [...building.shell, this.solidMat].map((m) => ({ m, base: m.color.clone() }));

    this.screenGeo = new THREE.PlaneGeometry(1, 1);
    this.screenOff = new THREE.MeshBasicMaterial({ color: 0x0b0c10 });

    // Dekorasyon modu
    this.build = { active: false, sel: 0, color: 0, rot: 0, cand: null, check: null, target: null, ghostKey: '' };
    this.ghost = new THREE.Group();
    this.ghost.visible = false;
    this.ghostMat = new THREE.MeshBasicMaterial({ color: 0x3cff7a, transparent: true, opacity: 0.45, depthWrite: false });
    this.scene.add(this.ghost);
    this.targetBox = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)),
      new THREE.LineBasicMaterial({ color: 0xff4f4f }),
    );
    this.targetBox.visible = false;
    this.scene.add(this.targetBox);

    const $ = (id) => document.getElementById(id);
    this.el = {
      btn: $('btn-build'),
      bar: $('build-bar'),
      list: $('build-items'),
      colors: $('build-colors'),
      hint: $('build-hint'),
    };
    this.el.btn.addEventListener('click', () => this.toggleBuild());
    $('build-rotate').addEventListener('click', () => this.command('rotate'));
    $('build-remove').addEventListener('click', () => this.command('remove'));
    $('build-close').addEventListener('click', () => this.toggleBuild(false));
    this.el.list.addEventListener('click', (e) => {
      const b = e.target.closest('[data-i]');
      if (b) this.command(`select:${b.dataset.i}`);
    });
    this.el.colors.addEventListener('click', (e) => {
      const b = e.target.closest('[data-c]');
      if (!b) return;
      this.build.color = Number(b.dataset.c);
      this.changed();
    });
    if (device.touch) this.el.hint.textContent = 'Eşyayı seç, yere bak, Aksiyon ile yerleştir.';

    interaction.addProvider({ find: (px, pz, f) => this.findTarget(px, pz, f) });
  }

  // ---- Sunucu durumu -----------------------------------------------------------

  applySnapshot(house) {
    this.items.clear();
    for (const it of house?.items ?? []) this.items.set(it.id, it);
    this.setLights(house?.lightsOn !== false);
    this.rebuild();
    for (const it of this.items.values()) if (it.type === 'tv') this.tv.syncScreen(it);
    // Bağlantı kopukken kaçırılan TV olaylarını (kaldırma, durdurma, yeni video) telafi et
    this.tv.reconcile(this.items);
  }

  onAdded(item) {
    this.items.set(item.id, item);
    this.rebuild();
  }

  onRemoved(id) {
    const it = this.items.get(id);
    this.items.delete(id);
    if (it?.type === 'tv') this.tv.onTvRemoved(id);
    this.rebuild();
  }

  onTvState({ itemId, video }) {
    const it = this.items.get(itemId);
    if (!it) return;
    it.video = video;
    this.tv.syncScreen(it);
    this.tv.onState(it);
    this.interaction.invalidate();
  }

  setLights(on) {
    this.lightsOn = on;
    for (const { m, base } of this.dimmable) m.color.copy(base).multiplyScalar(on ? 1 : LIGHTS_OFF);
    this.interaction.invalidate();
    this.engine.requestRender();
  }

  tvItems() {
    return [...this.items.values()].filter((it) => it.type === 'tv');
  }

  // ---- Çizim (birleştirilmiş geometri) ---------------------------------------------

  rebuild() {
    const groups = { solid: [], unlit: [], glow: [] };
    const seenTv = new Set();
    for (const it of this.items.values()) {
      const def = FURNITURE_BY_ID[it.type];
      if (!def) continue;
      const parts = buildFurniture(def, def.colors[it.color] ?? def.colors[0]);
      _m.compose(_p.set(it.x, 0, it.z), _q.setFromAxisAngle(_up, itemRotationY(def, it.rot)), _one);
      for (const key of ['solid', 'unlit', 'glow']) {
        for (const g of parts[key]) groups[key].push(g.applyMatrix4(_m));
      }
      if (parts.screen) {
        seenTv.add(it.id);
        this.placeScreen(it, parts.screen);
      }
    }
    for (const [id, mesh] of this.screens) {
      if (seenTv.has(id)) continue;
      this.scene.remove(mesh);
      this.screens.delete(id);
    }
    this.replaceMesh('solid', groups.solid, this.solidMat, true);
    this.replaceMesh('unlit', groups.unlit, this.unlitMat, false);
    this.replaceMesh('glow', groups.glow, this.glowMat, false);
    this.rebuildColliders();
    this.interaction.invalidate();
    this.engine.requestRender();
  }

  replaceMesh(key, list, material, shadows) {
    const old = this.meshes[key];
    if (old) {
      this.scene.remove(old);
      old.geometry.dispose();
      this.meshes[key] = null;
    }
    if (!list.length) return;
    const geo = mergeGeometries(list, false);
    for (const g of list) g.dispose();
    if (!geo) return;
    const mesh = new THREE.Mesh(geo, material);
    mesh.matrixAutoUpdate = false;
    mesh.receiveShadow = shadows;
    if (key === 'glow') mesh.renderOrder = 3;
    this.scene.add(mesh);
    this.meshes[key] = mesh;
  }

  placeScreen(it, s) {
    let mesh = this.screens.get(it.id);
    if (!mesh) {
      mesh = new THREE.Mesh(this.screenGeo, this.screenOff);
      mesh.matrixAutoUpdate = false;
      this.scene.add(mesh);
      this.screens.set(it.id, mesh);
    }
    const def = FURNITURE_BY_ID.tv;
    const ry = itemRotationY(def, it.rot);
    mesh.position.set(it.x + Math.sin(ry) * s.z, s.y, it.z + Math.cos(ry) * s.z);
    mesh.rotation.set(0, ry, 0);
    mesh.scale.set(s.w, s.h, 1);
    mesh.updateMatrix();
  }

  /** TvSystem ekran malzemesini (küçük resim / kapalı) atar */
  setScreenMaterial(itemId, material) {
    const mesh = this.screens.get(itemId);
    if (!mesh) return;
    mesh.material = material || this.screenOff;
    this.engine.requestRender();
  }

  rebuildColliders() {
    for (const c of this.colliders) this.collision.remove(c);
    this.colliders = [];
    for (const it of this.items.values()) {
      const def = FURNITURE_BY_ID[it.type];
      if (!def || def.layer !== 'floor') continue;
      const b = itemBox(def, it);
      const s = 0.04;
      this.colliders.push(this.collision.add(b.minX + s, b.maxX - s, b.minZ + s, b.maxZ - s));
    }
  }

  // ---- Etkileşim (TV, ışık anahtarı) -----------------------------------------------

  findTarget(px, pz, f) {
    if (!isInsideHouse(px, pz) || this.build.active) return null;
    let best = null;
    let bestD = Infinity;
    const consider = (x, z, range, make) => {
      const dx = x - px;
      const dz = z - pz;
      const d = Math.hypot(dx, dz);
      if (d > range) return;
      const dot = d > 1e-3 ? (dx * f.x + dz * f.z) / d : 1;
      if (d > 0.9 && dot < 0.35) return;
      if (d < bestD) {
        bestD = d;
        best = make();
      }
    };
    for (const it of this.tvItems()) {
      const ry = it.rot * (Math.PI / 2);
      const x = it.x + Math.sin(ry) * 0.5;
      const z = it.z + Math.cos(ry) * 0.5;
      consider(x, z, HOUSE_RULES.TV_RANGE, () => ({
        x, z, marker: false,
        label: it.video ? `📺 TV — ${it.video.title || 'oynatılıyor'}` : '📺 Televizyon — YouTube aç',
        use: () => this.tv.open(it),
      }));
    }
    const [sx, sz] = HOUSE.lightSwitch;
    consider(sx, sz + 0.3, HOUSE_RULES.SWITCH_RANGE, () => ({
      x: sx, z: sz + 0.3, marker: false,
      label: this.lightsOn ? '💡 Işıkları kapat (LED partisi)' : '💡 Işıkları aç',
      use: () => this.toggleLights(),
    }));
    return best;
  }

  async toggleLights() {
    const res = await this.net.request(EVT.HOUSE_LIGHTS, {});
    if (!res.ok) this.hud.toast(res.error || 'Olmadı.', 'warn');
  }

  // ---- Kare güncellemesi ----------------------------------------------------------

  /** @returns {boolean} animasyon sürüyor mu */
  update(dt) {
    let active = false;
    const { x, z } = this.player.pos;
    const inside = isInsideHouse(x, z);
    if (inside !== this.inside) this.onInsideChange(inside);

    // Kapı: yaklaşınca açılır
    const door = this.building.door;
    const near = Math.hypot(x - (HOUSE.door.from + HOUSE.door.to) / 2, z) < 2.4;
    const target = near ? 1 : 0;
    if (door.t !== target) {
      const step = dt * 2.6;
      door.t = Math.abs(target - door.t) <= step ? target : door.t + Math.sign(target - door.t) * step;
      door.pivot.rotation.y = -DOOR_OPEN * door.t;
      active = true;
    }

    if (this.build.active) this.updateBuild();
    return active;
  }

  onInsideChange(inside) {
    this.inside = inside;
    this.el.btn.hidden = !inside;
    if (inside) {
      this.tv.onEnterHouse(this.tvItems());
      if (!this.greeted) {
        this.greeted = true;
        this.hud.toast(`🏠 Bizim Ev! ${this.device.touch ? '🛠 Dekor butonu' : 'B tuşu'} ile dekorasyon modunu aç.`, 'info');
      }
    } else {
      if (this.build.active) this.toggleBuild(false);
      this.tv.onLeaveHouse();
    }
  }

  // ---- Dekorasyon modu ------------------------------------------------------------

  /** @returns {boolean} komut işlendi mi (işlenmediyse başka sistemlere geçer) */
  command(cmd) {
    if (cmd === 'build') {
      this.toggleBuild();
      return true;
    }
    if (!this.build.active) return false;
    const b = this.build;
    const def = FURNITURE[b.sel];
    if (cmd === 'rotate') b.rot = (b.rot + 1) % 4;
    else if (cmd === 'color') b.color = (b.color + 1) % def.colors.length;
    else if (cmd === 'remove') this.removeTarget();
    else if (cmd.startsWith('select:')) {
      const i = Number(cmd.slice(7));
      if (!FURNITURE[i]) return true;
      b.sel = i;
      b.color = Math.min(b.color, FURNITURE[i].colors.length - 1);
    } else {
      return false;
    }
    this.changed();
    return true;
  }

  toggleBuild(on = !this.build.active) {
    if (on && !this.inside) {
      this.hud.toast('Dekorasyon için Bizim Ev\'in içinde olmalısın (otelin batısında).', 'info');
      return;
    }
    this.build.active = on;
    this.el.bar.hidden = !on;
    document.body.classList.toggle('building', on);
    this.el.btn.classList.toggle('on', on);
    this.interaction.setEnabled(!on);
    if (on) {
      this.renderCatalog();
    } else {
      this.ghost.visible = false;
      this.targetBox.visible = false;
      this.hud.setPrompt(null);
    }
    this.changed();
  }

  changed() {
    this.renderCatalog();
    this.engine.requestRender();
  }

  renderCatalog() {
    if (!this.build.active) return;
    const b = this.build;
    const list = this.el.list;
    list.replaceChildren();
    FURNITURE.forEach((def, i) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.dataset.i = String(i);
      btn.className = i === b.sel ? 'sel' : '';
      btn.title = `${def.name} · €${def.price}`;
      const icon = document.createElement('span');
      icon.className = 'ic';
      icon.textContent = def.icon;
      const price = document.createElement('span');
      price.className = 'pr';
      price.textContent = `${this.device.touch ? '' : `${i + 1}·`}€${def.price}`;
      btn.append(icon, price);
      list.append(btn);
    });
    const def = FURNITURE[b.sel];
    this.el.colors.replaceChildren();
    def.colors.forEach((c, i) => {
      const sw = document.createElement('button');
      sw.type = 'button';
      sw.dataset.c = String(i);
      sw.className = `sw${i === b.color ? ' sel' : ''}`;
      sw.style.background = c;
      sw.title = 'Renk';
      this.el.colors.append(sw);
    });
  }

  /** Kameranın baktığı zemin noktası */
  floorPoint() {
    const cam = this.engine.camera;
    cam.getWorldDirection(_dir);
    if (_dir.y > -0.05) return null; // zemine bakmıyor
    const t = -cam.position.y / _dir.y;
    if (t > HOUSE_RULES.REACH) return null;
    return { x: cam.position.x + _dir.x * t, z: cam.position.z + _dir.z * t };
  }

  updateBuild() {
    const b = this.build;
    const def = FURNITURE[b.sel];
    const pt = this.floorPoint();
    if (!pt) {
      b.cand = null;
      b.target = null;
      this.ghost.visible = false;
      this.targetBox.visible = false;
      this.hud.setPrompt({ info: 'Eşyayı koymak istediğin yere, zemine bak.' });
      return;
    }
    const c = candidateFromPoint(def, pt.x, pt.z, b.rot);
    b.cand = { type: def.id, x: c.x, z: c.z, rot: c.rot, color: b.color };
    b.check = validatePlacement([...this.items.values()], b.cand);
    const me = this.player.pos;
    // LED en yakın duvara yapıştığı için bakılan noktadan metrelerce uzağa kayabilir
    if (b.check.ok && Math.hypot(c.x - me.x, c.z - me.z) > HOUSE_RULES.REACH - REACH_MARGIN) {
      b.check = { ok: false, error: 'Çok uzak — biraz yaklaş.' };
    }
    if (b.check.ok && blocksPlayer(def, b.cand, me.x, me.z, 0.1)) {
      b.check = { ok: false, error: 'Durduğun yere koyamazsın — biraz geri çekil.' };
    }
    if (b.check.ok) {
      for (const o of this.remotes.positions()) {
        if (!blocksPlayer(def, b.cand, o.x, o.z, 0.15)) continue;
        b.check = { ok: false, error: 'Orada biri duruyor.' };
        break;
      }
    }
    const wallet = this.getWallet();
    if (b.check.ok && wallet < def.price) {
      b.check = { ok: false, error: `${def.name}: €${def.price} gerekli, cüzdanda €${wallet} var. Oda temizle, bahşiş topla.` };
    }

    // Hayalet önizleme (tür/renk değişince yeniden kurulur)
    const key = `${def.id}:${b.color}`;
    if (b.ghostKey !== key) {
      b.ghostKey = key;
      for (const ch of [...this.ghost.children]) {
        this.ghost.remove(ch);
        ch.geometry.dispose();
      }
      const parts = buildFurniture(def, def.colors[b.color]);
      const geos = [...parts.solid, ...parts.unlit];
      if (parts.screen) geos.push(new THREE.BoxGeometry(parts.screen.w, parts.screen.h, 0.01).translate(0, parts.screen.y, parts.screen.z));
      for (const g of geos) {
        g.deleteAttribute('color');
        this.ghost.add(new THREE.Mesh(g, this.ghostMat));
      }
      for (const g of parts.glow) g.dispose();
    }
    this.ghost.position.set(c.x, 0, c.z);
    this.ghost.rotation.set(0, itemRotationY(def, c.rot), 0);
    this.ghost.visible = true;
    this.ghostMat.color.setHex(b.check.ok ? 0x3cff7a : 0xff4f4f);

    // Kaldırma hedefi: bakılan noktadaki eşya
    b.target = itemAtPoint([...this.items.values()], pt.x, pt.z);
    b.targetFar = !!b.target && Math.hypot(b.target.x - me.x, b.target.z - me.z) > HOUSE_RULES.REACH - REACH_MARGIN;
    if (b.target) {
      const td = FURNITURE_BY_ID[b.target.type];
      const box = itemBox(td, b.target);
      const h = td.layer === 'wall' ? 0.3 : Math.max(0.05, td.h);
      const y = td.layer === 'wall' ? HOUSE_RULES.LED_HEIGHT : h / 2;
      this.targetBox.position.set((box.minX + box.maxX) / 2, y, (box.minZ + box.maxZ) / 2);
      this.targetBox.scale.set(box.maxX - box.minX + 0.04, h + 0.04, box.maxZ - box.minZ + 0.04);
      this.targetBox.visible = true;
    } else {
      this.targetBox.visible = false;
    }

    const key2 = this.device.touch ? null : 'E';
    const text = b.check.ok ? `${def.icon} ${def.name} yerleştir · €${def.price}` : b.check.error;
    this.hud.setPrompt(b.check.ok ? { key: key2, text } : { info: `⚠ ${text}` });
    const t = b.target ? FURNITURE_BY_ID[b.target.type] : null;
    // İade yalnızca bu oturumda kendi aldığın eşyaya (sunucu kuralı)
    const refund = t && b.target.byId === this.selfId ? Math.floor(t.price * HOUSE_RULES.REFUND) : 0;
    const removeKey = this.device.touch ? '🗑' : 'X';
    let removeText = null;
    if (t && b.targetFar) removeText = `${t.icon} ${t.name} — kaldırmak için yaklaş`;
    else if (t) removeText = `${removeKey}: ${t.icon} ${t.name} kaldır${refund ? ` (+€${refund})` : ''}`;
    this.el.hint.textContent = removeText
      || (this.device.touch
        ? 'Eşyayı seç, yere bak, Aksiyon ile yerleştir.'
        : '1-9 eşya · C renk · R döndür · E yerleştir · X kaldır · B çık');
  }

  async place() {
    const b = this.build;
    if (!b.cand) return;
    if (!b.check?.ok) {
      this.hud.toast(b.check?.error || 'Buraya konmaz.', 'warn');
      return;
    }
    const def = FURNITURE_BY_ID[b.cand.type];
    const res = await this.net.request(EVT.HOUSE_PLACE, b.cand);
    if (res.ok) this.hud.toast(`${def.icon} ${def.name} yerleştirildi (−€${def.price})`, 'money');
    else this.hud.toast(res.error || 'Yerleştirilemedi.', 'warn');
  }

  async removeTarget() {
    const t = this.build.target;
    if (!t) {
      this.hud.toast('Kaldırmak için eşyanın durduğu yere bak.', 'info');
      return;
    }
    if (this.build.targetFar) {
      this.hud.toast('Eşyaya yaklaş.', 'info');
      return;
    }
    const def = FURNITURE_BY_ID[t.type];
    const res = await this.net.request(EVT.HOUSE_REMOVE, { id: t.id });
    if (!res.ok) this.hud.toast(res.error || 'Kaldırılamadı.', 'warn');
    else if (res.refund) this.hud.toast(`${def.icon} ${def.name} kaldırıldı (+€${res.refund})`, 'money');
    else this.hud.toast(`${def.icon} ${def.name} kaldırıldı`, 'info');
  }
}
