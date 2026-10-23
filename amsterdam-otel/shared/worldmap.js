// Genişletilmiş açık dünya (ExpandedWorldMap): şehir dışı otoyollar (A10 Ring + A4 Noord), Nieuw-Zuid şehir
// semti (ızgara sokaklar, trafik ışıkları), Industrieweg sanayi yolu, otelin lojistik avlusu, toptancı depoları
// ve konteyner limanı. Sunucu (sürülebilir alan + hız denetimi, sevkiyat doğrulaması, polis) ve istemci
// (geometri, navigasyon, trafik yapay zekâsı) AYNI değerleri kullanır. Saf JavaScript: Node.js ve tarayıcı.
//
// 2B dünyanın uzak bir köşesindedir (x 240..7800, z −2300..1700); şehre ışınlanan bir tünelle bağlanır
// (otelin önündeki sokağın doğu ucu ⇄ avlunun batı duvarı). Garaj (x 60..100), mal kabul (x 104..136),
// drag pisti (x 140..190), bodrum (x 26..56) ve otel (x −20..20) ile çakışmaz.
//
// Kuşbakışı: x sağa (doğu), z AŞAĞI (güney) çizilir (navi haritası da böyle). Yol ağı bir GRAFTIR: yollar
// kavşaklarda (uç noktası başka bir yolun üstünde / iki ucun buluşması / iki şehir sokağının kesişmesi)
// birleşir; rota en kısa SÜREYE göre (Dijkstra) bulunur. Tır teslimatı gidiş-dönüş ~10–15 dk sürer.
//
//   z=−2100                              ┌FrisDepot┐(içecek)
//   z=−2000               A4 ╭──Industrieweg (1.5 km)─┘
//                            │ (A4 Noord, ~2.4 km)
//   z=0  [AVLU]══A10 Ring════╪══════════════╮═══════════════════════[LİMAN]
//                         (x 3500)       (x 5000) ╲ Nieuw-Zuid çıkışı
//   z=600                                   ┌─────┬─────┐
//   z=1000                                  ├─────┼─────┤  Nieuw-Zuid (trafik ışıkları)
//   z=1400                                  └──┬──┴───┬─┘
//   z=1450                            [VersMarkt]  [ArcadeWorks]
//          x=250          x=3500  x=3800  x=5200 5600 6000          x=7560

const freeze = Object.freeze;
const KMH = 3.6;
/** Rota süresi hesabında tırın yasal seyir hızı (km/s) — sürüşte sınırlayıcı değildir (teslim süreleri buna göre) */
export const TRUCK_KMH = 90;
const r2 = (v) => Math.round(v * 100) / 100;
const byId = (list) => freeze(Object.assign(Object.create(null), Object.fromEntries(list.map((x) => [x.id, x]))));

export const HWY = freeze({
  bounds: freeze({ minX: 240, maxX: 7800, minZ: -2300, maxZ: 1700 }),
  far: 900, // kameranın uzak düzlemi (bu bölgedeyken)
  trunkHalf: 9, // otoyol: 2+2 şerit (3.5 m) + banket
  spurHalf: 5.5, // bağlantı yolu: 1+1 şerit
  urbanHalf: 7, // şehir sokağı: 1+1 şerit + park şeridi / kaldırım payı
  laneW: 3.5,
});

export const ROAD_KMH = freeze({ trunk: 100, spur: 60, urban: 50, yard: 30 });

/** Şerit merkezleri (yol ortasından, gidiş yönünün SAĞINA, m): [0] sağ / yavaş şerit */
export const LANES = freeze({ trunk: freeze([5.25, 1.75]), spur: freeze([2.2]), urban: freeze([2.6]) });

/** Otelin lojistik avlusu (şehre tünelle bağlı; tır parkı, TruckCenter bayisi, mal kabul körfezi) */
export const SERVICE_YARD = freeze({
  id: 'yard',
  name: 'Hotel De Tulp Lojistik Avlusu',
  bounds: freeze({ minX: 250, maxX: 330, minZ: -42, maxZ: 42 }),
  arrive: freeze({ x: 264, z: 0, yaw: -Math.PI / 2 }), // şehirden gelince (doğuya bakar)
  portal: freeze({ minX: 250, maxX: 254.6, minZ: -6.5, maxZ: 6.5 }), // batı duvarındaki tünel ağzı (→ şehir)
  exit: freeze([330, 0]), // otoyola çıkış
  dealer: freeze({ x: 262, z: -37.6, point: freeze([262, -36.2]), range: 2.4 }),
  truckBays: freeze([
    freeze({ x: 272, z: -24, yaw: Math.PI, label: 'T-1' }),
    freeze({ x: 284, z: -24, yaw: Math.PI, label: 'T-2' }),
    freeze({ x: 296, z: -24, yaw: Math.PI, label: 'T-3' }),
    freeze({ x: 308, z: -24, yaw: Math.PI, label: 'T-4' }),
  ]),
  walkIn: freeze([256.5, -14]), // ışınlanma noktası (yaya)
});

/**
 * Otel teslim körfezi (mal kabul rampası). Dorse kuzey duvarındaki rampaya dayanır; tırın merkezi bu
 * dikdörtgenin içindeyken durup E ile teslim edilir. Cargo Dock (sim.cargo.deliver) paletleri buradan alır.
 */
