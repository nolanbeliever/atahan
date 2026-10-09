import * as THREE from 'three';
import { WALL_H, COFFEESHOP } from '/shared/layout.js';
import { PRODUCTS, SLOT } from '/shared/constants.js';
import { UV } from './Materials.js';
import { addWindow, addPainting, makePanel } from './Props.js';
import { makeCharacter } from '../game/Characters.js';

// Otelin doğusundaki Amsterdam tarzı coffee shop ("De Groene Molen").
// Loş, koyu yeşil ahşap iç mekân; ışıklar ucuz MeshBasicMaterial (gerçek ışık yok).
// Tüm statik parçalar otelle aynı StaticBatcher'a eklenir → ekstra draw call yok.

function drawShopPanel(ctx, w, h, rnd) {
  const n = 6;
  const pw = w / n;
  for (let i = 0; i < n; i++) {
    const t = 0.85 + rnd() * 0.25;
    ctx.fillStyle = `rgb(${Math.round(30 * t)},${Math.round(64 * t)},${Math.round(44 * t)})`;
    ctx.fillRect(i * pw, 0, pw, h);
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(i * pw, 0, Math.max(1, w / 160), h);
    ctx.globalAlpha = 0.08;
    ctx.fillStyle = '#ffffff';
    for (let k = 0; k < 3; k++) ctx.fillRect(i * pw + rnd() * pw, 0, Math.max(1, w / 256), h);
    ctx.globalAlpha = 1;
  }
}

function drawNeonSign(ctx, w, h) {
  ctx.fillStyle = '#0d1f14';
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = '#3cff7a';
  ctx.lineWidth = Math.max(2, h * 0.05);
  ctx.strokeRect(h * 0.08, h * 0.08, w - h * 0.16, h - h * 0.16);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#b6ffcb';
  ctx.shadowColor = '#3cff7a';
  ctx.shadowBlur = h * 0.12;
  ctx.font = `800 ${Math.round(h * 0.42)}px "Arial Black", Impact, sans-serif`;
  ctx.fillText('COFFEESHOP', w / 2, h * 0.43, w * 0.9);
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#ffd27a';
  ctx.font = `italic ${Math.round(h * 0.2)}px Georgia, serif`;
  ctx.fillText('De Groene Molen  ·  yalnızca 18+', w / 2, h * 0.78, w * 0.9);
}

function drawMenu(ctx, w, h) {
  ctx.fillStyle = '#5a3a22';
  ctx.fillRect(0, 0, w, h);
  const b = h * 0.06;
  ctx.fillStyle = '#1c2420';
  ctx.fillRect(b, b, w - 2 * b, h - 2 * b);
  ctx.fillStyle = '#f4f1ea';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  ctx.font = `700 ${Math.round(h * 0.15)}px Georgia, serif`;
  ctx.fillText('MENÜ · Kaart', w / 2, h * 0.18);
  ctx.font = `${Math.round(h * 0.1)}px Georgia, serif`;
  PRODUCTS.forEach((p, i) => {
    const y = h * (0.36 + i * 0.15);
    ctx.textAlign = 'left';
    ctx.fillStyle = '#c8f5d3';
    ctx.fillText(p.name, w * 0.08, y);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#ffd27a';
    ctx.fillText(`€${p.price}`, w * 0.92, y);
  });
}

function drawSlotScreen(ctx, w, h) {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#2b0a3d');
  g.addColorStop(1, '#0b0414');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffd23f';
  ctx.font = `800 ${Math.round(h * 0.2)}px Impact, "Arial Black", sans-serif`;
  ctx.fillText('LUCKY TULP', w / 2, h * 0.17);
  const cw = w * 0.26;
  for (let i = 0; i < 3; i++) {
    const x = w * 0.1 + i * (cw + w * 0.04);
    ctx.fillStyle = '#fdf6e3';
    ctx.fillRect(x, h * 0.32, cw, h * 0.38);
    ctx.fillStyle = '#d7263d';
    ctx.font = `800 ${Math.round(h * 0.3)}px Impact, sans-serif`;
    ctx.fillText('7', x + cw / 2, h * 0.52);
  }
  ctx.fillStyle = '#9ff0bb';
  ctx.font = `600 ${Math.round(h * 0.12)}px system-ui, sans-serif`;
  ctx.fillText(`€${SLOT.BET} / çevir`, w / 2, h * 0.86);
}

