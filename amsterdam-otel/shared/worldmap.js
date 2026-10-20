// Devasa açık dünya: şehir dışı otoyol (A10 "Ring"), otelin lojistik avlusu, toptancı depoları ve
// konteyner limanı. Sunucu (sürülebilir alan + hız denetimi, sevkiyat doğrulaması) ve istemci
// (geometri, navigasyon, trafik) AYNI değerleri kullanır. Saf JavaScript: Node.js ve tarayıcı.
//
// 2B dünyanın uzak bir köşesindedir (x 240..1260, z −440..330); şehre ışınlanan bir tünelle bağlanır
// (otelin önündeki sokağın doğu ucu ⇄ avlunun batı duvarı). Garaj (x 60..100), drag pisti (x 140..190),
// bodrum (x 26..56) ve üst katlar (x −20..20) ile çakışmaz.
//
// Kuşbakışı: x sağa, z AŞAĞI çizilir (dünyanın kendi yönü; navi haritası da böyle). Yol ağı bir ağaçtır:
// ana gövde (otoyol) avludan limana uzanır; üç bağlantı yolu (çıkış) depolara ayrılır.
//
//   z=−260  ┌FrisDepot┐(içecek)
//              │
//   z=−90   ─╮ │  ╭─────╮                       (otoyol kıvrımları)
//   z=0  [AVLU]═══╯       ╰──╮      ╭──────╮  ╭══[LİMAN]
//   z=60           │          ╰─────╯      │ ╯
//   z=160      [VersMarkt](gıda)        [ArcadeWorks](eğlence)
//          x=250  x=520            x=800  x=955  x=1160

const freeze = Object.freeze;
const KMH = 3.6;
const r2 = (v) => Math.round(v * 100) / 100;
const byId = (list) => freeze(Object.assign(Object.create(null), Object.fromEntries(list.map((x) => [x.id, x]))));

export const HWY = freeze({
  bounds: freeze({ minX: 240, maxX: 1260, minZ: -440, maxZ: 330 }),
  far: 900, // kameranın uzak düzlemi (bu bölgedeyken)
  trunkHalf: 9, // otoyol: 2+2 şerit (3.5 m) + banket
  spurHalf: 5.5, // bağlantı yolu: 1+1 şerit
  laneW: 3.5,
});

export const ROAD_KMH = freeze({ trunk: 100, spur: 60, yard: 30 });

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

/** Toptancı depoları + liman (yükleme körfezi: tır merkezi `load` dikdörtgeninde durunca E ile yüklenir) */
export const SITES = freeze([
  freeze({
    id: 'food', name: 'VersMarkt Gıda Toptancısı', short: 'VersMarkt', icon: '🥩',
    bounds: freeze({ minX: 488, maxX: 556, minZ: 130, maxZ: 206 }),
    gate: freeze([521, 130]), load: freeze({ minX: 500, maxX: 516, minZ: 150, maxZ: 176 }), dock: freeze({ x: 508, z: 186 }),
    spur: freeze([[503, 40], [512, 100], [521, 130]]), anchor: freeze([500, -28]),
  }),
  freeze({
    id: 'drinks', name: 'FrisDepot İçecek Toptancısı', short: 'FrisDepot', icon: '🧃',
    bounds: freeze({ minX: 760, maxX: 830, minZ: -262, maxZ: -188 }),
    gate: freeze([796, -188]), load: freeze({ minX: 806, maxX: 822, minZ: -232, maxZ: -206 }), dock: freeze({ x: 814, z: -244 }),
    spur: freeze([[786, -122], [792, -165], [796, -188]]), anchor: freeze([782, -66]),
  }),
  freeze({
    id: 'fun', name: 'ArcadeWorks Eğlence Ekipmanı', short: 'ArcadeWorks', icon: '🎳',
    bounds: freeze({ minX: 920, maxX: 992, minZ: 160, maxZ: 232 }),
    gate: freeze([955, 160]), load: freeze({ minX: 936, maxX: 952, minZ: 178, maxZ: 204 }), dock: freeze({ x: 944, z: 214 }),
    spur: freeze([[946, 100], [952, 135], [955, 160]]), anchor: freeze([940, 62]),
  }),
  freeze({
    id: 'port', name: 'Haven Zuid Konteyner Limanı', short: 'Liman', icon: '⚓',
    bounds: freeze({ minX: 1150, maxX: 1252, minZ: -110, maxZ: 110 }),
    gate: freeze([1150, 0]), load: freeze({ minX: 1196, maxX: 1214, minZ: -38, maxZ: -12 }), dock: freeze({ x: 1205, z: -52 }),
    spur: null, anchor: null,
  }),
]);
export const SITE_BY_ID = byId(SITES);