export const HOTEL_DELIVERY = freeze({
  x: 300, z: 24, yaw: 0, // tır güneye bakar (dorse kuzeydeki rampaya)
  zone: freeze({ minX: 290, maxX: 310, minZ: 12, maxZ: 34 }),
  dockZ: 40.4, // rampa kenarı (kuzey duvarı önü)
});

/**
 * Toptancı depoları + liman (yükleme körfezi: tır merkezi `load` dikdörtgeninde durunca E ile yüklenir).
 * gate: avlunun yol ağına bağlandığı nokta (bir yolun ucu). Depolarda bina girişin karşı kenarındadır.
 */
export const SITES = freeze([
  freeze({
    id: 'food', name: 'VersMarkt Gıda Toptancısı', short: 'VersMarkt', icon: '🥩', district: 'Nieuw-Zuid',
    bounds: freeze({ minX: 5266, maxX: 5334, minZ: 1430, maxZ: 1506 }),
    gate: freeze([5299, 1430]), load: freeze({ minX: 5278, maxX: 5294, minZ: 1450, maxZ: 1476 }), dock: freeze({ x: 5286, z: 1486 }),
  }),
  freeze({
    id: 'drinks', name: 'FrisDepot İçecek Toptancısı', short: 'FrisDepot', icon: '🧃', district: 'Industrieweg',
    bounds: freeze({ minX: 5260, maxX: 5330, minZ: -2120, maxZ: -2046 }),
    gate: freeze([5296, -2046]), load: freeze({ minX: 5306, maxX: 5322, minZ: -2090, maxZ: -2064 }), dock: freeze({ x: 5314, z: -2102 }),
  }),
  freeze({
    id: 'fun', name: 'ArcadeWorks Eğlence Ekipmanı', short: 'ArcadeWorks', icon: '🎳', district: 'Nieuw-Zuid',
    bounds: freeze({ minX: 5866, maxX: 5938, minZ: 1430, maxZ: 1502 }),
    gate: freeze([5901, 1430]), load: freeze({ minX: 5882, maxX: 5898, minZ: 1448, maxZ: 1474 }), dock: freeze({ x: 5890, z: 1484 }),
  }),
  freeze({
    id: 'port', name: 'Haven Zuid Konteyner Limanı', short: 'Liman', icon: '⚓', district: 'Haven Zuid',
    bounds: freeze({ minX: 7560, maxX: 7662, minZ: -110, maxZ: 110 }),
    gate: freeze([7560, 0]), load: freeze({ minX: 7606, maxX: 7624, minZ: -38, maxZ: -12 }), dock: freeze({ x: 7615, z: -52 }),
  }),
]);
export const SITE_BY_ID = byId(SITES);

/** Nieuw-Zuid şehir semti: ızgara sokakları (avenue x, street z) + bloklar */
export const NIEUW_ZUID = freeze({
  name: 'Nieuw-Zuid',
  xs: freeze([5200, 5600, 6000]), // kuzey-güney caddeleri
  zs: freeze([600, 1000, 1400]), // doğu-batı sokakları
  bounds: freeze({ minX: 5150, maxX: 6050, minZ: 550, maxZ: 1450 }),
});

/** Industrieweg sanayi yolu (A4'ün sonu → FrisDepot) */
export const INDUSTRY = freeze({ name: 'Industrieweg', from: freeze([3800, -2000]), to: freeze([5296, -2000]) });

// ---- Yol ağı -----------------------------------------------------------------------------------

function chaikin(pts, iter) {
  let p = pts;
  for (let k = 0; k < iter; k++) {
    const out = [p[0]];
    for (let i = 0; i < p.length - 1; i++) {
      const [ax, az] = p[i];
      const [bx, bz] = p[i + 1];
      out.push([ax * 0.75 + bx * 0.25, az * 0.75 + bz * 0.25], [ax * 0.25 + bx * 0.75, az * 0.25 + bz * 0.75]);
    }
    out.push(p[p.length - 1]);
    p = out;
  }
  return p.map(([x, z]) => [r2(x), r2(z)]);
}

function closestOnPolyline(pts, x, z) {
  let best = null;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i];
    const [bx, bz] = pts[i + 1];
    const dx = bx - ax;
    const dz = bz - az;
    const L2 = dx * dx + dz * dz;
    const t = L2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2)) : 0;
    const px = ax + dx * t;
    const pz = az + dz * t;
    const d = Math.hypot(x - px, z - pz);
    if (!best || d < best.d) best = { i, t, x: px, z: pz, d };
  }
  return best;
}

/** A10 Ring: avludan limana ~7.3 km, yumuşak virajlı */
const A10_RAW = [
  [330, 0], [600, 0], [1000, -80], [1500, -200], [2000, -180], [2500, -40], [3000, 100], [3500, 160], [4000, 120],
  [4500, 0], [5000, -120], [5500, -160], [6000, -80], [6500, 40], [7000, 60], [7400, 10], [7560, 0],
];
const TRUNK = chaikin(A10_RAW, 4);
const onTrunk = (x, z) => {
  const c = closestOnPolyline(TRUNK, x, z);
  return [r2(c.x), r2(c.z)];
};
const J_A4 = onTrunk(3500, 160); // A4 Noord ayrımı
const J_NZ = onTrunk(5000, -120); // Nieuw-Zuid çıkışı
const [AX0, AX1, AX2] = NIEUW_ZUID.xs;
const [SZ0, SZ1, SZ2] = NIEUW_ZUID.zs;

