import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { STAGE } from '/shared/stage.js';
import { StaticBatcher } from './StaticBatcher.js';
import { UV } from './Materials.js';

// Achterstraat Canlı Müzik Sahnesi — 3D model (yalnızca görünüm; kurallar shared/stage.js'te).
//  - Satın alınmadan önce: sarı-siyah şeritle işaretli boş alan, köşelerde dubalar ve
//    "Sahne alanı — Resepsiyon PC'den satın al" tabelası (çarpışmasız, üstünden yürünür).
//  - Satın alınınca: ahşap platform + basamaklar, siyah fon perdesi, alüminyum truss, asılı
//    spot kafaları + ışık hüzmeleri, "ACHTERSTRAAT LIVE" afişi, hoparlörler, mikrofon sehpası ve
//    sokağın karşısındaki evlerin cephesine uzanan ampul zincirleri.
// Pil: sahne çalışma anında kurulduğu için kendi StaticBatcher'ı ile BİR kez birleştirilir
// (malzeme başına tek mesh; dünyanın malzemeleri paylaşılır). Hüzmeler, mercekler ve ampuller
// köşe renkli tek geometriler (3 draw call). Gölge atmaz (statik gölge haritası yeniden çizilmez).
// Kare başına iş yalnızca set çalarken ve sahne görüş alanındayken: hüzme opaklığı (tek uniform).

const B = STAGE.bounds;
const H = STAGE.height;
const CX = (B.minX + B.maxX) / 2;
const TRUSS_Z = B.minZ + 0.22; // arka truss'un merkezi
const POST_X = [B.minX + 0.17, B.maxX - 0.17];
const TOP_Y = 3.75; // üst kirişin merkezi
const SPOT_X = [-14.0, -13.0, -12.0, -11.0];
const SPOT_COLORS = ['#ff4fa3', '#ffd166', '#4fc3ff', '#9b6bff'];
// Ampul zincirleri: truss tepesinden karşıdaki evlerin cephesine (kapı ve pencere arasına)
const STRINGS = Object.freeze([
  [[POST_X[0], TOP_Y - 0.12, TRUSS_Z + 0.1], [-14.55, 3.05, 32.84]],
  [[POST_X[1], TOP_Y - 0.12, TRUSS_Z + 0.1], [-10.35, 3.05, 32.84]],
  [[POST_X[0], TOP_Y - 0.12, TRUSS_Z + 0.1], [-10.35, 3.05, 32.84]],
]);
const BULB_COLORS = ['#fff1c8', '#ffcf7a', '#ff9f9f', '#fff1c8', '#a8e6ff'];

function tinted(geo, hex) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const c = new THREE.Color(hex);
  const n = g.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = c.r;
    arr[i * 3 + 1] = c.g;
    arr[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  if (g.attributes.uv) g.deleteAttribute('uv');
  return g;
}

function canvasTexture(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** "ACHTERSTRAAT LIVE" afişi: koyu zemin, neon yazı, nota ve lale süsleri */
function drawBanner(ctx, w, h) {
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, '#1b0f2e');
  g.addColorStop(1, '#2b0f22');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = '#ffd166';
  ctx.lineWidth = 8;
  ctx.strokeRect(10, 10, w - 20, h - 20);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `900 ${Math.round(h * 0.4)}px system-ui, sans-serif`;
  ctx.shadowColor = '#ff4fa3';
  ctx.shadowBlur = 22;
  ctx.fillStyle = '#ffe6f3';
  ctx.fillText('ACHTERSTRAAT', w / 2, h * 0.4, w * 0.84);
  ctx.shadowColor = '#4fc3ff';
  ctx.font = `800 ${Math.round(h * 0.26)}px system-ui, sans-serif`;
  ctx.fillStyle = '#d9f4ff';
  ctx.fillText('♪  L I V E  ♫', w / 2, h * 0.77, w * 0.6);
  ctx.shadowBlur = 0;
  ctx.font = `${Math.round(h * 0.34)}px system-ui, sans-serif`;
  ctx.fillText('🌷', w * 0.07, h * 0.52);
  ctx.fillText('🌷', w * 0.93, h * 0.52);
}

