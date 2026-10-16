import * as THREE from 'three';
import { CAR_BODIES, CAR_BY_ID } from '/shared/cars.js';
import { StaticBatcher } from './StaticBatcher.js';

/**
 * Prosedürel düşük poligonlu araba modelleri (kasa tipine göre: mikro, şehir, hatchback, SUV,
 * sedan, coupé, GT, süper araba). Görsel dosya yok.
 *
 *  - Gövde: yan profil (tampon, kaput, kapı çizgisi, bagaj, çamurluk kemerleri) ExtrudeGeometry ile
 *    genişliğe çekilir; kabin camı ayrı, daha dar bir profil (tavana doğru içe eğim yok — ucuz).
 *  - Statik parçalar araba başına malzeme başına TEK mesh'e birleştirilir (StaticBatcher):
 *    gövde, cam, koyu trim, krom, iç mekân, farlar, stop lambaları, plaka → ~8 draw call + 4 tekerlek.
 *  - Dönen tekerlekler (jant kolları dönüşü gösterir), dönen ön tekerlekler, direksiyon simidi ve
 *    hız göstergesi ibresi ayrı nesnelerdir; yalnızca sürülürken güncellenir.
 *  - İç mekân (torpido, direksiyon, gösterge, koltuklar, tavan döşemesi, A direkleri) sürücü
 *    koltuğundan görünür: dış yüzeyler tek taraflı olduğundan kabinin içinden dışarısı görünür.
 *  - Gölge haritasına girmez (statik gölge); altında ucuz bir "blob" gölge düzlemi vardır.
 *
 * Yerel eksenler: önü +Z, y = 0 zemin, sürücü tarafı (sol, Hollanda soldan direksiyonlu) +X.
 */

const shared = { mats: new Map(), geos: new Map(), tex: null, blob: null };

function lambert(hex, extra = {}) {
  const key = `l${hex}${JSON.stringify(extra)}`;
  let m = shared.mats.get(key);
  if (!m) {
    m = new THREE.MeshLambertMaterial({ color: hex, ...extra });
    shared.mats.set(key, m);
  }
  return m;
}

function basic(hex, extra = {}) {
  const key = `b${hex}${JSON.stringify(extra)}`;
  let m = shared.mats.get(key);
  if (!m) {
    m = new THREE.MeshBasicMaterial({ color: hex, ...extra });
    shared.mats.set(key, m);
  }
  return m;
}

function geo(key, make) {
  let g = shared.geos.get(key);
  if (!g) {
    g = make();
    shared.geos.set(key, g);
  }
  return g;
}

/** Hız göstergesi kadranı (tek doku, bütün arabalarda ortak) */
function dialTexture() {
  if (shared.tex) return shared.tex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#0c0f14';
  g.beginPath();
  g.arc(64, 64, 62, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = '#ffffff';
  g.fillStyle = '#ffffff';
  g.lineWidth = 3;
  g.font = 'bold 13px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  for (let i = 0; i <= 10; i++) {
    const a = Math.PI * 0.75 + (i / 10) * Math.PI * 1.5;
    const r0 = i % 2 ? 50 : 44;
    g.beginPath();
    g.moveTo(64 + Math.cos(a) * r0, 64 + Math.sin(a) * r0);
    g.lineTo(64 + Math.cos(a) * 58, 64 + Math.sin(a) * 58);
    g.stroke();
    if (i % 2 === 0) g.fillText(String(i * 30), 64 + Math.cos(a) * 33, 64 + Math.sin(a) * 33);
  }
  g.fillStyle = '#ff7a1a';
  g.font = 'bold 11px system-ui, sans-serif';
  g.fillText('km/s', 64, 94);
  shared.tex = new THREE.CanvasTexture(c);
  shared.tex.colorSpace = THREE.SRGBColorSpace;
  return shared.tex;
}

function blobMaterial() {
  if (shared.blob) return shared.blob;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 4, 32, 32, 32);
  grd.addColorStop(0, 'rgba(0,0,0,0.55)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  shared.blob = new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false });
  return shared.blob;
}

