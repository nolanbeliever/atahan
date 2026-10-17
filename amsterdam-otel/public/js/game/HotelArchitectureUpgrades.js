import * as THREE from 'three';
import { formatMoney, roomFloor } from '/shared/constants.js';
import {
  ROOMS, BASE_FLOORS, ROOF_FLOOR, floorAt,
} from '/shared/layout.js';
import { ARCH_PACKAGES, VIP, LOUNGE_RULES } from '/shared/architecture.js';
import { StaticBatcher } from '../world/StaticBatcher.js';
import {
  drawHerringbone, drawDamask, drawLuxCarpet, drawDeck, drawPoolWater, drawPoolTile, drawCurtainWall, drawBooks,
} from '../world/LuxuryTextures.js';
import {
  buildLuxFloor, buildRoof, buildFacade, addLuxRoomFurniture,
} from '../world/LuxuryBuilding.js';

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};

// Gece: lüks cephedeki pencerelerin bir kısmı yanar, cam gökdelen maviye döner, çatı fonu kararır
const NIGHT_COLORS = {
  archWinA: [0x2c3a46, 0xffd27a],
  archWinB: [0x3b4d5e, 0x4b5d80],
  curtain: [0xffffff, 0x8fa6e6],
  roofSkyline: [0xffffff, 0x1c2848],
  roofGround: [0x55606a, 0x0c1220],
};

/**
 * Otelin mimari lüks paketleri — istemci (Resepsiyon PC → 🏗️ Yükseltmeler → 💎 Lüks paketler).
 *  - Paket kartları: fiyat, koşullar (4 kat / 4★ / 5★ / önceki paket), kazanımlar; satın alma sunucuda
 *    doğrulanır (EVT.HOTEL_ACT { act: 'buyPackage', pkg }). Durum HOTEL_STATE.arch ile herkese gelir.
 *  - "Lüks Otel": paylaşılan malzemelerin dokuları değişir (balıksırtı parke, damask duvar kâğıdı,
 *    lacivert-altın koridor halısı, maun kapılar), yatak örtüleri şampanya rengi olur; 1–4. kat odalarına
 *    bir kez kurulan statik lüks mobilya grubu eklenir. Sokak cephesi 8 kata çıkar (tente + altın yazı).
 *  - "Ultra Lüks Gökdelen": cephe 12 katlı cam gökdelene döner (taç, anten, tabela); çatı Aqua Park.
 *  - Pil / performans:
 *    · 5–12. katlar ve çatı TEMBEL kurulur: bir kat yalnızca oyuncu oraya ilk kez çıktığında (asansör
 *      kararmasının arkasında) kendi grubuna inşa edilir — paket alınmış ama ziyaret edilmemiş katlar
 *      bellek / draw call harcamaz. Her kat tek StaticBatcher (malzeme başına bir mesh).
 *    · Yalnızca oyuncunun bulunduğu lüks katın grubu görünür (katlar ışınlanmayla bağlı, birbirini
 *      görmez); sokak cephesi yalnızca zemin kat bölgesindeyken çizilir.
 *    · Karede iş: kat numarası karşılaştırması. Havuz suyu ve yüzücüler yalnızca oyuncu çatıdayken
 *      (ve pil tasarrufu kapalıyken) canlanır; başka hiçbir yerde render döngüsünü uyanık tutmaz.
 */
export class HotelArchitectureUpgrades {
  constructor({ engine, net, player, state, world, mats, factory, collision, maint, reception, night }) {
    this.engine = engine;
    this.net = net;
    this.player = player;
    this.state = state;
    this.world = world;
    this.mats = mats;
    this.factory = factory;
    this.collision = collision;
    this.maint = maint;
    this.reception = reception;
    this.level = 0;
    this.lux = null; // lüks malzemeler (ilk etkinleşmede)
    this.facade = null;
    this.floorGroups = new Map(); // kat → THREE.Group (5–12, ROOF_FLOOR)
    this.swimmers = [];
    this.curFloor = -1;
    this.nightT = night?.level ?? 0;
    this.t = 0;

    reception.arch = this;
    reception.onChange.push((h) => this.setState(h));
    // Gece seviyesi: dünyanın geçişine eklen (tek seferlik renk lerp'i)
    const prev = world.setNightLevel;
    world.setNightLevel = (t) => {
      prev.call(world, t);
      this.setNight(t);
    };
    // Lüks paketten sonra kurulan odaların yatak örtüsü de lüks olsun
    const addViews = world.addRoomViews.bind(world);
    world.addRoomViews = (...args) => {
      const views = addViews(...args);
      if (this.lux) for (const v of views) this.luxBlanket(v);
      return views;
    };
  }

