import * as THREE from 'three';
import { EVT, formatMoney } from '/shared/constants.js';
import { RESTAURANT, isInsideRestaurant } from '/shared/layout.js';
import {
  KITCHEN_INGREDIENTS, KITCHEN_INGREDIENT_BY_ID, COOK_METHODS, DISHES, DISH_BY_ID, DISH_CATS, BUFFET,
  RESTAURANT_RULES as R, matchDish, dishByIngredients,
} from '/shared/restaurant.js';
import { buildHand, prep, VIEW_SCALE, DEPTH } from './ViewModel.js';
import { dishGeometry, dishMaterial, trayGeometry, dirtyStackGeometry, makeDishMesh } from './GourmetRestaurant.js';

// Hareketi kilitleyen (istasyona bağlı) eylemler
const LOCKING = new Set(['cook', 'plate', 'wash', 'restock']);
const BUSY_TEXT = {
  take: '🧊 Buzdolabından alıyorsun…',
  plate: '🍽️ Tabaklıyorsun…',
  pass: '🛎️ Garson tezgâhına koyuyorsun…',
  pick: '🍽️ Tabağı alıyorsun…',
  serve: '🍽️ Servis ediyorsun…',
  clear: '🧽 Masayı topluyorsun…',
  wash: '🫧 Bulaşığı bırakıyorsun…',
  trash: '🗑️ Çöpe atıyorsun…',
  restock: '🍳 Büfeyi tazeliyorsun…',
};
const COOK_TEXT = { pan: '🍳 Tavada pişiriyorsun… (çevir!)', oven: '🔥 Taş fırında pişiyor…', board: '🔪 Tezgâhta hazırlıyorsun…' };

const sameSet = (a, b) => a.length === b.length && [...a].sort().join() === [...b].sort().join();
const recipeIcons = (d) => d.ingredients.map((i) => KITCHEN_INGREDIENT_BY_ID[i].icon).join(' ');
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};

// ---- Birinci şahıs mutfak elleri ---------------------------------------------------------------

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const seg = (k, a, b) => clamp01((k - a) / (b - a));
const inOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const lerp = (a, b, t) => a + (b - a) * t;

/** Anahtar kareler: [[k, [dx,dy,dz,rx,ry,rz]], ...] → aradeğer */
function track(k, keys, out) {
  let i = 0;
  while (i < keys.length - 1 && k >= keys[i + 1][0]) i++;
  const a = keys[i];
  const b = keys[Math.min(i + 1, keys.length - 1)];
  const e = a === b ? 0 : inOut(seg(k, a[0], b[0]));
  for (let j = 0; j < 6; j++) out[j] = lerp(a[1][j], b[1][j], e);
  return out;
}
const Z6 = [0, 0, 0, 0, 0, 0];
const REACH = [-0.06, 0.02, -0.2, -0.25, 0, 0];
const DOWN = [0, -0.32, 0.02, 0.3, 0, 0];

/**
 * Mutfak elleri: tepsi (malzemeler) / tava / fırın küreği / tabak / kirli tabak yığını. ViewModel'in el
 * modelini ve "küçültme" hilesini kullanır (kameraya bağlı kök 0.35 ölçekte). Pil: animasyon yokken
 * update() false döner ve hiçbir şey kıpırdamaz.
 */
class KitchenHands {
  constructor({ engine, settings }) {
    this.engine = engine;
    this.settings = settings || {};
    this.camera = engine.camera;
    if (this.camera.parent !== engine.scene) engine.scene.add(this.camera);
    this.hold = null;
    this.anim = null;
    this.layoutKey = '';
    this.anchor = [0, 0, 0];
    this.anchorL = [0, 0, 0];
    this._p = [0, 0, 0, 0, 0, 0];

    const skin = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.root = new THREE.Group();
    this.root.name = 'kitchen-hands';
    this.root.scale.setScalar(VIEW_SCALE);
    this.root.visible = false;
    this.camera.add(this.root);
    this.right = new THREE.Group();
    this.left = new THREE.Group();
    this.right.add(prep(new THREE.Mesh(buildHand(1), skin)));
    this.left.add(prep(new THREE.Mesh(buildHand(-1), skin)));
    this.item = prep(new THREE.Mesh(undefined, dishMaterial()));
    this.item.position.set(0, 0.03, -0.05);
    this.item.scale.setScalar(0.78); // tabak / tava ekranın yarısını kaplamasın
    this.right.add(this.item);
    // Sol elde bıçak (hazırlık tezgâhı)
    this.knife = prep(new THREE.Mesh(
      new THREE.BoxGeometry(0.012, 0.004, 0.16).translate(0, 0.02, -0.1),
      new THREE.MeshLambertMaterial({ color: 0xd8dde2 }),
    ));
    this.left.add(this.knife);
    this.left.visible = false;
    this.root.add(this.right, this.left);
    this.layout();
  }

