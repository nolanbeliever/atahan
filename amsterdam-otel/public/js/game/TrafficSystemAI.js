import * as THREE from 'three';
import {
  GRAPH, ROAD_BY_ID, LANES, PLAZAS, SIGNALS, roadPoint, edgeDirAt, signalState, signalAxis, HWY,
} from '/shared/worldmap.js';
import { rng } from '../world/CarWorldKit.js';

/**
 * Akıllı trafik (istemci, yerel): şehir dışı yol grafında şerit takip eden yapay araçlar.
 *
 *  - Şerit takibi: her araç bir kenarda (yol parçası) yön + şerit ile ilerler; konum yol koordinatlarından
 *    (s boyunca, l yanal) hesaplanır — virajlarda yolun eğrisini izler. Kavşaklarda bir sonraki kenar seçilir
 *    (geri dönüş ve depo girişleri hariç), dönüşler kuadratik Bezier eğrisiyle akıcı yapılır.
 *  - Takip mesafesi (IDM benzeri): öndeki araca / oyuncunun tırına (çekici + dorse noktaları) göre yumuşak
 *    hızlanma ve frenleme; kesişen trafikte önündeki engel konisinden yol verir.
 *  - Trafik ışıkları (Nieuw-Zuid): kırmızıda / durabileceği sarıda durma çizgisinde bekler.
 *  - Sinyal: şerit değiştirmeden ~2 sn önce ve kavşakta dönüşten / çıkıştan önce sinyal lambası yanıp söner;
 *    yavaş araç önünde sol şeride geçer (sollama), sonra sağa döner. Fren lambaları yavaşlarken yanar.
 *  - Pil: yalnızca oyuncu bölgedeyken ve yakınında (≈560 m) güncellenir; uzaklaşan araç görüş dışında
 *    (260–480 m) yeniden doğar. Gövde / kabin / sinyal / fren lambası birer InstancedMesh (4 draw call).
 */

const COLORS = [0xc3202f, 0x24508f, 0xeef0f2, 0x3d434b, 0xa9b0b8, 0x1f5d43, 0xf2c230, 0x121417, 0x7a4a2a, 0x5b3a8c];
const IDM = { a: 1.6, b: 3.0, s0: 4.0, T: 1.35 };
const CAR_LEN = 4.4;
const DESPAWN = 560;
const SPAWN_MIN = 260;
const SPAWN_MAX = 480;
const SIGNAL_LEAD_SEC = 2;

const plazaOf = new Map(PLAZAS.map((p) => [p.node, p]));
const signalOf = new Map(SIGNALS.map((s) => [s.node, s]));
/** Depo giriş sapakları (trafik girmez; yol sonu avlu / liman ağzında araç geri döner ya da görüş dışında kaybolur) */
const gateEdge = (e) => e.road.startsWith('gate-');

/** Gidiş yönünün sağındaki şerit ofseti → yolun yanal koordinatı */
const laneL = (e, dir, lane) => {
  const L = LANES[ROAD_BY_ID[e.road].kind];
  return dir * L[Math.min(lane, L.length - 1)];
};

function bezier(p0, p1, p2, t, out) {
  const u = 1 - t;
  out.x = u * u * p0.x + 2 * u * t * p1.x + t * t * p2.x;
  out.z = u * u * p0.z + 2 * u * t * p1.z + t * t * p2.z;
  out.dx = 2 * u * (p1.x - p0.x) + 2 * t * (p2.x - p1.x);
  out.dz = 2 * u * (p1.z - p0.z) + 2 * t * (p2.z - p1.z);
  return out;
}

/** İki doğrunun kesişimi (p + a·u, q + b·w); paralelse null */
function lineHit(p, u, q, w) {
  const den = u.x * w.z - u.z * w.x;
  if (Math.abs(den) < 1e-3) return null;
  const a = ((q.x - p.x) * w.z - (q.z - p.z) * w.x) / den;
  return { x: p.x + u.x * a, z: p.z + u.z * a, a };
}

