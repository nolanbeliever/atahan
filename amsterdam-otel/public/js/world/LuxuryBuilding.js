import * as THREE from 'three';
import {
  WALL_H, FLOOR_DZ, ROOMS, ROOF, LOUNGES, STAFF_ROOM, buildFloorWallSegments,
} from '/shared/layout.js';
import { VIP } from '/shared/architecture.js';
import { UV } from './Materials.js';
import { StaticBatcher } from './StaticBatcher.js';
import { addPlanter, addWindow, makePanel } from './Props.js';
import { addElevatorDoor, buildFloorDecor } from './HotelFloors.js';
import { signDrawer } from './Textures.js';
import { goldLettering, menuBoard } from './LuxuryTextures.js';
import { makeCharacter } from '../game/Characters.js';

// Lüks paketlerin geometrisi (HotelArchitectureUpgrades çağırır). Her şey StaticBatcher ile
// malzeme başına tek mesh'e birleştirilir; her bölüm (kat, çatı, cephe) kendi THREE.Group'unda durur
// ki sistem görünürlüğü tek bayrakla açıp kapatabilsin (yalnızca oyuncunun bulunduğu kat çizilir).
// NPC'ler (barmen, lounge müşterileri, çatıdaki misafirler) statik: matrixAutoUpdate kapalı.

const NO_CAST = { cast: false };
const CEIL = { facingDown: true, cast: false, receive: false };
const _up = new THREE.Vector3(0, 1, 0);
const _one = new THREE.Vector3(1, 1, 1);
const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _local = new THREE.Matrix4();

/** Yerel koordinatlı parça ekleyici (döndürülmüş mobilya) */
class Part {
  constructor(b, x, y, z, rotY = 0) {
    this.b = b;
    this.world = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(_up, rotY), _one);
  }

  add(mat, geo, pos = [0, 0, 0], rot = [0, 0, 0], opts = {}) {
    _local.compose(_v.fromArray(pos), _q.setFromEuler(new THREE.Euler(rot[0], rot[1], rot[2])), _one);
    geo.applyMatrix4(_local).applyMatrix4(this.world);
    this.b.add(mat, geo, opts);
  }
}

/** Statik NPC: oturuyorsa (y < 0) ya da uzanıyorsa (lie) gölge lekesi gizlenir */
export function addNpc(parent, look, { x, z, y = 0, rot = 0, opts = {}, lie = 0, dynamic = false }) {
  const c = makeCharacter(look, opts);
  c.position.set(x, y, z);
  c.rotation.order = 'YXZ';
  c.rotation.y = rot;
  if (lie) c.rotation.x = -lie;
  if (y !== 0 || lie) c.userData.blob.visible = false;
  c.updateMatrixWorld(true);
  if (!dynamic) c.traverse((o) => { o.matrixAutoUpdate = false; });
  parent.add(c);
  return c;
}

const look = (i) => ({ body: (i * 3) % 8, skin: (i * 2 + 1) % 5, hair: (i + 2) % 5, hat: false, bag: false });

/** Kadife berjer (altın ayaklı); önü yerel +Z */
function addLuxArmchair(b, collision, x, z, rotY, mat = 'luxVelvet') {
  const p = new Part(b, x, 0, z, rotY);
  p.add(mat, new THREE.BoxGeometry(0.78, 0.2, 0.74), [0, 0.36, 0.02]);
  p.add(mat, new THREE.BoxGeometry(0.78, 0.62, 0.16), [0, 0.68, -0.31]);
  p.add(mat, new THREE.BoxGeometry(0.12, 0.26, 0.66), [-0.33, 0.56, 0.03]);
  p.add(mat, new THREE.BoxGeometry(0.12, 0.26, 0.66), [0.33, 0.56, 0.03]);
  for (const [lx, lz] of [[-0.32, -0.28], [0.32, -0.28], [-0.32, 0.32], [0.32, 0.32]]) {
    p.add('gold', new THREE.CylinderGeometry(0.025, 0.018, 0.26, 6), [lx, 0.13, lz], [0, 0, 0], NO_CAST);
  }
  if (collision) collision.addAround(x, z, 0.42);
}

/** Avize: pirinç çubuk + halka + kristaller */
function addChandelier(b, x, z, y = 2.8, r = 0.3) {
  b.add('gold', new THREE.CylinderGeometry(0.012, 0.012, WALL_H - y, 4), { ...NO_CAST, receive: false, position: [x, (WALL_H + y) / 2, z] });
  b.add('gold', new THREE.TorusGeometry(r, 0.018, 4, 16), { ...NO_CAST, receive: false, position: [x, y, z], rotation: [Math.PI / 2, 0, 0] });
  b.add('lamp', new THREE.SphereGeometry(0.09, 8, 6), { ...NO_CAST, receive: false, position: [x, y - 0.05, z] });
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    b.add('crystal', new THREE.OctahedronGeometry(0.045), { ...NO_CAST, receive: false, position: [x + Math.cos(a) * r, y - 0.07, z + Math.sin(a) * r] });
    b.add('lamp', new THREE.SphereGeometry(0.04, 6, 4), { ...NO_CAST, receive: false, position: [x + Math.cos(a) * r, y + 0.05, z + Math.sin(a) * r] });
  }
}

// ---- Lüks oda mobilyası ----------------------------------------------------------------

/**
 * Bir odaya lüks dokunuşlar (RoomView'un mobilyasına ek, aynı batcher):
 * kadife yatak başı + altın kenar, aplikler, pencere önünde berjer, avize.
 * VIP suiti: cibinlikli (altın direkli) yatak, jakuzi köşesi, altın tavan silmesi, meyve tabağı.
 */