  get busy() { return !!this.anim; }

  layout() {
    const cam = this.camera;
    const key = `${cam.fov.toFixed(2)}|${cam.aspect.toFixed(3)}`;
    if (key === this.layoutKey) return false;
    this.layoutKey = key;
    const tanH = Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2);
    const portrait = cam.aspect < 1;
    const fit = portrait ? Math.max(0.6, Math.min(1, cam.aspect / 1.15)) : 1;
    const rx = portrait ? 0.24 : 0.3;
    this.anchor = [rx * DEPTH * tanH * cam.aspect, -0.56 * DEPTH * tanH, -DEPTH];
    this.anchorL = [-rx * DEPTH * tanH * cam.aspect, -0.48 * DEPTH * tanH, -DEPTH];
    this.right.scale.setScalar(fit);
    this.left.scale.setScalar(fit);
    return true;
  }

  /** Eldeki durum → gösterilecek geometri */
  geometryFor(h) {
    if (!h) return null;
    if (h.kind === 'tray') return trayGeometry(h.items, h.cooked);
    if (h.kind === 'dish') return dishGeometry(DISH_BY_ID[h.dish] ? h.dish : 'dirty');
    if (h.kind === 'dirty') return dirtyStackGeometry(h.count || 1);
    if (h.kind === 'buffet') return dishGeometry('buffet');
    return null;
  }

  show(h) {
    const g = this.geometryFor(h);
    this.item.visible = !!g;
    if (g) this.item.geometry = g;
  }

  setHold(h) {
    if (this.anim) {
      this.anim.after = h || null;
      return;
    }
    this.apply(h || null);
    this.engine.requestRender();
  }

  apply(h) {
    this.hold = h;
    this.show(h);
    this.root.visible = !!h;
    this.left.visible = false;
    this.pose(Z6);
  }

  pose(off, left = null) {
    const a = this.anchor;
    this.right.position.set(a[0] + off[0], a[1] + off[1], a[2] + off[2]);
    this.right.rotation.set(0.12 + off[3], -0.18 + off[4], off[5]);
    if (left) {
      const l = this.anchorL;
      this.left.position.set(l[0] + left[0], l[1] + left[1], l[2] + left[2]);
      this.left.rotation.set(0.1 + left[3], 0.2 + left[4], left[5]);
    }
  }

  /** @param opts { from, after, method } */
  play(act, durMs, opts = {}) {
    if (this.anim) this.finish();
    this.layout();
    this.anim = { act, dur: Math.max(150, durMs), t0: performance.now(), from: opts.from ?? this.hold, after: opts.after ?? null, method: opts.method };
    this.root.visible = true;
    const a = this.anim;
    // Pişirirken eldeki tepsi istasyonun kabına geçer (tava / fırın küreği / tahta)
    if (act === 'cook') this.show({ kind: 'tray', items: a.from?.items ?? [], cooked: a.method });
    else if (act === 'restock') this.show({ kind: 'buffet' });
    else this.show(a.from);
    this.left.visible = act === 'cook' && a.method === 'board';
    this.step(0);
    this.engine.wake();
  }

  cancel(h) {
    this.anim = null;
    this.apply(h || null);
    this.engine.requestRender();
  }

  finish() {
    const a = this.anim;
    this.anim = null;
    this.apply(a.after);
  }

  step(k) {
    const a = this.anim;
    const p = this._p;
    const amp = this.settings.reduceMotion ? 0.3 : 1;
    let left = null;
    switch (a.act) {
      case 'take':
      case 'pick':
      case 'clear':
        track(k, [[0, Z6], [0.42, REACH], [0.58, REACH], [1, Z6]], p);
        if (k >= 0.5 && a.swap !== true) {
          a.swap = true;
          this.show(a.after);
        }
        break;
      case 'pass':
      case 'serve':
        track(k, [[0, Z6], [0.5, [-0.04, -0.07, -0.24, -0.1, 0, 0]], [0.62, [-0.04, -0.07, -0.24, -0.1, 0, 0]], [1, Z6]], p);
        if (k >= 0.56 && !a.swap) {
          a.swap = true;
          this.show(a.after);
        }
        break;
      case 'plate':
        track(k, [[0, Z6], [0.38, DOWN], [0.62, DOWN], [1, Z6]], p);
        if (k >= 0.5 && !a.swap) {
          a.swap = true;
          this.show(a.after);
        }
        break;
      case 'cook':
        if (a.method === 'pan') {
          // Tavayı ileri uzat, sallayarak çevir
          track(k, [[0, Z6], [0.12, [-0.03, 0.0, -0.12, 0, 0, 0]], [0.88, [-0.03, 0.0, -0.12, 0, 0, 0]], [1, Z6]], p);
          const toss = Math.abs(Math.sin(k * Math.PI * 7)) * amp;
          p[1] += 0.035 * toss;
          p[3] += -0.25 * toss;
        } else if (a.method === 'oven') {
          // Küreği fırına sür, bekle, pişmiş çıkar
          track(k, [[0, Z6], [0.22, [-0.02, 0.02, -0.32, -0.15, 0, 0]], [0.3, [0, -0.3, 0, 0.3, 0, 0]], [0.72, [0, -0.3, 0, 0.3, 0, 0]], [0.82, [-0.02, 0.02, -0.32, -0.15, 0, 0]], [1, Z6]], p);
          if (k >= 0.3 && k < 0.78) this.item.visible = false;
          else if (k >= 0.78 && !a.swap) {
            a.swap = true;
            this.show(a.after);
          }
        } else {
          // Tahtayı önde tut, sol elle bıçakla doğra
          track(k, [[0, Z6], [0.12, [0.02, -0.06, -0.06, 0.25, 0, 0]], [0.88, [0.02, -0.06, -0.06, 0.25, 0, 0]], [1, Z6]], p);
          const chop = Math.abs(Math.sin(k * Math.PI * 12)) * amp;
          left = [0.12, -0.02 + 0.05 * chop, -0.08, -0.4 * chop, 0, 0];
        }
        break;
      case 'wash':
        track(k, [[0, Z6], [0.25, [-0.03, -0.12, -0.12, 0.2, 0, 0]], [0.8, [-0.03, -0.12, -0.12, 0.2, 0, 0]], [1, Z6]], p);
        p[0] += Math.sin(k * Math.PI * 8) * 0.03 * amp;
        p[2] += Math.cos(k * Math.PI * 8) * 0.02 * amp;
        if (k >= 0.8 && !a.swap) {
          a.swap = true;
          this.show(a.after);
        }
        break;
      case 'trash':
        track(k, [[0, Z6], [0.5, [0.04, -0.1, -0.12, 0, 0, -1.1]], [1, Z6]], p);
        if (k >= 0.55 && !a.swap) {
          a.swap = true;
          this.show(a.after);
        }
        break;
      case 'restock':
        track(k, [[0, Z6], [0.5, [-0.05, -0.04, -0.26, -0.1, 0, 0]], [0.65, [-0.05, -0.04, -0.26, -0.1, 0, 0]], [1, Z6]], p);
        if (k >= 0.58 && !a.swap) {
          a.swap = true;
          this.show(a.after);
        }
        break;
      default:
        track(k, [[0, Z6], [1, Z6]], p);
    }
    this.pose(p, left);
  }

  /** @returns {boolean} bu kare çizilsin mi */
  update() {
    let draw = this.layout() && this.root.visible;
    const a = this.anim;
    if (a) {
      const k = (performance.now() - a.t0) / a.dur;
      if (k >= 1) this.finish();
      else this.step(k);
      draw = true;
    } else if (draw) {
      this.pose(Z6);
    }
    return draw;
  }
}