  // ---- Durum ----------------------------------------------------------------------------

  /** HOTEL_STATE (ReceptionPC.onChange) */
  setState(h) {
    const level = h.arch?.level ?? 0;
    if (level === this.level && (level === 0 || this.facade)) return;
    this.level = level;
    if (level >= 1) this.activateLuxury();
    if (this.facade) {
      this.facade.tower8.visible = level >= 1;
      this.facade.crown8.visible = level === 1;
      this.facade.tower12.visible = level >= 2;
    }
    this.curFloor = -1; // görünürlükleri yeniden hesapla
    this.engine.requestRender();
  }

  get maxFloor() { return this.reception.hotel.arch?.maxFloor ?? BASE_FLOORS; }

  // ---- Lüks malzemeler / iç mekân ------------------------------------------------------------

  makeMaterials() {
    const f = this.factory;
    const L = (o) => new THREE.MeshLambertMaterial(o);
    const B = (o) => new THREE.MeshBasicMaterial(o);
    const tex = {
      herring: f.make(drawHerringbone, { seed: 41 }),
      herringDark: f.make((c, w, h, r) => drawHerringbone(c, w, h, r, '#5a3820'), { seed: 42 }),
      damask: f.make(drawDamask, { seed: 43 }),
      carpet: f.make(drawLuxCarpet, { seed: 44 }),
      deck: f.make(drawDeck, { seed: 45 }),
      water: f.make(drawPoolWater, { seed: 46 }),
      tile: f.make(drawPoolTile, { seed: 47 }),
      curtain: f.make(drawCurtainWall, { seed: 48 }),
      books: f.make(drawBooks, { seed: 49, w: 2, h: 1, repeat: false }),
    };
    const m = {
      luxVelvet: L({ color: 0x1f4a4a }),
      luxVelvetRed: L({ color: 0x6e1b28 }),
      luxCream: L({ color: 0xf3ead6 }),
      gold: L({ color: 0xd9b24a }),
      crystal: B({ color: 0xeaf6ff }),
      luxMarble: L({ color: 0xf1ede6 }),
      luxMirror: B({ color: 0x8fa8b8 }),
      luxLoungeFloor: L({ map: tex.herringDark }),
      luxCarpetGold: L({ color: 0x7d2433 }),
      luxAwning: L({ color: 0x1f4d3a }),
      jacuzziWater: B({ color: 0x8fe0f0 }),
      glassRail: B({ color: 0xbfe6f5, transparent: true, opacity: 0.32, depthWrite: false }),
      bottleOrange: L({ color: 0xf28c28 }),
      bottleRed: L({ color: 0xd7263d }),
      bottleGreen: L({ color: 0x7fbf3f }),
      bottleYellow: L({ color: 0xf6c90e }),
      bottlePink: L({ color: 0xf28ab2 }),
      books: L({ map: tex.books }),
      fireGlow: B({ color: 0xff8a2a }),
      deck: L({ map: tex.deck }),
      poolTile: L({ map: tex.tile }),
      poolWater: B({ map: tex.water, transparent: true, opacity: 0.88 }),
      slideA: L({ color: 0xff6b35 }),
      slideB: L({ color: 0x2fb7d6 }),
      slideC: L({ color: 0xffd23f }),
      roofSkyline: B({ map: this.mats.skyline.map }),
      roofGround: B({ color: 0x55606a }),
      archWinA: B({ color: NIGHT_COLORS.archWinA[0] }),
      archWinB: B({ color: NIGHT_COLORS.archWinB[0] }),
      curtain: B({ map: tex.curtain }),
      beacon: B({ color: 0xff2a2a }),
      blanket: L({ color: 0xe8d8b0 }),
      blanketVip: L({ color: 0x6e1b28 }),
    };
    return { tex, m, all: { ...this.mats, ...m } };
  }