export function addLuxRoomFurniture(b, collision, layout, { vip = false } = {}) {
  const s = layout.side;
  const z0 = layout.bounds.minZ;
  const bed = layout.bed;
  const wid = vip ? 2.0 : bed.wid;
  const bz0 = bed.z - wid / 2;
  const bz1 = bed.z + wid / 2;
  const hx0 = s > 0 ? 7.74 : -7.81;
  const hx1 = s > 0 ? 7.81 : -7.74;
  // Kapitoneli kadife yatak başı (tablonun altında kalır)
  b.box(vip ? 'luxVelvetRed' : 'luxVelvet', hx0, hx1, 0.66, 1.33, bz0 - 0.12, bz1 + 0.12, NO_CAST);
  b.box('gold', hx0 - 0.01, hx1, 1.33, 1.37, bz0 - 0.14, bz1 + 0.14, NO_CAST);
  for (let i = 0; i < 4; i++) {
    const zz = bz0 + ((i + 0.5) / 4) * (bz1 - bz0);
    b.add('gold', new THREE.SphereGeometry(0.02, 5, 4), { ...NO_CAST, position: [s > 0 ? hx0 : hx1, 1.0, zz] });
  }
  // Aplikler (yatağın iki yanında, duvarda)
  for (const dzS of [-1.05, 1.05]) {
    const zz = bed.z + dzS;
    b.box('gold', s > 0 ? 7.82 : -7.88, s > 0 ? 7.88 : -7.82, 1.62, 1.8, zz - 0.05, zz + 0.05, NO_CAST);
    b.add('lamp', new THREE.SphereGeometry(0.07, 8, 6), { ...NO_CAST, position: [s * 7.76, 1.86, zz] });
  }
  // Pencere önünde berjer (odaya bakar)
  addLuxArmchair(b, collision, s * 7.0, z0 + 2.15, -s * Math.PI / 2, vip ? 'luxVelvetRed' : 'luxVelvet');
  // Avize
  addChandelier(b, s * 3.3, z0 + 5.3);
  if (!vip) return;

  // ---- VIP suiti ----
  const bx0 = bed.x - bed.len / 2;
  const bx1 = bed.x + bed.len / 2;
  for (const px of [bx0, bx1]) {
    for (const pz of [bz0, bz1]) b.add('gold', new THREE.CylinderGeometry(0.045, 0.045, 2.35, 8), { ...NO_CAST, position: [px, 1.175, pz] });
  }
  b.box('gold', bx0, bx1, 2.33, 2.38, bz0 - 0.03, bz0 + 0.03, NO_CAST);
  b.box('gold', bx0, bx1, 2.33, 2.38, bz1 - 0.03, bz1 + 0.03, NO_CAST);
  b.box('gold', bx0 - 0.03, bx0 + 0.03, 2.33, 2.38, bz0, bz1, NO_CAST);
  b.box('gold', bx1 - 0.03, bx1 + 0.03, 2.33, 2.38, bz0, bz1, NO_CAST);
  b.box('luxVelvetRed', bx0, bx1, 2.1, 2.33, bz0 - 0.02, bz0 + 0.01, NO_CAST);
  b.box('luxVelvetRed', bx0, bx1, 2.1, 2.33, bz1 - 0.01, bz1 + 0.02, NO_CAST);
  // Jakuzi (koridor duvarı + arka duvar köşesi)
  const jx = s * 2.38;
  const jz = z0 + 6.3;
  b.add('luxMarble', new THREE.CylinderGeometry(0.62, 0.62, 0.55, 20), { position: [jx, 0.275, jz] });
  b.add('gold', new THREE.TorusGeometry(0.6, 0.035, 4, 24), { ...NO_CAST, position: [jx, 0.56, jz], rotation: [Math.PI / 2, 0, 0] });
  b.add('jacuzziWater', new THREE.CircleGeometry(0.56, 20), { ...NO_CAST, receive: false, position: [jx, 0.5, jz], rotation: [-Math.PI / 2, 0, 0] });
  collision.add(Math.min(jx - s * 0.62, jx + s * 0.62), Math.max(jx - s * 0.62, jx + s * 0.62), jz - 0.62, jz + 0.62);
  // Altın tavan silmesi
  const xin = s * 1.6;
  const xout = s * 7.9;
  const xa = Math.min(xin, xout);
  const xb = Math.max(xin, xout);
  b.box('gold', xa, xb, 3.04, 3.12, z0 + 0.1, z0 + 0.14, NO_CAST);
  b.box('gold', xa, xb, 3.04, 3.12, z0 + 6.86, z0 + 6.9, NO_CAST);
  b.box('gold', xb - 0.04, xb, 3.04, 3.12, z0 + 0.1, z0 + 6.9, NO_CAST);
  b.box('gold', xa, xa + 0.04, 3.04, 3.12, z0 + 0.1, z0 + 6.9, NO_CAST);
  // Meyve tabağı (sehpanın üstünde)
  const fx = s * 6.9;
  const fz = z0 + 6.45;
  b.add('gold', new THREE.SphereGeometry(0.14, 10, 4, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), { ...NO_CAST, position: [fx, 0.72, fz] });
  ['bottleOrange', 'bottleRed', 'bottleGreen'].forEach((m, i) => {
    b.add(m, new THREE.SphereGeometry(0.045, 8, 6), { ...NO_CAST, position: [fx + (i - 1) * 0.06, 0.65, fz + (i % 2) * 0.04] });
  });
}

// ---- Lüks kat (5–12) ------------------------------------------------------------------------

/**
 * Bir lüks katı kurar: duvarlar + çarpışmalar, oda zeminleri/tavanları, sahanlık dekoru, 4 RoomView
 * (dinamik parçalar `parent` grubunda), arıza görselleri, lüks mobilya; 5. ve 8. katta lounge bar,
 * 5. katta personel odası; 12. katta VIP suitleri. Hepsi tek batcher → kat başına ~25 draw call.
 * @returns {{ views: RoomView[], npcs: THREE.Object3D[] }}
 */
export function buildLuxFloor({ f, allMats, collision, factory, world, maint, parent }) {
  const b = new StaticBatcher();
  const dz = FLOOR_DZ[f];
  for (const s of buildFloorWallSegments(f)) {
    b.box(s.mat, s.minX, s.maxX, s.minY, s.maxY, s.minZ, s.maxZ, { uvScale: UV[s.mat] });
    if (!s.lintel) collision.add(s.minX, s.maxX, s.minZ, s.maxZ);
  }
  const rooms = ROOMS.filter((r) => r.floor === f);
  for (const r of rooms) {
    const bd = r.bounds;
    b.floor('floorRoom', bd.minX, bd.maxX, bd.minZ, bd.maxZ, 0, { uvScale: UV.floorRoom });
    b.floor('ceiling', bd.minX, bd.maxX, bd.minZ, bd.maxZ, WALL_H, CEIL);
  }
  const lounge = LOUNGES.find((l) => l.floor === f);
  buildFloorDecor(b, collision, parent, factory, f, { eastPainting: !lounge });
  const vip = f === VIP.FLOOR;
  const vipIds = new Set(vip ? rooms.map((r) => r.id) : []);
  const views = world.addRoomViews(rooms, b, parent, vipIds);
  maint.addRooms(rooms, parent);
  for (const r of rooms) addLuxRoomFurniture(b, collision, r, { vip });
  // Koridor: lüks katlarda altın aplikler
  for (const z of [15.5, 22.5]) {
    for (const x of [-1.38, 1.38]) b.add('lamp', new THREE.SphereGeometry(0.06, 6, 4), { ...NO_CAST, position: [x, 2.05, z - 1.1 + dz] });
  }
  const npcs = [];
  if (lounge) npcs.push(...buildLounge(b, collision, parent, factory, lounge, dz));
  if (STAFF_ROOM.floor === f) buildStaffRoom(b, collision, parent, factory, dz);
  if (vip) {
    const mat = new THREE.MeshBasicMaterial({ map: factory.make(signDrawer({ title: '★ VIP SUITES ★', sub: 'Yalnızca VIP misafirler · 1201–1204', bg: '#15151b', fg: '#f2c75c', border: '#c9a25e' }), { w: 1, h: 0.4, repeat: false }) });
    parent.add(makePanel(mat, 1.5, 0.6, -3.385, 1.85, 11.0 + dz, 'x+'));
    b.floor('luxCarpetGold', -1.4, 1.4, 12.2 + dz, 25.8 + dz, 0.006, NO_CAST);
  }
  b.build(allMats, parent);
  return { views, npcs };
}