// ---- Mutfak sistemi ------------------------------------------------------------------------------

/**
 * Gurme Restoran mutfağı — istemci (FPV).
 *  - Etkileşim: bakılan istasyona göre bağlama duyarlı E / Aksiyon: buzdolabı (malzeme seçici), tava / fırın /
 *    hazırlık tezgâhı (pişir), tabak rafı (tabakla), garson tezgâhı (koy / al), masalar (servis / topla),
 *    bulaşık lavabosu, çöp kovası, açık büfe (tazele) ve tarif panosu (menü kütüphanesi).
 *  - Her adım sunucuda zaman doğrulamalı (server/game/RestaurantService.js); istemci animasyonu İYİMSER
 *    oynatır, sunucu reddederse geri alır. Buzdolabında seçilen malzemeler tek tek tepsiye alınır.
 *  - HUD: eylem ilerleme çubuğu, tepsideki malzemeler + hangi tabağa denk geldiği.
 *  - Uzak oyuncuların elinde tabak / tepsi.
 */
export class KitchenSystem {
  constructor({ engine, net, hud, interaction, player, modal, settings, sfx, device, restaurant, remotes }) {
    this.engine = engine;
    this.net = net;
    this.hud = hud;
    this.interaction = interaction;
    this.player = player;
    this.modal = modal;
    this.settings = settings;
    this.sfx = sfx;
    this.device = device;
    this.restaurant = restaurant;
    this.view = restaurant.view;
    this.remotes = remotes;
    this.hold = null;
    this.local = null;
    this.pending = false;
    this.queue = []; // buzdolabında seçilip sırayla alınacak malzemeler
    this.picked = new Set();
    this.idleWaiters = []; // eylem animasyonu bitince çözülecek sözler (buzdolabı sırası)
    this.remote = new Map(); // oyuncu id → { hold, mesh, owner }
    this.hands = new KitchenHands({ engine, settings });

    const $ = (id) => document.getElementById(id);
    this.el = {
      progress: $('kitchen-progress'),
      progressFill: $('kitchen-progress').firstElementChild,
      held: $('kitchen-held'),
      fridge: $('fridge-panel'),
      fridgeSub: $('fridge-sub'),
      fridgeOrders: $('fridge-orders'),
      fridgeGrid: $('fridge-grid'),
      fridgeTake: $('fridge-take'),
      menu: $('menu-panel'),
      menuList: $('menu-list'),
    };
    $('fridge-close').addEventListener('click', () => this.modal.close(this.el.fridge));
    this.el.fridgeTake.addEventListener('click', () => this.takePicked());
    $('menu-close').addEventListener('click', () => this.modal.close(this.el.menu));
    restaurant.onMenu = () => this.openMenu();

    interaction.addProvider({ find: (px, pz, f) => this.findTarget(px, pz, f) });
  }