/**
 * Coffee shop'u kurar.
 * @returns {{ budtender: THREE.Object3D }}
 */
export function buildCoffeeShop({ batcher: b, collision, scene, mats, factory }) {
  const S = COFFEESHOP;
  const L = (o) => new THREE.MeshLambertMaterial(o);
  const B = (o) => new THREE.MeshBasicMaterial(o);

  // Bu binaya özel malzemeler (batcher anahtarlarıyla mats'e eklenir)
  Object.assign(mats, {
    shopWall: L({ map: factory.make(drawShopPanel, { seed: 31 }) }),
    floorShop: L({ map: mats.floorRoom.map, color: 0x7a5a42 }),
    shopCeiling: B({ color: 0x2e2620 }),
    neonGreen: B({ color: 0x3cff7a }),
    neonPink: B({ color: 0xff4fa3 }),
    neonYellow: B({ color: 0xffd23f }),
    shopGlass: B({ color: 0xffc46b }), // dışarıdan sıcak ışıklı vitrin
    slotBody: L({ color: 0xa3192c }),
    jar: B({ color: 0xbfe3d0 }),
  });
  const signMat = B({ map: factory.make(drawNeonSign, { w: 2, h: 0.25, repeat: false }) });
  const menuMat = B({ map: factory.make(drawMenu, { w: 1.3, h: 0.5, repeat: false }) });
  const slotMat = B({ map: factory.make(drawSlotScreen, { w: 0.8, h: 0.5, repeat: false }) });

  // ---- Kabuk ---------------------------------------------------------------
  b.floor('floorShop', 8.1, 16, -0.1, 8, 0, { uvScale: UV.floorRoom });
  b.floor('shopCeiling', 8.1, 16, 0, 8, WALL_H, { facingDown: true, cast: false, receive: false });
  // Batı yüzü (otelin doğu duvarı) dükkân tarafında ahşap kaplama
  b.box('shopWall', 8.1, 8.14, 0, WALL_H, 0.1, 7.9, { uvScale: UV.shopWall, cast: false });

  // Üst cephe (sokaktan görünen kanal evi) + boyunlu çatı
  const noCast = { cast: false, uvScale: UV.brick };
  b.box('brick', 8.2, 16.1, WALL_H, 7.6, -0.1, 0.1, noCast);
  b.box('brick', 10.4, 13.8, 7.6, 8.8, -0.1, 0.1, noCast);
  b.box('brick', 11.4, 12.8, 8.8, 9.5, -0.1, 0.1, noCast);
  b.box('white', 8.2, 16.2, WALL_H, WALL_H + 0.14, -0.22, -0.1, { cast: false });
  for (const y of [4.6, 6.5]) {
    for (const x of [9.4, 12.1, 14.8]) addWindow(b, { x, y, z: -0.1, w: 1.0, h: 1.3, facing: 'z-' });
  }
  addWindow(b, { x: 12.1, y: 8.2, z: -0.1, w: 0.7, h: 0.8, facing: 'z-' });

  // Vitrinler: dışarıdan sıcak sarı ışık, içeriden gün ışığı
  for (const [x, w] of [[9.45, 1.6], [14.1, 2.6]]) {
    addWindow(b, { x, y: 1.45, z: -0.1, w, h: 1.5, facing: 'z-', glass: 'shopGlass' });
    addWindow(b, { x, y: 1.45, z: 0.1, w, h: 1.5, facing: 'z+', glass: 'glassDay' });
  }
  // Kapı kasası
  b.box('neonYellow', S.door.from - 0.08, S.door.from, 0, 2.5, -0.16, -0.1, { cast: false });
  b.box('neonYellow', S.door.to, S.door.to + 0.08, 0, 2.5, -0.16, -0.1, { cast: false });
  b.box('stone', S.door.from - 0.3, S.door.to + 0.3, 0, 0.05, -0.7, -0.1, { cast: false });
  // Neon tabela (sokak tarafı)
  scene.add(makePanel(signMat, 4.4, 0.55, 12.0, 2.86, -0.125, 'z-'));

  // ---- Tezgâh ve raflar ------------------------------------------------------
  const c = S.counter;
  b.box('wood', c.minX, c.maxX, 0, 1.0, c.minZ, c.maxZ, { uvScale: UV.wood });
  b.box('black', c.minX - 0.05, c.maxX + 0.05, 1.0, 1.06, c.minZ - 0.06, c.maxZ + 0.05);
  b.box('neonGreen', c.minX + 0.05, c.maxX - 0.05, 0.86, 0.9, c.minZ - 0.015, c.minZ, { cast: false });
  collision.add(c.minX - 0.05, c.maxX + 0.05, c.minZ - 0.06, c.maxZ + 0.05);
  // Arka raflar + kavanozlar
  for (const y of [1.2, 1.75]) {
    b.box('wood', c.minX, c.maxX, y, y + 0.05, 7.55, 7.9, { cast: false });
    for (let i = 0; i < 7; i++) {
      const x = c.minX + 0.3 + i * ((c.maxX - c.minX - 0.6) / 6);
      b.add('jar', new THREE.CylinderGeometry(0.08, 0.08, 0.22, 8), { position: [x, y + 0.16, 7.72], cast: false });
      b.add('brass', new THREE.CylinderGeometry(0.085, 0.085, 0.04, 8), { position: [x, y + 0.29, 7.72], cast: false });
    }
  }
  scene.add(makePanel(menuMat, 2.6, 1.0, (c.minX + c.maxX) / 2, 2.55, 7.88, 'z-'));
  // Kasa (yazar kasa) + tezgâh üstü sarkıt lambalar
  b.box('black', 13.4, 13.8, 1.06, 1.3, 6.2, 6.5, { cast: false });
  for (const x of [10.6, 13.9]) { // menü panosunun iki yanında, önünü kapatmasın
    b.add('black', new THREE.CylinderGeometry(0.008, 0.008, 0.9, 4), { position: [x, WALL_H - 0.45, 6.35], cast: false, receive: false });
    b.add('neonYellow', new THREE.ConeGeometry(0.18, 0.22, 10, 1, true), { position: [x, WALL_H - 1.0, 6.35], cast: false, receive: false });
  }

  // Satış görevlisi (budtender)
  const budtender = makeCharacter({ skin: 3, hair: 0, hat: true }, { color: '#2f6b3a', staff: true });
  budtender.position.set(S.budtender[0], 0, S.budtender[1]);
  budtender.rotation.y = Math.PI;
  budtender.updateMatrixWorld(true);
  budtender.traverse((o) => { o.matrixAutoUpdate = false; });
  scene.add(budtender);
  collision.add(c.minX, c.maxX, c.maxZ, 7.9); // tezgâh arkası personele ait

  // ---- Slot makinesi --------------------------------------------------------
  const sx = S.slot.x;
  const sz = S.slot.z;
  b.box('slotBody', sx - 0.35, sx + 0.35, 0, 1.75, sz - 0.35, sz + 0.35);
  b.box('black', sx - 0.4, sx - 0.35, 0.85, 0.95, sz - 0.33, sz + 0.33); // para gözü
  b.box('neonYellow', sx - 0.36, sx + 0.36, 1.75, 1.85, sz - 0.36, sz + 0.36, { cast: false });
  b.add('metal', new THREE.CylinderGeometry(0.025, 0.025, 0.5, 6), { position: [sx, 1.2, sz + 0.42] });
  b.add('canRed', new THREE.SphereGeometry(0.06, 8, 6), { position: [sx, 1.47, sz + 0.42], cast: false });
  scene.add(makePanel(slotMat, 0.6, 0.38, sx - 0.36, 1.3, sz, 'x-'));
  collision.add(sx - 0.42, sx + 0.45, sz - 0.4, sz + 0.5);

  // ---- Oturma alanı ---------------------------------------------------------
  b.box('fabricGreen', 8.15, 8.7, 0, 0.45, 0.9, 5.6);
  b.box('fabricGreen', 8.15, 8.35, 0.45, 1.05, 0.9, 5.6);
  b.box('fabricOrange', 8.36, 8.5, 0.5, 0.85, 1.4, 2.0, { cast: false });
  b.box('fabricOrange', 8.36, 8.5, 0.5, 0.85, 3.6, 4.2, { cast: false });
  collision.add(8.1, 8.75, 0.9, 5.6);
  for (const z of [1.95, 4.15]) {
    b.box('wood', 9.2, 9.9, 0.4, 0.46, z - 0.4, z + 0.4, { uvScale: UV.wood });
    b.box('wood', 9.5, 9.6, 0, 0.4, z - 0.05, z + 0.05);
    collision.add(9.2, 9.9, z - 0.4, z + 0.4);
    b.add('fabricOrange', new THREE.CylinderGeometry(0.26, 0.28, 0.42, 10), { position: [10.45, 0.21, z] });
    collision.addAround(10.45, z, 0.27);
  }
  b.floor('rugRed', 8.8, 11.0, 1.0, 5.2, 0.008, { cast: false });
  // Yüksek masa + tabureler (vitrin önü)
  b.add('wood', new THREE.CylinderGeometry(0.38, 0.38, 0.04, 12), { position: [13.4, 1.05, 1.6] });
  b.add('metal', new THREE.CylinderGeometry(0.04, 0.06, 1.05, 6), { position: [13.4, 0.52, 1.6] });
  collision.addAround(13.4, 1.6, 0.4);
  for (const [x, z] of [[12.75, 1.6], [13.4, 2.3]]) {
    b.add('black', new THREE.CylinderGeometry(0.17, 0.17, 0.06, 10), { position: [x, 0.75, z] });
    b.add('metal', new THREE.CylinderGeometry(0.025, 0.04, 0.72, 5), { position: [x, 0.36, z] });
    collision.addAround(x, z, 0.18);
  }
  // Büyük saksı bitkileri (köşeler)
  for (const [x, z] of [[8.6, 7.35], [15.35, 7.35]]) {
    b.add('delft', new THREE.CylinderGeometry(0.28, 0.22, 0.55, 10), { position: [x, 0.275, z] });
    b.add('leaf', new THREE.SphereGeometry(0.55, 8, 6), { position: [x, 1.15, z], scale: [1, 1.3, 1] });
    collision.addAround(x, z, 0.3);
  }
  addPainting(b, { x: 15.9, y: 1.9, z: 5.2, w: 1.2, h: 0.88, facing: 'x-' });

  // Tavan kenarında renkli ip ışıklar (gerçek ışık değil → bedava)
  const colors = ['neonYellow', 'neonGreen', 'neonPink'];
  let k = 0;
  const bulb = (x, z) => b.add(colors[k++ % 3], new THREE.SphereGeometry(0.045, 6, 4), { position: [x, WALL_H - 0.12, z], cast: false, receive: false });
  for (let x = 8.5; x < 15.8; x += 0.55) { bulb(x, 0.3); bulb(x, 7.7); }
  for (let z = 0.85; z < 7.4; z += 0.55) { bulb(8.4, z); bulb(15.7, z); }

  return { budtender };
}