const ROAD_DEFS = [
  { id: 'trunk', kind: 'trunk', name: 'A10 Ring', pts: TRUNK },
  { id: 'a4', kind: 'trunk', name: 'A4 Noord', pts: chaikin([J_A4, [3480, -200], [3350, -700], [3380, -1200], [3560, -1700], [3800, -2000]], 4) },
  { id: 'industrieweg', kind: 'urban', name: 'Industrieweg', pts: [[...INDUSTRY.from], [...INDUSTRY.to]] },
  { id: 'gate-drinks', kind: 'urban', name: 'FrisDepot girişi', site: 'drinks', pts: [[...INDUSTRY.to], [...SITE_BY_ID.drinks.gate]] },
  { id: 'spur-nz', kind: 'spur', name: 'Nieuw-Zuid çıkışı', pts: chaikin([J_NZ, [5060, 150], [5150, 420], [AX0, SZ0]], 3) },
  { id: 'nz-tulpenlaan', kind: 'urban', name: 'Tulpenlaan', pts: [[AX0, SZ0], [AX0, SZ2]] },
  { id: 'nz-molenstraat', kind: 'urban', name: 'Molenstraat', pts: [[AX1, SZ0], [AX1, SZ2]] },
  { id: 'nz-havenlaan', kind: 'urban', name: 'Havenlaan', pts: [[AX2, SZ0], [AX2, SZ2]] },
  { id: 'nz-kanaalweg', kind: 'urban', name: 'Kanaalweg', pts: [[AX0, SZ0], [AX2, SZ0]] },
  { id: 'nz-dijkweg', kind: 'urban', name: 'Dijkweg', pts: [[AX0, SZ1], [AX2, SZ1]] },
  { id: 'nz-polderstraat', kind: 'urban', name: 'Polderstraat', pts: [[AX0, SZ2], [AX2, SZ2]] },
  { id: 'gate-food', kind: 'urban', name: 'VersMarkt girişi', site: 'food', pts: [[SITE_BY_ID.food.gate[0], SZ2], [...SITE_BY_ID.food.gate]] },
  { id: 'gate-fun', kind: 'urban', name: 'ArcadeWorks girişi', site: 'fun', pts: [[SITE_BY_ID.fun.gate[0], SZ2], [...SITE_BY_ID.fun.gate]] },
];

const HALF = { trunk: HWY.trunkHalf, spur: HWY.spurHalf, urban: HWY.urbanHalf };

/** Yollar: { id, kind: 'trunk'|'spur'|'urban', name, half, kmh, pts } */
export const ROADS = freeze(ROAD_DEFS.map((d) => freeze({
  id: d.id, kind: d.kind, name: d.name, site: d.site ?? null, half: HALF[d.kind], kmh: ROAD_KMH[d.kind],
  pts: freeze(d.pts.map((p) => freeze([r2(p[0]), r2(p[1])]))),
})));
const ROAD_BY_ID = Object.fromEntries(ROADS.map((r) => [r.id, r]));
export { ROAD_BY_ID };

// Yol başına kümülatif uzunluk (yol koordinatları: s boyunca, l yanal — sağ = (−uz, ux))
const ROAD_S = Object.fromEntries(ROADS.map((road) => {
  const acc = [0];
  for (let i = 1; i < road.pts.length; i++) acc.push(acc[i - 1] + Math.hypot(road.pts[i][0] - road.pts[i - 1][0], road.pts[i][1] - road.pts[i - 1][1]));
  return [road.id, acc];
}));
/** Yolun uzunluğu (m) */
export const roadLength = (id) => { const a = ROAD_S[id]; return a[a.length - 1]; };

// Segment önbelleği (kısıt + hız sınırı + izdüşüm) ve ızgara dizini (50 m hücre)
const SEGS = [];
for (const road of ROADS) {
  const acc = ROAD_S[road.id];
  for (let i = 0; i < road.pts.length - 1; i++) {
    const [ax, az] = road.pts[i];
    const [bx, bz] = road.pts[i + 1];
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 1e-6) continue;
    SEGS.push({ ax, az, bx, bz, len, ux: (bx - ax) / len, uz: (bz - az) / len, half: road.half, kmh: road.kmh, road: road.id, i, s0: acc[i] });
  }
}
const CELL = 50;
const GRID = new Map();
const cellKey = (cx, cz) => cx * 100003 + cz;
SEGS.forEach((s, k) => {
  const pad = s.half + 2;
  const x0 = Math.floor((Math.min(s.ax, s.bx) - pad) / CELL);
  const x1 = Math.floor((Math.max(s.ax, s.bx) + pad) / CELL);
  const z0 = Math.floor((Math.min(s.az, s.bz) - pad) / CELL);
  const z1 = Math.floor((Math.max(s.az, s.bz) + pad) / CELL);
  for (let cx = x0; cx <= x1; cx++) {
    for (let cz = z0; cz <= z1; cz++) {
      const key = cellKey(cx, cz);
      let list = GRID.get(key);
      if (!list) GRID.set(key, (list = []));
      list.push(k);
    }
  }
});
const _cand = [];
const _seen = new Set();
/** (x, z)'nin 3×3 hücre komşuluğundaki segmentler (≈50 m içindekilerin hepsi) */
function candidates(x, z) {
  _cand.length = 0;
  _seen.clear();
  const cx = Math.floor(x / CELL);
  const cz = Math.floor(z / CELL);
  for (let dx = -1; dx <= 1; dx++) {
    for (let dz = -1; dz <= 1; dz++) {
      const list = GRID.get(cellKey(cx + dx, cz + dz));
      if (!list) continue;
      for (const k of list) {
        if (_seen.has(k)) continue;
        _seen.add(k);
        _cand.push(SEGS[k]);
      }
    }
  }
  return _cand;
}