export class TrafficSystemAI {
  /**
   * @param group bölge grubu (araçlar buraya eklenir)
   * @param count araç sayısı (masaüstü ≤ 30, mobil daha az)
   */
  constructor(group, count = 26) {
    this.count = count;
    this.r = rng(1919);
    const body = new THREE.BoxGeometry(1.8, 0.8, 4.3).translate(0, 0.7, 0);
    const cab = new THREE.BoxGeometry(1.6, 0.55, 2.2).translate(0, 1.37, -0.2);
    const blinkG = new THREE.BoxGeometry(0.12, 0.16, 0.22);
    // Sinyal: bir yanın ön + arka köşesi (sol: +x, sağ: −x; araç önü +z)
    const sideBlink = (sx) => {
      const g1 = blinkG.clone().translate(sx * 0.92, 0.82, 2.05);
      const g2 = blinkG.clone().translate(sx * 0.92, 0.82, -2.05);
      return mergeTwo(g1, g2);
    };
    const brakeG = mergeTwo(new THREE.BoxGeometry(0.42, 0.14, 0.06).translate(0.6, 0.86, -2.16), new THREE.BoxGeometry(0.42, 0.14, 0.06).translate(-0.6, 0.86, -2.16));
    const dyn = (geo, mat, n) => {
      const m = new THREE.InstancedMesh(geo, mat, n);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.frustumCulled = false;
      group.add(m);
      return m;
    };
    this.body = dyn(body, new THREE.MeshLambertMaterial({ color: 0xffffff }), count);
    this.cab = dyn(cab, new THREE.MeshLambertMaterial({ color: 0x1d2a36 }), count);
    const blinkMat = new THREE.MeshBasicMaterial({ color: 0xffa21a });
    this.blinkL = dyn(sideBlink(1), blinkMat, count);
    this.blinkR = dyn(sideBlink(-1), blinkMat, count);
    this.brake = dyn(brakeG, new THREE.MeshBasicMaterial({ color: 0xff2a1a }), count);
    const c = new THREE.Color();
    this.cars = [];
    for (let i = 0; i < count; i++) {
      this.cars.push({
        i, active: false, edge: null, dir: 1, s: 0, lane: 0, lat: 0, v: 0, v0: 25, f: this.r(),
        next: null, nextDir: 1, nextTurn: 'straight', turn: null, blink: 0, change: null, fastSince: 0, braking: false,
        x: -1e6, z: -1e6, hx: 0, hz: 1, acc: 0,
      });
      this.body.setColorAt(i, c.setHex(COLORS[i % COLORS.length]));
    }
    this.body.instanceColor.needsUpdate = true;
    // Doğma noktaları: geri dönüşsüz kenarlarda 40 m'de bir
    this.spawns = [];
    for (const e of GRAPH.edges) {
      if (gateEdge(e)) continue;
      for (let s = e.sa + 20; s < e.sb - 20; s += 40) {
        const p = roadPoint(e.road, s);
        this.spawns.push({ e, s, x: p.x, z: p.z });
      }
    }
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler();
    this._p = new THREE.Vector3();
    this._s = new THREE.Vector3(1, 1, 1);
    this._b = { x: 0, z: 0, dx: 0, dz: 1 };
    this.hidden = true;
    this.t = 0;
    this.near100 = false;
  }

  // ---- Doğma / yok olma -------------------------------------------------------------------------

  spawn(car, ego, minD) {
    const r = this.r;
    for (let tries = 0; tries < 24; tries++) {
      const sp = this.spawns[Math.floor(r() * this.spawns.length)];
      const d = Math.hypot(sp.x - ego.x, sp.z - ego.z);
      if (d < minD || d > SPAWN_MAX) continue;
      if (this.cars.some((o) => o.active && Math.hypot(o.x - sp.x, o.z - sp.z) < 30)) continue;
      const kind = ROAD_BY_ID[sp.e.road].kind;
      const lanes = LANES[kind].length;
      car.active = true;
      car.edge = sp.e;
      car.dir = r() < 0.5 ? 1 : -1;
      car.s = sp.s;
      car.lane = lanes > 1 && r() < 0.35 ? 1 : 0;
      car.lat = laneL(car.edge, car.dir, car.lane);
      car.nextTurn = 'straight';
      car.v0 = this.desired(kind, car);
      car.v = car.v0 * 0.85;
      car.next = null;
      car.turn = null;
      car.change = null;
      car.blink = 0;
      this.place(car);
      return true;
    }
    return false;
  }

  despawn(car) {
    car.active = false;
    car.x = -1e6;
    car.z = -1e6;
  }

