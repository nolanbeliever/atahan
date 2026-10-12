import * as THREE from 'three';
import { WALL_H, STEEG, VEHICLE_KIOSK } from '/shared/layout.js';
import { UV } from './Materials.js';
import { addWindow, makePanel } from './Props.js';

const TOP_EAST = 7.4; // steeg'in doğusundaki komşu bina
const TOP_WEST = 6.2; // coffee shop / bar / avlu duvarının üst katı

/** Basit tabela dokusu (tek seferlik kanvas) */
function signMaterial(lines, { bg = '#1f4d3a', fg = '#fff7e0', w = 512, h = 160 } = {}) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = fg;
  ctx.lineWidth = 6;
  ctx.strokeRect(8, 8, w - 16, h - 16);
  ctx.fillStyle = fg;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  lines.forEach((t, i) => {
    ctx.font = `700 ${i === 0 ? 56 : 34}px system-ui, sans-serif`;
    ctx.fillText(t, w / 2, h * ((i + 1) / (lines.length + 1)), w - 40);
  });
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return new THREE.MeshLambertMaterial({ map: tex });
}

/**
 * Steeg (sokaktan Achterstraat'a açık hava geçidi) ve bisiklet / scooter büfesi.
 * Duvarların zemin kat kısmı ve çarpışmaları shared/layout.js buildWallSegments'ten gelir;
 * burada zemin, üst katlar, sokak tarafındaki kemerli giriş, tabelalar ve büfe kurulur.
 */
export function buildSteeg({ batcher: b, collision, scene }) {
  const { minX, maxX } = STEEG.bounds;
  const brickUV = { uvScale: UV.brick, cast: false };
  const flat = { cast: false };

  // Zemin
  b.floor('cobble', minX - 0.1, maxX + 0.1, -0.15, 26.1, 0, { uvScale: UV.cobble });

  // Doğu: komşu binanın yan cephesi (zemin katı layout'tan), üst katlar ve pencereler
  b.box('brick', 17.9, 18.1, WALL_H, TOP_EAST, -0.15, 26.1, brickUV);
  b.box('white', 17.85, 18.1, TOP_EAST - 0.1, TOP_EAST + 0.05, -0.15, 26.1, flat);
  for (let z = 2.5; z < 25; z += 3.2) {
    addWindow(b, { x: 17.9, y: 4.6, z, w: 0.9, h: 1.15, facing: 'x-' });
    addWindow(b, { x: 17.9, y: 6.35, z, w: 0.9, h: 0.9, facing: 'x-' });
  }
  // Batı: coffee shop, bar ve avlunun üstünde tuğla
  b.box('brick', 15.9, 16.1, WALL_H, TOP_WEST, 0, 26.1, brickUV);
  b.box('white', 15.9, 16.15, TOP_WEST - 0.1, TOP_WEST + 0.05, 0, 26.1, flat);
  for (let z = 3.2; z < 25; z += 4.4) addWindow(b, { x: 16.1, y: 4.7, z, w: 0.8, h: 1.0, facing: 'x+' });

  // Sokak tarafı: kemerli giriş (komşu cephenin altından geçilir)
  const AH = 2.9;
  b.box('brick', 15.9, 18.1, AH, TOP_EAST, -0.15, 0.1, brickUV);
  b.box('white', 15.85, 18.15, TOP_EAST - 0.1, TOP_EAST + 0.05, -0.2, 0.12, flat);
  b.box('stone', minX, maxX, AH - 0.14, AH, -0.18, 0.12, flat);
  b.box('stone', minX - 0.14, minX, 0, AH, -0.18, 0.12, flat);
  b.box('stone', maxX, maxX + 0.14, 0, AH, -0.18, 0.12, flat);
  addWindow(b, { x: 17.0, y: 4.5, z: -0.15, w: 0.9, h: 1.15, facing: 'z-' });
  addWindow(b, { x: 17.0, y: 6.2, z: -0.15, w: 0.9, h: 0.9, facing: 'z-' });
  scene.add(makePanel(signMaterial(['STEEG', '🚲 → Achterstraat']), 1.5, 0.47, 17.0, AH + 0.38, -0.2, 'z-'));
  // Achterstraat ucunda da kemer tabelası (layout'taki kemerin üstünde)
  scene.add(makePanel(signMaterial(['STEEG', '🚲 → Hotel / Sokak']), 1.5, 0.47, 17.0, STEEG.gate.top + 0.4, 26.2, 'z+'));

  // ---- Bisiklet / scooter büfesi (coffee shop cephesinin önünde) ----------------------
  const [kx, kz] = VEHICLE_KIOSK.pos;
  const bz = kz + 0.55; // büfenin merkezi (cepheye yaslı)
  b.box('paintGreen', kx - 0.9, kx + 0.9, 0, 1.05, bz - 0.3, bz + 0.35);
  b.box('wood', kx - 0.95, kx + 0.95, 1.05, 1.1, bz - 0.38, bz + 0.38);
  b.box('paintGreen', kx - 0.9, kx - 0.84, 1.1, 2.3, bz - 0.3, bz - 0.24);
  b.box('paintGreen', kx + 0.84, kx + 0.9, 1.1, 2.3, bz - 0.3, bz - 0.24);
  b.box('white', kx - 1.0, kx + 1.0, 2.3, 2.42, bz - 0.6, bz + 0.38);
  // Çizgili tente
  for (let i = 0; i < 8; i++) {
    const x0 = kx - 1.0 + i * 0.25;
    b.box(i % 2 ? 'white' : 'canRed', x0, x0 + 0.25, 2.22, 2.3, bz - 0.62, bz - 0.5, flat);
  }
  scene.add(makePanel(signMaterial(['FIETS & SCOOTER', 'kiralık değil — senin olsun!'], { bg: '#9c2f2f' }), 1.7, 0.53, kx, 2.7, bz - 0.04, 'z-'));
  collision.add(kx - 0.98, kx + 0.98, bz - 0.4, 0.1);

  // ---- Park yerleri (P tabelası + zemin çizgileri) -----------------------------------
  const parking = (x0, x1, z0, z1, signX, signZ) => {
    b.box('white', x0, x1, 0.002, 0.012, z0, z0 + 0.06, flat);
    b.box('white', x0, x1, 0.002, 0.012, z1 - 0.06, z1, flat);
    b.box('white', x0, x0 + 0.06, 0.002, 0.012, z0, z1, flat);
    b.box('white', x1 - 0.06, x1, 0.002, 0.012, z0, z1, flat);
    b.add('metal', new THREE.CylinderGeometry(0.035, 0.035, 2.1, 6), { position: [signX, 1.05, signZ] });
    scene.add(makePanel(signMaterial(['P'], { bg: '#2b5ea7', w: 128, h: 128 }), 0.42, 0.42, signX, 2.0, signZ - 0.04, 'z-'));
    collision.addAround(signX, signZ, 0.08);
  };
  parking(14.6, 16.9, -3.8, -2.0, 14.4, -3.9); // büfenin önü (satın alınan araçlar burada; direk steeg girişini kapatmasın)
  parking(5.6, 7.6, -2.6, -1.2, 7.8, -1.1); // otelin önü
  b.add('metal', new THREE.CylinderGeometry(0.035, 0.035, 2.1, 6), { position: [14.6, 1.05, 32.0] });
  scene.add(makePanel(signMaterial(['P'], { bg: '#2b5ea7', w: 128, h: 128 }), 0.42, 0.42, 14.6, 2.0, 31.96, 'z-'));
  collision.addAround(14.6, 32.0, 0.08);
}
