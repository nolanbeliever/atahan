import * as THREE from 'three';
import { WALL_H, FLOOR_DZ, LANDING, ELEVATOR } from '/shared/layout.js';
import { UV } from './Materials.js';
import { addPainting, addPlanter, addWindow, makePanel } from './Props.js';
import { signDrawer } from './Textures.js';

/**
 * Asansör kapısı (statik): paslanmaz çelik iki kanat, pirinç kasa, üstte kat göstergesi,
 * yanda çağırma düğmesi. Asansör aslında bir ışınlanma noktası; kapı duvara gömülü dekor.
 * @param facing 'z-' (lobi: güneye bakar) | 'z+' (sahanlık: kuzeye bakar)
 */
export function addElevatorDoor(b, scene, { x, z, facing, label, factory }) {
  const s = facing === 'z+' ? 1 : -1; // duvarın hangi yüzü
  const face = z + s * 0.1; // duvar yüzü (duvar kalınlığı 0.2)
  const W = ELEVATOR.width;
  const noCast = { cast: false };
  const zz = (d0, d1) => [Math.min(face + s * d0, face + s * d1), Math.max(face + s * d0, face + s * d1)];
  // Kasa
  b.box('brass', x - W / 2 - 0.1, x - W / 2, 0, 2.35, ...zz(0, 0.05), noCast);
  b.box('brass', x + W / 2, x + W / 2 + 0.1, 0, 2.35, ...zz(0, 0.05), noCast);
  b.box('brass', x - W / 2 - 0.1, x + W / 2 + 0.1, 2.25, 2.35, ...zz(0, 0.05), noCast);
  // Kanatlar (ortada ince derz)
  b.box('metal', x - W / 2, x - 0.008, 0, 2.25, ...zz(0, 0.025), noCast);
  b.box('metal', x + 0.008, x + W / 2, 0, 2.25, ...zz(0, 0.025), noCast);
  b.box('black', x - 0.008, x + 0.008, 0, 2.25, ...zz(0, 0.02), noCast);
  // Eşik
  b.box('metal', x - W / 2 - 0.1, x + W / 2 + 0.1, 0, 0.012, ...zz(0, 0.25), noCast);
  // Çağırma düğmesi paneli
  b.box('metal', x + W / 2 + 0.22, x + W / 2 + 0.36, 0.95, 1.25, ...zz(0, 0.02), noCast);
  b.add('lamp', new THREE.CylinderGeometry(0.025, 0.025, 0.02, 10), {
    position: [x + W / 2 + 0.29, 1.12, face + s * 0.03], rotation: [Math.PI / 2, 0, 0], cast: false,
  });
  // Kat göstergesi
  const mat = new THREE.MeshBasicMaterial({
    map: factory.make(signDrawer({ title: label, sub: 'LIFT', bg: '#141a22', fg: '#ffb347', border: '#c49a3a' }), { w: 1, h: 0.4, repeat: false }),
  });
  scene.add(makePanel(mat, 0.55, 0.22, x, 2.52, face + s * 0.012, facing));
}

/**
 * Lobideki asansör (101'in güney duvarında) ve üst katlar: her katın sahanlığı, koridoru,
 * tavanları, lambaları ve dekoru. Duvarlar / çarpışmalar shared/layout.js buildWallSegments'ten,
 * odalar (zemin + tavan + mobilya) HotelWorld / RoomView'dan gelir. Hepsi statik (batcher).
 */
export function buildHotelFloors({ batcher: b, collision, scene, factory }) {
  // Lobi asansörü
  addElevatorDoor(b, scene, { x: ELEVATOR.lobby.x, z: ELEVATOR.lobby.z, facing: 'z-', label: '1 ▲▼', factory });
  for (const f of [2, 3, 4]) buildFloorDecor(b, collision, scene, factory, f);
}

/**
 * Bir üst katın sahanlığı, koridoru, tavanları, lambaları ve dekoru (statik; batcher).
 * Lüks katlar (5–12) da bunu kullanır (HotelArchitectureUpgrades, kendi kat batcher'ıyla).
 * @param opts.eastPainting false: sahanlığın doğu duvarında lounge kemeri var (tablo asılmaz)
 */
export function buildFloorDecor(b, collision, scene, factory, f, { eastPainting = true } = {}) {
  const ceil = { facingDown: true, cast: false, receive: false };
  const L = LANDING;
  const dz = FLOOR_DZ[f];
  // Zemin + tavan: sahanlık ve koridor
  b.floor('floorLobby', L.minX, L.maxX, L.minZ + dz, L.maxZ + dz, 0, { uvScale: UV.floorLobby });
  b.floor('floorCorridor', -1.5, 1.5, 12 + dz, 26 + dz, 0, { uvScale: UV.floorCorridor });
  b.floor('ceiling', L.minX, L.maxX, L.minZ + dz, L.maxZ + dz, WALL_H, ceil);
  b.floor('ceiling', -1.5, 1.5, 12 + dz, 26 + dz, WALL_H, ceil);

  // Asansör + kat tabelası
  const e = ELEVATOR.floor(f);
  addElevatorDoor(b, scene, { x: e.x, z: e.z, facing: 'z+', label: `${f} ▲▼`, factory });
  const sign = new THREE.MeshLambertMaterial({
    map: factory.make(signDrawer({ title: `${f}. KAT`, sub: `Oda ${f}01 – ${f}04`, bg: '#b08d57', fg: '#2a1d0e', border: '#6b5330' }), { w: 1, h: 0.45, repeat: false }),
  });
  scene.add(makePanel(sign, 1.3, 0.58, 0, 2.15, 11.89 + dz, 'z-'));

  // Sahanlık dekoru: halı, saksılar, tablo, lambalar
  b.floor('rugRed', -1.4, 1.4, 8.9 + dz, 11.4 + dz, 0.008, { cast: false });
  addPlanter(b, collision, 3.0, 8.5 + dz, f % 3);
  addPlanter(b, collision, 3.0, 11.5 + dz, (f + 1) % 3);
  if (eastPainting) addPainting(b, { x: 3.38, y: 1.75, z: 10.0 + dz, w: 1.0, h: 0.75, facing: 'x-' });
  for (const z of [9.0, 11.0]) {
    b.add('lamp', new THREE.CylinderGeometry(0.17, 0.17, 0.02, 12), { cast: false, receive: false, position: [0, WALL_H - 0.012, z + dz] });
  }
  // Koridor lambaları, tablo ve pencere (manzara)
  for (const z of [13.8, 17.4, 21, 24.6]) {
    b.box('lamp', -0.25, 0.25, WALL_H - 0.03, WALL_H - 0.005, z - 0.25 + dz, z + 0.25 + dz, { cast: false, receive: false });
  }
  addPainting(b, { x: -1.4, y: 1.7, z: 19 + dz, w: 1.1, h: 0.8, facing: 'x+' });
  addWindow(b, { x: 0, y: 1.7, z: 25.9 + dz, w: 1.2, h: 1.1, facing: 'z-', glass: 'skyline', uOffset: 0.15 * f });
  addPlanter(b, collision, 1.1, 25.5 + dz, f % 3);
  addPlanter(b, collision, -1.1, 25.5 + dz, (f + 2) % 3);
}
