import * as THREE from 'three';
import { EVT, formatMoney } from '/shared/constants.js';
import { ALLEY_EAST, PLAYER_HOUSES } from '/shared/layout.js';
import { STAGE } from '/shared/stage.js';
import {
  STREET_PROPS, STREET_PROP_BY_ID, STREET_RULES as R, STREET_TOTAL_PRICE, STREET_TOTAL_RENT, paybackDays,
} from '/shared/street.js';
import { UV } from '../world/Materials.js';
import { addWindow, addStreetLamp, addBike, makePanel } from '../world/Props.js';
import { signDrawer } from '../world/Textures.js';

// Achterstraat Cadde İmparatorluğu — istemci: dükkân cepheleri (eski Achterstraat'taki iki komşu bina +
// Achterstraat Oost uzantısı: iki sıra dükkân, doğu ucunda benzinlik), kapıdan satın alma kartı, telefon ve
// Resepsiyon PC'deki "Achterstraat Real Estate" uygulaması (cadde haritası + liste), alınan dükkânın otel
// tabelasına / markasına geçmesi, "Achterstraat King 👑" rozeti ve kralın başında taç.
// Statik cepheler otelin StaticBatcher'ına (phFacade tuğlası + köşe renkli streetColor: TEK draw call); dinamik
// olan yalnızca tabelalar, tenteler ve marka plaketleri (sahiplik değişince doku / renk değişir; karede iş yok).

const _c = new THREE.Color();
const BRAND_GREEN = '#1f4d3a';
const BRAND_GOLD = '#c9a25e';

function tint(geo, hex) {
  _c.set(hex);
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = _c.r;
    arr[i * 3 + 1] = _c.g;
    arr[i * 3 + 2] = _c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

const boxGeo = (x0, x1, y0, y1, z0, z1) => new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0)
  .translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
const FACING = { 'z+': 0, 'z-': Math.PI, 'x+': Math.PI / 2, 'x-': -Math.PI / 2 };

// ---- Vitrin atlası: dükkân başına bir hücre (5 × 2) ---------------------------------------------

const GOODS = {
  koffie: ['#6b3a24', '#c98a3d', '#f4efe2'],
  bakkerij: ['#d29a4a', '#b8783a', '#f2d48a'],
  super: ['#c8382a', '#f2c14e', '#3f9b46', '#2d4f7c'],
  kaas: ['#f2c14e', '#e8a42a', '#f6e7a8'],
  bloem: ['#e2334a', '#f28ab2', '#f6c90e', '#9b59b6'],
  fiets: ['#2a2a2c', '#c4cad2', '#2d4f7c'],
  platen: ['#111111', '#c8382a', '#f2c14e', '#2b5ea7'],
  hoekje: ['#6b3a24', '#f4efe2', '#3f7d3a'],
  friet: ['#f2c14e', '#d23a2a', '#fbf6ea'],
  tank: ['#d7263d', '#2b5ea7', '#f4efe2'],
};

