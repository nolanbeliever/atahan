import * as THREE from 'three';
import { WALL_H, ROOMS, RECEPTION, SOFA, buildWallSegments } from '/shared/layout.js';
import { StaticBatcher } from './StaticBatcher.js';
import { UV } from './Materials.js';
import { signDrawer } from './Textures.js';
import { RoomView } from './RoomView.js';
import { buildCoffeeShop } from './CoffeeShopBuilding.js';
import {
  addPlanter, addBike, addTree, addBollard, addStreetLamp, addWindow, addPainting,
  addArmchair, addSideTable, makePanel,
} from './Props.js';
import { makeCharacter } from '../game/Characters.js';

const BLANKET_COLORS = { 101: 'fabricBlue', 102: 'fabricRed', 103: 'fabricGreen', 104: 'fabricOrange' };
const ENTRANCE_OPEN = Math.PI / 2 * 0.9;

/**
 * Otelin tamamını kurar: lobi, koridor, 4 oda, Amsterdam sokağı ve kanal.
 * Statik her şey StaticBatcher ile malzeme başına tek mesh'e birleştirilir.
 */
export function buildHotel({ engine, mats, tex, factory, collision, quality }) {
  const scene = engine.scene;
  scene.background = new THREE.Color(0x9cc6e6);
  const b = new StaticBatcher();

  buildShell(b, collision);
  buildExterior(b, collision, scene, mats);
  const clerk = buildLobby(b, collision, scene, mats);
  buildCorridor(b, collision);

  const rooms = ROOMS.map((layout) => new RoomView({
    layout,
    batcher: b,
    scene,
    mats,
    collision,
    blanketMat: mats[BLANKET_COLORS[layout.id]],
    plateMat: new THREE.MeshLambertMaterial({
      map: factory.make(signDrawer({ title: layout.id, sub: 'Oda · Kamer', bg: '#b08d57', fg: '#2a1d0e', border: '#6b5330' }), { w: 1, h: 0.45, repeat: false }),
    }),
  }));

  const entrance = buildEntrance(scene, mats);
  const coffeeShop = buildCoffeeShop({ batcher: b, collision, scene, mats, factory });

  b.build(mats, scene);
  addLights(scene, quality);

  let weekend = false;

  return {
    rooms,
    roomById: new Map(rooms.map((r) => [r.id, r])),
    clerk,
    coffeeShop,

    setWeekend(on) {
      if (weekend === on) return;
      weekend = on;
      mats.signOpen.map = on ? tex.signClosed : tex.signOpen;
      engine.requestRender();
    },

    applyRooms(states) {
      for (const st of states) this.roomById.get(st.id)?.applyState(st);
      engine.requestRender();
    },

    /** @returns {boolean} animasyon sürüyor mu */
    update(dt, ctx) {
      let active = false;
      for (const r of rooms) if (r.update(dt, ctx)) active = true;

      // Giriş kapısı: hafta içi açık; hafta sonu kapalı, personel/misafir yaklaşınca açılır
      const near = Math.hypot(ctx.px, ctx.pz) < 2.6 || ctx.guestNear(0, 0, 3.0);
      const target = !weekend || near ? 1 : 0;
      if (entrance.t !== target) {
        const step = dt * 2.6;
        entrance.t = Math.abs(target - entrance.t) <= step ? target : entrance.t + Math.sign(target - entrance.t) * step;
        entrance.left.rotation.y = -ENTRANCE_OPEN * entrance.t;
        entrance.right.rotation.y = ENTRANCE_OPEN * entrance.t;
        active = true;
      }
      return active;
    },
  };
}

// ---------------------------------------------------------------------------

