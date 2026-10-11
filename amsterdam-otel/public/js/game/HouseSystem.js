import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { EVT, possessive } from '/shared/constants.js';
import { HOUSE, HOUSE_BY_ID, SHARED_HOUSE_ID, houseAt } from '/shared/layout.js';
import {
  FURNITURE, FURNITURE_BY_ID, HOUSE_RULES, itemBox, itemRotationY, candidateFromPoint,
  validatePlacement, itemAtPoint, blocksPlayer, wallItemY,
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
const PARTS = ['solid', 'unlit', 'glow'];

/**
 * Evler: Bizim Ev (ortak, herkes dekore eder) + Achterstraat'taki oyuncu evleri.
 * Eşyaların çizimi, dekorasyon modu (yalnızca Bizim Ev'de ya da KENDİ evinde),
 * Bizim Ev'in ışık anahtarı ve kapısı.
 *
 * Performans: her evin mobilyaları üç birleştirilmiş mesh'e toplanır (ışık alan /
 * kendi ışığı olan / LED duvar ışığı). Eşya eklenip kaldırıldığında — nadir bir
 * olay — yalnızca O EVİN geometrisi yeniden birleştirilir; karede ekstra iş yoktur.
 * LED "ışıkları" gerçek ışık kaynağı değildir (pahalı); additive bir degradedir.
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

    this.items = new Map(); // tüm evlerin eşyaları (item.houseId)
    this.getWallet = () => Infinity; // main.js bağlar (coffee shop cüzdanı)
    this.selfId = null; // iade önizlemesi için (Bizim Ev'de yalnızca kendi aldığın eşya)
    this.ownedHouseId = null; // oyuncunun kendi evi (sunucudan: self.houseId)
    this.owners = new Map(); // houseId → { name, online, playerId } | null
    this.accessCheck = () => false; // HouseVisitingSystem bağlar: zili çalıp içeri alındın mı
    this.plantView = () => null; // HerbalBotanySystem bağlar: saksıdaki bitkinin görünümü { kind, stage }
    this.lightsOn = true;
    this.houseId = null; // oyuncunun şu an içinde olduğu ev
    this.greeted = new Set();
    this.groups = new Map(); // houseId → { meshes: {solid, unlit, glow}, colliders: [] }
    this.screens = new Map(); // itemId → mesh (TV ekranı)

    // Bizim Ev'in mobilyaları ışık anahtarıyla kararır; oyuncu evlerininki kararmaz
    this.solidMat = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.privateSolidMat = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.unlitMat = new THREE.MeshBasicMaterial({ vertexColors: true });
    this.glowMat = new THREE.MeshBasicMaterial({
      map: makeGlowTexture(), vertexColors: true, transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
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

  // ---- Yetki ---------------------------------------------------------------------

  /** Bu evi dekore edebilir mi: Bizim Ev herkese, oyuncu evi yalnızca sahibine */
  canBuild(houseId) {
    return houseId === SHARED_HOUSE_ID || (houseId !== null && houseId === this.ownedHouseId);
  }

  /** TV'yi kullanabilir mi (sunucu yine doğrular): Bizim Ev, kendi evin ya da içeri alındığın ev */
  canUseTv(houseId) {
    return houseId === SHARED_HOUSE_ID || houseId === this.ownedHouseId || this.accessCheck(houseId);
  }

  ownerName(houseId) {
    return this.owners.get(houseId)?.name ?? null;
  }

  // ---- Sunucu durumu -----------------------------------------------------------

  applySnapshot(house) {
    this.items.clear();
    for (const it of house?.items ?? []) {
      it.houseId = it.houseId || SHARED_HOUSE_ID;
      this.items.set(it.id, it);
    }
    if (Array.isArray(house?.owners)) this.setOwners(house.owners);
    this.setLights(house?.lightsOn !== false);
    for (const id of new Set([...this.groups.keys(), ...[...this.items.values()].map((it) => it.houseId)])) this.rebuild(id);
    for (const it of this.items.values()) if (it.type === 'tv') this.tv.syncScreen(it);
    // Bağlantı kopukken kaçırılan TV olaylarını (kaldırma, durdurma, yeni video) telafi et
    this.tv.reconcile(this.items);
  }

  /** EVT.HOUSE_OWNERS ya da snapshot.house.owners */
  setOwners(list) {
    for (const o of list) this.owners.set(o.houseId, o.owner ?? null);
    if (this.build.active) this.changed();
  }

  onAdded(item) {
    item.houseId = item.houseId || SHARED_HOUSE_ID;
    this.items.set(item.id, item);
    this.rebuild(item.houseId);
  }

  onRemoved(id) {
    const it = this.items.get(id);
    if (!it) return;
    this.items.delete(id);
    if (it.type === 'tv') this.tv.onTvRemoved(id);
    this.rebuild(it.houseId);
  }

  /** EVT.HOUSE_ITEM: eşyanın durumu değişti (saksıdaki bitki) */
  onItemState({ itemId, plant }) {
    const it = this.items.get(itemId);
    if (!it) return null;
    it.plant = plant ?? null;
    this.rebuild(it.houseId);
    return it;
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

  itemsOf(houseId) {
    const out = [];
    for (const it of this.items.values()) if (it.houseId === houseId) out.push(it);
    return out;
  }

  tvItems(houseId = this.houseId) {
    return this.itemsOf(houseId).filter((it) => it.type === 'tv');
  }

  // ---- Çizim (ev başına birleştirilmiş geometri) --------------------------------------

  rebuild(houseId) {
    let g = this.groups.get(houseId);
    if (!g) {
      g = { meshes: { solid: null, unlit: null, glow: null }, colliders: [] };
      this.groups.set(houseId, g);
    }
    const lists = { solid: [], unlit: [], glow: [] };
    const seenTv = new Set();
    for (const it of this.items.values()) {
      if (it.houseId !== houseId) continue;
      const def = FURNITURE_BY_ID[it.type];
      if (!def) continue;
      const parts = buildFurniture(def, def.colors[it.color] ?? def.colors[0], { color: it.color, plant: this.plantView(it) });
      _m.compose(_p.set(it.x, 0, it.z), _q.setFromAxisAngle(_up, itemRotationY(def, it.rot)), _one);
      for (const key of PARTS) {
        for (const geo of parts[key]) lists[key].push(geo.applyMatrix4(_m));
      }
      if (parts.screen) {
        seenTv.add(it.id);
        this.placeScreen(it, parts.screen);
      }
    }
    for (const [id, mesh] of this.screens) {
      if (mesh.userData.houseId !== houseId || seenTv.has(id)) continue;
      this.scene.remove(mesh);
      this.screens.delete(id);
    }
    const solid = houseId === SHARED_HOUSE_ID ? this.solidMat : this.privateSolidMat;
    this.replaceMesh(g, 'solid', lists.solid, solid, true);
    this.replaceMesh(g, 'unlit', lists.unlit, this.unlitMat, false);
    this.replaceMesh(g, 'glow', lists.glow, this.glowMat, false);
    this.rebuildColliders(g, houseId);
    this.interaction.invalidate();
    this.engine.requestRender();
  }

  replaceMesh(g, key, list, material, shadows) {
    const old = g.meshes[key];
    if (old) {
      this.scene.remove(old);
      old.geometry.dispose();
      g.meshes[key] = null;
    }
    if (!list.length) return;
    const geo = mergeGeometries(list, false);
    for (const x of list) x.dispose();
    if (!geo) return;
    const mesh = new THREE.Mesh(geo, material);
    mesh.matrixAutoUpdate = false;
    mesh.receiveShadow = shadows;
    if (key === 'glow') mesh.renderOrder = 3;
    this.scene.add(mesh);
    g.meshes[key] = mesh;
  }

  placeScreen(it, s) {
    let mesh = this.screens.get(it.id);
    if (!mesh) {
      mesh = new THREE.Mesh(this.screenGeo, this.screenOff);
      mesh.matrixAutoUpdate = false;
      this.scene.add(mesh);
      this.screens.set(it.id, mesh);
    }
    mesh.userData.houseId = it.houseId;
    const def = FURNITURE_BY_ID.tv;
    const ry = itemRotationY(def, it.rot);
    mesh.position.set(it.x + Math.sin(ry) * s.z, s.y, it.z + Math.cos(ry) * s.z);
    mesh.rotation.set(0, ry, 0);
    mesh.scale.set(s.w, s.h, 1);
    mesh.updateMatrix();
  }

  /** InteractiveTV ekran malzemesini (küçük resim / kapalı) atar */
  setScreenMaterial(itemId, material) {
    const mesh = this.screens.get(itemId);
    if (!mesh) return;
    mesh.material = material || this.screenOff;
    this.engine.requestRender();
  }

  rebuildColliders(g, houseId) {
    for (const c of g.colliders) this.collision.remove(c);
    g.colliders = [];
    for (const it of this.items.values()) {
      if (it.houseId !== houseId) continue;
      const def = FURNITURE_BY_ID[it.type];
      if (!def || def.layer !== 'floor') continue;
      const b = itemBox(def, it);
      const s = 0.04;
      g.colliders.push(this.collision.add(b.minX + s, b.maxX - s, b.minZ + s, b.maxZ - s));
    }
  }

  // ---- Etkileşim (TV, Bizim Ev'in ışık anahtarı) -----------------------------------------

  findTarget(px, pz, f) {
    const h = houseAt(px, pz);
    if (!h || this.build.active) return null;
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
    for (const it of this.tvItems(h.id)) {
      const ry = it.rot * (Math.PI / 2);
      const x = it.x + Math.sin(ry) * 0.5;
      const z = it.z + Math.cos(ry) * 0.5;
      consider(x, z, HOUSE_RULES.TV_RANGE, () => ({
        x, z, marker: false, short: 'TV',
        label: it.video ? `📺 TV — ${it.video.title || 'oynatılıyor'}` : '📺 Televizyon — YouTube aç',
        use: () => (this.canUseTv(h.id) ? this.tv.open(it) : this.hud.toast('Bu evin TV\'sini yalnızca ev sahibi ve içeri aldığı misafirler kullanabilir.', 'info')),
      }));
    }
    if (h.lightSwitch) {
      const [sx, sz] = h.lightSwitch;
      consider(sx, sz + 0.3, HOUSE_RULES.SWITCH_RANGE, () => ({
        x: sx, z: sz + 0.3, marker: false, short: 'Işık',
        label: this.lightsOn ? '💡 Işıkları kapat (LED partisi)' : '💡 Işıkları aç',
        use: () => this.toggleLights(),
      }));
    }
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
    const h = houseAt(x, z);
    const id = h ? h.id : null;
    if (id !== this.houseId) this.onHouseChange(id);

    // Bizim Ev'in kapısı: yaklaşınca açılır (oyuncu evlerinin kapıları HouseVisitingSystem'de)
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

  onHouseChange(id) {
    const prev = this.houseId;
    this.houseId = id;
    this.el.btn.hidden = !(id && this.canBuild(id));
    if (prev !== null) {
      if (this.build.active) this.toggleBuild(false);
      this.tv.onLeaveHouse();
    }
    if (id === null) return;
    this.tv.onEnterHouse(id, this.tvItems(id));
    if (this.greeted.has(id)) return;
    this.greeted.add(id);
    const key = this.device.touch ? '🛠 Dekor butonu' : 'B tuşu';
    if (id === SHARED_HOUSE_ID) this.hud.toast(`🏠 Bizim Ev! ${key} ile dekorasyon modunu aç.`, 'info');
    else if (id === this.ownedHouseId) this.hud.toast(`🏡 Evine hoş geldin! ${key} ile dekore et; TV'ye YouTube açabilirsin.`, 'info');
    else {
      const name = this.ownerName(id);
      this.hud.toast(`🚪 ${name ? `${possessive(name)} evindesin` : 'Misafirsin'} — eşyalara dokunamazsın, TV'yi açabilirsin.`, 'info');
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
    else if (cmd === 'selNext' || cmd === 'selPrev') {
      b.sel = (b.sel + (cmd === 'selNext' ? 1 : FURNITURE.length - 1)) % FURNITURE.length;
      b.color = Math.min(b.color, FURNITURE[b.sel].colors.length - 1);
    }
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
    if (on && !this.canBuild(this.houseId)) {
      if (this.houseId) {
        const name = this.ownerName(this.houseId);
        this.hud.toast(`🔒 Bu ev ${name ? possessive(name) : 'başkasının'} — yalnızca ev sahibi düzenleyebilir.`, 'warn');
      } else {
        this.hud.toast('Dekorasyon için kendi evinde (Achterstraat) ya da Bizim Ev\'de olmalısın.', 'info');
      }
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
      price.textContent = `${this.device.touch || i > 8 ? '' : `${i + 1}·`}€${def.price}`;
      btn.append(icon, price);
      list.append(btn);
      if (i === b.sel) requestAnimationFrame(() => btn.scrollIntoView?.({ block: 'nearest', inline: 'nearest' }));
    });
    const def = FURNITURE[b.sel];
    this.el.colors.replaceChildren();
    def.colors.forEach((c, i) => {
      const sw = document.createElement('button');
      sw.type = 'button';
      sw.dataset.c = String(i);
      sw.className = `sw${i === b.color ? ' sel' : ''}`;
      sw.style.background = c;
      sw.title = def.art ? def.art[i] : 'Renk';
      this.el.colors.append(sw);
    });
    // Seçili eşyanın adı (tablolarda eserin adı da)
    const name = document.createElement('span');
    name.className = 'build-name';
    name.textContent = def.art ? `${def.name}: ${def.art[b.color]}` : def.name;
    this.el.colors.append(name);
  }

  /** Kameranın baktığı zemin noktası (ceiling: true → tavandaki nokta) */
  floorPoint(ceiling = false) {
    const cam = this.engine.camera;
    cam.getWorldDirection(_dir);
    let t;
    if (ceiling) {
      if (_dir.y < 0.05) return null; // tavana bakmıyor
      t = (HOUSE_RULES.CEIL_HEIGHT - cam.position.y) / _dir.y;
    } else {
      if (_dir.y > -0.05) return null; // zemine bakmıyor
      t = -cam.position.y / _dir.y;
    }
    if (t > HOUSE_RULES.REACH) return null;
    return { x: cam.position.x + _dir.x * t, z: cam.position.z + _dir.z * t };
  }

  /** Yukarı mı bakıyor (tavan LED'i yerleştirme / kaldırma) */
  lookingUp() {
    this.engine.camera.getWorldDirection(_dir);
    return _dir.y > 0.05;
  }

  updateBuild() {
    const b = this.build;
    const def = FURNITURE[b.sel];
    const h = HOUSE_BY_ID[this.houseId];
    const up = this.lookingUp();
    const pt = this.floorPoint(up);
    const ceil = def.layer === 'ceiling';
    if (!pt || !h) {
      b.cand = null;
      b.target = null;
      this.ghost.visible = false;
      this.targetBox.visible = false;
      this.hud.setPrompt({ info: ceil ? 'Tavan LED\'ini koymak istediğin yere, tavana bak.' : 'Eşyayı koymak istediğin yere, zemine bak.' });
      this.el.hint.textContent = this.device.touch ? 'Eşyayı seç, yere bak, Aksiyon ile yerleştir.' : this.hintText();
      return;
    }
    const here = this.itemsOf(h.id);
    // Kaldırma hedefi: bakılan noktadaki eşya (yalnızca bu evde; tavana bakınca tavan LED'leri)
    b.target = itemAtPoint(here, pt.x, pt.z, { ceiling: up });
    const me = this.player.pos;
    b.targetFar = !!b.target && Math.hypot(b.target.x - me.x, b.target.z - me.z) > HOUSE_RULES.REACH - REACH_MARGIN;
    this.updateTargetBox(b.target);
    this.updateRemoveHint(h, b);
    if (ceil !== up) {
      // Seçili eşya için yanlış yöne bakıyor: önizleme yok
      b.cand = null;
      this.ghost.visible = false;
      this.hud.setPrompt({ info: ceil ? '✨ Tavan LED\'i için tavana bak (R: düz / çapraz).' : 'Eşyayı koymak için zemine bak.' });
      return;
    }
    const c = candidateFromPoint(def, pt.x, pt.z, b.rot, h);
    b.cand = { type: def.id, x: c.x, z: c.z, rot: c.rot, color: b.color };
    b.check = here.length >= h.maxItems
      ? { ok: false, error: `Bu evde en fazla ${h.maxItems} eşya olabilir.` }
      : validatePlacement(here, b.cand, h);
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
      const parts = buildFurniture(def, def.colors[b.color], { color: b.color });
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

    const key2 = this.device.touch ? null : 'E';
    const name = def.art ? `${def.name} (${def.art[b.color]})` : def.name;
    const text = b.check.ok ? `${def.icon} ${name} yerleştir · €${def.price}` : b.check.error;
    this.hud.setPrompt(b.check.ok ? { key: key2, text } : { info: `⚠ ${text}` });
  }

  hintText() {
    return '1-9 / tekerlek eşya · C renk · R döndür · E yerleştir · X kaldır · B çık';
  }

  updateTargetBox(target) {
    if (!target) {
      this.targetBox.visible = false;
      return;
    }
    const td = FURNITURE_BY_ID[target.type];
    const box = itemBox(td, target);
    let ht = Math.max(0.05, td.h);
    let y = ht / 2;
    if (td.layer === 'wall') {
      ht = td.slot === 'mid' ? td.h : 0.3;
      y = wallItemY(td);
    } else if (td.layer === 'ceiling') {
      ht = 0.08;
      y = HOUSE_RULES.CEIL_HEIGHT - 0.04;
    }
    this.targetBox.position.set((box.minX + box.maxX) / 2, y, (box.minZ + box.maxZ) / 2);
    this.targetBox.scale.set(box.maxX - box.minX + 0.04, ht + 0.04, box.maxZ - box.minZ + 0.04);
    this.targetBox.visible = true;
  }

  updateRemoveHint(h, b) {
    const t = b.target ? FURNITURE_BY_ID[b.target.type] : null;
    // İade: Bizim Ev'de yalnızca bu oturumda kendi aldığın eşya; kendi evinde hep (sunucu kuralı); hediye yatağın iadesi yok
    const own = h.id === SHARED_HOUSE_ID ? b.target?.byId === this.selfId : true;
    const refund = t && own && !b.target.starter ? Math.floor(t.price * HOUSE_RULES.REFUND) : 0;
    const removeKey = this.device.touch ? '🗑' : 'X';
    let removeText = null;
    if (t && b.targetFar) removeText = `${t.icon} ${t.name} — kaldırmak için yaklaş`;
    else if (t) removeText = `${removeKey}: ${t.icon} ${t.name} kaldır${refund ? ` (+€${refund})` : ''}${b.target.plant ? ' — bitki de gider!' : ''}`;
    this.el.hint.textContent = removeText
      || (this.device.touch ? 'Eşyayı seç, yere bak, Aksiyon ile yerleştir.' : this.hintText());
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