/** Yan profil (z, y) → genişliğe çekilmiş geometri (x: −w/2..w/2) */
function extrudeProfile(points, width, arches = []) {
  const s = new THREE.Shape();
  s.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) {
    const p = points[i];
    if (p === 'arches') {
      for (const a of arches) {
        s.lineTo(a.z - a.r, a.y0);
        s.lineTo(a.z - a.r, a.cy);
        s.absarc(a.z, a.cy, a.r, Math.PI, 0, true);
        s.lineTo(a.z + a.r, a.y0);
      }
      continue;
    }
    s.lineTo(p[0], p[1]);
  }
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: width, bevelEnabled: false, curveSegments: 6 });
  // Şekil (sx, sy, derinlik) → (x = −derinlik, y = sy, z = sx), sonra ortala
  g.rotateY(-Math.PI / 2);
  g.translate(width / 2, 0, 0);
  return g;
}

/** a → b arası kutu çubuk (direkler) */
function bar(b, key, a, c, t) {
  const va = new THREE.Vector3(...a);
  const vc = new THREE.Vector3(...c);
  const len = va.distanceTo(vc);
  const g = new THREE.BoxGeometry(t, len, t);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), vc.clone().sub(va).normalize());
  const e = new THREE.Euler().setFromQuaternion(q);
  b.add(key, g, { position: va.add(vc).multiplyScalar(0.5).toArray(), rotation: [e.x, e.y, e.z], cast: false, receive: false });
}

const NO_SHADOW = { cast: false, receive: false };

function wheel(r) {
  const g = new THREE.Group();
  const tire = new THREE.Mesh(geo(`tire${r}`, () => new THREE.CylinderGeometry(r, r, 0.24, 14).rotateZ(Math.PI / 2)), lambert('#16181b'));
  const rim = new THREE.Mesh(geo(`rim${r}`, () => new THREE.CylinderGeometry(r * 0.64, r * 0.64, 0.25, 10).rotateZ(Math.PI / 2)), lambert('#b9bec4'));
  const spoke = new THREE.Mesh(geo(`spk${r}`, () => new THREE.BoxGeometry(0.26, r * 1.2, 0.06)), lambert('#5a5f66'));
  const spoke2 = spoke.clone();
  spoke2.rotation.x = Math.PI / 2;
  g.add(tire, rim, spoke, spoke2);
  return g;
}

/**
 * @param {string} modelId katalog modeli
 * @param {number} colorIdx renk dizini
 * @returns {THREE.Group} userData: { wheels, steer, r, wheel, needle, brakeMat, head, body, def }
 */