// ---- Lounge barlar (alkolsüz) -------------------------------------------------------------------

const BOTTLE_MATS = ['bottleOrange', 'bottleRed', 'bottleGreen', 'bottleYellow', 'bottlePink'];

function buildLounge(b, collision, parent, factory, L, dz) {
  const library = L.id === 'library';
  const Z = (z) => z + dz;
  const floorUV = { uvScale: UV.floorRoom };
  b.floor('luxLoungeFloor', 3.5, 8, Z(8), Z(12), 0, floorUV);
  b.floor('luxLoungeFloor', 8, 17, Z(6.5), Z(18), 0, floorUV);
  b.floor('ceiling', 3.5, 8, Z(8), Z(12), WALL_H, CEIL);
  b.floor('ceiling', 8, 17, Z(6.5), Z(18), WALL_H, CEIL);
  // Kemer: altın pervaz + tabela (sahanlık tarafı)
  b.box('gold', 3.37, 3.42, 0, 2.8, Z(L.door.from) - 0.1, Z(L.door.from), NO_CAST);
  b.box('gold', 3.37, 3.42, 0, 2.8, Z(L.door.to), Z(L.door.to) + 0.1, NO_CAST);
  b.box('gold', 3.37, 3.42, 2.7, 2.8, Z(L.door.from) - 0.1, Z(L.door.to) + 0.1, NO_CAST);
  const signMat = new THREE.MeshBasicMaterial({
    map: factory.make(goldLettering(L.name.toUpperCase(), { bg: '#14141a' }), { w: 1.6, h: 0.3, repeat: false }),
  });
  parent.add(makePanel(signMat, 2.1, 0.38, 3.385, 2.98, Z(10), 'x-'));
  b.floor('rugRed', 3.7, 7.8, Z(8.6), Z(11.4), 0.006, NO_CAST);

  // Bar tezgâhı (doğu), arka tezgâh ve raflar
  b.box('wood', 14.0, 14.6, 0, 1.0, Z(8.6), Z(15.6));
  b.box('luxMarble', 13.92, 14.68, 1.0, 1.06, Z(8.55), Z(15.65));
  b.box('luxVelvet', 13.98, 14.0, 0.15, 0.9, Z(8.7), Z(15.5), NO_CAST);
  b.box('gold', 13.84, 13.88, 0.2, 0.24, Z(8.6), Z(15.6), NO_CAST);
  collision.add(13.84, 14.68, Z(8.55), Z(15.65));
  b.box('wood', 16.35, 16.9, 0, 0.95, Z(8.4), Z(15.8));
  b.box('luxMarble', 16.3, 16.9, 0.95, 1.0, Z(8.4), Z(15.8));
  b.box('luxMirror', 16.87, 16.9, 1.05, 2.6, Z(8.6), Z(15.6), NO_CAST);
  b.box('gold', 16.84, 16.9, 2.6, 2.66, Z(8.5), Z(15.7), NO_CAST);
  collision.add(16.3, 16.9, Z(8.4), Z(15.8));
  let k = 0;
  for (const y of [1.35, 1.8, 2.25]) {
    b.box('luxMarble', 16.5, 16.88, y - 0.02, y, Z(8.6), Z(15.6), NO_CAST);
    for (let z = 8.75; z < 15.5; z += 0.24) {
      const m = BOTTLE_MATS[(k++ * 7 + Math.round(y * 10)) % BOTTLE_MATS.length];
      const h = 0.2 + ((k * 13) % 5) * 0.025;
      b.add(m, new THREE.CylinderGeometry(0.045, 0.045, h, 6), { ...NO_CAST, position: [16.68, y + h / 2, Z(z)] });
      b.add('glassRail', new THREE.CylinderGeometry(0.016, 0.03, 0.08, 5), { ...NO_CAST, position: [16.68, y + h + 0.04, Z(z)] });
    }
  }
  // Tezgâhta taze meyve suyu sürahileri (alkolsüz)
  ['bottleOrange', 'bottleRed', 'bottleGreen'].forEach((m, i) => {
    const z = Z(14.4 + i * 0.35);
    b.add(m, new THREE.CylinderGeometry(0.1, 0.1, 0.28, 10), { ...NO_CAST, position: [14.3, 1.2, z] });
    b.add('glassRail', new THREE.CylinderGeometry(0.12, 0.12, 0.4, 10, 1, true), { ...NO_CAST, receive: false, position: [14.3, 1.26, z] });
  });
  // Menü panosu (arka tezgâhın üstünde)
  const menuMat = new THREE.MeshBasicMaterial({
    map: factory.make(menuBoard(`${L.name} · Alkolsüz`, ['Virgin Mojito · €6', 'Taze portakal suyu · €4', 'Çilekli smoothie · €5']), { w: 1.4, h: 0.4, repeat: false }),
  });
  parent.add(makePanel(menuMat, 2.4, 0.62, 16.86, 2.92, Z(12.1), 'x-'));
  // Sarkıt lambalar
  for (const z of [10, 12.1, 14.2]) {
    b.add('gold', new THREE.CylinderGeometry(0.01, 0.01, 0.6, 4), { ...NO_CAST, receive: false, position: [14.3, 2.9, Z(z)] });
    b.add('lamp', new THREE.SphereGeometry(0.14, 10, 8), { ...NO_CAST, receive: false, position: [14.3, 2.5, Z(z)] });
  }
  for (const [x, z] of [[10.5, 9.5], [10.5, 13.2], [15.4, 7.4], [15.4, 17.0]]) {
    b.add('lamp', new THREE.CylinderGeometry(0.17, 0.17, 0.02, 12), { ...NO_CAST, receive: false, position: [x, WALL_H - 0.012, Z(z)] });
  }

  // Tabureler + müşteriler (3 dolu) + barmen
  const stoolZ = [9.4, 10.6, 11.8, 13.0, 14.2];
  for (const z of stoolZ) {
    b.add('gold', new THREE.CylinderGeometry(0.03, 0.03, 0.7, 6), { position: [13.35, 0.35, Z(z)] });
    b.add('gold', new THREE.CylinderGeometry(0.18, 0.18, 0.02, 10), { ...NO_CAST, position: [13.35, 0.01, Z(z)] });
    b.add('luxVelvet', new THREE.CylinderGeometry(0.2, 0.2, 0.08, 12), { position: [13.35, 0.74, Z(z)] });
    collision.addAround(13.35, Z(z), 0.2);
  }
  const npcs = [];
  const seed = library ? 0 : 4;
  [0, 2, 3].forEach((i, n) => {
    npcs.push(addNpc(parent, look(seed + n), { x: 13.3, z: Z(stoolZ[i]), y: 0.12, rot: Math.PI / 2 }));
    const m = BOTTLE_MATS[(seed + n) % BOTTLE_MATS.length];
    b.add(m, new THREE.CylinderGeometry(0.035, 0.03, 0.12, 8), { ...NO_CAST, position: [14.15, 1.12, Z(stoolZ[i])] });
  });
  npcs.push(addNpc(parent, { skin: library ? 2 : 0, hair: library ? 0 : 1 }, {
    x: 15.4, z: Z(12.1), rot: -Math.PI / 2, opts: { color: '#1d2a4a', staff: true },
  }));

  // Kuzey oturma grubu: kanepe, berjerler, sehpa, halı (+ 3 misafir)
  b.floor('rugRed', 8.8, 12.6, Z(14.3), Z(17.05), 0.006, NO_CAST);
  b.box('luxVelvetRed', 9.0, 12.4, 0.1, 0.45, Z(17.1), Z(17.9));
  b.box('luxVelvetRed', 9.0, 12.4, 0.45, 1.0, Z(17.62), Z(17.9));
  b.box('luxVelvetRed', 9.0, 9.18, 0.45, 0.68, Z(17.1), Z(17.62));
  b.box('luxVelvetRed', 12.22, 12.4, 0.45, 0.68, Z(17.1), Z(17.62));
  b.box('gold', 9.0, 12.4, 0.02, 0.1, Z(17.15), Z(17.85), NO_CAST);
  collision.add(9.0, 12.4, Z(17.1), Z(17.9));
  b.add('luxMarble', new THREE.CylinderGeometry(0.45, 0.45, 0.04, 16), { position: [10.7, 0.42, Z(16.1)] });
  b.add('gold', new THREE.CylinderGeometry(0.06, 0.16, 0.4, 8), { position: [10.7, 0.2, Z(16.1)] });
  collision.addAround(10.7, Z(16.1), 0.45);
  addLuxArmchair(b, collision, 9.4, Z(14.9), 0);
  addLuxArmchair(b, collision, 12.0, Z(14.9), 0);
  npcs.push(addNpc(parent, look(seed + 5), { x: 9.8, z: Z(17.35), y: -0.4, rot: Math.PI }));
  npcs.push(addNpc(parent, look(seed + 6), { x: 11.6, z: Z(17.35), y: -0.4, rot: Math.PI }));
  npcs.push(addNpc(parent, look(seed + 7), { x: 12.0, z: Z(14.95), y: -0.4, rot: 0 }));
  // Güney köşe: iki berjer + küçük sehpa, saksı
  addLuxArmchair(b, collision, 9.4, Z(7.4), 0);
  addLuxArmchair(b, collision, 11.2, Z(7.4), 0);
  b.add('luxMarble', new THREE.CylinderGeometry(0.22, 0.22, 0.03, 12), { position: [10.3, 0.55, Z(7.3)] });
  b.add('gold', new THREE.CylinderGeometry(0.03, 0.05, 0.54, 6), { position: [10.3, 0.27, Z(7.3)] });
  addPlanter(b, collision, 16.4, Z(7.1), 1);

  if (library) {
    // Kitaplık (batı duvarı) ve şömine (güney duvarı)
    b.box('wood', 8.1, 8.45, 0, 2.6, Z(12.3), Z(16.9));
    const g = new THREE.PlaneGeometry(4.5, 2.45);
    b.add('books', g, { ...NO_CAST, position: [8.456, 1.3, Z(14.6)], rotation: [0, Math.PI / 2, 0] });
    collision.add(8.1, 8.45, Z(12.3), Z(16.9));
    b.box('luxMarble', 12.4, 14.0, 0, 1.3, Z(6.6), Z(6.95));
    b.box('wood', 12.3, 14.1, 1.3, 1.38, Z(6.6), Z(7.05));
    b.box('black', 12.8, 13.6, 0.1, 0.85, Z(6.95), Z(6.97), NO_CAST);
    b.add('fireGlow', new THREE.PlaneGeometry(0.6, 0.35), { ...NO_CAST, receive: false, position: [13.2, 0.3, Z(6.98)] });
    collision.add(12.4, 14.0, Z(6.6), Z(7.05));
    addPlanter(b, collision, 8.55, Z(17.4), 2);
  } else {
    // Sky Lounge: panoramik pencereler (kuzey + güney), tavanda yıldız ışıkları
    addWindow(b, { x: 14.6, y: 1.75, z: Z(17.9), w: 3.4, h: 1.7, facing: 'z-', glass: 'skyline', uOffset: 0.4 });
    addWindow(b, { x: 10.3, y: 1.85, z: Z(6.6), w: 3.0, h: 1.4, facing: 'z+', glass: 'skyline', uOffset: 0.75 });
    for (let i = 0; i < 18; i++) {
      const x = 8.6 + ((i * 37) % 80) / 10;
      const z = 7.2 + ((i * 53) % 100) / 10;
      b.add('lamp', new THREE.SphereGeometry(0.025, 4, 3), { ...NO_CAST, receive: false, position: [x, WALL_H - 0.02, Z(z)] });
    }
    addPlanter(b, collision, 8.55, Z(17.4), 0);
  }
  return npcs;
}