  // ---- Sunucu durumu -----------------------------------------------------------------------

  /** EVT.SELF.kitchen / WELCOME.self.kitchen */
  applySelf(k) {
    this.hold = k?.hold ?? null;
    if (!this.local) this.syncHold();
  }

  get inside() { return isInsideRestaurant(this.player.pos.x, this.player.pos.z); }

  // ---- Etkileşim hedefleri -------------------------------------------------------------------

  findTarget(px, pz, f) {
    if (!isInsideRestaurant(px, pz) || this.local || this.queue.length) return null;
    const st = this.restaurant.state;
    if (!st) return null;
    const h = this.hold;
    const cands = [];
    const add = (pt, label, short, use) => cands.push({ x: pt[0], z: pt[1], label, short, use });
    const toast = (t, kind = 'info') => () => this.hud.toast(t, kind);
    const busyHands = h?.kind === 'dish' ? 'Elinde tabak var — servis et ya da garson tezgâhına koy.' : h?.kind === 'dirty' ? 'Önce kirli tabakları bulaşık lavabosuna bırak.' : null;

    // Buzdolabı
    const fp = RESTAURANT.fridge.point;
    if (!h || (h.kind === 'tray' && !h.cooked && h.items.length < R.MAX_ITEMS)) {
      add(fp, `🧊 Buzdolabı: malzeme seç${h ? ` (tepside ${h.items.length}/${R.MAX_ITEMS})` : ''}`, 'Dolap', () => this.openFridge());
    } else if (h.kind === 'tray') {
      add(fp, h.cooked ? '🧊 Pişmiş tepsiye malzeme eklenmez' : '🧊 Tepsi dolu', 'Dolap', toast(h.cooked ? 'Önce tabakla ya da çöpe at.' : `Tepsiye en fazla ${R.MAX_ITEMS} malzeme sığar.`));
    } else {
      add(fp, '🧊 Buzdolabı — ellerin dolu', 'Dolap', toast(busyHands));
    }
    // Pişirme istasyonları
    for (const m of Object.values(COOK_METHODS)) {
      const pt = RESTAURANT.stations[m.id];
      if (h?.kind === 'tray' && h.items.length && !h.cooked) {
        const dish = matchDish(h.items, m.id);
        const want = dish ? null : dishByIngredients(h.items);
        let label = `${m.icon} ${m.verb}`;
        if (dish) label += ` → ${dish.icon} ${dish.name}`;
        else if (want) label += ` · ⚠ ${want.name} ${COOK_METHODS[want.method].name} ister`;
        add(pt, label, m.icon, () => this.act('cook', { method: m.id }));
      } else if (h?.kind === 'tray' && h.cooked) {
        add(pt, `${m.icon} Tepsi hazır — tabak rafında tabakla`, m.icon, toast('Tepsi hazır: tabak rafına götür ve tabakla.'));
      } else {
        add(pt, `${m.icon} ${m.name} — önce buzdolabından malzeme al`, m.icon, toast('Önce buzdolabından malzeme al.'));
      }
    }
    // Tabak rafı
    if (h?.kind === 'tray' && h.items.length) {
      const dish = matchDish(h.items, h.cooked);
      add(RESTAURANT.plates, dish ? `🍽️ Tabakla → ${dish.icon} ${dish.name}` : '🍽️ Tabakla (tarif uymuyor olabilir)', 'Tabakla', () => this.act('plate'));
    } else {
      add(RESTAURANT.plates, '🍽️ Tabak rafı — önce malzemeyi hazırla', 'Tabak', toast('Önce buzdolabından malzeme al ve pişir.'));
    }
    // Garson tezgâhı
    st.pass.forEach((dishId, i) => {
      const pt = RESTAURANT.passSlots[i];
      const dish = DISH_BY_ID[dishId];
      if (h?.kind === 'dish' && !dish) add(pt, '🛎️ Garson tezgâhına koy', 'Koy', () => this.act('pass', { slot: i }));
      else if (!h && dish) add(pt, `🛎️ Al: ${dish.icon} ${dish.name}`, 'Al', () => this.act('pick', { slot: i }));
    });
    // Masalar
    st.tables.forEach((t, i) => {
      const pt = RESTAURANT.tables[i].center;
      if (h?.kind === 'dish' && t.state === 'waiting') {
        const want = DISH_BY_ID[t.order];
        if (!want) return;
        if (t.order === h.dish) add(pt, `✅ Servis et: ${t.name} · ${want.icon} ${want.name}`, 'Servis', () => this.act('serve', { table: i }));
        else add(pt, `⚠ ${t.name} ${want.icon} ${want.name} istiyor`, 'Servis', toast(`${want.name} = ${recipeIcons(want)} → ${COOK_METHODS[want.method].icon}`, 'warn'));
      } else if (t.plate === 'dirty' && (!h || (h.kind === 'dirty' && h.count < R.MAX_DIRTY))) {
        add(pt, `🍽️ Kirli tabağı topla${h ? ` (elinde ${h.count})` : ''}`, 'Topla', () => this.act('clear', { table: i }));
      }
    });
    // Lavabo, çöp, büfe, tarif panosu
    if (h?.kind === 'dirty') add(RESTAURANT.sink, `🫧 Bulaşığı bırak (${h.count})`, 'Bırak', () => this.act('wash'));
    if (h?.kind === 'tray' || h?.kind === 'dish') add(RESTAURANT.trash, '🗑️ Çöpe at', 'At', () => this.act('trash'));
    const bp = RESTAURANT.buffet.point;
    if (!h && st.buffet < BUFFET.MAX) add(bp, `🍳 Büfeyi tazele (+${BUFFET.REFILL} porsiyon, ${formatMoney(BUFFET.REFILL_COST)} kasadan) · ${st.buffet}/${BUFFET.MAX}`, 'Tazele', () => this.act('restock'));
    else if (!h) add(bp, `🍳 Açık büfe dolu (${st.buffet}/${BUFFET.MAX})`, 'Büfe', toast('Büfe dolu.'));
    add([-17.2, 22.4], '📖 Menü kütüphanesi (tarifler)', 'Tarif', () => this.openMenu());

    let best = null;
    let bestScore = Infinity;
    for (const c of cands) {
      const dx = c.x - px;
      const dz = c.z - pz;
      const d = Math.hypot(dx, dz);
      if (d > RESTAURANT.range) continue;
      const dot = d > 1e-3 ? (dx * f.x + dz * f.z) / d : 1;
      if (d > 0.7 && dot < 0.5) continue;
      const score = d - dot * 0.9;
      if (score < bestScore) {
        bestScore = score;
        best = c;
      }
    }
    return best && { x: best.x, z: best.z, label: best.label, short: best.short, marker: false, use: best.use };
  }