/** Satın alınmamış alan tabelası */
function drawPlotSign(ctx, w, h) {
  ctx.fillStyle = '#f2c230';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#1d1d22';
  ctx.fillRect(10, 10, w - 20, h - 20);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffd166';
  ctx.font = `800 ${Math.round(h * 0.2)}px system-ui, sans-serif`;
  ctx.fillText('🎤 SAHNE ALANI', w / 2, h * 0.28, w * 0.9);
  ctx.fillStyle = '#ffffff';
  ctx.font = `600 ${Math.round(h * 0.12)}px system-ui, sans-serif`;
  ctx.fillText('Resepsiyon PC\'den satın al', w / 2, h * 0.56, w * 0.9);
  ctx.fillStyle = '#9ff0bb';
  ctx.font = `700 ${Math.round(h * 0.13)}px system-ui, sans-serif`;
  ctx.fillText(`€${STAGE.PRICE} · otelin kasasından`, w / 2, h * 0.79, w * 0.9);
}

/** Yerden yükselen bir zincir eğrisi (sarkma): a → b, n nokta */
function catenary(a, b, sag, n) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    pts.push(new THREE.Vector3(
      a[0] + (b[0] - a[0]) * t,
      a[1] + (b[1] - a[1]) * t - sag * 4 * t * (1 - t),
      a[2] + (b[2] - a[2]) * t,
    ));
  }
  return pts;
}

/** İki nokta arasında ince silindir */
function rod(a, b, r, seg = 5) {
  const va = new THREE.Vector3(...a);
  const vb = new THREE.Vector3(...b);
  const len = va.distanceTo(vb);
  const geo = new THREE.CylinderGeometry(r, r, len, seg, 1, true);
  geo.translate(0, len / 2, 0);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), vb.clone().sub(va).normalize());
  geo.applyQuaternion(q);
  geo.translate(va.x, va.y, va.z);
  return geo;
}

/**
 * @returns {{ group, plot, built, setOwned(on), setNight(t), setLights(on, pulse) }}
 */