// ---- Personel odası (5. kat) --------------------------------------------------------------

function buildStaffRoom(b, collision, parent, factory, dz) {
  const Z = (z) => z + dz;
  b.floor('floorRoom', -8, -3.5, Z(8), Z(12), 0, { uvScale: UV.floorRoom });
  b.floor('floorRoom', -17, -8, Z(6.5), Z(18), 0, { uvScale: UV.floorRoom });
  b.floor('ceiling', -8, -3.5, Z(8), Z(12), WALL_H, CEIL);
  b.floor('ceiling', -17, -8, Z(6.5), Z(18), WALL_H, CEIL);
  const sign = new THREE.MeshLambertMaterial({
    map: factory.make(signDrawer({ title: 'PERSONEL', sub: 'Personeel · Staff only', bg: '#203a5c' }), { w: 1, h: 0.3, repeat: false }),
  });
  parent.add(makePanel(sign, 1.0, 0.3, -3.385, 2.55, Z(9.0), 'x+'));
  // Dolaplar (batı duvarı)
  b.box('delft', -16.9, -16.45, 0, 2.0, Z(7.0), Z(17.6));
  for (let z = 7.5; z < 17.6; z += 0.5) b.box('black', -16.45, -16.43, 0.1, 1.9, Z(z) - 0.01, Z(z) + 0.01, NO_CAST);
  collision.add(-16.9, -16.45, Z(7.0), Z(17.6));
  // Masa + banklar
  b.box('wood', -15.6, -13.2, 0.72, 0.77, Z(7.2), Z(8.4));
  for (const [x, z] of [[-15.45, 7.35], [-13.35, 7.35], [-15.45, 8.25], [-13.35, 8.25]]) b.box('metal', x - 0.04, x + 0.04, 0, 0.72, Z(z) - 0.04, Z(z) + 0.04);
  b.box('wood', -15.6, -13.2, 0.42, 0.46, Z(6.7), Z(7.0));
  b.box('wood', -15.6, -13.2, 0.42, 0.46, Z(8.6), Z(8.9));
  collision.add(-15.6, -13.2, Z(6.7), Z(8.9));
  // Kahve tezgâhı (güney duvarı)
  b.box('wood', -12.2, -9.6, 0, 0.92, Z(6.6), Z(7.2));
  b.box('white', -12.25, -9.55, 0.92, 0.96, Z(6.6), Z(7.25));
  b.box('metal', -11.9, -11.4, 0.96, 1.4, Z(6.65), Z(7.0));
  collision.add(-12.25, -9.55, Z(6.6), Z(7.25));
  // Duyuru panosu + lambalar
  b.box('cardboard', -14.0, -12.0, 1.3, 2.1, Z(17.86), Z(17.9), NO_CAST);
  for (const [x, y] of [[-13.6, 1.85], [-12.9, 1.6], [-12.5, 1.9]]) b.box('paper', x - 0.15, x + 0.15, y - 0.2, y + 0.2, Z(17.84), Z(17.86), NO_CAST);
  for (const [x, z] of [[-12.5, 9.5], [-12.5, 14.5], [-5.7, 10]]) b.box('lamp', x - 0.3, x + 0.3, WALL_H - 0.03, WALL_H - 0.005, Z(z) - 0.3, Z(z) + 0.3, { cast: false, receive: false });
}