// ---- Yol ağı -----------------------------------------------------------------------------------

/** Ana gövdenin köşe noktaları (Chaikin ile yumuşatılır → yumuşak virajlar) */
const TRUNK_RAW = [
  [330, 0], [420, 0], [500, -28], [585, -92], [680, -112], [782, -66], [860, 0], [940, 62], [1040, 72], [1118, 30], [1150, 0],
];

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

const TRUNK = freeze(chaikin(TRUNK_RAW, 3).map((p) => freeze(p)));

/** Yollar: { id, kind: 'trunk'|'spur', half, kmh, pts } — bağlantı yolları ana gövdeden ayrılır */
export const ROADS = freeze([
  freeze({ id: 'trunk', kind: 'trunk', name: 'A10 Ring', half: HWY.trunkHalf, kmh: ROAD_KMH.trunk, pts: TRUNK }),
  ...SITES.filter((s) => s.spur).map((s) => {
    const c = closestOnPolyline(TRUNK, s.anchor[0], s.anchor[1]);
    const pts = chaikin([[c.x, c.z], ...s.spur], 2);
    return freeze({ id: `spur-${s.id}`, kind: 'spur', site: s.id, name: `${s.short} çıkışı`, half: HWY.spurHalf, kmh: ROAD_KMH.spur, pts: freeze(pts.map((p) => freeze(p))), at: freeze({ i: c.i, t: c.t }) });
  }),
]);