function buildShell(b, collision) {
  // Zeminler
  b.floor('floorLobby', -8, 8, -0.1, 12, 0, { uvScale: UV.floorLobby });
  b.floor('floorCorridor', -1.5, 1.5, 12, 26, 0, { uvScale: UV.floorCorridor });
  for (const r of ROOMS) {
    const bd = r.bounds;
    b.floor('floorRoom', bd.minX, bd.maxX, bd.minZ, bd.maxZ, 0, { uvScale: UV.floorRoom });
  }
  // Tavanlar (gölge atmaz → güneş ışığı içeri girer, stilize görünüm)
  const ceil = { facingDown: true, cast: false, receive: false };
  b.floor('ceiling', -8, 8, 0, 12, WALL_H, ceil);
  b.floor('ceiling', -1.5, 1.5, 12, 26, WALL_H, ceil);
  for (const r of ROOMS) {
    const bd = r.bounds;
    b.floor('ceiling', bd.minX, bd.maxX, bd.minZ, bd.maxZ, WALL_H, ceil);
  }
  // Duvarlar
  for (const s of buildWallSegments()) {
    b.box(s.mat, s.minX, s.maxX, s.minY, s.maxY, s.minZ, s.maxZ, { uvScale: UV[s.mat] });
    if (!s.lintel) collision.add(s.minX, s.maxX, s.minZ, s.maxZ);
  }
  // Lobi lambri (alt ahşap kaplama)
  const wh = 0.85;
  const lam = { uvScale: UV.wainscot, cast: false };
  b.box('wainscot', -7.9, -7.87, 0, wh, 0.1, 11.9, lam);
  b.box('wainscot', 7.87, 7.9, 0, wh, 0.1, 11.9, lam);
  b.box('wainscot', -7.9, -1.6, 0, wh, 11.87, 11.9, lam);
  b.box('wainscot', 1.6, 7.9, 0, wh, 11.87, 11.9, lam);
  b.box('wainscot', -7.9, -1.32, 0, wh, 0.1, 0.13, lam);
  b.box('wainscot', 1.32, 7.9, 0, wh, 0.1, 0.13, lam);
}