  desired(kind, car) {
    if (kind === 'trunk') return 24 + car.f * 6; // 86–108 km/s
    if (kind === 'spur') return 14 + car.f * 2;
    return 11 + car.f * 2.2; // şehir: 40–48 km/s
  }

  // ---- Yol geometrisi -----------------------------------------------------------------------------

  /** Kenar bitişine kalan mesafe (gidiş yönünde) */
  remaining(car) {
    return car.dir > 0 ? car.edge.sb - car.s : car.s - car.edge.sa;
  }

  targetNode(car) {
    return car.dir > 0 ? car.edge.b : car.edge.a;
  }

  place(car) {
    const p = roadPoint(car.edge.road, car.s, car.lat);
    car.x = p.x;
    car.z = p.z;
    car.hx = p.ux * car.dir;
    car.hz = p.uz * car.dir;
  }

  /** Kavşakta sıradaki kenar (geri dönüş ve depo girişi yok); yoksa null (çıkmaz) */
  pickNext(car) {
    const node = GRAPH.nodes[this.targetNode(car)];
    const opts = node.edges.map((id) => GRAPH.edges[id]).filter((e) => e !== car.edge && !e.road.startsWith('gate-') && !node.yard);
    if (!opts.length) return null;
    // Aynı yolda devam ağırlıklı (otoyolda çoğu araç düz gider)
    const same = opts.find((e) => e.road === car.edge.road);
    const r = this.r();
    const e = same && r < (ROAD_BY_ID[car.edge.road].kind === 'trunk' ? 0.8 : 0.45) ? same : opts[Math.floor(this.r() * opts.length)];
    return e;
  }

  planTurn(car) {
    const nodeId = this.targetNode(car);
    const e = this.pickNext(car);
    car.next = e;
    if (!e) {
      car.nextTurn = 'uturn';
      return;
    }
    car.nextDir = e.a === nodeId ? 1 : -1;
    if (e.road === car.edge.road) {
      car.nextTurn = 'straight';
      return;
    }
    const din = edgeDirAt(car.edge, nodeId);
    const dout0 = edgeDirAt(e, nodeId);
    const dout = { x: -dout0.x, z: -dout0.z };
    const dot = din.x * dout.x + din.z * dout.z;
    const cross = dout.x * -din.z + dout.z * din.x;
    car.nextTurn = dot > 0.94 ? 'straight' : cross > 0 ? 'right' : 'left';
  }

  /** Dönüş eğrisini başlat: şu anki şeritten sonraki kenarın şeridine */
  startTurn(car) {
    const nodeId = this.targetNode(car);
    const node = GRAPH.nodes[nodeId];
    const p0 = { x: car.x, z: car.z };
    const din = { x: car.hx, z: car.hz };
    let p2;
    let dout;
    let nextS;
    let nextLat;
    let len;
    if (car.next) {
      const e = car.next;
      const D = Math.min(plazaOf.has(nodeId) ? 16 : 26, (e.sb - e.sa) / 2);
      nextS = car.nextDir > 0 ? e.sa + D : e.sb - D;
      nextLat = laneL(e, car.nextDir, 0);
      const q = roadPoint(e.road, nextS, nextLat);
      p2 = { x: q.x, z: q.z };
      dout = { x: q.ux * car.nextDir, z: q.uz * car.nextDir };
    } else {
      // Çıkmaz: aynı kenarda karşı yöne U dönüşü
      const e = car.edge;
      nextS = car.s - car.dir * 4;
      nextLat = laneL(e, -car.dir, 0);
      const q = roadPoint(e.road, nextS, nextLat);
      p2 = { x: q.x, z: q.z };
      dout = { x: -car.hx, z: -car.hz };
    }
    let p1 = lineHit(p0, din, p2, dout);
    if (!p1 || p1.a < 0 || p1.a > 60) p1 = { x: (p0.x + p2.x) / 2 + din.x * 4, z: (p0.z + p2.z) / 2 + din.z * 4 };
    len = (Math.hypot(p1.x - p0.x, p1.z - p0.z) + Math.hypot(p2.x - p1.x, p2.z - p1.z) + Math.hypot(p2.x - p0.x, p2.z - p0.z)) / 2;
    car.turn = { p0, p1: { x: p1.x, z: p1.z }, p2, len: Math.max(4, len), d: 0, nextS, nextLat, node };
  }

