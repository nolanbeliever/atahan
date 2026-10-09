import * as THREE from 'three';

// Mobilya ve dekor üreticileri. Hepsi StaticBatcher'a eklenir (draw call yok),
// gerektiğinde çarpışma kutusu da kaydeder.

const _m = new THREE.Matrix4();
const _local = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _one = new THREE.Vector3(1, 1, 1);

/** Yerel koordinat sisteminde parça ekleyen küçük yardımcı (döndürülmüş prop'lar için) */
class Part {
  constructor(batcher, x, y, z, rotY = 0) {
    this.b = batcher;
    this.world = new THREE.Matrix4().compose(
      new THREE.Vector3(x, y, z),
      new THREE.Quaternion().setFromAxisAngle(_up, rotY),
      _one,
    );
  }

  add(mat, geo, pos = [0, 0, 0], rot = [0, 0, 0], opts = {}) {
    _local.compose(_v.fromArray(pos), _q.setFromEuler(new THREE.Euler(rot[0], rot[1], rot[2])), _one);
    geo.applyMatrix4(_local).applyMatrix4(this.world);
    this.b.add(mat, geo, opts);
  }

  /** İki nokta arasında ince boru (bisiklet kadrosu vb.) */
  tube(mat, a, b, r = 0.02, opts = {}) {
    const start = new THREE.Vector3().fromArray(a);
    const dir = new THREE.Vector3().fromArray(b).sub(start);
    const len = dir.length();
    const geo = new THREE.CylinderGeometry(r, r, len, 5, 1);
    _q.setFromUnitVectors(_up, dir.clone().normalize());
    _m.compose(start.addScaledVector(dir, 0.5), _q, _one);
    geo.applyMatrix4(_m).applyMatrix4(this.world);
    this.b.add(mat, geo, opts);
  }
}

/** Delft mavisi saksıda laleler */
export function addPlanter(b, col, x, z, seed = 0) {
  b.add('delft', new THREE.CylinderGeometry(0.26, 0.2, 0.5, 10), { position: [x, 0.25, z] });
  b.add('white', new THREE.CylinderGeometry(0.265, 0.265, 0.05, 10), { position: [x, 0.4, z], cast: false });
  b.add('soil', new THREE.CylinderGeometry(0.235, 0.235, 0.02, 10), { position: [x, 0.49, z], cast: false });
  const colors = ['tulipRed', 'tulipYellow', 'tulipPink'];
  for (let i = 0; i < 7; i++) {
    const a = (i / 6) * Math.PI * 2 + seed;
    const r = i === 0 ? 0 : 0.13;
    const sx = x + Math.cos(a) * r;
    const sz = z + Math.sin(a) * r;
    const h = 0.34 + ((i * 7 + seed * 3) % 5) * 0.03;
    b.add('leaf', new THREE.CylinderGeometry(0.012, 0.012, h, 4), { position: [sx, 0.5 + h / 2, sz], cast: false });
    b.add(colors[(i + seed) % 3], new THREE.CylinderGeometry(0.05, 0.028, 0.11, 6), { position: [sx, 0.5 + h + 0.04, sz], cast: false });
  }
  if (col) col.addAround(x, z, 0.28);
}

/** Klasik Hollanda bisikleti ("omafiets") — önde ahşap kasa */
export function addBike(b, col, x, z, rotY, frameMat) {
  const p = new Part(b, x, 0, z, rotY);
  p.add('black', new THREE.TorusGeometry(0.33, 0.025, 5, 14), [-0.52, 0.35, 0]);
  p.add('black', new THREE.TorusGeometry(0.33, 0.025, 5, 14), [0.52, 0.35, 0]);
  const R = [-0.52, 0.35, 0];
  const F = [0.52, 0.35, 0];
  const BB = [-0.05, 0.32, 0];
  const S = [-0.2, 0.86, 0];
  const H = [0.38, 0.92, 0];
  const HB = [0.44, 0.7, 0];
  p.tube(frameMat, R, BB);
  p.tube(frameMat, R, S);
  p.tube(frameMat, BB, S);
  p.tube(frameMat, BB, HB, 0.025);
  p.tube(frameMat, HB, F);
  p.tube(frameMat, HB, H);
  p.tube('metal', [0.3, 1.0, -0.26], [0.3, 1.0, 0.26], 0.015);
  p.tube('metal', H, [0.3, 1.0, 0], 0.018);
  p.add('black', new THREE.BoxGeometry(0.24, 0.06, 0.13), [-0.22, 0.9, 0]);
  p.add('metal', new THREE.BoxGeometry(0.42, 0.02, 0.2), [-0.5, 0.72, 0]);
  p.add('wood', new THREE.BoxGeometry(0.36, 0.24, 0.32), [0.62, 0.85, 0]);
  if (col) {
    const c = Math.abs(Math.cos(rotY));
    const hx = 0.9 * c + 0.25 * (1 - c);
    const hz = 0.25 * c + 0.9 * (1 - c);
    col.add(x - hx, x + hx, z - hz, z + hz);
  }
}

/** Kanal kenarı ağacı (karaağaç) */
export function addTree(b, col, x, z, s = 1) {
  b.add('wood', new THREE.CylinderGeometry(0.13 * s, 0.2 * s, 3.2 * s, 7), { position: [x, 1.6 * s, z] });
  b.add('leaf', new THREE.SphereGeometry(1.5 * s, 8, 6), { position: [x, 4.1 * s, z], scale: [1, 0.85, 1] });
  b.add('leaf', new THREE.SphereGeometry(1.0 * s, 7, 5), { position: [x + 0.8 * s, 4.9 * s, z - 0.3 * s] });
  if (col) col.addAround(x, z, 0.25);
}