  // ---- Girdi -------------------------------------------------------------------------------

  /** main.js onAction zinciri: eylem sürerken ikinci basış yutulur */
  onAction() {
    return !!(this.local || this.pending || this.queue.length);
  }

  /** K: restoranda menü kütüphanesi (barda bar tarif kitabı) */
  command(cmd) {
    if (cmd !== 'recipes' || !this.inside) return false;
    this.openMenu();
    return true;
  }

  // ---- Buzdolabı seçici ---------------------------------------------------------------------

  openFridge() {
    const h = this.hold;
    const have = h?.kind === 'tray' ? h.items : [];
    const room = R.MAX_ITEMS - have.length;
    this.picked = new Set();
    const render = () => {
      this.el.fridgeSub.textContent = `Tepside ${have.length}/${R.MAX_ITEMS} · seçili ${this.picked.size} · en fazla ${room} malzeme daha`;
      this.el.fridgeTake.textContent = this.picked.size ? `Tepsiye al (${this.picked.size})` : 'Tepsiye al';
      this.el.fridgeTake.disabled = !this.picked.size;
      for (const b of this.el.fridgeGrid.children) {
        const id = b.dataset.id;
        const on = this.picked.has(id);
        b.classList.toggle('on', on);
        b.disabled = have.includes(id) || (!on && this.picked.size >= room);
      }
    };
    // Bekleyen siparişler için kısayollar: o tabağın eksik malzemelerini seç
    const orders = this.el.fridgeOrders;
    orders.replaceChildren();
    const seen = new Set();
    for (const t of this.restaurant.waitingOrders()) {
      const d = DISH_BY_ID[t.order];
      if (seen.has(d.id)) continue;
      seen.add(d.id);
      const need = d.ingredients.filter((i) => !have.includes(i));
      const ok = have.every((i) => d.ingredients.includes(i)) && need.length <= room;
      const b = el('button', 'fridge-order', `${d.icon} ${d.name} · M${t.i + 1}${t.vip ? ' ⭐' : ''}`);
      b.type = 'button';
      b.disabled = !ok || !need.length;
      b.title = `${recipeIcons(d)} → ${COOK_METHODS[d.method].name}`;
      b.addEventListener('click', () => {
        this.picked = new Set(need);
        render();
      });
      orders.append(b);
    }
    orders.hidden = !orders.children.length;
    const grid = this.el.fridgeGrid;
    grid.replaceChildren();
    for (const ing of KITCHEN_INGREDIENTS) {
      const b = el('button', 'cooler-item');
      b.type = 'button';
      b.dataset.id = ing.id;
      const icon = el('span', 'ci-icon', ing.icon);
      icon.style.setProperty('--c', ing.color);
      b.append(icon, el('span', null, ing.name));
      b.addEventListener('click', () => {
        if (this.picked.has(ing.id)) this.picked.delete(ing.id);
        else if (this.picked.size < room) this.picked.add(ing.id);
        render();
      });
      grid.append(b);
    }
    render();
    this.modal.open(this.el.fridge);
  }