  finishTurn(car) {
    const t = car.turn;
    if (car.next) {
      car.edge = car.next;
      car.dir = car.nextDir;
    } else {
      car.dir = -car.dir;
    }
    car.s = t.nextS;
    car.lane = 0;
    car.lat = t.nextLat;
    car.change = null;
    car.nextTurn = 'straight';
    car.turn = null;
    car.next = null;
    car.blink = 0;
    car.v0 = this.desired(ROAD_BY_ID[car.edge.road].kind, car);
  }

  // ---- Engeller (öndeki araç / oyuncu / ışık) -------------------------------------------------------

  /** Öndeki en yakın engel: { gap, v } (koni: ileri 0..80 m, yanal ±1.9 m) */
  leader(car, ego) {
    let gap = Infinity;
    let lv = 0;
    const hx = car.hx;
    const hz = car.hz;
    // Şerit değiştirirken hedef şerit de izlenir (aracın sağ ekseninde yanal konumu)
    const want = car.change ? (car.change.to - car.lat) * car.dir : 0;
    for (const o of this.cars) {
      if (o === car || !o.active) continue;
      const rx = o.x - car.x;
      const rz = o.z - car.z;
      const along = rx * hx + rz * hz;
      if (along <= 0 || along > 80) continue;
      const lr = rx * -hz + rz * hx;
      if (Math.abs(lr) > 1.9 && (!car.change || Math.abs(lr - want) > 1.9)) continue;
      const g = along - CAR_LEN;
      if (g < gap) {
        gap = g;
        lv = o.v * Math.max(0, o.hx * hx + o.hz * hz);
      }
    }
    if (ego.active) {
      for (const k of ego.points) {
        const rx = k.x - car.x;
        const rz = k.z - car.z;
        const along = rx * hx + rz * hz;
        if (along <= 0 || along > 80) continue;
        const lr = rx * -hz + rz * hx;
        if (Math.abs(lr) > ego.half + 1.0 && (!car.change || Math.abs(lr - want) > ego.half + 1.0)) continue;
        const g = along - CAR_LEN * 0.5 - 1.5;
        if (g < gap) {
          gap = g;
          lv = Math.abs(ego.vel) * Math.max(0, ego.hx * hx + ego.hz * hz);
        }
      }
    }
    return { gap, v: lv };
  }

  /** Şerit boş mu (aynı kenar + yön, hedef yanal ofsette, boyuna −25..+35 m) */
  laneFree(car, latTo, ego) {
    for (const o of this.cars) {
      if (o === car || !o.active || o.edge !== car.edge || o.dir !== car.dir || o.turn) continue;
      if (Math.abs(o.lat - latTo) > 1.6 && Math.abs((o.change?.to ?? o.lat) - latTo) > 1.6) continue;
      const ds = (o.s - car.s) * car.dir;
      const back = Math.max(25, (o.v - car.v) * 3.5 + 15); // arkadan hızlı gelen araca yer bırak
      const ahead = Math.max(35, (car.v - o.v) * 4 + 20); // önde yavaş / duran araç varsa o şeride geçme
      if (ds > -back && ds < ahead) return false;
    }
    if (ego.active) {
      // Oyuncu (tır noktaları) hedef şeritte mi: aracın sağ ekseninde hedef şeridin yanal konumu
      const want = (latTo - car.lat) * car.dir;
      for (const k of ego.points) {
        const rx = k.x - car.x;
        const rz = k.z - car.z;
        const along = rx * car.hx + rz * car.hz;
        const lat = rx * -car.hz + rz * car.hx;
        if (along > -25 && along < 40 && Math.abs(lat - want) < ego.half + 1.6) return false;
      }
    }
    return true;
  }

  idm(v, v0, gap, lv) {
    const { a, b, s0, T } = IDM;
    const free = 1 - (v / Math.max(1, v0)) ** 4;
    if (gap === Infinity) return a * free;
    const ss = s0 + v * T + (v * (v - lv)) / (2 * Math.sqrt(a * b));
    const g = Math.max(0.3, gap);
    return a * (free - (Math.max(0, ss) / g) ** 2);
  }

  // ---- Kare --------------------------------------------------------------------------------------------