function projSeg(s, x, z) {
  const t = Math.max(0, Math.min(s.len, (x - s.ax) * s.ux + (z - s.az) * s.uz));
  const px = s.ax + s.ux * t;
  const pz = s.az + s.uz * t;
  return { t, px, pz, d: Math.hypot(x - px, z - pz) };
}

/**
 * Noktayı bir yola izdüşür: { road, s, l, d, len, half, ux, uz } (l: sağa +). roadId verilmezse en yakın yol;
 * yolların hiçbirinin şeridinde değilse (avlu) d > half olur.
 */
export function roadProject(x, z, roadId = null) {
  let best = null;
  let bs = null;
  let bp = null;
  const scan = (list) => {
    for (const s of list) {
      if (roadId && s.road !== roadId) continue;
      const p = projSeg(s, x, z);
      if (!bp || p.d < bp.d) { bp = p; bs = s; }
    }
  };
  scan(candidates(x, z));
  if (!bs || bp.d > CELL) scan(SEGS);
  if (!bs) return null;
  best = {
    road: bs.road, s: bs.s0 + bp.t, l: (x - bp.px) * -bs.uz + (z - bp.pz) * bs.ux,
    d: bp.d, len: roadLength(bs.road), half: bs.half, ux: bs.ux, uz: bs.uz,
  };
  return best;
}

/** Yol koordinatından dünya konumu + yön: { x, z, ux, uz } (s yolun iki ucuna kırpılır) */
export function roadPoint(roadId, s, l = 0) {
  const road = ROAD_BY_ID[roadId];
  const acc = ROAD_S[roadId];
  const n = acc.length;
  const q = Math.max(0, Math.min(acc[n - 1], s));
  let lo = 1;
  let hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (acc[mid] < q) lo = mid + 1;
    else hi = mid;
  }
  const i = lo;
  const seg = acc[i] - acc[i - 1] || 1;
  const t = (q - acc[i - 1]) / seg;
  const [ax, az] = road.pts[i - 1];
  const [bx, bz] = road.pts[i];
  const ux = (bx - ax) / seg;
  const uz = (bz - az) / seg;
  return { x: ax + (bx - ax) * t - uz * l, z: az + (bz - az) * t + ux * l, ux, uz };
}

/** Yolun s0 → s1 arasındaki noktaları (s1 < s0 ise ters yönde) */
export function roadSlice(roadId, s0, s1) {
  const road = ROAD_BY_ID[roadId];
  const acc = ROAD_S[roadId];
  const a = roadPoint(roadId, s0);
  const out = [[a.x, a.z]];
  if (s1 > s0) {
    for (let i = 0; i < road.pts.length; i++) if (acc[i] > s0 && acc[i] < s1) out.push(road.pts[i]);
  } else {
    for (let i = road.pts.length - 1; i >= 0; i--) if (acc[i] < s0 && acc[i] > s1) out.push(road.pts[i]);
  }
  const b = roadPoint(roadId, s1);
  out.push([b.x, b.z]);
  return out;
}

// Avlu ve depo alanları (dikdörtgen sürülebilir alan)
export const YARDS = freeze([
  freeze({ id: SERVICE_YARD.id, name: SERVICE_YARD.name, bounds: SERVICE_YARD.bounds, gate: SERVICE_YARD.exit }),
  ...SITES.map((s) => freeze({ id: s.id, name: s.name, bounds: s.bounds, gate: s.gate })),
]);

const B = HWY.bounds;
/** Otoyol bölgesinde mi (geniş kutu) */
export function inHighwayRegion(x, z, tol = 0) {
  return x > B.minX - tol && x < B.maxX + tol && z > B.minZ - tol && z < B.maxZ + tol;
}

const inRect = (b, x, z, tol = 0) => x > b.minX - tol && x < b.maxX + tol && z > b.minZ - tol && z < b.maxZ + tol;

/** Avlu / depo / liman alanının kimliği (yoksa null) */
export function yardAt(x, z, tol = 0) {
  for (const y of YARDS) if (inRect(y.bounds, x, z, tol)) return y.id;
  return null;
}

// ---- Graf: kavşaklar (düğümler) + yol parçaları (kenarlar) ------------------------------------

function segIntersect(ax, az, bx, bz, cx, cz, dx, dz) {
  const rX = bx - ax;
  const rZ = bz - az;
  const sX = dx - cx;
  const sZ = dz - cz;
  const den = rX * sZ - rZ * sX;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((cx - ax) * sZ - (cz - az) * sX) / den;
  const u = ((cx - ax) * rZ - (cz - az) * rX) / den;
  if (t <= 1e-6 || t >= 1 - 1e-6 || u <= 1e-6 || u >= 1 - 1e-6) return null;
  return { t, u };
}