function drawVitrines(ctx, w, h) {
  const cw = w / 5;
  const ch = h / 2;
  STREET_PROPS.forEach((p, i) => {
    const x0 = (i % 5) * cw;
    const y0 = Math.floor(i / 5) * ch;
    const g = ctx.createLinearGradient(0, y0, 0, y0 + ch);
    g.addColorStop(0, '#fff2cf');
    g.addColorStop(1, '#c79a5a');
    ctx.fillStyle = g;
    ctx.fillRect(x0, y0, cw, ch);
    // Raflar ve mallar
    const cols = GOODS[p.id];
    for (let r = 0; r < 3; r++) {
      const sy = y0 + ch * (0.38 + r * 0.22);
      ctx.fillStyle = '#5a3a22';
      ctx.fillRect(x0 + cw * 0.06, sy, cw * 0.88, ch * 0.025);
      for (let k = 0; k < 7; k++) {
        ctx.fillStyle = cols[(k + r) % cols.length];
        const bx = x0 + cw * (0.09 + k * 0.122);
        const bh = ch * (0.08 + ((k * 7 + r * 3) % 5) * 0.015);
        ctx.fillRect(bx, sy - bh, cw * 0.09, bh);
      }
    }
    ctx.font = `${Math.round(ch * 0.2)}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(p.icon, x0 + cw * 0.5, y0 + ch * 0.17);
    // Cam yansıması
    ctx.fillStyle = 'rgba(255,255,255,.18)';
    ctx.beginPath();
    ctx.moveTo(x0 + cw * 0.15, y0);
    ctx.lineTo(x0 + cw * 0.38, y0);
    ctx.lineTo(x0 + cw * 0.12, y0 + ch);
    ctx.lineTo(x0 - cw * 0.1, y0 + ch);
    ctx.fill();
  });
}

function vitrinePlane(i, w, hgt) {
  const geo = new THREE.PlaneGeometry(w, hgt);
  const uv = geo.attributes.uv;
  const u0 = (i % 5) / 5 + 0.004;
  const u1 = (i % 5 + 1) / 5 - 0.004;
  const v1 = 1 - Math.floor(i / 5) / 2 - 0.004;
  const v0 = 1 - (Math.floor(i / 5) + 1) / 2 + 0.004;
  // Geniş vitrinde dokuyu yatayda tekrarlama: hücrenin ortasından en-boy oranına göre kırp
  const span = Math.min(1, (w / hgt) / 1.6);
  const uc = (u0 + u1) / 2;
  const uh = ((u1 - u0) / 2) * span;
  for (let k = 0; k < uv.count; k++) uv.setXY(k, uc - uh + uv.getX(k) * 2 * uh, v0 + uv.getY(k) * (v1 - v0));
  return geo;
}

// ---- Cadde ---------------------------------------------------------------------------------------

/**
 * Dükkân cephelerini ve Achterstraat Oost'u kurar (buildPlayerHouses'tan SONRA: phFacade malzemesini kullanır).
 * @returns StreetView: setOwner(id, owned) — tabela / tente / plaket otel markasına geçer
 */
export function buildStreet({ batcher: b, collision, scene, mats, factory }) {
  Object.assign(mats, {
    streetColor: new THREE.MeshLambertMaterial({ vertexColors: true }),
    streetVitrine: new THREE.MeshBasicMaterial({ map: factory.make(drawVitrines, { w: 2.5, h: 1, repeat: false, minSize: 256, seed: 91 }) }),
  });
  const flat = { cast: false };
  const noShadow = { cast: false, receive: false };
  const fbox = (hex, x0, x1, y0, y1, z0, z1) => b.add('phFacade', tint(boxGeo(x0, x1, y0, y1, z0, z1), hex), { cast: false, uvScale: UV.brick });
  const vbox = (hex, x0, x1, y0, y1, z0, z1, o = flat) => b.add('streetColor', tint(boxGeo(x0, x1, y0, y1, z0, z1), hex), o);
  const E = ALLEY_EAST.bounds;
  const P = ALLEY_EAST.passage;

  // ---- Achterstraat Oost: zemin, kaldırımlar, geçit -----------------------------------------
  b.floor('cobble', E.minX, E.maxX - 0.1, E.minZ + 0.1, E.maxZ - 0.1, 0, { uvScale: UV.cobble });
  b.add('phFacade', tint(boxGeo(E.minX + 0.1, E.maxX - 0.12, 0, 0.02, 32.3, 32.88), '#8a6656'), { cast: false, uvScale: 1.25 });
  b.box('stone', E.minX + 0.1, E.maxX - 0.12, 0, 0.02, 32.27, 32.3, flat);
  b.box('stone', E.minX + 0.1, E.maxX - 0.12, 0, 0.02, 26.12, 26.7, flat);
  b.box('stone', E.minX + 0.1, E.maxX - 0.12, 0, 0.025, 26.7, 26.74, flat);
  // Geçit: iki yüzde taş kemer çerçevesi + yön tabelaları
  for (const [x0, x1] of [[17.84, 17.9], [18.1, 18.16]]) {
    b.box('stone', x0, x1, 0, P.top + 0.02, P.from - 0.14, P.from, flat);
    b.box('stone', x0, x1, 0, P.top + 0.02, P.to, P.to + 0.14, flat);
    b.box('stone', x0, x1, P.top, P.top + 0.16, P.from - 0.14, P.to + 0.14, flat);
  }
  b.box('stone', 17.9, 18.1, 0, 0.015, P.from, P.to, flat);
  const sMat = (title, sub, bg = '#23395b') => new THREE.MeshLambertMaterial({
    map: factory.make(signDrawer({ title, sub, bg, fg: '#f6e7c1' }), { w: 1.6, h: 0.36, repeat: false }),
  });
  scene.add(makePanel(sMat('Achterstraat Oost →', 'Dükkânlar · Kafe · Benzinlik'), 1.6, 0.36, 17.83, 2.96, (P.from + P.to) / 2, 'x-'));
  scene.add(makePanel(sMat('← Achterstraat', 'Hotel De Tulp · Huis 1–8'), 1.6, 0.36, 18.17, 2.96, (P.from + P.to) / 2, 'x+'));

  // Sokak lambaları ve köşe ağaçlarının yerine bisiklet park yeri
  addStreetLamp(b, collision, 24.6, 26.6);
  addStreetLamp(b, collision, 33.6, 32.1);
  addBike(b, collision, 36.6, 27.05, 0, 'paintGreen');
  addBike(b, collision, 33.9, 27.05, Math.PI, 'fabricRed');

  const view = new Map(); // id → { sign, signMats: [normal, brand], awningMat, plaque }
  const brandPlaque = new THREE.MeshLambertMaterial({
    map: factory.make(signDrawer({ title: '🌷 De Tulp', sub: 'Hotel partner', bg: BRAND_GREEN, fg: '#f6e7c1', border: BRAND_GOLD }), { w: 0.6, h: 0.36, repeat: false }),
  });

  STREET_PROPS.forEach((p, i) => {
    const signMats = [
      new THREE.MeshLambertMaterial({ map: factory.make(signDrawer({ title: p.name, sub: `${p.type} · ${formatMoney(p.price)} · satılık`, bg: '#2a2523', fg: '#f6e7c1', border: p.awning }), { w: 2, h: 0.4, repeat: false }) }),
      new THREE.MeshLambertMaterial({ map: factory.make(signDrawer({ title: p.name, sub: `${p.type} · by ${R.BRAND}`, bg: BRAND_GREEN, fg: '#f6e7c1', border: BRAND_GOLD }), { w: 2, h: 0.4, repeat: false }) }),
    ];
    const awningMat = new THREE.MeshLambertMaterial({ color: p.awning });
    const entry = p.side === 'E' ? buildKiosk(p, i, signMats, awningMat) : buildShop(p, i, signMats, awningMat);
    view.set(p.id, { ...entry, signMats, awningMat, color: p.awning });
  });

  // ---- Dükkân (güney / kuzey sıra) ----------------------------------------------------------
  function buildShop(p, i, signMats, awningMat) {
    const S = p.side === 'S';
    const dir = S ? 1 : -1;
    const zF = S ? 26.12 : 32.88;
    const facing = S ? 'z+' : 'z-';
    const w = p.x1 - p.x0;
    if (!p.old) {
      fbox(p.tint, p.x0, p.x1, 0, p.top, S ? 25.9 : 32.88, S ? 26.12 : 33.1);
      vbox('#efeadf', p.x0, p.x1, p.top - 0.1, p.top + 0.04, Math.min(zF, zF + dir * 0.08), Math.max(zF, zF + dir * 0.08));
      const cols = Math.max(1, Math.round(w / 1.6));
      for (let k = 0; k < cols; k++) {
        const x = p.x0 + (w / cols) * (k + 0.5);
        addWindow(b, { x, y: 4.35, z: zF, w: 0.9, h: 1.15, facing });
        if (p.top > 6.9) addWindow(b, { x, y: 6.05, z: zF, w: 0.9, h: 1.0, facing });
      }
      // Derinlik: komşudan yüksekte kalan yan duvarlar (çapraz bakınca gökyüzü görünmesin)
      for (const x of [p.x0, p.x1]) fbox(p.tint, x - 0.08, x + 0.08, 3.2, p.top, S ? 22.5 : 33.1, S ? 25.9 : 36.5);
      // Kapı: koyu ahşap, üstte cam, pirinç kol, taş basamak
      const d = p.door;
      vbox('#3b2618', d - 0.5, d + 0.5, 0, 2.2, Math.min(zF, zF + dir * 0.05), Math.max(zF, zF + dir * 0.05));
      b.add('glassDark', new THREE.PlaneGeometry(0.7, 0.9), { ...noShadow, position: [d, 1.6, zF + dir * 0.052], rotation: [0, FACING[facing], 0] });
      vbox('#c9a25e', d + 0.32, d + 0.38, 0.98, 1.04, Math.min(zF + dir * 0.05, zF + dir * 0.09), Math.max(zF + dir * 0.05, zF + dir * 0.09));
      b.box('stone', d - 0.6, d + 0.6, 0, 0.06, Math.min(zF, zF + dir * 0.4), Math.max(zF, zF + dir * 0.4), flat);
    }
    // Vitrinler (kapının iki yanı) + koyu ahşap çerçeve + taş taban
    vbox('#2a2523', p.x0 + 0.15, p.x1 - 0.15, 0, 0.45, Math.min(zF, zF + dir * 0.05), Math.max(zF, zF + dir * 0.05));
    for (const [a, c] of [[p.x0 + 0.3, p.door - 0.68], [p.door + 0.68, p.x1 - 0.3]]) {
      const vw = c - a;
      if (vw < 0.6) continue;
      const cx = (a + c) / 2;
      b.add('streetVitrine', vitrinePlane(i, vw, 1.7), { ...noShadow, position: [cx, 1.35, zF + dir * 0.03], rotation: [0, FACING[facing], 0] });
      const z0 = Math.min(zF, zF + dir * 0.07);
      const z1 = Math.max(zF, zF + dir * 0.07);
      vbox('#3b2618', a - 0.06, c + 0.06, 2.2, 2.28, z0, z1);
      vbox('#3b2618', a - 0.06, a, 0.45, 2.2, z0, z1);
      vbox('#3b2618', c, c + 0.06, 0.45, 2.2, z0, z1);
    }
    // Tente (dinamik malzeme) + saçak
    const aw = new THREE.Mesh(new THREE.BoxGeometry(w - 0.3, 0.04, 0.95), awningMat);
    aw.position.set((p.x0 + p.x1) / 2, 2.5, zF + dir * 0.47);
    aw.rotation.x = dir * 0.35;
    const val = new THREE.Mesh(new THREE.BoxGeometry(w - 0.3, 0.16, 0.02), awningMat);
    val.position.set((p.x0 + p.x1) / 2, 2.27, zF + dir * 0.92);
    for (const m of [aw, val]) {
      m.matrixAutoUpdate = false;
      m.updateMatrix();
      scene.add(m);
    }
    // Tabela (tentenin üstünde) + marka plaketi (kapının yanında, yalnızca otel markalıyken)
    const sign = makePanel(signMats[0], Math.min(2.6, w - 0.4), Math.min(2.6, w - 0.4) * 0.2, (p.x0 + p.x1) / 2, 3.08, zF + dir * 0.03, facing);
    scene.add(sign);
    const px = p.door + (p.door + 0.95 < p.x1 ? 0.78 : -0.78);
    const plaque = makePanel(brandPlaque, 0.36, 0.22, px, 1.55, zF + dir * 0.035, facing);
    plaque.visible = false;
    scene.add(plaque);
    return { sign, plaque };
  }

  // ---- Benzinlik: doğu ucunda kulübe + kanopi + pompa adası -----------------------------------
  function buildKiosk(p, i, signMats, awningMat) {
    const xF = E.maxX - 0.12; // 43.88: kulübenin batı yüzü
    fbox(p.tint, xF, E.maxX + 0.1, 0, p.top, E.minZ + 0.1, E.maxZ - 0.1);
    fbox('#7a3a2a', E.maxX + 0.1, E.maxX + 0.3, 0, 7.4, E.minZ - 0.1, E.maxZ + 0.1); // arkadaki yüksek bina
    vbox('#efeadf', xF - 0.08, E.maxX + 0.1, p.top - 0.12, p.top + 0.04, E.minZ + 0.1, E.maxZ - 0.1);
    // Kapı (z 29.0–30.0), vitrinler
    vbox('#3b2618', xF - 0.05, xF, 0, 2.2, p.door - 0.5, p.door + 0.5);
    b.add('glassDark', new THREE.PlaneGeometry(0.7, 0.9), { ...noShadow, position: [xF - 0.052, 1.6, p.door], rotation: [0, FACING['x-'], 0] });
    vbox('#2a2523', xF - 0.05, xF, 0, 0.45, E.minZ + 0.3, E.maxZ - 0.3);
    for (const [a, c] of [[p.x0, p.door - 0.68], [p.door + 0.68, p.x1]]) {
      b.add('streetVitrine', vitrinePlane(i, c - a, 1.7), { ...noShadow, position: [xF - 0.03, 1.35, (a + c) / 2], rotation: [0, FACING['x-'], 0] });
      vbox('#3b2618', xF - 0.07, xF, 2.2, 2.28, a - 0.06, c + 0.06);
    }
    // Kanopi: beyaz tavan + markalı (dinamik) saçak bandı, iki direk, pompa adası
    vbox('#f4f2ea', 37.6, 42.4, 3.05, 3.3, 27.3, 31.7, { cast: true });
    b.add('lamp', new THREE.PlaneGeometry(4.4, 4.0).rotateX(Math.PI / 2), { ...noShadow, position: [40, 3.045, 29.5] });
    const band = new THREE.Group();
    for (const [w, d, x, z] of [[4.86, 0.06, 40, 27.27], [4.86, 0.06, 40, 31.73], [0.06, 4.46, 37.57, 29.5], [0.06, 4.46, 42.43, 29.5]]) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.32, d), awningMat);
      m.position.set(x, 3.18, z);
      band.add(m);
    }
    band.updateMatrixWorld(true);
    band.traverse((o) => { o.matrixAutoUpdate = false; });
    scene.add(band);
    for (const x of [38.5, 41.5]) b.add('streetColor', tint(new THREE.CylinderGeometry(0.12, 0.12, 2.87, 10), '#c4cad2'), { position: [x, 0.18 + 2.87 / 2, 29.5] });
    vbox('#b9b4aa', 38.1, 41.9, 0, 0.18, 29.05, 29.95);
    for (const x of [39.4, 40.6]) {
      vbox('#f4f2ea', x - 0.28, x + 0.28, 0.18, 1.55, 29.33, 29.67, { cast: true });
      vbox(p.awning, x - 0.29, x + 0.29, 1.55, 1.75, 29.32, 29.68);
      vbox('#1f6fb2', x - 0.18, x + 0.18, 1.15, 1.4, 29.32, 29.33);
      vbox('#1f6fb2', x - 0.18, x + 0.18, 1.15, 1.4, 29.67, 29.68);
      for (const dz of [-0.2, 0.2]) vbox('#2a2a2c', x + 0.18, x + 0.24, 0.5, 1.1, 29.5 + dz - 0.03, 29.5 + dz + 0.03);
    }
    collision.add(38.1, 41.9, 29.05, 29.95);
    const sign = makePanel(signMats[0], 3.2, 0.64, xF - 0.03, 3.5, 29.5, 'x-');
    scene.add(sign);
    const plaque = makePanel(brandPlaque, 0.36, 0.22, xF - 0.035, 1.55, p.door + 0.78, 'x-');
    plaque.visible = false;
    scene.add(plaque);
    return { sign, plaque };
  }

  return {
    /** Sahiplik: owned=true → tabela otel markasına, tente / saçak otelin yeşiline geçer, plaket görünür */
    setOwner(id, owned) {
      const v = view.get(id);
      if (!v) return;
      v.sign.material = v.signMats[owned ? 1 : 0];
      v.awningMat.color.set(owned ? BRAND_GREEN : v.color);
      v.plaque.visible = owned;
    },
  };
}

// ---- Sistem: kapıdan satın alma, uygulama, King ---------------------------------------------------

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
const SVG_NS = 'http://www.w3.org/2000/svg';
const svg = (tag, attrs = {}, text = null) => {
  const e = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (text != null) e.textContent = text;
  return e;
};

/**
 * Achterstraat Cadde İmparatorluğu — istemci.
 *  - Dükkân kapısında E → emlak kartı (fiyat, günlük kira, geri dönüş, sahibi, "Satın al").
 *  - 📱 telefonda "Emlak" ve 💻 Resepsiyon PC'de "🏘️ Emlak" sekmesi: "Achterstraat Real Estate" — cadde haritası
 *    (mülkler renkli işaretli: satılık / senin / başkasının), seçili mülkün kartı ve liste. Telefondan her yerden,
 *    PC'den başındayken satın alınır. Ödeme ve kira oyuncunun kişisel cüzdanı (sunucu doğrular).
 *  - Sahiplik değişince tabela / tente / plaket otel markasına geçer; kral olunca HUD rozeti, uzaktaki kralın
 *    başında taç.
 */
export class StreetMonopoly {
  constructor({ engine, net, hud, interaction, player, modal, phone, reception, remotes, state, getWallet, view }) {
    this.engine = engine;
    this.net = net;
    this.hud = hud;
    this.interaction = interaction;
    this.player = player;
    this.modal = modal;
    this.phone = phone;
    this.reception = reception;
    this.remotes = remotes;
    this.state = state;
    this.getWallet = getWallet || (() => 0);
    this.view = view;
    this.street = { owned: {}, king: null, kingId: null };
    this.selected = null; // haritada seçili mülk
    this.busy = false;
    this.crown = null; // { sprite, owner } — uzaktaki kralın başındaki taç

    const $ = (id) => document.getElementById(id);
    this.el = { card: $('street-card'), body: $('street-card-body'), chip: $('king-chip') };
    $('street-card-close').addEventListener('click', () => this.modal.close(this.el.card));

    phone?.registerApp({ id: 'realestate', icon: '🏘️', name: 'Emlak', order: 4, render: (body) => this.renderApp(body, 'phone') });
    if (reception) reception.tabs.realestate = (body) => this.renderApp(body, 'pc');
    interaction.addProvider({ find: (px, pz, f) => this.findTarget(px, pz, f) });
  }

  get selfId() { return this.state.selfId; }

  /** Mülkün durumu: 'free' | 'mine' | 'other' */
  status(id) {
    const o = this.street.owned[id];
    if (!o) return 'free';
    return o.pid != null && o.pid === this.selfId ? 'mine' : 'other';
  }

  mine() { return STREET_PROPS.filter((p) => this.status(p.id) === 'mine'); }

  // ---- Durum -----------------------------------------------------------------------------

  /** snapshot.street / EVT.STREET_STATE */
  onState(s) {
    if (!s) return;
    const wasKing = this.street.kingId === this.selfId && this.street.king;
    this.street = s;
    for (const p of STREET_PROPS) this.view?.setOwner(p.id, !!s.owned[p.id]);
    const isKing = s.king && s.kingId === this.selfId;
    if (isKing && !wasKing && this.ready) this.hud.toast(`👑 Tebrikler! Artık "${R.KING_TITLE}" sensin — Achterstraat'ın tamamı senin.`, 'day');
    this.ready = true;
    this.renderChip();
    this.syncCrown();
    this.refreshApps();
    this.interaction.invalidate();
    this.engine.requestRender();
  }

  /** Cüzdan değişince açık uygulama / kart tazelensin */
  onSelf() { this.refreshApps(); }

  refreshApps() {
    if (this.phone?.current?.id === 'realestate') this.phone.rerender();
    if (this.reception?.tab === 'realestate') this.reception.refresh();
    if (!this.el.card.hidden && this.cardId) this.renderCard(this.cardId, this.cardVia);
  }

  renderChip() {
    const chip = this.el.chip;
    const k = this.street.king;
    chip.hidden = !k;
    if (!k) return;
    const me = this.street.kingId === this.selfId;
    chip.textContent = me ? `👑 ${R.KING_TITLE}` : `👑 ${R.KING_TITLE}: ${k}`;
    chip.title = `Bütün cadde tek sahipte — otel prestiji: oda ücretleri +%${Math.round((R.KING_ROOM_PRICE - 1) * 100)}`;
    chip.classList.toggle('me', me);
  }

  /** Uzaktaki kralın başında taç (kendi başımızda yok: FPV) */
  syncCrown() {
    const id = this.street.kingId;
    const rp = id != null && id !== this.selfId ? this.remotes.get(id) : null;
    if (this.crown && this.crown.owner !== rp?.obj) {
      this.crown.sprite.removeFromParent();
      this.crown = null;
    }
    if (!rp || this.crown) return;
    if (!StreetMonopoly.crownTex) {
      const c = document.createElement('canvas');
      c.width = 64;
      c.height = 64;
      const g = c.getContext('2d');
      g.font = '50px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText('👑', 32, 36);
      StreetMonopoly.crownTex = new THREE.CanvasTexture(c);
      StreetMonopoly.crownTex.colorSpace = THREE.SRGBColorSpace;
    }
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: StreetMonopoly.crownTex, transparent: true, depthWrite: false }));
    sprite.scale.set(0.32, 0.32, 1);
    sprite.position.y = 2.22;
    rp.obj.add(sprite);
    this.crown = { sprite, owner: rp.obj };
  }

  /** Oyuncu girdi / çıktı: taç doğru kişide kalsın */
  onPlayersChanged() { this.syncCrown(); }

  // ---- Kapıdaki etkileşim ---------------------------------------------------------------------

  findTarget(px, pz, f) {
    if (pz < 26 || pz > 33 || px < 7) return null;
    let best = null;
    let bestD = Infinity;
    for (const p of STREET_PROPS) {
      const [x, z] = p.point;
      const dx = x - px;
      const dz = z - pz;
      const d = Math.hypot(dx, dz);
      if (d > R.RANGE) continue;
      // Kapıya (cepheye) bakıyor mu: kapının cephe üzerindeki noktası
      const tx = p.side === 'E' ? 43.88 : p.door;
      const tz = p.side === 'E' ? p.door : p.side === 'S' ? 26.12 : 32.88;
      const ex = tx - px;
      const ez = tz - pz;
      const el2 = Math.hypot(ex, ez) || 1;
      if ((ex * f.x + ez * f.z) / el2 < 0.35) continue;
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    if (!best) return null;
    const st = this.status(best.id);
    let label;
    if (st === 'free') label = `🏪 ${best.icon} ${best.name} — satılık ${formatMoney(best.price)} · günde ${formatMoney(best.rent)} kira`;
    else if (st === 'mine') label = `🏨 ${best.icon} ${best.name} · senin (günde ${formatMoney(best.rent)})`;
    else label = `🏨 ${best.icon} ${best.name} · ${this.street.owned[best.id].by} adına`;
    return { x: best.point[0], z: best.point[1], label, short: 'Emlak', marker: false, use: () => this.openCard(best.id, 'door') };
  }

  // ---- Emlak kartı ---------------------------------------------------------------------------

  openCard(id, via) {
    this.cardId = id;
    this.cardVia = via;
    this.renderCard(id, via);
    this.modal.open(this.el.card, () => { this.cardId = null; });
  }

  renderCard(id, via) {
    const body = this.el.body;
    body.replaceChildren(this.propDetail(STREET_PROP_BY_ID[id], via, () => this.modal.close(this.el.card)));
  }

  /** Mülk ayrıntısı + satın alma düğmesi (kart, telefon, PC ortak) */
  propDetail(p, via, onBought = null) {
    const st = this.status(p.id);
    const box = el('div', `re-detail ${st}`);
    const head = el('div', 're-head');
    head.append(el('span', 're-icon', p.icon), el('div', 're-title'));
    head.lastChild.append(el('b', null, p.name), el('small', null, `${p.type} · ${p.area}`));
    box.append(head);
    const grid = el('div', 're-grid');
    const stat = (label, value) => {
      const c = el('div');
      c.append(el('small', null, label), el('b', null, value));
      grid.append(c);
    };
    stat('Fiyat', formatMoney(p.price));
    stat('Günlük kira', formatMoney(p.rent));
    stat('Geri dönüş', `${paybackDays(p)} gün`);
    stat('Sahibi', st === 'free' ? 'Satılık' : st === 'mine' ? 'Sen' : this.street.owned[p.id].by);
    box.append(grid);
    box.append(el('p', 're-note', st === 'free'
      ? `Kişisel cüzdanından ödenir; dükkân senin olur ve tabelası "by ${R.BRAND}" markasına geçer. Kira her oyun günü başında cüzdanına.`
      : `Tabela: "${p.name} · by ${R.BRAND}". Kira her gün başında ${st === 'mine' ? 'cüzdanına' : 'sahibinin cüzdanına'} geçer.`));
    if (st === 'free') {
      const wallet = this.getWallet();
      const btn = el('button', 'primary re-buy', wallet >= p.price ? `Satın al · ${formatMoney(p.price)}` : `Cüzdanda ${formatMoney(wallet)} — ${formatMoney(p.price)} gerekli`);
      btn.type = 'button';
      btn.disabled = wallet < p.price || this.busy;
      btn.addEventListener('click', () => this.buy(p.id, via, onBought));
      box.append(btn);
    }
    return box;
  }

  async buy(id, via, onBought) {
    if (this.busy) return;
    this.busy = true;
    const res = await this.net.request(EVT.STREET_ACT, { act: 'buy', id, via });
    this.busy = false;
    if (!res?.ok) {
      this.hud.toast(res?.error || 'Satın alınamadı.', 'warn');
      this.refreshApps();
      return;
    }
    const p = STREET_PROP_BY_ID[id];
    this.hud.toast(`🏘️ ${p.icon} ${p.name} artık senin! Günde ${formatMoney(p.rent)} kira cüzdanına (${res.owned}/${STREET_PROPS.length} dükkân).`, 'money');
    onBought?.();
  }

  // ---- "Achterstraat Real Estate" uygulaması (telefon + Resepsiyon PC) ---------------------------

  renderApp(body, via) {
    const mine = this.mine();
    const rent = mine.reduce((a, p) => a + p.rent, 0);
    const wrap = el('div', `re-app re-${via}`);
    const head = el('div', 're-banner');
    head.append(el('b', null, '🏘️ Achterstraat Real Estate'), el('small', null, 'Cadde Gayrimenkul · Hotel De Tulp partner ağı'));
    wrap.append(head);
    const sum = el('div', 're-summary');
    sum.append(
      el('span', null, `Senin: ${mine.length}/${STREET_PROPS.length} dükkân`),
      el('span', null, `Günlük kira: ${formatMoney(rent)}`),
      el('span', null, `Cüzdan: ${formatMoney(this.getWallet())}`),
    );
    wrap.append(sum);
    if (this.street.king) {
      const me = this.street.kingId === this.selfId;
      wrap.append(el('div', 're-king', me
        ? `👑 Sen "${R.KING_TITLE}"sın! Otel prestiji aktif: oda ücretleri +%${Math.round((R.KING_ROOM_PRICE - 1) * 100)}.`
        : `👑 ${R.KING_TITLE}: ${this.street.king} — otel prestiji aktif.`));
    } else {
      wrap.append(el('p', 're-note', `Bütün caddeyi (${formatMoney(STREET_TOTAL_PRICE)}, günde ${formatMoney(STREET_TOTAL_RENT)} kira) tek başına alan "${R.KING_TITLE} 👑" olur: otel +${R.KING_REPUTATION} itibar ve kalıcı +%${Math.round((R.KING_ROOM_PRICE - 1) * 100)} oda ücreti kazanır.`));
    }
    wrap.append(this.renderMap(body, via));
    const sel = STREET_PROP_BY_ID[this.selected];
    if (sel) wrap.append(this.propDetail(sel, via));
    else wrap.append(el('p', 're-note', 'Haritada bir mülke dokun ya da aşağıdan seç.'));
    // Liste
    const list = el('div', 're-list');
    for (const p of STREET_PROPS) {
      const st = this.status(p.id);
      const row = el('button', `re-row ${st}${this.selected === p.id ? ' on' : ''}`);
      row.type = 'button';
      const who = st === 'free' ? formatMoney(p.price) : st === 'mine' ? '✓ senin' : `👤 ${this.street.owned[p.id].by}`;
      row.append(el('span', 're-ic', p.icon), el('span', 're-nm', p.name), el('span', 're-rent', `+${formatMoney(p.rent)}/gün`), el('span', 're-who', who));
      row.addEventListener('click', () => {
        this.selected = p.id;
        this.refreshApps();
      });
      list.append(row);
    }
    wrap.append(list);
    if (via === 'phone') wrap.append(el('p', 're-note', 'Telefondan her yerden satın alabilirsin; dükkânın kapısına gidip E ile de olur.'));
    body.append(wrap);
  }

  /** Şematik cadde haritası: Achterstraat (otel, evler, sahne) + geçit + Achterstraat Oost */
  renderMap() {
    const X0 = -18;
    const X1 = 44;
    const sx = (x) => ((x - X0) / (X1 - X0)) * 620 + 10;
    const sz = (z) => ((z - 22) / 15) * 150 + 5;
    const map = svg('svg', { viewBox: '0 0 640 160', class: 're-map', role: 'img', 'aria-label': 'Achterstraat haritası' });
    map.append(svg('rect', { x: sx(-18), y: sz(26), width: sx(18) - sx(-18), height: sz(33) - sz(26), class: 'm-street' }));
    map.append(svg('rect', { x: sx(18), y: sz(26), width: sx(44) - sx(18), height: sz(33) - sz(26), class: 'm-street oost' }));
    map.append(svg('rect', { x: sx(-8), y: sz(22.6), width: sx(8) - sx(-8), height: sz(26) - sz(22.6), class: 'm-hotel' }));
    map.append(svg('text', { x: sx(0), y: sz(24.6), class: 'm-label' }, '🏨 Hotel De Tulp'));
    for (const h of PLAYER_HOUSES) map.append(svg('rect', { x: sx(h.bounds.minX) + 1, y: sz(33), width: sx(h.bounds.maxX) - sx(h.bounds.minX) - 2, height: sz(36.5) - sz(33), class: 'm-house' }));
    map.append(svg('text', { x: sx(0), y: sz(35.4), class: 'm-label small' }, 'Huis 1–8'));
    const st = STAGE.bounds;
    map.append(svg('rect', { x: sx(st.minX), y: sz(st.minZ), width: sx(st.maxX) - sx(st.minX), height: sz(st.maxZ) - sz(st.minZ), class: 'm-stage' }));
    map.append(svg('text', { x: sx(-12.5), y: sz(27.6), class: 'm-label small' }, '🎤'));
    map.append(svg('text', { x: sx(31), y: sz(29.9), class: 'm-label small' }, 'Achterstraat Oost'));
    map.append(svg('text', { x: sx(-3), y: sz(29.9), class: 'm-label small' }, 'Achterstraat'));
    for (const p of STREET_PROPS) {
      const status = this.status(p.id);
      let x;
      let y;
      let w;
      let h;
      if (p.side === 'E') {
        x = sx(37.4); y = sz(26.6); w = sx(43.9) - sx(37.4); h = sz(32.4) - sz(26.6);
      } else {
        x = sx(p.x0) + 1; w = sx(p.x1) - sx(p.x0) - 2;
        y = p.side === 'S' ? sz(23.4) : sz(33);
        h = sz(26) - sz(23.4);
      }
      const g = svg('g', { class: `m-prop ${status}${this.selected === p.id ? ' on' : ''}`, tabindex: '0' });
      g.append(svg('rect', { x, y, width: w, height: h, rx: 3 }));
      g.append(svg('text', { x: x + w / 2, y: y + h / 2 + 5, class: 'm-ic' }, p.icon));
      g.append(svg('title', {}, `${p.name} · ${formatMoney(p.price)}`));
      g.addEventListener('click', () => {
        this.selected = p.id;
        this.refreshApps();
      });
      map.append(g);
    }
    const leg = el('div', 're-legend');
    leg.append(el('span', 'free', 'Satılık'), el('span', 'mine', 'Senin'), el('span', 'other', 'Başkasının'));
    const box = el('div', 're-mapbox');
    box.append(map, leg);
    return box;
  }
}