  /**
   * @param dt sn
   * @param tSec ortak saat (trafik ışıkları, sinyal yanıp sönmesi)
   * @param ego { active, x, z, yaw, vel, truck } oyuncu
   */
  update(dt, tSec, ego) {
    this.t = tSec;
    const h = Math.min(dt, 0.1);
    // Oyuncunun engel noktaları (tırda: çekici + dorse ortası + dorse arkası)
    const fx = -Math.sin(ego.yaw);
    const fz = -Math.cos(ego.yaw);
    const E = this._ego ??= { points: [{ x: 0, z: 0 }, { x: 0, z: 0 }, { x: 0, z: 0 }], half: 1.3 };
    E.active = ego.active;
    E.x = ego.x;
    E.z = ego.z;
    E.vel = ego.vel;
    E.hx = ego.vel >= 0 ? fx : -fx;
    E.hz = ego.vel >= 0 ? fz : -fz;
    E.half = ego.truck ? 1.35 : 1.0;
    const np = ego.truck ? 3 : 1;
    E.points.length = 3;
    for (let k = 0; k < 3; k++) {
      const back = k === 0 ? 0 : k === 1 ? 7 : 14;
      E.points[k].x = ego.x - fx * (k < np ? back : 0);
      E.points[k].z = ego.z - fz * (k < np ? back : 0);
    }
    // Işınlanma (tek karede > 200 m): çevre yeniden doldurulur
    if (this.lastEgo && Math.hypot(ego.x - this.lastEgo.x, ego.z - this.lastEgo.z) > 200) this.hidden = true;
    (this.lastEgo ??= { x: 0, z: 0 }).x = ego.x;
    this.lastEgo.z = ego.z;
    let near = false;
    let budget = this.hidden ? this.count : 2; // kare başına en çok 2 doğma (girişte hepsi)
    for (const car of this.cars) {
      if (!car.active) {
        if (budget > 0 && this.spawn(car, ego, this.hidden ? 50 : SPAWN_MIN)) budget--;
        continue;
      }
      if (Math.hypot(car.x - ego.x, car.z - ego.z) > DESPAWN) {
        this.despawn(car);
        continue;
      }
      this.step(car, h, tSec, E);
      if (Math.abs(car.x - ego.x) < 150 && Math.abs(car.z - ego.z) < 150) near = true;
    }
    this.hidden = false;
    this.near100 = near;
    this.render(tSec);
  }