/**
 * Yol grafı. NODES: { id, x, z, edges: [kenar id], yard: avlu id | null, signal: trafik ışığı indeksi | −1 }.
 * EDGES: { id, road, sa, sb, a, b, len, kmh, time } — a (s = sa) → b (s = sb); iki yönlü.
 */
const NODES = [];
const EDGES = [];
(function buildGraph() {
  const J = Object.fromEntries(ROADS.map((r) => [r.id, [0, roadLength(r.id)]]));
  // Uç noktası başka bir yolun üstünde (T / Y kavşağı) ya da iki ucun buluşması (köşe)
  for (const a of ROADS) {
    for (const end of [a.pts[0], a.pts[a.pts.length - 1]]) {
      for (const b of ROADS) {
        if (b === a) continue;
        const c = closestOnPolyline(b.pts, end[0], end[1]);
        if (c.d < 0.6) J[b.id].push(ROAD_S[b.id][c.i] + c.t * (ROAD_S[b.id][c.i + 1] - ROAD_S[b.id][c.i]));
      }
    }
  }
  // Şehir sokaklarının kesişmeleri (dört yol ağzı)
  const urban = ROADS.filter((r) => r.kind === 'urban');
  for (let i = 0; i < urban.length; i++) {
    for (let j = i + 1; j < urban.length; j++) {
      const A = urban[i];
      const C = urban[j];
      for (let p = 0; p < A.pts.length - 1; p++) {
        for (let q = 0; q < C.pts.length - 1; q++) {
          const hit = segIntersect(...A.pts[p], ...A.pts[p + 1], ...C.pts[q], ...C.pts[q + 1]);
          if (!hit) continue;
          J[A.id].push(ROAD_S[A.id][p] + hit.t * (ROAD_S[A.id][p + 1] - ROAD_S[A.id][p]));
          J[C.id].push(ROAD_S[C.id][q] + hit.u * (ROAD_S[C.id][q + 1] - ROAD_S[C.id][q]));
        }
      }
    }
  }
  const nodeAt = (x, z) => {
    for (const n of NODES) if (Math.hypot(n.x - x, n.z - z) < 1.5) return n;
    const n = { id: NODES.length, x: r2(x), z: r2(z), edges: [], yard: null, signal: -1 };
    NODES.push(n);
    return n;
  };
  for (const r of ROADS) {
    const list = J[r.id].sort((p, q) => p - q).filter((s, k, arr) => k === 0 || s - arr[k - 1] > 0.5);
    let prev = null;
    let prevS = 0;
    for (const s of list) {
      const p = roadPoint(r.id, s);
      const n = nodeAt(p.x, p.z);
      if (prev && prev !== n) {
        const len = s - prevS;
        const e = { id: EDGES.length, road: r.id, sa: prevS, sb: s, a: prev.id, b: n.id, len, kmh: r.kmh, time: len / (Math.min(r.kmh, TRUCK_KMH) / KMH) };
        EDGES.push(e);
        prev.edges.push(e.id);
        n.edges.push(e.id);
      }
      prev = n;
      prevS = s;
    }
  }
  for (const y of YARDS) {
    const n = NODES.find((m) => Math.hypot(m.x - y.gate[0], m.z - y.gate[1]) < 2);
    if (!n) throw new Error(`worldmap: ${y.id} kapısı yol ağına bağlı değil`);
    n.yard = y.id;
  }
})();
for (const n of NODES) freeze(n.edges);
export const GRAPH = freeze({ nodes: NODES, edges: EDGES });
const YARD_NODE = Object.fromEntries(NODES.filter((n) => n.yard).map((n) => [n.yard, n.id]));

/** Kenar üzerinde yolun s'si için (kenar, uzaklıklar) */
function edgeOn(roadId, s) {
  let best = null;
  for (const e of EDGES) {
    if (e.road !== roadId) continue;
    if (s >= e.sa - 1e-6 && s <= e.sb + 1e-6) return e;
    const d = Math.min(Math.abs(s - e.sa), Math.abs(s - e.sb));
    if (!best || d < best.d) best = { e, d };
  }
  return best?.e ?? null;
}

/** Bir kenarın düğümdeki yaklaşma yönü (düğüme doğru gidiş, birim) */
export function edgeDirAt(e, nodeId) {
  const toB = nodeId === e.b;
  const s = toB ? e.sb : e.sa;
  const q = roadPoint(e.road, toB ? s - 2 : s + 2);
  const p = roadPoint(e.road, s);
  const dx = p.x - q.x;
  const dz = p.z - q.z;
  const l = Math.hypot(dx, dz) || 1;
  return { x: dx / l, z: dz / l };
}

// ---- Trafik ışıkları + kavşak meydanları -------------------------------------------------------

/**
 * Trafik ışıkları: Nieuw-Zuid'de en az üç yolun buluştuğu kavşaklar (depo giriş sapakları hariç).
 * İki faz: NS (kuzey-güney yaklaşımlar) ve EW. Döngü 34 sn: NS yeşil 14 + sarı 3, sonra EW yeşil 14 + sarı 3
 * (bütün kavşaklar aynı fazda: istemcide 6 paylaşılan lamba malzemesi).
 */
export const SIGNAL_CYCLE = 34;
export const SIGNALS = freeze(NODES.filter((n) => {
  if (n.edges.length < 3 || !inRect(NIEUW_ZUID.bounds, n.x, n.z)) return false;
  return n.edges.every((id) => !ROAD_BY_ID[EDGES[id].road].id.startsWith('gate-'));
}).map((n, i) => {
  n.signal = i;
  return freeze({ id: i, node: n.id, x: n.x, z: n.z, offset: 0 }); // hepsi aynı fazda (paylaşılan lamba malzemeleri)
}));
for (const n of NODES) freeze(n);