function buildExterior(b, collision, scene, mats) {
  // Üst cephe ve kademeli (trapgevel) çatı
  const noCast = { cast: false, uvScale: UV.brick };
  b.box('brick', -8.1, 8.1, WALL_H, 8.6, -0.1, 0.1, noCast);
  b.box('brick', -3.0, 3.0, 8.6, 9.5, -0.1, 0.1, noCast);
  b.box('brick', -2.0, 2.0, 9.5, 10.4, -0.1, 0.1, noCast);
  b.box('brick', -1.0, 1.0, 10.4, 11.2, -0.1, 0.1, noCast);
  b.box('white', -8.2, 8.2, 3.2, 3.35, -0.22, -0.1, { cast: false });
  b.box('white', -8.2, 8.2, 8.5, 8.65, -0.2, -0.1, { cast: false });
  for (const y of [4.9, 7.1]) {
    for (const x of [-6, -3, 0, 3, 6]) addWindow(b, { x, y, z: -0.1, w: 1.1, h: 1.5, facing: 'z-' });
  }
  addWindow(b, { x: 0, y: 9.75, z: -0.1, w: 0.7, h: 0.7, facing: 'z-' });

  // Zemin kat pencereleri: dışta koyu cam, içte gün ışığı
  for (const x of [-5, 5]) {
    addWindow(b, { x, y: 1.75, z: -0.1, w: 2.2, h: 1.6, facing: 'z-' });
    addWindow(b, { x, y: 1.75, z: 0.1, w: 2.2, h: 1.6, facing: 'z+', glass: 'glassDay' });
  }

  // Giriş: beyaz kasa, taş basamak
  b.box('white', -1.36, -1.2, 0, 2.6, -0.2, -0.1, { cast: false });
  b.box('white', 1.2, 1.36, 0, 2.6, -0.2, -0.1, { cast: false });
  b.box('white', -1.36, 1.36, 2.6, 2.76, -0.2, -0.1, { cast: false });
  b.box('stone', -1.7, 1.7, 0, 0.05, -0.9, -0.1, { cast: false });

  // Tabelalar
  scene.add(makePanel(mats.signHotel, 3.4, 0.61, 0, 3.73, -0.125, 'z-'));
  scene.add(makePanel(mats.signOpen, 0.9, 0.36, 1.95, 1.55, -0.115, 'z-'));
  scene.add(makePanel(mats.signOpen, 0.9, 0.36, 2.2, 2.0, 0.14, 'z+'));

  // Sokak, rıhtım, kanal
  b.floor('cobble', -24, 24, -7.8, -0.1, 0, { uvScale: UV.cobble });
  b.box('stone', -30, 30, -0.7, 0.0, -8.0, -7.8, { cast: false });
  b.floor('water', -30, 30, -16, -8, -0.7, { cast: false, receive: false });

  // Komşu kanal evleri ve karşı kıyı (tek manzara malzemesi)
  const skyPlane = (w, h, x, y, z, rotY, uSpan, uOff = 0) => {
    const g = new THREE.PlaneGeometry(w, h);
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setX(i, uOff + uv.getX(i) * uSpan);
    b.add('skyline', g, { position: [x, y, z], rotation: [0, rotY, 0], cast: false, receive: false });
  };
  skyPlane(15.9, 12, -16.05, 6, -0.05, Math.PI, 15.9 / 24, 0.1);
  skyPlane(7.9, 12, 20.05, 6, -0.05, Math.PI, 7.9 / 24, 0.55); // coffee shop'un doğusu
  skyPlane(60, 13.7, 0, 6.15, -16, 0, 60 / 27.4, 0.3);
  skyPlane(16, 13.7, -24, 6.15, -8, Math.PI / 2, 16 / 27.4, 0.7);
  skyPlane(16, 13.7, 24, 6.15, -8, -Math.PI / 2, 16 / 27.4, 0.2);

  for (let x = -11.2; x <= 17.21; x += 1.6) addBollard(b, collision, x, -7.35);
  addBike(b, collision, 3.6, -0.75, 0, 'paintGreen');
  addBike(b, collision, 4.75, -0.75, Math.PI, 'black');
  addBike(b, collision, -4.4, -0.75, 0, 'fabricRed');
  addTree(b, collision, -9.6, -6.3);
  addTree(b, collision, 9.6, -6.3, 1.1);
  addTree(b, null, -18, -6.3, 0.9);
  addTree(b, null, 18, -6.3);
  addStreetLamp(b, collision, -6.5, -6.9);
  addStreetLamp(b, collision, 6.5, -6.9);
  addPlanter(b, collision, -1.95, -0.55, 2);

  // Sokak sınırları
  collision.add(-30, 30, -20, -7.7); // kanal
  collision.add(-30, -12, -20, 0.1);
  collision.add(18, 30, -20, 0.1);
  collision.add(-30, -8, -0.15, 0.1); // komşu cepheler
  collision.add(16, 30, -0.15, 0.1);
}