  /** Seçilen malzemeleri sırayla tepsiye al (her biri ayrı 'take' adımı + uzanma animasyonu) */
  async takePicked() {
    const list = [...this.picked];
    this.modal.close(this.el.fridge);
    if (!list.length) return;
    this.queue = list;
    while (this.queue.length) {
      const ing = this.queue.shift();
      const ok = await this.act('take', { ing });
      if (!ok) {
        this.queue = [];
        break;
      }
      await this.whenIdle();
    }
    this.interaction.invalidate();
  }

  // ---- Menü kütüphanesi ---------------------------------------------------------------------

  openMenu() {
    const list = this.el.menuList;
    list.replaceChildren();
    for (const [cat, title] of Object.entries(DISH_CATS)) {
      list.append(el('h3', 'menu-cat', title));
      for (const d of DISHES.filter((x) => x.cat === cat)) {
        const card = el('div', `menu-dish${d.lux ? ' lux' : ''}`);
        const head = el('div', 'menu-head');
        head.append(el('span', 'menu-icon', d.icon), el('b', null, d.name), el('span', 'menu-price', formatMoney(d.price)));
        const m = COOK_METHODS[d.method];
        const steps = el('div', 'menu-steps');
        steps.append(el('span', null, '🧊'));
        for (const i of d.ingredients) {
          const ing = KITCHEN_INGREDIENT_BY_ID[i];
          steps.append(el('span', 'menu-ing', `${ing.icon} ${ing.name}`));
        }
        steps.append(el('span', 'menu-arrow', '→'), el('span', 'menu-ing', `${m.icon} ${m.name}`), el('span', 'menu-arrow', '→'), el('span', 'menu-ing', '🍽️ Tabakla'));
        card.append(head, el('div', 'menu-desc', `${d.desc}${d.lux ? ` · ⭐ VIP'lerin favorisi (VIP ×${R.VIP_PRICE_MULT} fiyat)` : ''}`), steps);
        list.append(card);
      }
    }
    list.append(el('p', 'menu-note', `🍳 Açık büfe kahvaltı 07:00–11:00: müşteri tabağını büfeden kendisi doldurur (${formatMoney(BUFFET.PRICE)}). Büfe azalınca tazele (${formatMoney(BUFFET.REFILL_COST)} malzeme, kasadan) ya da aşçı işe al.`));
    this.modal.open(this.el.menu);
  }

  // ---- Eylemler (iyimser) -------------------------------------------------------------------

  predict(act, extra) {
    const h = this.hold;
    switch (act) {
      case 'take': return h?.kind === 'tray' ? { ...h, items: [...h.items, extra.ing] } : { kind: 'tray', items: [extra.ing], cooked: null };
      case 'cook': return { ...h, cooked: extra.method };
      case 'plate': {
        const d = matchDish(h.items, h.cooked);
        return d ? { kind: 'dish', dish: d.id } : h;
      }
      case 'pick': return { kind: 'dish', dish: this.restaurant.state.pass[extra.slot] };
      case 'clear': return { kind: 'dirty', count: (h?.kind === 'dirty' ? h.count : 0) + 1 };
      case 'pass':
      case 'serve':
      case 'wash':
      case 'trash':
      case 'restock':
        return null;
      default: return h;
    }
  }

  /** @returns {Promise<boolean>} sunucu kabul etti mi */
  async act(act, extra = {}) {
    if (this.local || this.pending) return false;
    const prev = this.hold;
    const next = this.predict(act, extra);
    const dur = act === 'cook' ? COOK_METHODS[extra.method].ms : R.T[act];
    const now = performance.now();
    this.local = { act, t0: now, dur, until: now + dur };
    this.hold = next;
    if (LOCKING.has(act)) this.player.lockUntil = now + dur;
    this.interaction.setBusy(act === 'cook' ? COOK_TEXT[extra.method] : BUSY_TEXT[act]);
    this.el.progress.hidden = false;
    this.el.progressFill.style.transform = 'scaleX(0)';
    this.hands.play(act, dur, { from: prev, after: next, method: extra.method });
    if (act === 'cook') this.view?.setFx(extra.method, this.net.serverNow() + dur);
    this.playSound(act, dur, extra);
    this.renderHeld();
    this.engine.wake();

    this.pending = true;
    const res = await this.net.request(EVT.KITCHEN_ACT, { act, ...extra });
    this.pending = false;
    if (!res?.ok) {
      this.hold = prev;
      this.player.lockUntil = 0;
      this.hands.cancel(prev);
      if (act === 'cook') this.view?.setFx(extra.method, 0);
      this.finishLocal();
      this.hud.toast(res?.error || 'Olmadı.', 'warn');
      return false;
    }
    if ('hold' in res) this.hold = res.hold ?? null;
    this.hands.setHold(this.hold);
    if (act === 'serve') setTimeout(() => this.sound('coin'), dur * 0.8);
    return true;
  }

  finishLocal() {
    this.local = null;
    this.el.progress.hidden = true;
    this.interaction.setBusy(null);
    this.syncHold();
    for (const r of this.idleWaiters.splice(0)) r();
  }

  /** Süren eylemin animasyonu bitince çözülür */
  whenIdle() {
    return this.local ? new Promise((r) => this.idleWaiters.push(r)) : Promise.resolve();
  }

  syncHold() {
    this.hands.setHold(this.hold);
    this.renderHeld();
    this.interaction.invalidate();
    this.engine.requestRender();
  }

  sound(name, ...args) {
    if (!this.settings.sound) return;
    this.sfx?.[name]?.(...args);
  }

  playSound(act, dur, extra) {
    if (act === 'cook') {
      if (extra.method === 'pan') this.sound('sizzle', dur);
      else if (extra.method === 'board') this.sound('chop', dur);
      else setTimeout(() => this.sound('clink'), dur * 0.8);
    } else if (act === 'wash') this.sound('wash', dur);
    else if (act !== 'trash') setTimeout(() => this.sound('clink'), dur * 0.55);
  }

  // ---- HUD ----------------------------------------------------------------------------------

  renderHeld() {
    const h = this.hold;
    let text = '';
    if (h?.kind === 'tray') {
      const icons = h.items.map((i) => KITCHEN_INGREDIENT_BY_ID[i]?.icon ?? '?').join(' ');
      const dish = matchDish(h.items, h.cooked);
      const want = dishByIngredients(h.items);
      text = `${h.cooked ? COOK_METHODS[h.cooked].icon : '🧺'} Tepside: ${icons || 'boş'}`;
      if (dish) text += ` → ${dish.icon} ${dish.name} hazır, tabakla!`;
      else if (want && !h.cooked) text += ` → ${want.icon} ${want.name}: ${COOK_METHODS[want.method].verb.toLowerCase()}`;
      else if (want) text += ` · ⚠ ${want.name} ${COOK_METHODS[want.method].name} ister — çöpe at`;
      else {
        const close = DISHES.find((d) => h.items.every((i) => d.ingredients.includes(i)));
        if (close) text += ` · ${close.icon} ${close.name} için eksik: ${close.ingredients.filter((i) => !h.items.includes(i)).map((i) => KITCHEN_INGREDIENT_BY_ID[i].icon).join(' ')}`;
      }
    } else if (h?.kind === 'dish') {
      const d = DISH_BY_ID[h.dish];
      if (d) text = `${d.icon} ${d.name} — masaya servis et ya da garson tezgâhına koy`;
    } else if (h?.kind === 'dirty') {
      text = `🍽️ Kirli tabak ×${h.count} — bulaşık lavabosuna bırak`;
    }
    const e = this.el.held;
    e.hidden = !text;
    if (text && e.textContent !== text) e.textContent = text;
  }

  // ---- Kare ---------------------------------------------------------------------------------

  /** @returns {boolean} animasyon / ilerleme sürüyor mu */
  update() {
    let active = false;
    if (this.local) {
      const k = Math.min(1, (performance.now() - this.local.t0) / this.local.dur);
      this.el.progressFill.style.transform = `scaleX(${k.toFixed(3)})`;
      if (k >= 1) this.finishLocal();
      active = true;
    }
    if (this.hands.update()) active = true;
    return active;
  }

  // ---- Uzak oyuncular: elde tabak / tepsi ------------------------------------------------------

  /** EVT.PLAYER_KITCHEN ya da publicPlayer.kitchen */
  onRemoteKitchen(id, k) {
    const rp = this.remotes.get(id);
    if (!rp || !k) return;
    let r = this.remote.get(id);
    const hold = k.hold ?? null;
    if (r && r.owner === rp.obj && r.hold === hold) return;
    if (r?.mesh) r.mesh.removeFromParent();
    r = { hold, owner: rp.obj, mesh: null };
    this.remote.set(id, r);
    if (hold) {
      let mesh;
      if (hold === 'tray') mesh = new THREE.Mesh(trayGeometry(['egg', 'tomato'], null), dishMaterial());
      else if (hold === 'dirty') mesh = new THREE.Mesh(dirtyStackGeometry(2), dishMaterial());
      else mesh = makeDishMesh(DISH_BY_ID[hold] ? hold : 'dirty');
      mesh.position.set(0.1, 1.02, 0.32);
      mesh.scale.setScalar(1.3);
      rp.obj.userData.inner.add(mesh);
      r.mesh = mesh;
    }
    this.engine.requestRender();
  }

  removeRemote(id) {
    const r = this.remote.get(id);
    r?.mesh?.removeFromParent();
    this.remote.delete(id);
  }
}