/** Işık durumu: 'g' | 'y' | 'r'. axis: 'ns' | 'ew'; tSec: ortak saat (sunucu zamanı, sn) */
export function signalState(sig, axis, tSec) {
  const t = (((tSec + sig.offset) % SIGNAL_CYCLE) + SIGNAL_CYCLE) % SIGNAL_CYCLE;
  const half = SIGNAL_CYCLE / 2;
  const local = axis === 'ns' ? t : (t + half) % SIGNAL_CYCLE;
  if (local < 14) return 'g';
  if (local < half) return 'y';
  return 'r';
}
/** Yaklaşma yönünden ışık ekseni */
export const signalAxis = (dir) => (Math.abs(dir.x) > Math.abs(dir.z) ? 'ew' : 'ns');

/** Kavşak meydanları: şehir yollarının buluştuğu düğümlerde tır dönüşü için geniş asfalt kare (sürülebilir) */
export const PLAZAS = freeze(NODES.filter((n) => n.edges.length >= 2 && n.edges.some((id) => ROAD_BY_ID[EDGES[id].road].kind === 'urban'))
  .map((n) => freeze({ node: n.id, x: n.x, z: n.z, half: HWY.urbanHalf + 5 })));
const inPlaza = (x, z, tol = 0) => PLAZAS.some((p) => Math.abs(x - p.x) < p.half + tol && Math.abs(z - p.z) < p.half + tol);

/**
 * (x, z) noktası roadId dışındaki bir yolun şeridine / kavşak meydanına / avluya pad metreden yakın mı
 * (istemci: bariyer ve ağaç yerleşimi; ızgara dizinli, hızlı)
 */
export function nearOtherRoad(x, z, roadId, pad = 3) {
  for (const s of candidates(x, z)) if (s.road !== roadId && projSeg(s, x, z).d < s.half + pad) return true;
  return inPlaza(x, z, pad) || yardAt(x, z, pad) !== null;
}

// ---- Sürülebilir alan / hız sınırı -----------------------------------------------------------

/**
 * Yol segmentine uzaklık (en yakın, kenara göre) → { d, seg }. full=false: yalnızca ~50 m komşuluk
 * (yol genişliği ≤ 9 m olduğundan şerit içi / yakını sorguları için yeterli; uzaktaysa null)
 */
function nearestSeg(x, z, full = false) {
  let best = null;
  let bd = Infinity;
  const scan = (list) => {
    for (const s of list) {
      const p = projSeg(s, x, z);
      if (p.d - s.half < bd) {
        bd = p.d - s.half;
        best = { d: p.d, seg: s, t: p.t, px: p.px, pz: p.pz };
      }
    }
  };
  scan(candidates(x, z));
  if (full && (!best || bd > CELL - 10)) scan(SEGS);
  return best;
}

/** Sürülebilir mi (yol şeridi, kavşak meydanı ya da avlu) — tol: sunucu gecikme payı */
export function isDrivable(x, z, tol = 0) {
  if (!inHighwayRegion(x, z, tol)) return false;
  if (yardAt(x, z, tol) || inPlaza(x, z, tol)) return true;
  const n = nearestSeg(x, z);
  return !!n && n.d <= n.seg.half + tol;
}

/** Konumdaki yol hız sınırı (km/s): yol / avlu / bölge dışı → null */
export function roadLimitKmh(x, z) {
  if (!inHighwayRegion(x, z, 2)) return null;
  if (yardAt(x, z)) return ROAD_KMH.yard;
  const n = nearestSeg(x, z);
  if (!n || n.d > n.seg.half + 3) return inPlaza(x, z) ? ROAD_KMH.urban : ROAD_KMH.yard;
  return n.seg.kmh;
}

/**
 * Kısıt (istemci çarpışması): konumu (yarıçap r) sürülebilir alanın içine iter. Avlularda / meydanlarda
 * dikdörtgen, yollarda şerit. @returns {boolean} itildi mi
 */
export function constrainToRoads(pos, r = 0) {
  const { x, z } = pos;
  if (!inHighwayRegion(x, z, 4)) return false;
  let bx = x;
  let bz = z;
  let bd = Infinity;
  const rect = (minX, maxX, minZ, maxZ) => {
    const cx = Math.min(Math.max(x, minX + r), maxX - r);
    const cz = Math.min(Math.max(z, minZ + r), maxZ - r);
    const d = Math.hypot(x - cx, z - cz);
    if (d < 1e-9) return true;
    if (d < bd) { bd = d; bx = cx; bz = cz; }
    return false;
  };
  for (const y of YARDS) if (rect(y.bounds.minX, y.bounds.maxX, y.bounds.minZ, y.bounds.maxZ)) return false;
  for (const p of PLAZAS) {
    if (Math.abs(x - p.x) > p.half + 60) continue;
    if (Math.abs(z - p.z) > p.half + 60) continue;
    if (rect(p.x - p.half, p.x + p.half, p.z - p.half, p.z + p.half)) return false;
  }
  const seg = (list) => {
    for (const s of list) {
      const p = projSeg(s, x, z);
      const lim = Math.max(0, s.half - r);
      if (p.d <= lim) return true;
      const k = lim / p.d;
      const cx = p.px + (x - p.px) * k;
      const cz = p.pz + (z - p.pz) * k;
      const dd = Math.hypot(x - cx, z - cz);
      if (dd < bd) { bd = dd; bx = cx; bz = cz; }
    }
    return false;
  };
  if (seg(candidates(x, z))) return false;
  if (bd > CELL - 10 && seg(SEGS)) return false;
  pos.x = bx;
  pos.z = bz;
  return true;
}