function buildLobby(b, collision, scene, mats) {
  // Resepsiyon masası
  const d = RECEPTION.desk;
  b.box('wood', d.minX, d.maxX, 0, 1.02, d.minZ, d.maxZ, { uvScale: UV.wood });
  b.box('white', d.minX - 0.05, d.maxX + 0.08, 1.02, 1.08, d.minZ - 0.05, d.maxZ + 0.05);
  b.box('fabricOrange', d.maxX, d.maxX + 0.015, 0.68, 0.8, d.minZ + 0.05, d.maxZ - 0.05, { cast: false });
  collision.add(d.minX - 0.05, d.maxX + 0.08, d.minZ - 0.05, d.maxZ + 0.05);
  // Monitör masanın kuzey ucunda: görevli ile misafirin arasına girmesin
  b.box('black', -6.98, -6.9, 1.08, 1.12, 7.9, 8.3, { cast: false });
  b.box('black', -6.96, -6.92, 1.12, 1.45, 7.75, 8.45);
  b.add('brass', new THREE.SphereGeometry(0.06, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2), { position: [-6.35, 1.08, 6.2], cast: false });
  b.box('wood', -7.9, -7.86, 1.45, 1.95, 8.3, 9.1, { uvScale: UV.wood, cast: false }); // anahtar panosu
  for (let i = 0; i < 4; i++) b.box('brass', -7.86, -7.83, 1.6, 1.68, 8.42 + i * 0.18, 8.47 + i * 0.18, { cast: false });
  scene.add(makePanel(mats.signReception, 2.4, 0.54, -7.885, 2.4, 7.0, 'x+'));

  // Resepsiyonist (statik NPC)
  const clerk = makeCharacter({ skin: 1, hair: 2 }, { color: '#203a5c', staff: true });
  clerk.position.set(RECEPTION.clerk[0], 0, RECEPTION.clerk[1]);
  clerk.rotation.y = Math.PI / 2;
  clerk.updateMatrixWorld(true);
  clerk.traverse((o) => { o.matrixAutoUpdate = false; });
  scene.add(clerk);
  collision.add(-7.8, -7.1, 6.65, 7.35);

  // Kanepe (bekleyen misafirler burada oturur)
  const S = SOFA;
  b.box('wood', S.minX + 0.05, S.maxX - 0.05, 0, 0.1, S.minZ + 0.05, S.maxZ - 0.05, { uvScale: UV.wood });
  b.box('fabricBlue', S.minX, S.maxX, 0.1, 0.45, S.minZ, S.maxZ);
  b.box('fabricBlue', S.maxX - 0.25, S.maxX, 0.45, 1.0, S.minZ, S.maxZ);
  b.box('fabricBlue', S.minX, S.maxX, 0.45, 0.68, S.minZ, S.minZ + 0.18);
  b.box('fabricBlue', S.minX, S.maxX, 0.45, 0.68, S.maxZ - 0.18, S.maxZ);
  b.box('fabricOrange', S.maxX - 0.4, S.maxX - 0.25, 0.5, 0.86, 4.55, 5.05, { cast: false });
  b.box('fabricOrange', S.maxX - 0.4, S.maxX - 0.25, 0.5, 0.86, 6.15, 6.65, { cast: false });
  collision.add(S.minX, S.maxX, S.minZ, S.maxZ);
  addSideTable(b, collision, 7.35, 3.0);
  addPlanter(b, collision, 7.35, 8.25, 1);
  addPainting(b, { x: 7.9, y: 2.05, z: 5.6, w: 1.7, h: 1.25, facing: 'x-' });

  // Bekleme köşesi (batı)
  addArmchair(b, collision, -7.15, 2.2, Math.PI / 2, 'fabricRed');
  addArmchair(b, collision, -7.15, 3.75, Math.PI / 2, 'fabricRed');
  addSideTable(b, collision, -7.25, 2.97, true);

  // Halı, paspas, saksılar
  b.floor('rugRed', -2.6, 2.6, 3.0, 8.4, 0.008, { cast: false });
  b.floor('rugBlue', -2.2, 2.2, 3.4, 8.0, 0.014, { cast: false });
  b.floor('black', -1.0, 1.0, 0.15, 0.95, 0.008, { cast: false });
  addPlanter(b, collision, -2.05, 0.65, 0);
  addPlanter(b, collision, 2.05, 0.65, 2);
  addPlanter(b, collision, -2.25, 11.4, 1);
  addPlanter(b, collision, 2.25, 11.4, 0);

  // Avize + tavan spotları
  const noCast = { cast: false, receive: false };
  b.add('brass', new THREE.CylinderGeometry(0.015, 0.015, 0.5, 4), { ...noCast, position: [0, 2.95, 5.7] });
  b.add('brass', new THREE.TorusGeometry(0.45, 0.025, 4, 18), { ...noCast, position: [0, 2.7, 5.7], rotation: [Math.PI / 2, 0, 0] });
  b.add('brass', new THREE.SphereGeometry(0.1, 8, 6), { ...noCast, position: [0, 2.7, 5.7] });
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    b.add('lamp', new THREE.SphereGeometry(0.075, 8, 6), { ...noCast, position: [Math.cos(a) * 0.45, 2.79, 5.7 + Math.sin(a) * 0.45] });
  }
  for (const [x, z] of [[-4.5, 3], [4.5, 3], [-4.5, 9.5], [4.5, 9.5]]) {
    b.add('lamp', new THREE.CylinderGeometry(0.17, 0.17, 0.02, 12), { ...noCast, position: [x, WALL_H - 0.012, z] });
  }
  return clerk;
}