  step(car, h, tSec, ego) {
    const kind = ROAD_BY_ID[car.edge.road].kind;
    // Dönüş eğrisinde
    if (car.turn) {
      const L = this.leader(car, ego);
      const vT = car.next && car.nextTurn !== 'straight' ? (kind === 'urban' || ROAD_BY_ID[car.next.road].kind === 'urban' ? 7 : 13) : car.v0;
      car.acc = Math.max(-9, this.idm(car.v, vT, L.gap, L.v));
      car.v = Math.max(0, car.v + car.acc * h);
      const t = car.turn;
      t.d += car.v * h;
      const u = Math.min(1, t.d / t.len);
      const b = bezier(t.p0, t.p1, t.p2, u, this._b);
      car.x = b.x;
      car.z = b.z;
      const l = Math.hypot(b.dx, b.dz) || 1;
      car.hx = b.dx / l;
      car.hz = b.dz / l;
      car.blink = car.nextTurn === 'left' ? -1 : car.nextTurn === 'right' ? 1 : 0;
      if (u >= 1) this.finishTurn(car);
      return;
    }
    const rem = this.remaining(car);
    if (!car.next && car.nextTurn !== 'uturn' && rem < 140) this.planTurn(car);
    // İstenen hız: dönüş / çıkış öncesi yavaşla
    let v0 = car.v0;
    if (car.next && car.nextTurn !== 'straight' && rem < 60) v0 = Math.min(v0, kind === 'urban' ? 8 : 14);
    if (!car.next && car.nextTurn === 'uturn' && rem < 50) v0 = Math.min(v0, 5);
    let { gap, v: lv } = this.leader(car, ego);
    // Trafik ışığı
    const nodeId = this.targetNode(car);
    const sig = signalOf.get(nodeId);
    if (sig) {
      const pl = plazaOf.get(nodeId);
      const stopAt = rem - (pl ? pl.half + 3 : 10);
      if (stopAt > -1) {
        const st = signalState(sig, signalAxis(edgeDirAt(car.edge, nodeId)), tSec);
        const canStop = stopAt > (car.v * car.v) / (2 * IDM.b) + 1;
        if (st === 'r' || (st === 'y' && canStop)) {
          if (stopAt < gap) { gap = Math.max(0, stopAt); lv = 0; }
        }
      }
    }
    // Işıksız kavşakta yol ver: ana yoldaki (ya da kavşağa daha yakın) araca
    if (!sig && car.next && car.nextTurn !== 'straight' && rem < 60 && this.mustYield(car, nodeId, rem)) {
      const stopAt = rem - (plazaOf.has(nodeId) ? 16 : 26) - 1;
      if (stopAt < gap) { gap = Math.max(0, stopAt); lv = 0; }
      car.waitT = car.v < 0.5 ? (car.waitT ?? 0) + h : car.waitT ?? 0;
    } else car.waitT = 0;
    car.acc = Math.max(-9, this.idm(car.v, v0, gap, lv));
    car.braking = car.acc < -1;
    car.v = Math.max(0, car.v + car.acc * h);
    car.s += car.dir * car.v * h;
    // Şerit değiştirme (otoyol: 2 şerit)
    const lanes = LANES[kind].length;
    if (car.change) {
      const c = car.change;
      c.t += h;
      if (c.t >= SIGNAL_LEAD_SEC) {
        const k = Math.min(1, (c.t - SIGNAL_LEAD_SEC) / 2.6);
        const sm = k * k * (3 - 2 * k);
        car.lat = c.from + (c.to - c.from) * sm;
        if (k >= 1) {
          car.lane = c.lane;
          car.change = null;
          car.fastSince = tSec;
        }
      }
      car.blink = c.side;
    } else if (lanes > 1 && car.lane === 1 && car.next && car.nextTurn !== 'straight' && rem > 60) {
      // Çıkıştan önce sağ şeride geç
      const to = laneL(car.edge, car.dir, 0);
      if (this.laneFree(car, to, ego)) car.change = { from: car.lat, to, lane: 0, t: 0, side: 1 };
      car.blink = 0;
    } else if (lanes > 1 && rem > 220 && !car.next) {
      const slow = gap < 45 && lv < car.v0 - 3;
      const blocked = gap < 30 && lv < 2; // önde duran araç / tır: hangi şeritte olursa olsun öbür şeride geç
      if (car.lane === 1 && blocked) {
        const to = laneL(car.edge, car.dir, 0);
        if (this.laneFree(car, to, ego)) car.change = { from: car.lat, to, lane: 0, t: 0, side: 1 };
      } else if (car.lane === 0 && slow) {
        const to = laneL(car.edge, car.dir, 1);
        if (this.laneFree(car, to, ego)) car.change = { from: car.lat, to, lane: 1, t: 0, side: -1 };
      } else if (car.lane === 1 && tSec - car.fastSince > 9 && !slow) {
        const to = laneL(car.edge, car.dir, 0);
        if (this.laneFree(car, to, ego)) car.change = { from: car.lat, to, lane: 0, t: 0, side: 1 };
      }
      car.blink = 0;
    } else {
      car.blink = 0;
    }
    // Kavşaktan önce sinyal
    if (!car.change && car.next && (car.nextTurn === 'left' || car.nextTurn === 'right') && rem < Math.max(35, car.v * 3.2)) {
      car.blink = car.nextTurn === 'left' ? -1 : 1;
    }
    // Kavşağa yaklaşınca dönüş eğrisine geç (ya da aynı yolda devam)
    const D = plazaOf.has(nodeId) ? 16 : 26;
    const remNow = this.remaining(car);
    if (car.next && car.next.road === car.edge.road) {
      if (remNow <= 0) {
        const over = -remNow;
        car.edge = car.next;
        car.dir = car.nextDir;
        car.s = car.dir > 0 ? car.edge.sa + over : car.edge.sb - over;
        car.next = null;
        car.nextTurn = 'straight';
      }
    } else if (remNow < D && (car.next || car.nextTurn === 'uturn')) {
      if (!car.next && car.nextTurn === 'uturn' && this._egoFar(car, ego)) {
        this.despawn(car); // çıkmaz: görüş dışındaysa yeniden doğar
        return;
      }
      this.place(car);
      this.startTurn(car);
      return;
    } else if (remNow <= 0) {
      car.s = car.dir > 0 ? car.edge.sb : car.edge.sa;
      car.v = 0;
    }
    this.place(car);
  }