// ---- A10 ana gövdesi (polis, tarayıcı kapıları, şerit noktaları) -------------------------------

const TRUNK_S = ROAD_S.trunk;
/** Ana gövdenin (A10) uzunluğu (m) */
export const TRUNK_LENGTH = r2(TRUNK_S[TRUNK_S.length - 1]);

/** Ana gövde üzerinde s (m) noktasındaki konum + yön */
export function trunkAt(s) {
  return roadPoint('trunk', s);
}

/**
 * Ana gövdede şerit noktası: dir +1 (avludan limana, sağ şeritler), −1 (geri); lane 0 (sağ / yavaş), 1 (sol).
 * Sağ = ileri yönün (−uz, ux) tarafı.
 */
export function laneAt(s, dir, lane) {
  const p = trunkAt(s);
  const off = (lane === 0 ? 1.5 : 0.5) * HWY.laneW * dir;
  return { x: p.x - p.uz * off, z: p.z + p.ux * off, yaw: Math.atan2(-p.ux * dir, -p.uz * dir) };
}

// ---- Navigasyon (rota) ---------------------------------------------------------------------------

/** Hedef noktaları: avlu (otel teslim körfezi) ya da bir depo / liman yükleme körfezi */
export function destinationPoint(id) {
  if (id === 'hotel') return [HOTEL_DELIVERY.x, HOTEL_DELIVERY.z];
  const s = SITE_BY_ID[id];
  if (!s) return null;
  return [(s.load.minX + s.load.maxX) / 2, (s.load.minZ + s.load.maxZ) / 2];
}

const nodePt = (id) => [NODES[id].x, NODES[id].z];

/** Kenarı düğümden diğer düğüme giderken: noktalar */
function edgePts(e, fromNode) {
  return fromNode === e.a ? roadSlice(e.road, e.sa, e.sb) : roadSlice(e.road, e.sb, e.sa);
}

/** Dönüş yönü: gelen → giden (birim vektörler; sağ = (−z, x)) */
function turnOf(din, dout) {
  const cross = dout.x * -din.z + dout.z * din.x; // > 0: sağa
  const dot = din.x * dout.x + din.z * dout.z;
  if (dot > 0.94) return 'straight';
  if (dot < -0.7) return 'uturn';
  return cross > 0 ? 'right' : 'left';
}

/**
 * Konumdan hedefe rota: { pts, length (m), steps: [{ x, z, dist, turn, road, name, kind }] }.
 * Hedef: 'hotel' ya da site kimliği. Graf üzerinde en kısa süre (tırın yasal seyir hızıyla) aranır.
 */