// ---- Çatı: Aqua Park + teras ------------------------------------------------------------------

/** Kaydırak borusu (CatmullRom eğrisi boyunca açık tüp) */
function addSlide(b, mat, pts) {
  const curve = new THREE.CatmullRomCurve3(pts.map(([x, y, z]) => new THREE.Vector3(x, y, z)));
  b.add(mat, new THREE.TubeGeometry(curve, 48, 0.42, 8, false), NO_CAST);
  // Destek direkleri
  for (let i = 1; i < 6; i++) {
    const p = curve.getPoint(i / 6);
    if (p.y < 0.6) continue;
    b.add('metal', new THREE.CylinderGeometry(0.06, 0.06, p.y, 6), { position: [p.x, p.y / 2, p.z] });
  }
}

/** Yükseltilmiş havuz: kenar (fayans) + su yüzeyi; çarpışma kutusu */
function addPool(b, collision, x0, x1, z0, z1, { rim = 'luxMarble' } = {}) {
  const t = 0.35;
  b.box(rim, x0 - t, x1 + t, 0, 0.45, z0 - t, z0);
  b.box(rim, x0 - t, x1 + t, 0, 0.45, z1, z1 + t);
  b.box(rim, x0 - t, x0, 0, 0.45, z0, z1);
  b.box(rim, x1, x1 + t, 0, 0.45, z0, z1);
  b.floor('poolTile', x0, x1, z0, z1, 0.02, { uvScale: 0.8 });
  b.floor('poolWater', x0, x1, z0, z1, 0.38, { cast: false, receive: false, uvScale: 0.12 });
  collision.add(x0 - t, x1 + t, z0 - t, z1 + t);
}

/** Şezlong: uzun minder + yükseltilmiş sırtlık; `dir` sırtlığın yönü (+1: kuzey, −1: güney) */
function addLounger(b, x, z, dir = -1, cushion = 'luxCream') {
  b.box('white', x - 0.36, x + 0.36, 0.08, 0.28, z - 0.95, z + 0.95);
  b.box(cushion, x - 0.33, x + 0.33, 0.28, 0.36, z - 0.92, z + 0.92, NO_CAST);
  const g = new THREE.BoxGeometry(0.66, 0.08, 0.75);
  b.add(cushion, g, { ...NO_CAST, position: [x, 0.55, z + dir * 0.72], rotation: [dir * 0.85, 0, 0] });
}

function addParasol(b, collision, x, z, mat) {
  b.add('white', new THREE.CylinderGeometry(0.035, 0.035, 2.4, 6), { position: [x, 1.2, z] });
  b.add(mat, new THREE.ConeGeometry(1.35, 0.5, 10, 1, true), { ...NO_CAST, position: [x, 2.45, z] });
  b.add('white', new THREE.CylinderGeometry(0.2, 0.25, 0.08, 8), { position: [x, 0.04, z] });
  collision.addAround(x, z, 0.12);
}

/**
 * Çatı terası + Aqua Park (ROOF: x −18..18, z 280..330): asansör kulübesi, ana havuz (batı),
 * kaydıraklı çocuk havuzu (doğu), şezlonglar + şemsiyeler, taze meyve suyu & atıştırmalık büfesi,
 * cam korkuluk, VIP bölümü (z > 314: sonsuzluk havuzu, cabanalı şezlonglar — VIP misafirlerin yeri),
 * şehir silueti fonu. Statik NPC misafirler; yüzücüler (döndürülen dizi) yalnızca oyuncu çatıdayken salınır.
 * @returns {{ swimmers: THREE.Object3D[] }}
 */