  /** Kavşağa gelen / kavşakta dönen başka araç varken beklemeli mi (yol sınıfı: şehir < bağlantı < otoyol) */
  mustYield(car, nodeId, rem) {
    const RANK = { urban: 0, spur: 1, trunk: 2 };
    const node = GRAPH.nodes[nodeId];
    const mine = Math.max(RANK[ROAD_BY_ID[car.edge.road].kind], car.next ? RANK[ROAD_BY_ID[car.next.road].kind] - 1 : 0);
    for (const o of this.cars) {
      if (o === car || !o.active) continue;
      if (o.turn) {
        if (o.turn.node === node && o.edge !== car.edge) return true; // kavşağın içinde
        continue;
      }
      if (o.edge === car.edge && o.dir === car.dir) continue;
      if (this.targetNode(o) !== nodeId) continue;
      // Sağa katılırken: girilen yolda karşıdan gelen şeritler ve iç (sollama) şerit çakışmaz
      if (car.nextTurn === 'right' && (o.edge === car.next || o.lane === 1)) continue;
      const orem = this.remaining(o);
      const tta = orem / Math.max(1, o.v); // kavşağa varış süresi
      const wait = car.waitT > 6 ? 1.8 : 3.0; // uzun bekleyen daha kısa boşluğu kabul eder
      if (orem > 90 || (tta > wait && orem > 12) || (o.v < 0.5 && orem > 30)) continue;
      const theirs = RANK[ROAD_BY_ID[o.edge.road].kind];
      if (theirs > mine) return true;
      if (theirs === mine && (orem < rem - 2 || (Math.abs(orem - rem) <= 2 && o.i < car.i))) return true;
    }
    return false;
  }

  _egoFar(car, ego) {
    return !ego.active || Math.hypot(car.x - ego.x, car.z - ego.z) > 150;
  }

  render(tSec) {
    const on = Math.floor(tSec * 3) % 2 === 0;
    const m = this._m;
    const p = this._p;
    const s = this._s;
    const q = this._q;
    for (const car of this.cars) {
      const i = car.i;
      if (!car.active) {
        s.setScalar(0);
        m.compose(p.set(0, -10, 0), q.identity(), s);
        for (const mesh of [this.body, this.cab, this.blinkL, this.blinkR, this.brake]) mesh.setMatrixAt(i, m);
        continue;
      }
      q.setFromEuler(this._e.set(0, Math.atan2(car.hx, car.hz), 0));
      p.set(car.x, 0, car.z);
      s.setScalar(1);
      m.compose(p, q, s);
      this.body.setMatrixAt(i, m);
      this.cab.setMatrixAt(i, m);
      const bl = on && car.blink < 0;
      const br = on && car.blink > 0;
      const stop = car.braking || (car.v < 0.5 && car.active);
      s.setScalar(bl ? 1 : 0);
      m.compose(p, q, s);
      this.blinkL.setMatrixAt(i, m);
      s.setScalar(br ? 1 : 0);
      m.compose(p, q, s);
      this.blinkR.setMatrixAt(i, m);
      s.setScalar(stop ? 1 : 0);
      m.compose(p, q, s);
      this.brake.setMatrixAt(i, m);
    }
    for (const mesh of [this.body, this.cab, this.blinkL, this.blinkR, this.brake]) mesh.instanceMatrix.needsUpdate = true;
  }

  /** Bölgeden çıkınca: bütün araçlar kalkar (dönüşte oyuncunun çevresinde yeniden doğar) */
  reset() {
    for (const car of this.cars) this.despawn(car);
    this.hidden = true;
    this.render(this.t);
  }

  /** (x, z) noktasına r'den yakın trafik aracı */
  near(x, z, r) {
    for (const c of this.cars) if (c.active && Math.abs(c.x - x) < r && Math.abs(c.z - z) < r && Math.hypot(c.x - x, c.z - z) < r) return c;
    return null;
  }

  /** Test / tanılama: etkin araçlar */
  get active() {
    return this.cars.filter((c) => c.active);
  }
}

function mergeTwo(a, b) {
  const pos = [...a.attributes.position.array, ...b.attributes.position.array];
  const nor = [...a.attributes.normal.array, ...b.attributes.normal.array];
  const ia = a.index.array;
  const ib = b.index.array;
  const off = a.attributes.position.count;
  const idx = [...ia, ...Array.from(ib, (v) => v + off)];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setIndex(idx);
  return g;
}

export const TRAFFIC_HALF = HWY.urbanHalf;