  /** "Lüks Otel" görünümü (bir kez): doku değişimi + 1–4. kat lüks mobilya + cephe */
  activateLuxury() {
    if (this.lux) return;
    this.lux = this.makeMaterials();
    const { tex } = this.lux;
    const mats = this.mats;
    mats.floorRoom.map = tex.herring;
    mats.wall.map = tex.damask;
    mats.floorCorridor.map = tex.carpet;
    mats.roomDoor.color.setHex(0x3a1f12);
    for (const v of this.world.rooms) this.luxBlanket(v);
    // 1–4. kat odaları: statik lüks mobilya (tek batcher → birkaç draw call)
    const b = new StaticBatcher();
    const group = new THREE.Group();
    group.name = 'arch:base-lux';
    for (const r of ROOMS) if (r.floor <= BASE_FLOORS) addLuxRoomFurniture(b, this.collision, r);
    b.build(this.lux.all, group);
    this.engine.scene.add(group);
    // Sokak cephesi (8 / 12 kat)
    this.facade = buildFacade({ allMats: this.lux.all, factory: this.factory });
    for (const g of [this.facade.tower8, this.facade.crown8, this.facade.tower12]) {
      g.visible = false;
      this.engine.scene.add(g);
    }
    this.setNight(this.nightT);
    this.engine.requestRender();
  }

  luxBlanket(view) {
    const vip = roomFloor(view.id) === VIP.FLOOR;
    view.blanket.material = vip ? this.lux.m.blanketVip : this.lux.m.blanket;
  }

  setNight(t) {
    this.nightT = t;
    if (!this.lux) return;
    const c = new THREE.Color();
    for (const [key, [day, night]] of Object.entries(NIGHT_COLORS)) {
      this.lux.m[key].color.copy(c.setHex(day)).lerp(new THREE.Color(night), t);
    }
  }

  // ---- Tembel kat / çatı inşası ----------------------------------------------------------------

  ensureFloor(f) {
    if (this.floorGroups.has(f) || !this.lux) return;
    const group = new THREE.Group();
    group.name = f === ROOF_FLOOR ? 'arch:roof' : `arch:floor${f}`;
    this.engine.scene.add(group);
    this.floorGroups.set(f, group);
    if (f === ROOF_FLOOR) {
      const { swimmers } = buildRoof({ allMats: this.lux.all, collision: this.collision, factory: this.factory, parent: group });
      this.swimmers = swimmers;
      return;
    }
    const { views } = buildLuxFloor({
      f, allMats: this.lux.all, collision: this.collision, factory: this.factory, world: this.world, maint: this.maint, parent: group,
    });
    // Yeni odalara güncel durum (dolu / kirli, dağınık yatak, çöpler)
    for (const v of views) {
      const st = this.state.rooms.get(v.id);
      if (st) v.applyState(st);
    }
  }

  /** Kare sistemi: bulunduğu kata göre görünürlük; çatıda su animasyonu. @returns animasyon sürüyor mu */
  update(dt) {
    if (!this.lux) return false;
    const floor = floorAt(this.player.pos.x, this.player.pos.z);
    if (floor !== this.curFloor) {
      this.curFloor = floor;
      const open = floor === ROOF_FLOOR ? this.level >= 2 : floor > BASE_FLOORS && floor <= this.maxFloor;
      if (open) this.ensureFloor(floor);
      for (const [f, g] of this.floorGroups) g.visible = f === floor;
      if (this.facade) {
        const street = floor === 1;
        this.facade.tower8.visible = street && this.level >= 1;
        this.facade.crown8.visible = street && this.level === 1;
        this.facade.tower12.visible = street && this.level >= 2;
      }
      this.engine.requestRender();
    }
    if (floor !== ROOF_FLOOR || !this.floorGroups.has(ROOF_FLOOR) || this.engine.batterySaver) return false;
    // Çatı: su dokusu kayar, yüzücüler hafifçe salınır
    this.t += dt;
    const map = this.lux.m.poolWater.map;
    map.offset.set(this.t * 0.02, this.t * 0.012);
    this.swimmers.forEach((s, i) => {
      s.position.y = -0.85 + Math.sin(this.t * 1.6 + i * 1.7) * 0.04;
      s.rotation.y += dt * 0.15 * (i % 2 ? 1 : -1);
    });
    return true;
  }

