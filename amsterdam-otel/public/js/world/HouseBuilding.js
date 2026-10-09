import * as THREE from 'three';
import { WALL_H, HOUSE } from '/shared/layout.js';
import { UV } from './Materials.js';
import { drawPlanks, signDrawer } from './Textures.js';
import { addWindow, makePanel } from './Props.js';

// "Bizim Ev": otelin batısında, sokağa açılan kanal evi. İç mekân boş gelir,
// oyuncular dekore eder. Ev kabuğu malzemeleri otelinkinden ayrıdır, böylece
// "ışıkları kapat" yalnızca evi karartır.

export function buildHouse({ batcher: b, scene, mats, factory }) {
  const H = HOUSE;
  Object.assign(mats, {
    houseWall: new THREE.MeshLambertMaterial({ color: 0xece6dc }),
    houseFloor: new THREE.MeshLambertMaterial({
      map: factory.make((ctx, w, h, rnd) => drawPlanks(ctx, w, h, rnd, '#c9a074'), { seed: 41 }),
    }),
    houseCeiling: new THREE.MeshBasicMaterial({ color: 0xe9e3d8 }),
    houseDoor: new THREE.MeshLambertMaterial({ color: 0x8f2420 }),
  });
  const signMat = new THREE.MeshLambertMaterial({
    map: factory.make(signDrawer({ title: 'HUIS 7', sub: 'Bizim Ev', bg: '#1f3b5a', fg: '#f6e7c1' }), { w: 1, h: 0.5, repeat: false }),
  });

  // ---- İç kabuk ----------------------------------------------------------
  b.floor('houseFloor', H.bounds.minX, H.bounds.maxX, -0.1, H.bounds.maxZ, 0, { uvScale: UV.floorRoom });
  b.floor('houseCeiling', H.bounds.minX, H.bounds.maxX, 0, H.bounds.maxZ, WALL_H, { facingDown: true, cast: false, receive: false });
  const lining = { cast: false };
  // Doğu (otelin batı duvarı) ve ön duvarın iç yüzleri — kapı boşluğu açık kalır
  b.box('houseWall', -8.14, -8.1, 0, WALL_H, 0.1, 7.9, lining);
  b.box('houseWall', -15.9, H.door.from, 0, WALL_H, 0.1, 0.13, lining);
  b.box('houseWall', H.door.to, -8.14, 0, WALL_H, 0.1, 0.13, lining);
  b.box('houseWall', H.door.from, H.door.to, 2.5, WALL_H, 0.1, 0.13, lining);
  // Süpürgelik
  b.box('wood', -15.9, -8.14, 0, 0.1, 7.86, 7.9, { cast: false, uvScale: UV.wood });
  b.box('wood', -15.9, -15.86, 0, 0.1, 0.13, 7.86, { cast: false, uvScale: UV.wood });

  // Pencereler (ön cephe): dışta koyu cam, içte gün ışığı
  for (const x of [-14.2, -9.8]) {
    addWindow(b, { x, y: 1.65, z: -0.1, w: 2.0, h: 1.5, facing: 'z-' });
    addWindow(b, { x, y: 1.65, z: 0.13, w: 2.0, h: 1.5, facing: 'z+', glass: 'glassDay' });
  }

  // ---- Dış cephe (kanal evi) ------------------------------------------------
  const noCast = { cast: false, uvScale: UV.brick };
  b.box('brick', -16.1, -8.1, WALL_H, 8.0, -0.1, 0.1, noCast);
  b.box('brick', -13.6, -10.6, 8.0, 9.0, -0.1, 0.1, noCast); // boyunlu çatı
  b.box('white', -13.75, -10.45, 8.95, 9.1, -0.2, -0.1, { cast: false });
  b.box('white', -16.2, -8.1, WALL_H, WALL_H + 0.14, -0.22, -0.1, { cast: false });
  for (const y of [4.5, 6.4]) {
    for (const x of [-14.2, -12.0, -9.8]) addWindow(b, { x, y, z: -0.1, w: 1.0, h: 1.3, facing: 'z-' });
  }
  addWindow(b, { x: -12.1, y: 8.45, z: -0.1, w: 0.6, h: 0.7, facing: 'z-' });
  // Kapı kasası, basamak, tabela
  b.box('white', H.door.from - 0.14, H.door.from, 0, 2.5, -0.2, -0.1, { cast: false });
  b.box('white', H.door.to, H.door.to + 0.14, 0, 2.5, -0.2, -0.1, { cast: false });
  b.box('white', H.door.from - 0.14, H.door.to + 0.14, 2.5, 2.64, -0.2, -0.1, { cast: false });
  b.box('stone', H.door.from - 0.3, H.door.to + 0.3, 0, 0.05, -0.8, -0.1, { cast: false });
  scene.add(makePanel(signMat, 0.6, 0.3, H.door.to + 0.55, 1.75, -0.115, 'z-'));

  // ---- Işık anahtarı (kapının yanında, iç yüz) ---------------------------------
  const [sx] = H.lightSwitch;
  b.box('white', sx - 0.05, sx + 0.05, 1.22, 1.38, 0.13, 0.15, { cast: false });
  b.box('black', sx - 0.015, sx + 0.015, 1.27, 1.33, 0.15, 0.165, { cast: false });

  // ---- Kapı (dinamik, yaklaşınca açılır) -------------------------------------
  const width = H.door.to - H.door.from;
  const pivot = new THREE.Group();
  pivot.position.set(H.door.from, 0, 0);
  const leaf = new THREE.Mesh(new THREE.BoxGeometry(width - 0.02, 2.48, 0.06), mats.houseDoor);
  leaf.position.set(width / 2, 1.24, 0);
  const knob = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.16), mats.brass);
  knob.position.set(width - 0.15, 1.05, 0);
  const pane = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.7), mats.glassDay);
  pane.position.set(width / 2, 1.85, -0.032);
  pane.rotation.y = Math.PI;
  pivot.add(leaf, knob, pane);
  scene.add(pivot);

  return {
    door: { pivot, t: 0 },
    shell: [mats.houseWall, mats.houseFloor, mats.houseCeiling],
  };
}