export function routeTo(x, z, dest) {
  const goal = destinationPoint(dest);
  if (!goal || !inHighwayRegion(x, z, 4)) return null;
  const destYard = dest === 'hotel' ? 'yard' : dest;
  const startYard = yardAt(x, z, 1);
  if (startYard === destYard) return finish([[x, z], goal], []);
  // Başlangıç: avlu kapısı ya da en yakın yolun iki kavşağı
  const starts = [];
  let pre = [[x, z]];
  let startEdge = null;
  let startS = 0;
  if (startYard) {
    starts.push({ node: YARD_NODE[startYard], cost: 0 });
  } else {
    const p = roadProject(x, z);
    if (!p) return null;
    startEdge = edgeOn(p.road, p.s);
    startS = Math.max(startEdge.sa, Math.min(startEdge.sb, p.s));
    const v = Math.min(startEdge.kmh, TRUCK_KMH) / KMH;
    starts.push({ node: startEdge.a, cost: (startS - startEdge.sa) / v });
    starts.push({ node: startEdge.b, cost: (startEdge.sb - startS) / v });
  }
  const target = YARD_NODE[destYard];
  // Dijkstra (küçük graf: O(n²))
  const n = NODES.length;
  const dist = new Array(n).fill(Infinity);
  const prev = new Array(n).fill(null); // { node, edge }
  const done = new Array(n).fill(false);
  const first = new Array(n).fill(-1); // hangi başlangıçtan
  starts.forEach((s, k) => {
    if (s.cost < dist[s.node]) { dist[s.node] = s.cost; first[s.node] = k; }
  });
  for (;;) {
    let u = -1;
    for (let i = 0; i < n; i++) if (!done[i] && dist[i] < Infinity && (u < 0 || dist[i] < dist[u])) u = i;
    if (u < 0 || u === target) break;
    done[u] = true;
    // Avlu kapısı geçit değildir (yalnızca başlangıç / hedef)
    if (NODES[u].yard && first[u] < 0 && u !== target) continue;
    for (const eid of NODES[u].edges) {
      const e = EDGES[eid];
      const v = e.a === u ? e.b : e.a;
      const nd = dist[u] + e.time;
      if (nd < dist[v]) {
        dist[v] = nd;
        prev[v] = { node: u, edge: eid };
        first[v] = first[u];
      }
    }
  }
  if (dist[target] === Infinity) return null;
  // Geri izle
  const chain = [];
  for (let v = target; prev[v]; v = prev[v].node) chain.unshift({ from: prev[v].node, edge: EDGES[prev[v].edge], to: v });
  const startNode = chain.length ? chain[0].from : target;
  if (startEdge) {
    pre = [[x, z], ...(startNode === startEdge.a ? roadSlice(startEdge.road, startS, startEdge.sa) : roadSlice(startEdge.road, startS, startEdge.sb))];
  } else {
    pre.push(nodePt(startNode));
  }
  const pts = [...pre];
  const legs = [];
  if (startEdge) legs.push({ road: startEdge.road, pts: pre.slice(1) });
  for (const c of chain) {
    const ep = edgePts(c.edge, c.from);
    pts.push(...ep);
    legs.push({ road: c.edge.road, pts: ep, node: c.from });
  }
  pts.push(goal);
  // Manevralar: yol değişen düğümler
  const steps = [];
  let acc = 0;
  let last = pts[0];
  const cum = new Map();
  for (const p of pts) {
    acc += Math.hypot(p[0] - last[0], p[1] - last[1]);
    last = p;
    cum.set(p, acc);
  }
  for (let k = 1; k < legs.length; k++) {
    const a = legs[k - 1];
    const b = legs[k];
    if (a.road === b.road || a.pts.length < 2 || b.pts.length < 2) continue;
    const p0 = a.pts[a.pts.length - 2];
    const p1 = a.pts[a.pts.length - 1];
    const q1 = b.pts[1];
    const q0 = b.pts[0];
    const l1 = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) || 1;
    const l2 = Math.hypot(q1[0] - q0[0], q1[1] - q0[1]) || 1;
    const turn = turnOf({ x: (p1[0] - p0[0]) / l1, z: (p1[1] - p0[1]) / l1 }, { x: (q1[0] - q0[0]) / l2, z: (q1[1] - q0[1]) / l2 });
    const road = ROAD_BY_ID[b.road];
    steps.push({ x: q0[0], z: q0[1], dist: Math.round(cum.get(q0) ?? 0), turn, road: road.id, name: road.name, kind: road.kind, from: ROAD_BY_ID[a.road].kind });
  }
  steps.push({ x: goal[0], z: goal[1], dist: 0, turn: 'arrive', road: null, name: dest === 'hotel' ? SERVICE_YARD.name : SITE_BY_ID[dest].name, kind: 'yard' });
  return finish(pts, steps);
}

function finish(pts, steps) {
  const out = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) > 0.5) out.push([r2(p[0]), r2(p[1])]);
  }
  let len = 0;
  for (let i = 1; i < out.length; i++) len += Math.hypot(out[i][0] - out[i - 1][0], out[i][1] - out[i - 1][1]);
  const length = Math.round(len);
  if (steps.length) steps[steps.length - 1].dist = length;
  return { pts: out, length, steps };
}

/** Rotanın tır sınırlarıyla sürüş süresi (sn): otoyol 90 (yasal seyir), bağlantı 60, şehir 50, avlu 30 km/s */
export function routeTimeSec(route) {
  if (!route) return 0;
  let t = 0;
  const p = route.pts;
  for (let i = 1; i < p.length; i++) {
    const [ax, az] = p[i - 1];
    const [bx, bz] = p[i];
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 1e-6) continue;
    // Uzun parçalar birkaç noktadan örneklenir (avlu → yol geçişi)
    const n = Math.max(1, Math.ceil(len / 40));
    for (let k = 0; k < n; k++) {
      const f = (k + 0.5) / n;
      const lim = roadLimitKmh(ax + (bx - ax) * f, az + (bz - az) * f) ?? ROAD_KMH.yard;
      t += len / n / (Math.min(lim, TRUCK_KMH) / KMH);
    }
  }
  return t;
}

/** Avludan siteye rota uzunluğu (m) — sevkiyat ücreti ve süre için (önbellekli) */
const DIST = new Map();
export function siteDistance(id) {
  let d = DIST.get(id);
  if (d === undefined) {
    const a = SERVICE_YARD.exit;
    d = routeTo(a[0], a[1], id)?.length ?? 0;
    DIST.set(id, d);
  }
  return d;
}

/** Otel teslim körfezi → site → otel: tır sınırlarıyla gidiş-dönüş sürüş süresi (sn, önbellekli) */
const TRIP = new Map();
export function siteTripSec(id) {
  let t = TRIP.get(id);
  if (t === undefined) {
    const s = destinationPoint(id);
    t = routeTimeSec(routeTo(HOTEL_DELIVERY.x, HOTEL_DELIVERY.z, id)) + routeTimeSec(routeTo(s[0], s[1], 'hotel'));
    TRIP.set(id, t);
  }
  return t;
}

/** Bölge hız sınırı (m/sn): araba için yol sınırı, model hızıyla sınırlı */
export function highwayCap(vmax, x, z) {
  // Hız sınırlayıcı yok: tabelalardaki sınırlar yalnızca bilgi (ve rota süresi hesabı); araç kendi en yüksek hızına çıkar.
  // Hız aşımı polis ısısı da yazmaz (IllegalLogisticsService).
  void x; void z;
  return vmax;
}