function buildCorridor(b, collision) {
  for (const z of [13.8, 17.4, 21, 24.6]) {
    b.box('lamp', -0.25, 0.25, WALL_H - 0.03, WALL_H - 0.005, z - 0.25, z + 0.25, { cast: false, receive: false });
  }
  addWindow(b, { x: 0, y: 1.7, z: 25.9, w: 1.4, h: 1.4, facing: 'z-', glass: 'skyline', uOffset: 0.4 });
  addPainting(b, { x: -1.4, y: 1.7, z: 19, w: 1.1, h: 0.8, facing: 'x+' });
  b.box('wood', 1.36, 1.4, 1.22, 2.18, 18.4, 19.6, { cast: false });
  addWindow(b, { x: 1.36, y: 1.7, z: 19, w: 1.0, h: 0.8, facing: 'x-', glass: 'skyline', uOffset: 0.8 });
  addPlanter(b, collision, 1.0, 25.45, 2);
  addPlanter(b, collision, -1.0, 25.45, 1);
}

function buildEntrance(scene, mats) {
  // Çift kanatlı yeşil Amsterdam kapısı (dinamik)
  const leafGeo = new THREE.BoxGeometry(1.18, 2.55, 0.06);
  const glassGeo = new THREE.PlaneGeometry(0.7, 0.9);
  const makeLeaf = (pivotX, dir) => {
    const pivot = new THREE.Group();
    pivot.position.set(pivotX, 0, 0);
    const leaf = new THREE.Mesh(leafGeo, mats.paintGreen);
    leaf.position.set(dir * 0.6, 1.275, 0);
    const glassOut = new THREE.Mesh(glassGeo, mats.glassDay);
    glassOut.position.set(dir * 0.6, 1.75, -0.032);
    glassOut.rotation.y = Math.PI;
    const glassIn = new THREE.Mesh(glassGeo, mats.glassDay);
    glassIn.position.set(dir * 0.6, 1.75, 0.032);
    const knob = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.16), mats.brass);
    knob.position.set(dir * 1.05, 1.05, 0);
    pivot.add(leaf, glassOut, glassIn, knob);
    scene.add(pivot);
    return pivot;
  };
  const left = makeLeaf(-1.2, 1);
  const right = makeLeaf(1.2, -1);
  left.rotation.y = -ENTRANCE_OPEN;
  right.rotation.y = ENTRANCE_OPEN;
  return { left, right, t: 1 };
}

function addLights(scene, quality) {
  scene.add(new THREE.HemisphereLight(0xfff4e2, 0x6e5a46, 2.1));
  const sun = new THREE.DirectionalLight(0xfff0d8, 1.5);
  sun.position.set(4, 20, 8);
  sun.target.position.set(0, 0, 13);
  scene.add(sun, sun.target);
  if (quality.shadowSize > 0) {
    sun.castShadow = true;
    sun.shadow.mapSize.set(quality.shadowSize, quality.shadowSize);
    const c = sun.shadow.camera;
    c.left = -16;
    c.right = 16;
    c.top = 19;
    c.bottom = -19;
    c.near = 1;
    c.far = 45;
    c.updateProjectionMatrix();
    sun.shadow.bias = -0.0006;
    sun.shadow.normalBias = 0.03;
  }
}