export function buildRoof({ allMats, collision, factory, parent }) {
  const b = new StaticBatcher();
  const R = ROOF.bounds;
  b.floor('deck', R.minX, R.maxX, R.minZ, R.maxZ, 0, { uvScale: 0.45 });
  b.floor('luxMarble', -2, 2, 282.4, 314, 0.004, { ...NO_CAST, uvScale: 0.5 }); // orta yürüyüş yolu

  // Asansör kulübesi (kapı kuzeye bakar)
  const E = ROOF.elevator;
  b.box('white', -1.9, 1.9, 0, 3.0, R.minZ - 0.1, E.z, {});
  b.box('gold', -2.0, 2.0, 3.0, 3.12, R.minZ - 0.15, E.z + 0.1, NO_CAST);
  collision.add(-1.9, 1.9, R.minZ - 0.5, E.z);
  addElevatorDoor(b, parent, { x: E.x, z: E.z - 0.1, facing: 'z+', label: 'ÇATI ▼', factory });
  const parkSign = new THREE.MeshBasicMaterial({
    map: factory.make(goldLettering('ROOFTOP AQUA PARK', { bg: '#0f3b4f', color: '#7fe3ff' }), { w: 2, h: 0.3, repeat: false }),
    transparent: false,
  });
  parent.add(makePanel(parkSign, 3.6, 0.55, 0, 3.45, E.z + 0.02, 'z+'));
  b.box('white', -1.85, 1.85, 3.12, 3.75, E.z - 0.08, E.z, NO_CAST);

  // Cam korkuluk (çevre) + çarpışma
  const railH = 1.1;
  const rail = (x0, x1, z0, z1) => {
    b.box('glassRail', x0, x1, 0.05, railH, z0, z1, { cast: false, receive: false });
    b.box('gold', Math.min(x0, x1) - 0.02, Math.max(x0, x1) + 0.02, railH, railH + 0.05, z0 - 0.02, z1 + 0.02, NO_CAST);
  };
  rail(R.minX + 0.05, R.minX + 0.1, R.minZ, R.maxZ);
  rail(R.maxX - 0.1, R.maxX - 0.05, R.minZ, R.maxZ);
  rail(R.minX, R.maxX, R.maxZ - 0.1, R.maxZ - 0.05);
  rail(R.minX, -1.9, R.minZ + 0.05, R.minZ + 0.1);
  rail(1.9, R.maxX, R.minZ + 0.05, R.minZ + 0.1);
  collision.add(R.minX - 1, R.minX + 0.12, R.minZ - 1, R.maxZ + 1);
  collision.add(R.maxX - 0.12, R.maxX + 1, R.minZ - 1, R.maxZ + 1);
  collision.add(R.minX - 1, R.maxX + 1, R.maxZ - 0.12, R.maxZ + 1);
  collision.add(R.minX - 1, R.maxX + 1, R.minZ - 1, R.minZ + 0.12);

  // VIP bölümü korkuluğu (z = 314), ortada altın kemerli geçit
  const G = ROOF.vipGate;
  rail(R.minX, G.from, G.z - 0.03, G.z + 0.03);
  rail(G.to, R.maxX, G.z - 0.03, G.z + 0.03);
  collision.add(R.minX, G.from, G.z - 0.08, G.z + 0.08);
  collision.add(G.to, R.maxX, G.z - 0.08, G.z + 0.08);
  for (const x of [G.from - 0.08, G.to + 0.08]) {
    b.add('gold', new THREE.CylinderGeometry(0.07, 0.07, 2.6, 8), { position: [x, 1.3, G.z] });
    collision.addAround(x, G.z, 0.1);
  }
  b.box('gold', G.from - 0.15, G.to + 0.15, 2.6, 2.72, G.z - 0.06, G.z + 0.06, NO_CAST);
  const vipSign = new THREE.MeshBasicMaterial({
    map: factory.make(signDrawer({ title: '★ VIP ★', sub: 'Yalnızca VIP misafirler', bg: '#15151b', fg: '#f2c75c', border: '#c9a25e' }), { w: 1, h: 0.4, repeat: false }),
  });
  parent.add(makePanel(vipSign, 1.5, 0.5, 0, 3.05, G.z - 0.07, 'z-'));
  parent.add(makePanel(vipSign, 1.5, 0.5, 0, 3.05, G.z + 0.07, 'z+'));

  // Ana havuz (batı) + merdiven
  addPool(b, collision, -16, -4.5, 292, 306);
  for (const z of [298.6, 299.4]) {
    b.add('gold', new THREE.TorusGeometry(0.3, 0.025, 4, 10, Math.PI), { ...NO_CAST, position: [-4.5, 0.5, z], rotation: [0, Math.PI / 2, 0] });
  }
  // Çocuk havuzu + kaydırak kulesi (doğu)
  addPool(b, collision, 4, 13, 296, 304);
  b.box('white', 13.2, 16.6, 3.8, 4.0, 305.4, 309.4);
  for (const [x, z] of [[13.3, 305.5], [16.5, 305.5], [13.3, 309.3], [16.5, 309.3]]) {
    b.add('metal', new THREE.CylinderGeometry(0.09, 0.09, 3.8, 6), { position: [x, 1.9, z] });
  }
  b.box('slideC', 13.2, 16.6, 4.0, 4.9, 309.3, 309.4, NO_CAST);
  for (let i = 0; i < 8; i++) b.box('white', 16.7, 17.5, i * 0.5, i * 0.5 + 0.06, 305.5 + i * 0.45, 306.2 + i * 0.45); // merdiven
  collision.add(13.2, 17.6, 305.4, 309.4);
  addSlide(b, 'slideA', [[14.0, 4.1, 305.6], [12.8, 3.4, 303.8], [14.6, 2.6, 302.0], [12.6, 1.6, 300.6], [10.6, 0.7, 300.2]]);
  addSlide(b, 'slideB', [[15.9, 4.1, 305.6], [16.3, 3.0, 302.6], [15.4, 1.9, 299.0], [13.8, 1.0, 297.2], [11.8, 0.6, 297.4]]);

  // Şezlonglar + şemsiyeler
  const fabrics = ['fabricRed', 'fabricBlue', 'fabricOrange'];
  [-16.4, -14.4, -12.4, -10.4, -8.4, -6.4].forEach((x) => addLounger(b, x, 285.6, -1));
  [-15.4, -11.4, -7.4].forEach((x, i) => addParasol(b, collision, x, 287.3, fabrics[i % 3]));
  [4.6, 6.6, 8.6, 10.6].forEach((x) => addLounger(b, x, 309.6, 1));
  [5.6, 9.6].forEach((x, i) => addParasol(b, collision, x, 311.4, fabrics[(i + 1) % 3]));
  [-15, -13, -9].forEach((x) => addLounger(b, x, 309.2, 1));
  addParasol(b, collision, -11, 310.6, 'fabricBlue');
  collision.add(-16.8, -6, 284.6, 286.6);
  collision.add(3.9, 11.3, 308.6, 310.6);
  collision.add(-15.5, -8.5, 308.2, 310.2);

  // Taze meyve suyu & atıştırmalık büfesi (güneydoğu; alkolsüz)
  b.box('paintGreen', 11.6, 17.6, 0, 2.6, 281.0, 281.3);
  b.box('wood', 11.8, 17.4, 0, 1.0, 285.1, 285.7);
  b.box('luxMarble', 11.7, 17.5, 1.0, 1.06, 285.0, 285.8);
  b.box('wood', 11.6, 11.9, 0, 1.0, 281.3, 285.1);
  for (let i = 0; i < 6; i++) b.box(i % 2 ? 'white' : 'fabricOrange', 11.6 + i, 12.6 + i, 2.6, 2.7, 281.0, 286.3, NO_CAST);
  for (const x of [11.7, 17.5]) b.add('white', new THREE.CylinderGeometry(0.05, 0.05, 2.6, 6), { position: [x, 1.3, 286.2] });
  collision.add(11.6, 17.6, 281.0, 285.8);
  ['bottleOrange', 'bottleYellow', 'bottleRed', 'bottleGreen'].forEach((m, i) => {
    b.add(m, new THREE.SphereGeometry(0.07, 8, 6), { ...NO_CAST, position: [12.4 + i * 0.18, 1.13, 285.4] });
    b.add(m, new THREE.SphereGeometry(0.07, 8, 6), { ...NO_CAST, position: [12.49 + i * 0.18, 1.13, 285.55] });
    b.add(m, new THREE.CylinderGeometry(0.1, 0.1, 0.3, 10), { ...NO_CAST, position: [15.2 + i * 0.4, 1.21, 285.4] });
  });
  const kioskMenu = new THREE.MeshBasicMaterial({
    map: factory.make(menuBoard('Taze Sap & Snack', ['Taze sıkma portakal · €4', 'Mango smoothie · €5', 'Meyve tabağı · €6']), { w: 1.4, h: 0.5, repeat: false }),
  });
  parent.add(makePanel(kioskMenu, 2.2, 0.8, 14.6, 1.9, 281.32, 'z+'));

  // Saksılar ve teras lambaları
  for (const [x, z, s] of [[-2.6, 288, 0], [2.6, 288, 1], [-2.6, 300, 2], [2.6, 300, 0], [-2.6, 312, 1], [2.6, 312, 2], [17.2, 290, 1], [-17.2, 290, 2]]) addPlanter(b, collision, x, z, s);

  // ---- VIP bölümü: sonsuzluk havuzu + cabanalar ----
  addPool(b, collision, -16, -3.5, 318.5, 327.5, { rim: 'gold' });
  ROOF.vipSpots.forEach((sp, i) => {
    const [x, z] = sp.seat;
    addLounger(b, x, z + 0.15, 1, 'luxVelvetRed');
    if (i % 2 === 0) {
      const cx = x + 1.7;
      for (const px of [cx - 2.4, cx + 2.4]) {
        for (const pz of [z - 1.3, z + 1.6]) b.add('gold', new THREE.CylinderGeometry(0.05, 0.05, 2.6, 6), { position: [px, 1.3, pz] });
      }
      // Tente + yalnızca arkada (kuzey) perde: güneyden (geçitten) şezlonglar ve VIP misafirler görünür
      b.box('luxCream', cx - 2.5, cx + 2.5, 2.6, 2.7, z - 1.4, z + 1.7, NO_CAST);
      b.box('luxCream', cx - 2.4, cx + 2.4, 0.3, 2.6, z + 1.58, z + 1.62, NO_CAST);
      b.box('luxVelvetRed', cx - 2.5, cx + 2.5, 2.3, 2.6, z - 1.42, z - 1.38, NO_CAST);
    }
    collision.add(x - 0.4, x + 0.4, z - 0.6, z + 1.1);
  });

  // Şehir silueti fonu (çatının çevresinde; gece kararır — HotelArchitectureUpgrades.setNight)
  const sky = (w, h, x, y, z, rotY, uOff) => {
    const g = new THREE.PlaneGeometry(w, h);
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setX(i, uOff + uv.getX(i) * (w / (h * 2)));
    b.add('roofSkyline', g, { position: [x, y, z], rotation: [0, rotY, 0], cast: false, receive: false });
  };
  // Fon çatı kenarının hemen ötesinde: kanal evlerinin çatıları göz hizasının biraz altında kalır
  sky(80, 12, 0, 1.6, 268, 0, 0.1);
  sky(80, 12, 0, 1.6, 342, Math.PI, 0.5);
  sky(80, 12, -28, 1.6, 305, Math.PI / 2, 0.3);
  sky(80, 12, 28, 1.6, 305, -Math.PI / 2, 0.7);
  b.floor('roofGround', -60, 60, 250, 360, -4.5, { cast: false, receive: false });

  // ---- NPC misafirler ----
  // Şezlonglarda uzananlar (baş güneyde), büfede biri, havuz kenarında oturan biri
  addNpc(parent, look(1), { x: -14.4, z: 286.3, y: 0.42, rot: 0, lie: 1.25 });
  addNpc(parent, look(2), { x: -10.4, z: 286.3, y: 0.42, rot: 0, lie: 1.25 });
  addNpc(parent, look(3), { x: 6.6, z: 308.9, y: 0.42, rot: Math.PI, lie: 1.25 });
  addNpc(parent, look(4), { x: 13.6, z: 286.6, rot: Math.PI });
  addNpc(parent, { skin: 3, hair: 1 }, { x: 14.6, z: 283.6, rot: 0, opts: { color: '#2b8a8a', staff: true } });
  addNpc(parent, look(6), { x: -9.5, z: 291.5, y: 0.05, rot: 0 });
  // Yüzücüler: yalnızca baş ve omuzlar sudan çıkar; sistem çatıdayken hafifçe salınır
  const swimmers = [[-12, 298], [-7.5, 302.5], [8, 300]].map(([x, z], i) => addNpc(parent, look(7 + i), {
    x, z, y: -0.85, rot: i * 2.1, dynamic: true,
  }));
  b.build(allMats, parent);
  return { swimmers };
}