/** "Amsterdammertje" — kanal kenarındaki ikonik bordo direkler */
export function addBollard(b, col, x, z) {
  b.add('bollard', new THREE.CylinderGeometry(0.055, 0.085, 0.82, 8), { position: [x, 0.41, z] });
  b.add('bollard', new THREE.SphereGeometry(0.06, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2), { position: [x, 0.82, z] });
  if (col) col.addAround(x, z, 0.1);
}

/** Klasik sokak lambası */
export function addStreetLamp(b, col, x, z) {
  b.add('black', new THREE.CylinderGeometry(0.05, 0.07, 3.4, 6), { position: [x, 1.7, z] });
  b.add('black', new THREE.BoxGeometry(0.34, 0.06, 0.34), { position: [x, 3.42, z] });
  b.add('lamp', new THREE.BoxGeometry(0.24, 0.32, 0.24), { position: [x, 3.6, z], cast: false });
  b.add('black', new THREE.ConeGeometry(0.26, 0.2, 4), { position: [x, 3.86, z], rotation: [0, Math.PI / 4, 0] });
  if (col) col.addAround(x, z, 0.12);
}

/**
 * Pencere: çerçeve + cam (+ kayıt). `facing` normali: 'x+', 'x-', 'z+', 'z-'.
 * glass 'skyline' ise cam yerine kanal evleri manzarası gösterilir.
 */
export function addWindow(b, { x, y, z, w, h, facing, glass = 'glassDark', uOffset = 0 }) {
  const rotY = { 'z+': 0, 'z-': Math.PI, 'x+': Math.PI / 2, 'x-': -Math.PI / 2 }[facing];
  const p = new Part(b, x, y, z, rotY);
  p.add('white', new THREE.BoxGeometry(w + 0.14, h + 0.14, 0.04), [0, 0, 0.02], [0, 0, 0], { cast: false });
  const g = new THREE.PlaneGeometry(w, h);
  if (glass === 'skyline') {
    // Manzaranın en-boy oranını koru (doku 2:1)
    const span = w / (h * 2);
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setX(i, uOffset + uv.getX(i) * span);
  }
  p.add(glass, g, [0, 0, 0.045], [0, 0, 0], { cast: false, receive: false });
  p.add('white', new THREE.BoxGeometry(0.05, h, 0.02), [0, 0, 0.055], [0, 0, 0], { cast: false });
  p.add('white', new THREE.BoxGeometry(w, 0.05, 0.02), [0, h * 0.12, 0.055], [0, 0, 0], { cast: false });
}

/** Çerçeveli tablo (düzlem + ahşap çerçeve) */
export function addPainting(b, { x, y, z, w, h, facing, mat = 'painting' }) {
  const rotY = { 'z+': 0, 'z-': Math.PI, 'x+': Math.PI / 2, 'x-': -Math.PI / 2 }[facing];
  const p = new Part(b, x, y, z, rotY);
  p.add(mat, new THREE.PlaneGeometry(w, h), [0, 0, 0.012], [0, 0, 0], { cast: false });
}

/** Döndürülmüş düz panel (tabela vb.) — ayrı mesh olarak döner, batch'e eklenmez */
export function makePanel(mat, w, h, x, y, z, facing) {
  const rotY = { 'z+': 0, 'z-': Math.PI, 'x+': Math.PI / 2, 'x-': -Math.PI / 2 }[facing];
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  mesh.position.set(x, y, z);
  mesh.rotation.y = rotY;
  mesh.matrixAutoUpdate = false;
  mesh.updateMatrix();
  return mesh;
}

/** Koltuk (berjer) — yönü: sırtın baktığı yön tersinde oturulur */
export function addArmchair(b, col, x, z, rotY, mat) {
  const p = new Part(b, x, 0, z, rotY);
  p.add(mat, new THREE.BoxGeometry(0.8, 0.32, 0.8), [0, 0.26, 0]);
  p.add('wood', new THREE.BoxGeometry(0.7, 0.1, 0.7), [0, 0.05, 0]);
  p.add(mat, new THREE.BoxGeometry(0.8, 0.55, 0.16), [0, 0.65, -0.32]);
  p.add(mat, new THREE.BoxGeometry(0.14, 0.2, 0.7), [-0.33, 0.5, 0.05]);
  p.add(mat, new THREE.BoxGeometry(0.14, 0.2, 0.7), [0.33, 0.5, 0.05]);
  if (col) col.addAround(x, z, 0.42);
}

/** Yuvarlak sehpa + abajur */
export function addSideTable(b, col, x, z, withLamp = true) {
  b.add('wood', new THREE.CylinderGeometry(0.26, 0.26, 0.04, 12), { position: [x, 0.56, z] });
  b.add('wood', new THREE.CylinderGeometry(0.04, 0.06, 0.54, 6), { position: [x, 0.27, z] });
  if (withLamp) {
    b.add('brass', new THREE.CylinderGeometry(0.03, 0.08, 0.3, 8), { position: [x, 0.73, z] });
    b.add('lamp', new THREE.CylinderGeometry(0.1, 0.17, 0.2, 10, 1, true), { position: [x, 0.95, z], cast: false });
  }
  if (col) col.addAround(x, z, 0.28);
}