// Segment önbelleği (kısıt + hız sınırı için)
const SEGS = [];
for (const road of ROADS) {
  for (let i = 0; i < road.pts.length - 1; i++) {
    const [ax, az] = road.pts[i];
    const [bx, bz] = road.pts[i + 1];
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 1e-6) continue;
    SEGS.push({ ax, az, bx, bz, len, ux: (bx - ax) / len, uz: (bz - az) / len, half: road.half, kmh: road.kmh, road: road.id });
  }
}
// Avlu ve depo alanları (dikdörtgen sürülebilir alan)
export const YARDS = freeze([
  freeze({ id: SERVICE_YARD.id, name: SERVICE_YARD.name, bounds: SERVICE_YARD.bounds }),
  ...SITES.map((s) => freeze({ id: s.id, name: s.name, bounds: s.bounds })),
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

/** Yol segmentine uzaklık (en yakın) → { d, seg } */
function nearestSeg(x, z) {
  let best = null;
  let bd = Infinity;
  for (const s of SEGS) {
    const t = Math.max(0, Math.min(s.len, (x - s.ax) * s.ux + (z - s.az) * s.uz));
    const px = s.ax + s.ux * t;
    const pz = s.az + s.uz * t;
    const d = Math.hypot(x - px, z - pz);
    if (d - s.half < bd) {
      bd = d - s.half;
      best = { d, seg: s, t, px, pz };
    }
  }
  return best;
}

/** Sürülebilir mi (yol şeridi ya da avlu) — tol: sunucu gecikme payı */
export function isDrivable(x, z, tol = 0) {
  if (!inHighwayRegion(x, z, tol)) return false;
  if (yardAt(x, z, tol)) return true;
  const n = nearestSeg(x, z);
  return !!n && n.d <= n.seg.half + tol;
}

/** Konumdaki yol hız sınırı (km/s): yol / avlu / bölge dışı → null */
export function roadLimitKmh(x, z) {
  if (!inHighwayRegion(x, z, 2)) return null;
  if (yardAt(x, z)) return ROAD_KMH.yard;
  const n = nearestSeg(x, z);
  if (!n || n.d > n.seg.half + 3) return ROAD_KMH.yard;
  return n.seg.kmh;
}

/**
 * Kısıt (istemci çarpışması): konumu (yarıçap r) sürülebilir alanın içine iter. Avlularda dikdörtgen,
 * yollarda şerit. @returns {boolean} itildi mi
 */
export function constrainToRoads(pos, r = 0) {
  const { x, z } = pos;
  if (!inHighwayRegion(x, z, 4)) return false;
  let bx = x;
  let bz = z;
  let bd = Infinity;
  for (const y of YARDS) {
    const b = y.bounds;
    const cx = Math.min(Math.max(x, b.minX + r), b.maxX - r);
    const cz = Math.min(Math.max(z, b.minZ + r), b.maxZ - r);
    const d = Math.hypot(x - cx, z - cz);
    if (d < 1e-9) return false;
    if (d < bd) { bd = d; bx = cx; bz = cz; }
  }
  for (const s of SEGS) {
    const t = Math.max(0, Math.min(s.len, (x - s.ax) * s.ux + (z - s.az) * s.uz));
    const px = s.ax + s.ux * t;
    const pz = s.az + s.uz * t;
    const dx = x - px;
    const dz = z - pz;
    const d = Math.hypot(dx, dz);
    const lim = Math.max(0, s.half - r);
    if (d <= lim) return false;
    const k = lim / d;
    const cx = px + dx * k;
    const cz = pz + dz * k;
    const dd = Math.hypot(x - cx, z - cz);
    if (dd < bd) { bd = dd; bx = cx; bz = cz; }
  }
  pos.x = bx;
  pos.z = bz;
  return true;
}

// ---- Navigasyon (rota) ---------------------------------------------------------------------------

const TRUNK_S = (() => {
  const s = [0];
  for (let i = 1; i < TRUNK.length; i++) s.push(s[i - 1] + Math.hypot(TRUNK[i][0] - TRUNK[i - 1][0], TRUNK[i][1] - TRUNK[i - 1][1]));
  return s;
})();
/** Ana gövdenin uzunluğu (m) */
export const TRUNK_LENGTH = r2(TRUNK_S[TRUNK_S.length - 1]);

/** Ana gövde üzerinde s (m) noktasındaki konum + yön */
export function trunkAt(s) {
  const L = TRUNK_LENGTH;
  const q = Math.max(0, Math.min(L, s));
  let i = 1;
  while (i < TRUNK_S.length - 1 && TRUNK_S[i] < q) i++;
  const s0 = TRUNK_S[i - 1];
  const seg = TRUNK_S[i] - s0 || 1;
  const t = (q - s0) / seg;
  const [ax, az] = TRUNK[i - 1];
  const [bx, bz] = TRUNK[i];
  const ux = (bx - ax) / seg;
  const uz = (bz - az) / seg;
  return { x: ax + (bx - ax) * t, z: az + (bz - az) * t, ux, uz };
}

/** Ana gövdede bir noktanın s'si (en yakın izdüşüm) */
function trunkS(x, z) {
  const c = closestOnPolyline(TRUNK, x, z);
  return TRUNK_S[c.i] + c.t * (TRUNK_S[c.i + 1] - TRUNK_S[c.i]);
}

const SPUR_BY_SITE = Object.fromEntries(ROADS.filter((r) => r.kind === 'spur').map((r) => [r.site, r]));
const yardPoint = (id) => (id === 'yard' ? SERVICE_YARD.exit : SITE_BY_ID[id].gate);

/** Hedef noktaları: avlu (otel teslim körfezi) ya da bir depo / liman yükleme körfezi */
export function destinationPoint(id) {
  if (id === 'hotel') return [HOTEL_DELIVERY.x, HOTEL_DELIVERY.z];
  const s = SITE_BY_ID[id];
  if (!s) return null;
  return [(s.load.minX + s.load.maxX) / 2, (s.load.minZ + s.load.maxZ) / 2];
}

/** Konumun bulunduğu düğüm: avlu / depo kimliği, bir bağlantı yolu ya da ana gövde */
function locate(x, z) {
  const y = yardAt(x, z, 1);
  if (y) return { kind: 'yard', id: y };
  const n = nearestSeg(x, z);
  if (n && n.seg.road !== 'trunk') return { kind: 'spur', site: n.seg.road.slice(5) };
  return { kind: 'trunk' };
}

/** Bağlantı yolunun ana gövdeye bağlandığı s */
const spurTrunkS = (site) => {
  const r = SPUR_BY_SITE[site];
  return TRUNK_S[r.at.i] + r.at.t * (TRUNK_S[r.at.i + 1] - TRUNK_S[r.at.i]);
};

/** Ana gövde boyunca s0 → s1 noktaları */
function trunkPath(s0, s1) {
  const out = [];
  const a = trunkAt(s0);
  out.push([a.x, a.z]);
  if (s1 > s0) {
    for (let i = 0; i < TRUNK.length; i++) if (TRUNK_S[i] > s0 && TRUNK_S[i] < s1) out.push(TRUNK[i]);
  } else {
    for (let i = TRUNK.length - 1; i >= 0; i--) if (TRUNK_S[i] < s0 && TRUNK_S[i] > s1) out.push(TRUNK[i]);
  }
  const b = trunkAt(s1);
  out.push([b.x, b.z]);
  return out;
}

/**
 * Konumdan hedefe rota (kuşbakışı nokta listesi) + uzunluk (m). Hedef: 'hotel' ya da site kimliği.
 * Yol ağı ağaç olduğu için: kaynak → ana gövde → hedefin bağlantı yolu → hedef.
 */
export function routeTo(x, z, dest) {
  const goal = destinationPoint(dest);
  if (!goal || !inHighwayRegion(x, z, 4)) return null;
  const destYard = dest === 'hotel' ? 'yard' : dest;
  const here = locate(x, z);
  const pts = [[x, z]];
  let s0;
  if (here.kind === 'yard') {
    if (here.id === destYard) {
      pts.push(goal);
      return finish(pts);
    }
    if (here.id === 'yard') s0 = 0;
    else if (here.id === 'port') s0 = TRUNK_LENGTH;
    else {
      pts.push(SITE_BY_ID[here.id].gate, ...[...SPUR_BY_SITE[here.id].pts].reverse().slice(1));
      s0 = spurTrunkS(here.id);
    }
  } else if (here.kind === 'spur') {
    const sp = SPUR_BY_SITE[here.site].pts;
    const c = closestOnPolyline(sp, x, z);
    if (here.site === destYard) {
      pts.push(...sp.slice(c.i + 1), SITE_BY_ID[here.site].gate, goal);
      return finish(pts);
    }
    pts.push(...sp.slice(0, c.i + 1).reverse());
    s0 = spurTrunkS(here.site);
  } else {
    s0 = trunkS(x, z);
  }
  let s1;
  if (destYard === 'yard') s1 = 0;
  else if (destYard === 'port') s1 = TRUNK_LENGTH;
  else s1 = spurTrunkS(destYard);
  pts.push(...trunkPath(s0, s1));
  if (destYard === 'yard') pts.push(SERVICE_YARD.exit);
  else if (destYard !== 'port') pts.push(...SPUR_BY_SITE[destYard].pts.slice(1));
  else pts.push(SITE_BY_ID.port.gate);
  pts.push(goal);
  return finish(pts);
}

function finish(pts) {
  const out = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) > 0.5) out.push([r2(p[0]), r2(p[1])]);
  }
  let len = 0;
  for (let i = 1; i < out.length; i++) len += Math.hypot(out[i][0] - out[i - 1][0], out[i][1] - out[i - 1][1]);
  return { pts: out, length: Math.round(len) };
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

// ---- Trafik şeritleri (istemci yapay trafiği + ileride polis) -----------------------------------

/**
 * Ana gövdede şerit noktası: dir +1 (avludan limana, sağ şeritler), −1 (geri); lane 0 (sağ / yavaş), 1 (sol).
 * Sağ = ileri yönün (−uz, ux) tarafı.
 */
export function laneAt(s, dir, lane) {
  const p = trunkAt(s);
  const off = (lane === 0 ? 1.5 : 0.5) * HWY.laneW * dir;
  return { x: p.x - p.uz * off, z: p.z + p.ux * off, yaw: Math.atan2(-p.ux * dir, -p.uz * dir) };
}

/** Bölge hız sınırı (m/sn): araba için yol sınırı, model hızıyla sınırlı */
export function highwayCap(vmax, x, z) {
  const k = roadLimitKmh(x, z) ?? ROAD_KMH.yard;
  return Math.min(vmax, k / KMH);
}