  // ---- Resepsiyon PC: Lüks paketler -------------------------------------------------------------

  /** "🏗️ Yükseltmeler" sekmesinin sonuna paket kartları */
  renderUpgradeSection(body, pc) {
    const g = pc.growth;
    const money = pc.state.economy?.money ?? 0;
    const sec = el('div', 'arch-sec');
    sec.append(el('h3', 'arch-title', '💎 Lüks paketler'));
    sec.append(el('p', 'pc-small', 'Kasadan ödenir; sırayla alınır. Herkes için hemen geçerli ve kalıcıdır.'));
    for (const pkg of ARCH_PACKAGES) {
      const owned = this.level >= pkg.level;
      const card = el('div', `arch-card${owned ? ' owned' : ''}`);
      const head = el('div', 'arch-head');
      head.append(el('span', 'arch-icon', pkg.icon), el('b', null, `${pkg.name}`), el('span', 'arch-price', owned ? 'Alındı ✓' : formatMoney(pkg.price)));
      card.append(head);
      const reqs = [
        [pkg.level === 1 || this.level >= pkg.level - 1, pkg.level === 1 ? null : `"${ARCH_PACKAGES[pkg.level - 2].name}" paketi`],
        [g.floors >= pkg.needFloors, `${pkg.needFloors} kat açık`],
        [g.stars >= pkg.stars, `en az ${pkg.stars}★ (şu an ${g.stars}★)`],
        [money >= pkg.price, `kasada ${formatMoney(pkg.price)}`],
      ].filter(([, t]) => t);
      if (!owned) {
        const rl = el('div', 'arch-reqs');
        for (const [ok, t] of reqs) rl.append(el('span', ok ? 'ok' : 'bad', `${ok ? '✓' : '✗'} ${t}`));
        card.append(rl);
      }
      const ul = el('ul', 'arch-perks');
      for (const p of pkg.perks) ul.append(el('li', null, p));
      card.append(ul);
      if (!owned) {
        const btn = el('button', 'pc-btn', `${pkg.icon} ${formatMoney(pkg.price)} · Satın al`);
        btn.type = 'button';
        btn.disabled = pkg.level !== this.level + 1 || reqs.some(([ok]) => !ok);
        btn.addEventListener('click', async () => {
          btn.disabled = true;
          const res = await pc.act({ act: 'buyPackage', pkg: pkg.id }, `${pkg.icon} "${pkg.name}" hazır!`);
          if (!res?.ok) btn.disabled = false;
        });
        card.append(btn);
      }
      sec.append(card);
    }
    if (this.level >= 1) {
      const lph = Math.round(2 * LOUNGE_RULES.BASE * 0.75);
      sec.append(el('p', 'pc-small', `🍹 Library + Sky Lounge (alkolsüz) her gün ${LOUNGE_RULES.OPEN_MIN / 60}:00–${LOUNGE_RULES.CLOSE_MIN / 60}:00 arası kasaya saatte ~${formatMoney(lph)} kazandırır (doluluk ve konser / reklam bonusuyla artar).`));
    }
    if (this.level >= 2) sec.append(el('p', 'pc-small', `⭐ VIP misafirler 12. kattaki suitlerde kalır, ${formatMoney(VIP.PRICE)} öder ve çatıdaki VIP bölümünde dinlenir.`));
    body.append(sec);
  }
}
