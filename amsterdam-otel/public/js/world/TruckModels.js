import * as THREE from 'three';
import { CAR_BODIES } from '/shared/cars.js';
import { StaticBatcher } from './StaticBatcher.js';

/**
 * Prosedürel lojistik tırı: kabinli çekici (cab-over) + 13.6 m'lik dorse.
 *
 *  - Çekici: kabin kalın olmayan levhalardan kurulur (levhaların iç yüzü de çizilir) → sürücü koltuğundan
 *    gerçek bir kabin görünür: geniş ön cam, A direkleri, tavan, kapı panelleri, geniş torpido, yatay büyük
 *    direksiyon, hız / devir kadranı, takograf, dev dikiz aynaları. Statik parçalar malzeme başına tek mesh.
 *  - Dorse ayrı bir pivotta (beşinci teker) durur; `articulate()` çekicinin gittiği yola göre açısını
 *    günceller (kıvrılma: dθ = ds / L · sin(çekici − dorse)). Yalnızca yük takılıyken görünür
 *    (`setTrailer(cargoId)`); yan branda üzerinde "Hotel De Tulp Lojistik" yazısı ve yük şeridi rengi.
 *  - userData sözleşmesi CarModels ile aynıdır (wheels, steer, r, wheel, needle, brakeMat, head, def, body)
 *    → UndergroundGarage / CarCockpit / CityVehicleSystem tırı başka bir değişiklik olmadan sürer.
 * Yerel eksenler: önü +Z, y = 0 zemin, sürücü tarafı (sol) +X.
 */

const shared = { mats: new Map(), geos: new Map(), dial: null, logo: null };
const NO = { cast: false, receive: false };