export function makeCarModel(modelId, colorIdx) {
  const def = CAR_BY_ID[modelId] ?? CAR_BY_ID['kade-vier'];
  const B = CAR_BODIES[def.body];
  const color = def.colors[colorIdx]?.hex ?? def.colors[0].hex;
  const { L, W, H, belt, ws, rf, rr, deck, nose, tail, clear, wr, wf, wb } = B;
  const hl = L / 2;
  const root = new THREE.Group();
  const b = new StaticBatcher();

  // ---- Gövde (yan profil + çamurluk kemerleri) ----
  const arches = [
    { z: wb, cy: wr, r: wr + 0.07, y0: clear },
    { z: wf, cy: wr, r: wr + 0.07, y0: clear },
  ];
  // Kabinin altı oyuktur (taban floorY): içeriden bakınca gövdenin üst kapağı değil, kapı panelleri görünür
  const floorY = clear + 0.22;
  const lower = [
    [-hl, clear + 0.1], [-hl + 0.12, clear], 'arches', [hl - 0.12, clear], [hl, clear + 0.14], [hl, nose - 0.08],
    [hl - 0.18, nose], [ws, belt + 0.02], [ws, floorY], [deck, floorY], [deck, belt], [-hl + 0.14, tail], [-hl, tail - 0.1],
  ];
  b.add('body', extrudeProfile(lower, W, arches), NO_SHADOW);
  for (const sx of [-1, 1]) b.box('body', sx > 0 ? W / 2 - 0.05 : -W / 2, sx > 0 ? W / 2 : -W / 2 + 0.05, floorY, belt, deck, ws, NO_SHADOW); // kapılar
  b.floor('trim', -W / 2 + 0.05, W / 2 - 0.05, deck, ws, floorY + 0.004, NO_SHADOW); // kabin tabanı (paspas)
  // Kabin camı (biraz dar) ve tavan
  const cabW = W * 0.86;
  b.add('glass', extrudeProfile([[ws, belt], [rf, H - 0.04], [rr, H - 0.04], [deck, belt]], cabW), NO_SHADOW);
  b.box('body', -cabW / 2 + 0.01, cabW / 2 - 0.01, H - 0.06, H, rr - 0.02, rf + 0.04, NO_SHADOW);
  // Direkler (A, B, C) — içeriden de görünür
  for (const sx of [-1, 1]) {
    const x = (sx * cabW) / 2;
    bar(b, 'body', [x, belt, ws], [x, H - 0.03, rf], 0.07);
    bar(b, 'body', [x, belt, deck], [x, H - 0.03, rr], 0.09);
    if (def.body !== 'super' && def.body !== 'micro') bar(b, 'trim', [x, belt, (rf + rr) / 2 - 0.1], [x, H - 0.03, (rf + rr) / 2 - 0.1], 0.07);
  }
  // Alt etek, tamponlar, ızgara
  b.box('trim', -W / 2 - 0.005, W / 2 + 0.005, clear, clear + 0.08, -hl + 0.3, hl - 0.3, NO_SHADOW);
  b.box('trim', -W / 2 + 0.15, W / 2 - 0.15, clear + 0.05, clear + 0.17, hl - 0.04, hl + 0.02, NO_SHADOW);
  b.box('trim', -W / 2 + 0.15, W / 2 - 0.15, clear + 0.05, clear + 0.15, -hl - 0.02, -hl + 0.04, NO_SHADOW);
  const grilleW = def.body === 'super' ? W * 0.5 : W * 0.38;
  b.box('trim', -grilleW / 2, grilleW / 2, nose - 0.24, nose - 0.1, hl - 0.03, hl + 0.005, NO_SHADOW);
  // Farlar ve stop lambaları
  const lx = W / 2 - 0.26;
  for (const sx of [-1, 1]) {
    b.box('head', sx * lx - 0.17, sx * lx + 0.17, nose - 0.17, nose - 0.07, hl - 0.06, hl + 0.006, NO_SHADOW);
    b.box('brake', sx * lx - 0.17, sx * lx + 0.17, tail - 0.2, tail - 0.08, -hl - 0.006, -hl + 0.06, NO_SHADOW);
  }
  // Sarı Hollanda plakaları
  b.box('plate', -0.26, 0.26, clear + 0.17, clear + 0.29, hl + 0.005, hl + 0.025, NO_SHADOW);
  b.box('plate', -0.26, 0.26, tail - 0.36, tail - 0.24, -hl - 0.025, -hl - 0.005, NO_SHADOW);
  // Aynalar
  for (const sx of [-1, 1]) b.box('body', sx * (W / 2) - 0.07, sx * (W / 2) + 0.07, belt + 0.04, belt + 0.14, ws - 0.2, ws - 0.08, NO_SHADOW);
  // Süper araba: arka kanat
  if (B.wing) {
    b.box('trim', -W / 2 + 0.1, W / 2 - 0.1, tail + 0.22, tail + 0.26, -hl + 0.05, -hl + 0.38, NO_SHADOW);
    for (const sx of [-1, 1]) b.box('trim', sx * 0.55 - 0.03, sx * 0.55 + 0.03, tail, tail + 0.22, -hl + 0.18, -hl + 0.26, NO_SHADOW);
  }

  // ---- İç mekân (sürücü koltuğundan görünür) ----
  const seatX = B.seat.x;
  const seatZ = B.seat.z;
  b.floor('inner', -cabW / 2 + 0.02, cabW / 2 - 0.02, rr, rf, H - 0.075, { facingDown: true, ...NO_SHADOW }); // tavan döşemesi
  b.box('inner', -cabW / 2 + 0.04, cabW / 2 - 0.04, belt - 0.2, belt + 0.06, ws - 0.5, ws - 0.04, NO_SHADOW); // torpido
  b.box('trim', -cabW / 2 + 0.06, cabW / 2 - 0.06, belt + 0.055, belt + 0.07, ws - 0.48, ws - 0.1, NO_SHADOW); // torpido üstü
  b.box('trim', seatX - 0.17, seatX + 0.17, belt + 0.03, belt + 0.12, ws - 0.52, ws - 0.44, NO_SHADOW); // gösterge kaputu
  for (const sx of [1, -1]) {
    const x = sx * seatX;
    b.box('inner', x - 0.24, x + 0.24, clear + 0.18, clear + 0.36, seatZ - 0.3, seatZ + 0.22, NO_SHADOW); // oturak
    b.box('inner', x - 0.24, x + 0.24, clear + 0.3, belt + 0.38, seatZ - 0.4, seatZ - 0.28, NO_SHADOW); // sırt
  }
  if (def.body !== 'super' && def.body !== 'coupe' && def.body !== 'micro') {
    b.box('inner', -cabW / 2 + 0.08, cabW / 2 - 0.08, clear + 0.18, belt + 0.25, rr + 0.1, rr + 0.25, NO_SHADOW); // arka koltuk
  }

  const mats = {
    body: lambert(color),
    glass: lambert('#203040', { transparent: true, opacity: 0.6 }),
    trim: lambert('#1b1e22'),
    inner: lambert('#2b2724'),
    head: basic('#fff6d8'),
    brake: new THREE.MeshBasicMaterial({ color: 0x7a0f14 }), // arabaya özel: fren yapınca parlar
    plate: lambert('#f2c230'),
  };
  b.build(mats, root);

  // ---- Hareketli parçalar ----
  const wheels = [];
  const steer = [];
  for (const [z, front] of [[wf, true], [wb, false]]) {
    for (const sx of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(sx * (W / 2 - 0.14), wr, z);
      const w = wheel(wr);
      pivot.add(w);
      root.add(pivot);
      wheels.push(w);
      if (front) steer.push(pivot);
    }
  }
  // Direksiyon simidi (sürücü önünde, eğik)
  const wheelG = new THREE.Group();
  wheelG.position.set(seatX, B.eye - 0.28, seatZ + 0.56);
  wheelG.rotation.x = -0.45;
  const rim = new THREE.Mesh(geo('swheel', () => new THREE.TorusGeometry(0.17, 0.022, 6, 18)), lambert('#141414'));
  const hub = new THREE.Mesh(geo('swhub', () => new THREE.BoxGeometry(0.32, 0.05, 0.03)), lambert('#2b2b2b'));
  const logo = new THREE.Mesh(geo('swlogo', () => new THREE.CylinderGeometry(0.045, 0.045, 0.035, 10).rotateX(Math.PI / 2)), lambert('#b9bec4'));
  wheelG.add(rim, hub, logo);
  root.add(wheelG);
  // Hız göstergesi (kadran + ibre)
  const dial = new THREE.Mesh(geo('dial', () => new THREE.CircleGeometry(0.075, 20)), new THREE.MeshBasicMaterial({ map: dialTexture() }));
  dial.position.set(seatX, belt + 0.06, ws - 0.53);
  dial.rotation.set(-0.35, Math.PI, 0);
  const needle = new THREE.Group();
  const nm = new THREE.Mesh(geo('needle', () => new THREE.BoxGeometry(0.004, 0.062, 0.002).translate(0, 0.031, 0.002)), basic('#ff3b1f'));
  needle.add(nm);
  dial.add(needle);
  root.add(dial);
  // Sürücünün başı (başkasının arabasında görünür)
  const head = new THREE.Mesh(geo('dhead', () => new THREE.SphereGeometry(0.11, 10, 8)), lambert('#d9a37a'));
  head.position.set(seatX, B.eye + 0.02, seatZ - 0.05);
  head.visible = false;
  root.add(head);
  // Blob gölge
  const blob = new THREE.Mesh(geo(`blob${def.body}`, () => new THREE.PlaneGeometry(W * 1.25, L * 1.1).rotateX(-Math.PI / 2)), blobMaterial());
  blob.position.y = 0.012;
  blob.renderOrder = 1;
  root.add(blob);

  root.userData = { wheels, steer, r: wr, wheel: wheelG, needle, brakeMat: mats.brake, head, def, body: B };
  return root;
}

/** Fren lambası (yalnızca değişince) */
export function setBrake(car, on) {
  const ud = car.userData;
  if (ud.brakeOn === on) return;
  ud.brakeOn = on;
  ud.brakeMat.color.setHex(on ? 0xff2a2a : 0x7a0f14);
}

/** Gösterge ibresi: 0 → 300 km/s, 270° */
export function setNeedle(car, kmh) {
  const k = Math.min(1, Math.max(0, kmh / 300));
  car.userData.needle.rotation.z = Math.PI * 0.75 - k * Math.PI * 1.5;
}