// ---- Cephe: 8 katlı lüks bina / 12 katlı gökdelen -------------------------------------------------

const STOREY = 2.7;
const BASE_TOP = 8.6; // mevcut cephenin (3 kat) üst kenarı

/**
 * Sokak cephesi büyümesi. Mevcut cephe (zemin + 2 kat, kademeli çatı) batcher'da sabit; lüks paketle
 * üstüne (ve arkasına) bir kule eklenir. Ön yüz z = −0.12'de: eski kademeli çatıyı örter.
 * @returns {{ tower8, crown8, tower12 }} üç grup (görünürlüğü seviye belirler)
 */
export function buildFacade({ allMats, factory }) {
  const top8 = BASE_TOP + 5 * STOREY; // 22.1
  const top12 = top8 + 4 * STOREY; // 32.9

  // --- 8 katlı gövde (4.–8. kat) + tente + altın yazı ---
  const tower8 = new THREE.Group();
  let b = new StaticBatcher();
  b.box('brick', -8.1, 8.1, 3.35, BASE_TOP, 0.12, 26, { ...NO_CAST, uvScale: UV.brick }); // eski cephenin arkası
  b.box('brick', -8.1, 8.1, BASE_TOP, top8, -0.12, 26, { ...NO_CAST, uvScale: UV.brick });
  for (let k = 0; k < 5; k++) {
    const y0 = BASE_TOP + k * STOREY;
    b.box('white', -8.2, 8.2, y0, y0 + 0.12, -0.22, -0.12, NO_CAST);
    [-6, -3, 0, 3, 6].forEach((x, i) => addWindow(b, {
      x, y: y0 + 1.4, z: -0.12, w: 1.1, h: 1.5, facing: 'z-', glass: (i + k * 2) % 3 === 0 ? 'archWinB' : 'archWinA',
    }));
    // Yan cepheler (sokaktan çapraz görünür)
    for (const z of [4, 12, 20]) {
      addWindow(b, { x: -8.1, y: y0 + 1.4, z, w: 1.1, h: 1.5, facing: 'x-', glass: (z + k) % 3 === 0 ? 'archWinB' : 'archWinA' });
      addWindow(b, { x: 8.1, y: y0 + 1.4, z, w: 1.1, h: 1.5, facing: 'x+', glass: (z + k + 1) % 3 === 0 ? 'archWinB' : 'archWinA' });
    }
  }
  // Giriş tentesi (pirinç direkli) + altta spotlar
  b.box('luxAwning', -1.9, 1.9, 2.86, 2.98, -2.45, -0.12, NO_CAST);
  b.floor('luxCream', -1.88, 1.88, -2.43, -0.14, 2.855, { facingDown: true, cast: false, receive: false });
  b.box('luxAwning', -1.92, 1.92, 2.58, 2.98, -2.49, -2.43, NO_CAST); // ön saçak (altın yazının zemini)
  b.box('gold', -1.94, 1.94, 2.55, 2.59, -2.51, -2.41, NO_CAST);
  b.box('gold', -1.94, 1.94, 2.97, 3.01, -2.51, -2.41, NO_CAST);
  for (const x of [-1.75, 1.75]) b.add('gold', new THREE.CylinderGeometry(0.04, 0.05, 2.86, 8), { position: [x, 1.43, -2.3] });
  for (const x of [-1, 0, 1]) b.add('lamp', new THREE.CircleGeometry(0.09, 10), { ...NO_CAST, receive: false, position: [x, 2.855, -1.3], rotation: [Math.PI / 2, 0, 0] });
  b.box('rugRed', -1.2, 1.2, 0.05, 0.06, -2.3, -0.12, NO_CAST);
  b.build(allMats, tower8);
  const letters = new THREE.MeshBasicMaterial({
    map: factory.make(goldLettering('HOTEL AMSTERDAM ★'), { w: 2, h: 0.24, repeat: false }), transparent: true, depthWrite: false,
  });
  tower8.add(makePanel(letters, 3.7, 0.36, 0, 2.78, -2.495, 'z-'));
  const bigLetters = new THREE.MeshBasicMaterial({
    map: factory.make(goldLettering('HOTEL AMSTERDAM'), { w: 2, h: 0.24, repeat: false }), transparent: true, depthWrite: false,
  });
  tower8.add(makePanel(bigLetters, 6.2, 0.52, 0, top8 - 0.27, -0.24, 'z-'));

  // --- 8 katlı binanın tacı: korniş + kademeli çatı (yalnızca 1. seviye) ---
  const crown8 = new THREE.Group();
  b = new StaticBatcher();
  b.box('white', -8.3, 8.3, top8, top8 + 0.3, -0.35, 26.2, NO_CAST);
  b.box('brick', -3.0, 3.0, top8 + 0.3, top8 + 1.2, -0.12, 0.2, { ...NO_CAST, uvScale: UV.brick });
  b.box('brick', -2.0, 2.0, top8 + 1.2, top8 + 2.1, -0.12, 0.2, { ...NO_CAST, uvScale: UV.brick });
  b.box('brick', -1.0, 1.0, top8 + 2.1, top8 + 2.9, -0.12, 0.2, { ...NO_CAST, uvScale: UV.brick });
  addWindow(b, { x: 0, y: top8 + 1.5, z: -0.12, w: 0.7, h: 0.7, facing: 'z-', glass: 'archWinA' });
  b.add('gold', new THREE.OctahedronGeometry(0.3), { ...NO_CAST, position: [0, top8 + 3.25, 0] });
  b.build(allMats, crown8);

  // --- 12 katlı gökdelen: cam giydirme (9.–12. kat), taç, anten, tabela ---
  const tower12 = new THREE.Group();
  b = new StaticBatcher();
  b.box('white', -8.3, 8.3, top8, top8 + 0.25, -0.35, 26.2, NO_CAST);
  b.box('curtain', -7.8, 7.8, top8 + 0.25, top12, 0.2, 25.8, { ...NO_CAST, uvScale: 1 / STOREY });
  for (let k = 1; k <= 4; k++) b.box('white', -7.85, 7.85, top8 + k * STOREY - 0.06, top8 + k * STOREY + 0.04, 0.15, 25.85, NO_CAST);
  for (const x of [-7.82, -3.9, 0, 3.9, 7.82]) b.box('white', x - 0.05, x + 0.05, top8 + 0.25, top12, 0.15, 0.2, NO_CAST);
  // Taç: geri çekilmiş cam kat + ışıklı bant + kanatçıklar
  b.box('curtain', -5, 5, top12, top12 + 2.7, 3, 23, { ...NO_CAST, uvScale: 1 / STOREY });
  b.box('white', -8.0, 8.0, top12, top12 + 0.2, 0.0, 26.0, NO_CAST);
  b.box('lamp', -5.05, 5.05, top12 + 2.7, top12 + 2.9, 2.95, 23.05, { cast: false, receive: false });
  for (let i = 0; i < 7; i++) {
    const x = -4.5 + i * 1.5;
    const h = 3.6 + (3 - Math.abs(3 - i)) * 0.9;
    b.box('white', x - 0.08, x + 0.08, top12 + 0.2, top12 + h, 2.8, 2.95, NO_CAST);
  }
  b.add('metal', new THREE.CylinderGeometry(0.08, 0.16, 9, 6), { ...NO_CAST, position: [0, top12 + 2.9 + 4.5, 13] });
  b.add('beacon', new THREE.SphereGeometry(0.22, 8, 6), { ...NO_CAST, receive: false, position: [0, top12 + 2.9 + 9.1, 13] });
  b.build(allMats, tower12);
  const skySign = new THREE.MeshBasicMaterial({
    map: factory.make(goldLettering('HOTEL AMSTERDAM ★', { bg: '#0d1626' }), { w: 2, h: 0.24, repeat: false }),
  });
  tower12.add(makePanel(skySign, 9.2, 1.15, 0, top12 + 1.35, 2.98, 'z-'));
  return { tower8, crown8, tower12, top8, top12 };
}