function lambert(hex, extra = {}) {
  const key = `l${hex}${JSON.stringify(extra)}`;
  let m = shared.mats.get(key);
  if (!m) {
    m = new THREE.MeshLambertMaterial({ color: hex, ...extra });
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

function canvasTex(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Tır göstergesi: 0–160 km/s kadranı (ibre setNeedle'da needleMax ile) */
function dialTexture() {
  if (shared.dial) return shared.dial;
  shared.dial = canvasTex(128, 128, (g) => {
    g.fillStyle = '#0b0e12';
    g.beginPath();
    g.arc(64, 64, 62, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#d8e2ec';
    g.fillStyle = '#d8e2ec';
    g.lineWidth = 3;
    g.font = 'bold 13px system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (let i = 0; i <= 5; i++) {
      const a = Math.PI * 0.75 + (i / 5) * Math.PI * 1.5;
      g.beginPath();
      g.moveTo(64 + Math.cos(a) * 46, 64 + Math.sin(a) * 46);
      g.lineTo(64 + Math.cos(a) * 58, 64 + Math.sin(a) * 58);
      g.stroke();
      g.fillText(String(i * 32), 64 + Math.cos(a) * 33, 64 + Math.sin(a) * 33);
    }
    g.fillStyle = '#ff9d2e';
    g.font = 'bold 10px system-ui, sans-serif';
    g.fillText('km/s', 64, 96);
  });
  return shared.dial;
}

/** Dorse brandası: otel logosu (her renk için ortak doku, yük şeridi rengi ayrı malzeme) */
function logoTexture() {
  if (shared.logo) return shared.logo;
  shared.logo = canvasTex(1024, 192, (g, w, h) => {
    g.fillStyle = '#f4f1ea';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#1f5d43';
    g.fillRect(0, h - 26, w, 26);
    g.fillStyle = '#c3202f';
    for (let i = 0; i < 3; i++) {
      g.beginPath();
      g.ellipse(110 + i * 34, 92, 15, 30, (i - 1) * 0.35, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = '#1f5d43';
    g.font = 'bold 74px Georgia, serif';
    g.textBaseline = 'middle';
    g.fillText('Hotel De Tulp', 210, 80);
    g.font = '600 34px system-ui, sans-serif';
    g.fillStyle = '#3d434b';
    g.fillText('LOJİSTİK · AMSTERDAM', 214, 140);
  });
  return shared.logo;
}

function wheel(r, dual) {
  const g = new THREE.Group();
  const w = dual ? 0.56 : 0.32;
  g.add(new THREE.Mesh(geo(`ttire${r}${dual}`, () => new THREE.CylinderGeometry(r, r, w, 14).rotateZ(Math.PI / 2)), lambert('#141619')));
  g.add(new THREE.Mesh(geo(`trim${r}${dual}`, () => new THREE.CylinderGeometry(r * 0.55, r * 0.55, w + 0.02, 10).rotateZ(Math.PI / 2)), lambert('#aeb4ba')));
  const spoke = new THREE.Mesh(geo(`tspk${r}`, () => new THREE.BoxGeometry(w + 0.04, r * 1.05, 0.08)), lambert('#5a5f66'));
  g.add(spoke);
  return g;
}

/**
 * @param {object} def katalog modeli (gövde 'truck')
 * @param {number} colorIdx renk dizini
 */
export function makeTruckModel(def, colorIdx) {
  const B = CAR_BODIES.truck;
  const color = def.colors[colorIdx]?.hex ?? def.colors[0].hex;
  const W = B.W;
  const hw = W / 2;
  const hl = B.L / 2; // 3.15
  const root = new THREE.Group();
  const b = new StaticBatcher();
  const box = (k, x0, x1, y0, y1, z0, z1) => b.box(k, x0, x1, y0, y1, z0, z1, NO);

  // ---- Şasi, yakıt depoları, beşinci teker ----
  box('chassis', -0.5, 0.5, 0.62, 0.9, -hl, hl - 0.4);
  box('chassis', -hw + 0.05, hw - 0.05, 0.55, 0.95, hl - 0.35, hl); // ön tampon
  box('trim', -hw + 0.2, hw - 0.2, 0.6, 0.72, hl, hl + 0.03); // tampon şeridi
  for (const sx of [-1, 1]) {
    b.add('chrome', new THREE.CylinderGeometry(0.3, 0.3, 1.25, 12).rotateX(Math.PI / 2), { position: [sx * 0.86, 0.95, -0.25], ...NO }); // yakıt deposu
    box('chassis', sx * hw - (sx > 0 ? 0.32 : -0.02), sx * hw + (sx > 0 ? 0.02 : 0.32), 0.95, 1.05, -2.9, -0.95); // basamak / çamurluk
  }
  box('chassis', -0.75, 0.75, 1.0, 1.12, B.fifth - 0.7, B.fifth + 0.7); // beşinci teker tablası
  box('trim', -1.1, 1.1, 0.95, 1.05, -hl - 0.02, -hl + 0.12); // arka çamurluk kirişi

  // ---- Kabin (ince levhalar: içi de görünür) ----
  const zF = hl; // ön yüz
  const zB = 0.95; // kabinin arkası
  const y0 = 1.12; // kabin tabanı
  const yW = 2.05; // ön cam alt kenarı
  const yS = 2.2; // yan cam alt kenarı
  const yR = B.H; // tavan
  const t = 0.05;
  box('body', -hw, hw, y0, yW, zF - t, zF); // ön panel (ızgara altı)
  box('body', -hw, hw, yR - 0.08, yR, zB, zF); // tavan
  box('body', -hw, hw, y0, yR, zB, zB + t); // arka duvar
  for (const sx of [-1, 1]) {
    const x0 = sx > 0 ? hw - t : -hw;
    const x1 = sx > 0 ? hw : -hw + t;
    box('body', x0, x1, y0, yS, zB, zF); // kapı paneli
    box('body', x0, x1, yS, yR, zB, zB + 0.55); // B direği / arka yan panel
    box('body', sx * (hw - 0.04) - 0.06, sx * (hw - 0.04) + 0.06, yW, yR, zF - 0.12, zF); // A direği
  }
  box('body', -hw, hw, yR - 0.22, yR, zF - t, zF); // ön cam üstü
  // Cam: ön ve yanlar (yarı saydam)
  b.add('glass', new THREE.PlaneGeometry(W - 0.14, yR - 0.22 - yW), { position: [0, (yW + yR - 0.22) / 2, zF - 0.02], ...NO });
  for (const sx of [-1, 1]) {
    b.add('glass', new THREE.PlaneGeometry(zF - 0.12 - (zB + 0.55), yR - 0.08 - yS), { position: [sx * (hw - 0.02), (yS + yR - 0.08) / 2, (zF - 0.12 + zB + 0.55) / 2], rotation: [0, Math.PI / 2, 0], ...NO });
  }
  // Rüzgâr deflektörü (tavan spoyleri) ve güneşlik
  box('body', -hw + 0.1, hw - 0.1, yR, yR + 0.42, zB + 0.2, zB + 1.0);
  box('trim', -hw + 0.02, hw - 0.02, yR - 0.24, yR - 0.16, zF, zF + 0.28);
  // Izgara, farlar, logo, plaka
  box('trim', -0.85, 0.85, 1.25, 1.95, zF, zF + 0.025);
  for (let i = 0; i < 5; i++) box('chrome', -0.82, 0.82, 1.3 + i * 0.13, 1.34 + i * 0.13, zF + 0.025, zF + 0.04);
  box('chrome', -0.32, 0.32, 1.98, 2.04, zF, zF + 0.03); // marka şeridi
  for (const sx of [-1, 1]) box('head', sx * 0.98 - 0.22, sx * 0.98 + 0.22, 0.98, 1.14, zF, zF + 0.035);
  box('plate', -0.26, 0.26, 0.74, 0.86, zF + 0.03, zF + 0.05);
  // Arka stop lambaları (şasi sonunda)
  for (const sx of [-1, 1]) box('brake', sx * 1.0 - 0.14, sx * 1.0 + 0.14, 0.95, 1.07, -hl - 0.03, -hl);
  // Dikiz aynaları (kol + büyük ayna)
  for (const sx of [-1, 1]) {
    box('trim', sx * hw - (sx > 0 ? 0 : 0.32), sx * hw + (sx > 0 ? 0.32 : 0), 2.62, 2.66, zF - 0.32, zF - 0.28);
    box('trim', sx * (hw + 0.3) - 0.05, sx * (hw + 0.3) + 0.05, 2.05, 2.95, zF - 0.36, zF - 0.22);
    box('mirror', sx * (hw + 0.3) - 0.04, sx * (hw + 0.3) + 0.04, 2.1, 2.9, zF - 0.39, zF - 0.37);
  }

  // ---- İç mekân ----
  const sxs = B.seat.x;
  const sz = B.seat.z;
  b.floor('inner', -hw + t, hw - t, zB + t, zF - t, y0 + 0.01, NO); // taban
  b.floor('inner', -hw + t, hw - t, zB + t, zF - t, yR - 0.09, { facingDown: true, ...NO }); // tavan döşemesi
  box('dash', -hw + t, hw - t, 1.55, 2.0, zF - 0.62, zF - t); // geniş torpido
  box('trim', -hw + t, hw - t, 1.98, 2.04, zF - 0.66, zF - 0.06); // torpido üstü
  box('trim', sxs - 0.3, sxs + 0.3, 2.0, 2.12, zF - 0.62, zF - 0.5); // gösterge kaputu
  box('screen', -0.28, 0.08, 1.9, 2.02, zF - 0.64, zF - 0.62); // orta ekran (navi)
  box('tacho', -0.62, -0.32, 1.66, 1.74, zF - 0.64, zF - 0.62); // takograf yuvası
  for (const x of [sxs, -sxs]) {
    box('seat', x - 0.3, x + 0.3, y0 + 0.4, y0 + 0.58, sz - 0.3, sz + 0.25); // oturak
    box('seat', x - 0.3, x + 0.3, y0 + 0.5, y0 + 1.35, sz - 0.42, sz - 0.3); // sırt
  }
  box('inner', -hw + 0.1, hw - 0.1, y0 + 0.35, y0 + 0.55, zB + t, zB + 0.75); // yatak
  box('trim', -0.25, 0.25, y0, y0 + 0.5, sz - 0.2, sz + 0.6); // vites konsolu

  const mats = {
    body: lambert(color),
    chassis: lambert('#22262b'),
    trim: lambert('#1a1d21'),
    chrome: lambert('#c9ced4'),
    glass: lambert('#1d2c3a', { transparent: true, opacity: 0.45, side: THREE.DoubleSide, depthWrite: false }),
    mirror: lambert('#9fb8cc'),
    inner: lambert('#3a3430'),
    dash: lambert('#2a2c30'),
    seat: lambert('#4a3d34'),
    screen: new THREE.MeshBasicMaterial({ color: 0x2f8fd8 }),
    tacho: new THREE.MeshBasicMaterial({ color: 0x5ce07a }),
    head: new THREE.MeshBasicMaterial({ color: 0xfff4d6 }),
    brake: new THREE.MeshBasicMaterial({ color: 0x7a0f14 }),
    plate: lambert('#f2c230'),
  };
  b.build(mats, root);

  // ---- Tekerlekler ----
  const wheels = [];
  const steer = [];
  const wr = B.wr;
  for (const sx of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(sx * (hw - 0.2), wr, B.wf);
    const w = wheel(wr, false);
    pivot.add(w);
    root.add(pivot);
    wheels.push(w);
    steer.push(pivot);
    for (const z of [-1.25, B.wb - 0.4]) {
      const r = wheel(wr, true);
      r.position.set(sx * (hw - 0.32), wr, z);
      root.add(r);
      wheels.push(r);
    }
  }

  // ---- Direksiyon (büyük, yataya yakın), kadranlar ----
  const wheelG = new THREE.Group();
  wheelG.position.set(sxs, B.eye - 0.48, sz + 0.62);
  wheelG.rotation.x = -1.05;
  wheelG.add(
    new THREE.Mesh(geo('tswheel', () => new THREE.TorusGeometry(0.25, 0.026, 6, 22)), lambert('#16181a')),
    new THREE.Mesh(geo('tswhub', () => new THREE.BoxGeometry(0.46, 0.06, 0.035)), lambert('#2b2b2b')),
    new THREE.Mesh(geo('tswlogo', () => new THREE.CylinderGeometry(0.06, 0.06, 0.04, 10).rotateX(Math.PI / 2)), lambert('#c9ced4')),
  );
  root.add(wheelG);
  const dial = new THREE.Mesh(geo('tdial', () => new THREE.CircleGeometry(0.085, 22)), new THREE.MeshBasicMaterial({ map: dialTexture() }));
  dial.position.set(sxs - 0.12, 2.05, zF - 0.6);
  dial.rotation.set(-0.5, Math.PI, 0);
  const needle = new THREE.Group();
  needle.add(new THREE.Mesh(geo('tneedle', () => new THREE.BoxGeometry(0.004, 0.07, 0.002).translate(0, 0.035, 0.002)), new THREE.MeshBasicMaterial({ color: 0xff3b1f })));
  dial.add(needle);
  root.add(dial);
  const rev = new THREE.Mesh(geo('tdial', () => new THREE.CircleGeometry(0.085, 22)), new THREE.MeshBasicMaterial({ map: dialTexture() }));
  rev.position.set(sxs + 0.12, 2.05, zF - 0.6);
  rev.rotation.set(-0.5, Math.PI, 0);
  root.add(rev);
  const head = new THREE.Mesh(geo('tdhead', () => new THREE.SphereGeometry(0.12, 10, 8)), lambert('#d9a37a'));
  head.position.set(sxs, B.eye + 0.02, sz - 0.05);
  head.visible = false;
  root.add(head);

  // ---- Dorse (pivot: beşinci teker) ----
  const pivot = new THREE.Group();
  pivot.position.set(0, 0, B.fifth);
  const trailer = new THREE.Group();
  pivot.add(trailer);
  pivot.visible = false;
  root.add(pivot);
  const TL = B.trailer;
  const tb = new StaticBatcher();
  const tbox = (k, x0, x1, ya, yb, z0, z1) => tb.box(k, x0, x1, ya, yb, z0, z1, NO);
  const front = 0.9; // pim önündeki çıkıntı
  const zr = front - TL; // arka uç
  tbox('frame', -0.5, 0.5, 1.05, 1.25, zr + 0.3, front); // şasi
  tbox('floor', -1.27, 1.27, 1.25, 1.35, zr, front);
  tbox('box', -1.27, 1.27, 3.95, 4.0, zr, front); // tavan
  tbox('box', -1.27, 1.27, 1.35, 4.0, front - 0.05, front); // ön duvar
  tbox('door', -1.27, 1.27, 1.35, 4.0, zr, zr + 0.05); // arka kapılar
  tbox('frame', -0.02, 0.02, 1.35, 4.0, zr - 0.01, zr); // kapı aralığı
  for (const sx of [-1, 1]) {
    tbox('frame', sx * 1.27 - 0.04, sx * 1.27 + 0.04, 1.3, 1.42, zr, front); // alt kiriş
    tbox('frame', -0.12 + sx * 0.75, 0.12 + sx * 0.75, 0.25, 1.05, front - 3.6, front - 3.4); // destek ayağı
    tbox('brakeT', sx * 1.0 - 0.15, sx * 1.0 + 0.15, 1.0, 1.12, zr - 0.03, zr);
    tbox('frame', sx * 1.27 - 0.03, sx * 1.27 + 0.03, 0.75, 1.05, zr + 4.2, zr + 0.6); // yan koruma
  }
  // Yan branda: logo dokulu düzlem (iki yan)
  const side = new THREE.PlaneGeometry(TL - 0.2, 2.6);
  tb.add('logo', side.clone().rotateY(Math.PI / 2), { position: [1.275, 2.67, (zr + front) / 2], ...NO });
  tb.add('logo', side.rotateY(-Math.PI / 2), { position: [-1.275, 2.67, (zr + front) / 2], ...NO });
  const tmats = {
    frame: lambert('#25292e'),
    floor: lambert('#3a3f45'),
    box: lambert('#e9e6df'),
    door: lambert('#d8d4cc'),
    logo: new THREE.MeshLambertMaterial({ map: logoTexture() }),
    brakeT: mats.brake,
  };
  tb.build(tmats, trailer);
  // Yük şeridi (renk yük türüne göre)
  const stripeMat = new THREE.MeshLambertMaterial({ color: 0xc3202f });
  for (const sx of [-1, 1]) {
    const s = new THREE.Mesh(geo('tstripe', () => new THREE.BoxGeometry(0.02, 0.22, TL - 0.4)), stripeMat);
    s.position.set(sx * 1.285, 1.5, (zr + front) / 2);
    trailer.add(s);
  }
  for (const z of [zr + 1.4, zr + 2.75, zr + 4.1]) {
    for (const sx of [-1, 1]) {
      const w = wheel(0.5, true);
      w.position.set(sx * 0.95, 0.5, z);
      trailer.add(w);
      wheels.push(w);
    }
  }

  const blob = new THREE.Mesh(geo('tblob', () => new THREE.PlaneGeometry(W * 1.2, B.L * 1.1).rotateX(-Math.PI / 2)), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28, depthWrite: false }));
  blob.position.y = 0.012;
  root.add(blob);

  const ud = {
    wheels, steer, r: wr, wheel: wheelG, needle, brakeMat: mats.brake, head, def, body: B, needleMax: 160,
    truck: true, trailer: pivot, trailerYaw: 0, cargo: null, stripeMat,
  };
  root.userData = ud;
  return root;
}

const STRIPE = { food: 0xc3202f, drinks: 0xf2a51c, fun: 0x8a2be2, import: 0x24508f };

/** Dorseyi tak / sök (cargoId null → sökülü) */
export function setTrailer(obj, cargoId) {
  const ud = obj.userData;
  if (!ud.truck || ud.cargo === cargoId) return;
  ud.cargo = cargoId;
  ud.trailer.visible = !!cargoId;
  ud.trailerYaw = 0;
  ud.trailer.rotation.y = 0;
  if (cargoId) ud.stripeMat.color.setHex(STRIPE[cargoId] ?? 0xc3202f);
}

/**
 * Dorsenin kıvrılması: çekici `ds` (ileri +) kadar gittikçe dorse çekiciye doğru döner.
 * Açı çekiciye göre; 70°'den fazla kırılmaz (makas).
 */
export function articulate(obj, ds) {
  const ud = obj.userData;
  if (!ud.truck || !ud.cargo || !ds) return false;
  const L = 9.5; // pimden arka aksa
  const a = ud.trailerYaw;
  // Dorsenin dünya yönü θt = θ + a; dθt = ds/L · sin(θ − θt) = −ds/L · sin(a); çekici dönerse a da değişir (dışarıda)
  ud.trailerYaw = Math.max(-1.2, Math.min(1.2, a - (ds / L) * Math.sin(a)));
  ud.trailer.rotation.y = ud.trailerYaw;
  return Math.abs(ud.trailerYaw) > 1e-4;
}

/** Çekici döndüğünde dorse dünyada yerinde kalır: göreli açı ters yönde değişir */
export function turnTractor(obj, dyaw) {
  const ud = obj.userData;
  if (!ud.truck || !ud.cargo || !dyaw) return;
  ud.trailerYaw = Math.max(-1.2, Math.min(1.2, ud.trailerYaw - dyaw));
  ud.trailer.rotation.y = ud.trailerYaw;
}