export function buildStage({ scene, mats, collision }) {
  const root = new THREE.Group();
  root.name = 'stage';
  scene.add(root);

  // ---- Satın alınmamış alan --------------------------------------------------------
  const plot = new THREE.Group();
  {
    const tapes = [];
    const seg = 0.3;
    const edge = (x0, z0, x1, z1) => {
      const len = Math.hypot(x1 - x0, z1 - z0);
      const n = Math.max(1, Math.round(len / seg));
      for (let i = 0; i < n; i++) {
        const t0 = i / n;
        const t1 = (i + 1) / n;
        const ax = x0 + (x1 - x0) * t0;
        const az = z0 + (z1 - z0) * t0;
        const bx = x0 + (x1 - x0) * t1;
        const bz = z0 + (z1 - z0) * t1;
        const geo = new THREE.BoxGeometry(Math.max(Math.abs(bx - ax), 0.07), 0.012, Math.max(Math.abs(bz - az), 0.07));
        geo.translate((ax + bx) / 2, 0.012, (az + bz) / 2);
        tapes.push(tinted(geo, i % 2 ? '#1d1d22' : '#f2c230'));
      }
    };
    const z1 = STAGE.steps.maxZ;
    edge(B.minX, B.minZ + 0.05, B.maxX, B.minZ + 0.05);
    edge(B.maxX, B.minZ + 0.05, B.maxX, z1);
    edge(B.maxX, z1, B.minX, z1);
    edge(B.minX, z1, B.minX, B.minZ + 0.05);
    // Köşelerde trafik dubaları
    for (const [x, z] of [[B.minX + 0.2, z1 - 0.2], [B.maxX - 0.2, z1 - 0.2], [B.minX + 0.2, B.minZ + 0.3], [B.maxX - 0.2, B.minZ + 0.3]]) {
      tapes.push(tinted(new THREE.ConeGeometry(0.13, 0.42, 10).translate(x, 0.23, z), '#ff7a1a'));
      tapes.push(tinted(new THREE.CylinderGeometry(0.075, 0.095, 0.07, 10).translate(x, 0.27, z), '#ffffff'));
      tapes.push(tinted(new THREE.BoxGeometry(0.32, 0.03, 0.32).translate(x, 0.015, z), '#26262b'));
    }
    // Tabela direği
    tapes.push(tinted(new THREE.BoxGeometry(0.07, 1.25, 0.07).translate(CX, 0.62, B.minZ + 1.0), '#3b3d42'));
    const tape = new THREE.Mesh(mergeGeometries(tapes), new THREE.MeshLambertMaterial({ vertexColors: true }));
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(1.3, 0.72),
      new THREE.MeshLambertMaterial({ map: canvasTexture(512, 284, drawPlotSign) }),
    );
    sign.position.set(CX, 1.5, B.minZ + 1.04);
    plot.add(tape, sign);
  }
  root.add(plot);

  // ---- Sahne (satın alınınca bir kez kurulur) --------------------------------------------
  let built = null;

  function build() {
    const group = new THREE.Group();
    const b = new StaticBatcher();
    const local = {
      ...mats,
      stageCloth: new THREE.MeshLambertMaterial({ color: 0x17151c }),
      truss: new THREE.MeshLambertMaterial({ color: 0xbfc4cc }),
      trim: new THREE.MeshLambertMaterial({ color: 0xf2c230 }),
      speaker: new THREE.MeshLambertMaterial({ color: 0x2a2a30 }),
      cone: new THREE.MeshLambertMaterial({ color: 0x0e0e11 }),
      banner: new THREE.MeshBasicMaterial({ map: canvasTexture(1024, 256, drawBanner) }),
    };
    const flat = { cast: false };

    // Platform: ahşap döşeme, siyah etek, sarı ön kenar
    b.box('wood', B.minX, B.maxX, H - 0.06, H, B.minZ, B.maxZ, { ...flat, uvScale: UV.wood });
    b.box('stageCloth', B.minX + 0.03, B.maxX - 0.03, 0, H - 0.06, B.minZ, B.maxZ - 0.03, flat);
    b.box('trim', B.minX, B.maxX, H - 0.07, H + 0.005, B.maxZ - 0.04, B.maxZ, flat);
    // Basamaklar
    const S = STAGE.steps;
    b.box('wood', S.minX, S.maxX, 0, H / 3, S.minZ, S.maxZ, { ...flat, uvScale: UV.wood });
    b.box('wood', S.minX, S.maxX, H / 3, (2 * H) / 3, S.minZ, S.minZ + (S.maxZ - S.minZ) * 0.5, { ...flat, uvScale: UV.wood });
    b.box('trim', S.minX, S.maxX, H / 3 - 0.01, H / 3 + 0.004, S.maxZ - 0.03, S.maxZ, flat);
    // Fon perdesi (komşu binanın kullanılmayan arka kapısını da örter)
    b.box('stageCloth', B.minX + 0.05, B.maxX - 0.05, H, 3.45, B.minZ + 0.01, B.minZ + 0.05, flat);

    // Alüminyum truss: iki dikme + üst kiriş (dört köşe borusu + zikzak çaprazlar)
    const tr = 0.12; // truss yarı genişliği
    const rods = [];
    const box4 = (a, b2, axis) => {
      // a → b2 doğrultusunda kare kesitli kafes
      const offs = axis === 'y' ? [[-tr, -tr], [tr, -tr], [tr, tr], [-tr, tr]] : [[-tr, -tr], [tr, -tr], [tr, tr], [-tr, tr]];
      const P = (p, o) => (axis === 'y' ? [p[0] + o[0], p[1], p[2] + o[1]] : [p[0], p[1] + o[0], p[2] + o[1]]);
      for (const o of offs) rods.push(rod(P(a, o), P(b2, o), 0.022));
      const len = axis === 'y' ? b2[1] - a[1] : b2[0] - a[0];
      const n = Math.max(2, Math.round(len / 0.45));
      for (let i = 0; i < n; i++) {
        const t0 = i / n;
        const t1 = (i + 1) / n;
        const at = (t) => [a[0] + (b2[0] - a[0]) * t, a[1] + (b2[1] - a[1]) * t, a[2] + (b2[2] - a[2]) * t];
        for (let f = 0; f < 4; f++) {
          const o0 = offs[f];
          const o1 = offs[(f + 1) % 4];
          rods.push(rod(P(at(i % 2 ? t1 : t0), o0), P(at(i % 2 ? t0 : t1), o1), 0.012, 4));
        }
      }
    };
    for (const x of POST_X) box4([x, H, TRUSS_Z], [x, TOP_Y + tr, TRUSS_Z], 'y');
    box4([POST_X[0] - tr, TOP_Y, TRUSS_Z], [POST_X[1] + tr, TOP_Y, TRUSS_Z], 'x');
    for (const g of rods) b.add('truss', g, flat);
    for (const x of POST_X) b.box('metal', x - 0.22, x + 0.22, H, H + 0.03, TRUSS_Z - 0.22, TRUSS_Z + 0.22, flat);

    // Afiş (truss'a asılı)
    const banner = new THREE.PlaneGeometry(3.7, 0.92);
    b.add('banner', banner, { ...flat, position: [CX, 2.95, TRUSS_Z + 0.16] });
    for (const x of [CX - 1.7, CX + 1.7]) b.add('black', new THREE.CylinderGeometry(0.006, 0.006, 0.36, 4), { ...flat, position: [x, 3.58, TRUSS_Z + 0.15] });

    // Spot kafaları: kirişin altında, sahnenin önüne doğru eğik
    const spotRot = (x) => [-0.75, 0, (CX - x) * 0.12];
    for (const x of SPOT_X) {
      b.add('black', new THREE.CylinderGeometry(0.1, 0.12, 0.26, 10), { ...flat, position: [x, TOP_Y - 0.32, TRUSS_Z + 0.08], rotation: spotRot(x) });
      b.add('metal', new THREE.TorusGeometry(0.14, 0.012, 4, 12, Math.PI), { ...flat, position: [x, TOP_Y - 0.27, TRUSS_Z + 0.08], rotation: [0, Math.PI / 2, Math.PI] });
    }

    // Hoparlörler: ön köşelerde iki kabin (woofer + tweeter)
    for (const [x0, x1] of [[B.minX + 0.08, B.minX + 0.58], [B.maxX - 0.58, B.maxX - 0.08]]) {
      const z0 = B.maxZ - 0.72;
      const z1 = B.maxZ - 0.18;
      b.box('speaker', x0, x1, H, H + 1.0, z0, z1, flat);
      const xc = (x0 + x1) / 2;
      b.add('cone', new THREE.CylinderGeometry(0.17, 0.17, 0.02, 16), { ...flat, position: [xc, H + 0.32, z1 + 0.005], rotation: [Math.PI / 2, 0, 0] });
      b.add('metal', new THREE.CylinderGeometry(0.06, 0.06, 0.025, 10), { ...flat, position: [xc, H + 0.32, z1 + 0.01], rotation: [Math.PI / 2, 0, 0] });
      b.add('cone', new THREE.CylinderGeometry(0.07, 0.07, 0.02, 12), { ...flat, position: [xc, H + 0.75, z1 + 0.005], rotation: [Math.PI / 2, 0, 0] });
      b.box('black', x0 - 0.01, x1 + 0.01, H + 0.98, H + 1.02, z0 - 0.01, z1 + 0.01, flat);
    }
    // Sahne önü monitör hoparlörü (kama)
    {
      const wedge = new THREE.CylinderGeometry(0.2, 0.2, 0.5, 3, 1).rotateZ(Math.PI / 2).rotateX(Math.PI / 6);
      b.add('speaker', wedge, { ...flat, position: [CX - 0.85, H + 0.11, B.maxZ - 0.3] });
    }
    // Mikrofon sehpası
    {
      const mx = CX;
      const mz = B.maxZ - 0.38;
      b.add('black', new THREE.CylinderGeometry(0.14, 0.15, 0.02, 14), { ...flat, position: [mx, H + 0.01, mz] });
      b.add('metal', new THREE.CylinderGeometry(0.012, 0.012, 1.42, 6), { ...flat, position: [mx, H + 0.72, mz] });
      b.add('metal', new THREE.CylinderGeometry(0.01, 0.01, 0.34, 6), { ...flat, position: [mx, H + 1.45, mz - 0.13], rotation: [-1.05, 0, 0] });
      b.add('black', new THREE.CylinderGeometry(0.022, 0.016, 0.12, 8), { ...flat, position: [mx, H + 1.53, mz - 0.27], rotation: [-1.05, 0, 0] });
      b.add('metal', new THREE.SphereGeometry(0.03, 8, 6), { ...flat, position: [mx, H + 1.57, mz - 0.32] });
    }
    // Ampul zincirlerinin telleri
    const lights = [];
    for (const [a, c] of STRINGS) {
      const pts = catenary(a, c, 0.55, 18);
      for (let i = 1; i < pts.length; i++) b.add('black', rod(pts[i - 1].toArray(), pts[i].toArray(), 0.006, 3), flat);
      const bulbs = catenary(a, c, 0.55, 14);
      bulbs.slice(1, -1).forEach((p, i) => {
        lights.push(tinted(new THREE.SphereGeometry(0.05, 6, 4).translate(p.x, p.y - 0.07, p.z), BULB_COLORS[i % BULB_COLORS.length]));
      });
    }
    b.build(local, group);

    // Ampuller (ışıktan etkilenmez) — tek mesh
    const bulbMesh = new THREE.Mesh(mergeGeometries(lights), new THREE.MeshBasicMaterial({ vertexColors: true }));
    group.add(bulbMesh);

    // Spot mercekleri ve ışık hüzmeleri (köşe renkli, additive) — set çalarken görünür
    const lenses = [];
    const beams = [];
    SPOT_X.forEach((x, i) => {
      const [rx, , rz] = spotRot(x);
      const e = new THREE.Euler(rx, 0, rz);
      const dir = new THREE.Vector3(0, -1, 0).applyEuler(e);
      const head = new THREE.Vector3(x, TOP_Y - 0.32, TRUSS_Z + 0.08);
      const lens = new THREE.CircleGeometry(0.095, 12).rotateX(Math.PI / 2);
      lens.applyQuaternion(new THREE.Quaternion().setFromEuler(e));
      lens.translate(...head.clone().addScaledVector(dir, 0.135).toArray());
      lenses.push(tinted(lens, SPOT_COLORS[i]));
      const len = 3.4;
      const beam = new THREE.CylinderGeometry(0.08, 0.62, len, 14, 1, true).translate(0, -len / 2, 0);
      beam.applyQuaternion(new THREE.Quaternion().setFromEuler(e));
      beam.translate(...head.clone().addScaledVector(dir, 0.14).toArray());
      beams.push(tinted(beam, SPOT_COLORS[i]));
    });
    const lensMat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide });
    const lensMesh = new THREE.Mesh(mergeGeometries(lenses), lensMat);
    const beamMat = new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    });
    const beamMesh = new THREE.Mesh(mergeGeometries(beams), beamMat);
    beamMesh.renderOrder = 3;
    beamMesh.visible = false;
    const lensOff = new THREE.Color(0x3a3a40);
    lensMat.color.copy(lensOff);
    group.add(lensMesh, beamMesh);

    // Çarpışma: platform + basamaklar (2B)
    const colliders = [
      collision.add(B.minX, B.maxX, B.minZ, B.maxZ),
      collision.add(S.minX, S.maxX, S.minZ, S.maxZ),
    ];
    root.add(group);
    return { group, beamMat, beamMesh, lensMat, colliders };
  }

  let night = 0;
  let lightsOn = false;

  return {
    root,
    plot,
    get built() { return built; },

    /** Sahne satın alındı mı (alan ↔ sahne) */
    setOwned(on) {
      plot.visible = !on;
      if (on && !built) built = build();
      if (built) built.group.visible = on;
    },

    setNight(t) {
      night = t;
      if (built && lightsOn) built.beamMat.opacity = 0.05 + 0.13 * night;
    },

    /**
     * Spotlar: set çalarken açık. pulse 0..1 (vuruşla) — yalnızca opaklık / renk değişir.
     * @returns {void}
     */
    setLights(on, pulse = 0.5) {
      if (!built) return;
      if (on !== lightsOn) {
        lightsOn = on;
        built.beamMesh.visible = on;
        built.lensMat.color.set(on ? 0xffffff : 0x3a3a40);
      }
      if (on) built.beamMat.opacity = (0.04 + 0.12 * night) * (0.55 + 0.45 * pulse) + 0.02;
    },
  };
}
