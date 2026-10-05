// Night burglaries on the client (shared/burglary.ts): the rooms the burglars are teleported into
// (built the first time someone goes in; far away from the city, so only the people inside see
// them), and at the buildings themselves the flashing red alarm lights.
//
// A room: floor, walls and ceiling with light panels, its furniture (glass display counters,
// shelves of electronics, sofas, beds, desks, the safe), the loot glowing where it lies (gold
// jewellery, watches, laptops, phones), red laser beams across the doorways (blinking ones go on
// and off), motion sensors high on the walls with their LEDs and the circle they watch on the
// floor (red: armed), vases, chairs and boxes that topple over, the way out with a green ÇIKIŞ
// sign, and when the alarm goes off red beacons turning on the ceiling.

import * as THREE from 'three';
import {
  BURGLARY_TARGETS,
  cycleOn,
  findTarget,
  layoutOf,
  type BurglaryState,
  type BurglaryTarget,
  type BurglaryTargetView,
  type Knockable,
  type LocalBox,
  type LootSpot,
} from '../../../shared/burglary';
import { surfaceY } from './City';
import { lightGlowTexture } from './Highway';

const mats = new Map<string, THREE.MeshStandardMaterial>();
function mat(color: string, opts: Partial<THREE.MeshStandardMaterialParameters> = {}): THREE.MeshStandardMaterial {
  const key = `${color}|${JSON.stringify(opts)}`;
  let m = mats.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, roughness: 0.7, ...opts });
    mats.set(key, m);
  }
  return m;
}

function glowSprite(color: string, size: number): THREE.Sprite {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: lightGlowTexture(), color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  s.scale.setScalar(size);
  return s;
}

/** A floor texture: tiles for the shops, planks for the homes. */
function floorTexture(kind: 'tile' | 'wood', base: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = base;
  g.fillRect(0, 0, 256, 256);
  if (kind === 'tile') {
    g.strokeStyle = 'rgba(0,0,0,0.18)';
    g.lineWidth = 2;
    for (let i = 0; i <= 256; i += 64) {
      g.beginPath();
      g.moveTo(i, 0);
      g.lineTo(i, 256);
      g.moveTo(0, i);
      g.lineTo(256, i);
      g.stroke();
    }
  } else {
    for (let y = 0; y < 256; y += 32) {
      const off = (y / 32) % 2 ? 90 : 0;
      g.fillStyle = `rgba(0,0,0,${0.04 + ((y / 32) % 3) * 0.03})`;
      g.fillRect(0, y, 256, 32);
      g.fillStyle = 'rgba(0,0,0,0.3)';
      g.fillRect(0, y, 256, 2);
      g.fillRect(off + 40, y, 2, 32);
      g.fillRect(off + 170, y, 2, 32);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function signTexture(text: string, bg: string, fg: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 96;
  const g = c.getContext('2d')!;
  g.fillStyle = bg;
  g.fillRect(0, 0, 256, 96);
  g.fillStyle = fg;
  g.font = '900 52px system-ui, Arial, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 128, 50);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

interface LaserView {
  beams: THREE.Mesh[];
  glow: THREE.Sprite[];
  def: ReturnType<typeof layoutOf>['lasers'][number];
}

interface SensorView {
  led: THREE.Mesh;
  ledGlow: THREE.Sprite;
  ring: THREE.Mesh;
  def: ReturnType<typeof layoutOf>['sensors'][number];
  was: boolean;
}

interface KnockView {
  obj: THREE.Group;
  def: Knockable;
  /** Tipping over: 0 standing, 1 on the floor. */
  fall: number;
  down: boolean;
  dir: number;
}

interface LootView {
  obj: THREE.Group;
  glow: THREE.Sprite;
  spot: LootSpot;
}

interface Room {
  target: BurglaryTarget;
  group: THREE.Group;
  lights: THREE.PointLight[];
  alarmLight: THREE.PointLight;
  beacons: THREE.Group[];
  lasers: LaserView[];
  sensors: SensorView[];
  knock: KnockView[];
  loot: LootView[];
  safeDoor: THREE.Group | null;
}

export class InteriorsView {
  private rooms = new Map<string, Room>();
  private time = 0;
  /** Red flashers over the doors of the places whose alarm is ringing. */
  private outdoor = new Map<string, { group: THREE.Group; glow: THREE.Sprite[]; light: THREE.PointLight }>();
  /** The sensor nearest arming (for a beep). */
  onSensorArm: (() => void) | null = null;
  onKnock: ((look: Knockable['look']) => void) | null = null;

  constructor(private readonly scene: THREE.Scene) {}

  // ---------------------------------------------------------------- building a room

  private build(t: BurglaryTarget): Room {
    const l = layoutOf(t);
    const group = new THREE.Group();
    group.name = `room_${t.id}`;
    group.position.set(t.room.x, surfaceY(t.room.x, t.room.z), t.room.z);
    const homes = l.kind === 'villa' || l.kind === 'flat';
    // Floor, walls, ceiling.
    const ftex = floorTexture(homes ? 'wood' : 'tile', l.floor);
    ftex.repeat.set(l.w / 3, l.d / 3);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(l.w + 0.8, l.d + 0.8).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: ftex, roughness: homes ? 0.6 : 0.25, metalness: homes ? 0 : 0.1 }));
    floor.position.set(0, 0.002, l.d / 2);
    floor.receiveShadow = true;
    group.add(floor);
    const wallM = mat(l.wall, { roughness: 0.9 });
    const W = 0.4;
    for (const [w, d, x, z] of [
      [l.w + 2 * W, W, 0, -W / 2],
      [l.w + 2 * W, W, 0, l.d + W / 2],
      [W, l.d, -l.w / 2 - W / 2, l.d / 2],
      [W, l.d, l.w / 2 + W / 2, l.d / 2],
    ] as const) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, l.h, d), wallM);
      m.position.set(x, l.h / 2, z);
      m.receiveShadow = true;
      group.add(m);
    }
    // Skirting boards.
    const skirt = mat(homes ? '#5b3a22' : '#2b2f36');
    for (const [w, d, x, z] of [
      [l.w, 0.04, 0, 0.02],
      [l.w, 0.04, 0, l.d - 0.02],
      [0.04, l.d, -l.w / 2 + 0.02, l.d / 2],
      [0.04, l.d, l.w / 2 - 0.02, l.d / 2],
    ] as const) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.12, d), skirt);
      m.position.set(x, 0.06, z);
      group.add(m);
    }
    const ceil = new THREE.Mesh(new THREE.BoxGeometry(l.w + 2 * W, 0.2, l.d + 2 * W), mat(homes ? '#efe9de' : '#e8ebef', { roughness: 1 }));
    ceil.position.set(0, l.h + 0.1, l.d / 2);
    ceil.castShadow = true;
    group.add(ceil);
    // Light panels (dim night lighting: the shop's security lights, a lamp left on at home).
    const panelM = new THREE.MeshBasicMaterial({ color: homes ? '#ffd9a0' : '#cfe4ff', toneMapped: false });
    const lights: THREE.PointLight[] = [];
    for (const [x, z] of [
      [-l.w / 4, l.d * 0.3],
      [l.w / 4, l.d * 0.7],
    ] as const) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.03, 0.5), panelM);
      p.position.set(x, l.h - 0.02, z);
      group.add(p);
      const light = new THREE.PointLight(homes ? '#ffcf8a' : '#bcd6ff', homes ? 7 : 6, Math.max(l.w, l.d) * 1.1, 1.6);
      light.position.set(x, l.h - 0.4, z);
      group.add(light);
      lights.push(light);
    }
    // The way out: a door in the front wall with a green ÇIKIŞ sign over it.
    const door = new THREE.Mesh(new THREE.BoxGeometry(1.1, 2.15, 0.08), mat(homes ? '#6b4226' : '#3a4452', { roughness: 0.6 }));
    door.position.set(0, 1.075, 0.04);
    group.add(door);
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 8), mat('#d6b25e', { metalness: 0.8, roughness: 0.3 }));
    knob.position.set(0.4, 1.05, 0.1);
    group.add(knob);
    const exit = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.26), new THREE.MeshBasicMaterial({ map: signTexture('ÇIKIŞ', '#0b7d3b', '#ffffff'), toneMapped: false }));
    exit.position.set(0, 2.45, 0.05);
    group.add(exit);
    const exitGlow = glowSprite('#2ee59d', 1.4);
    exitGlow.material.opacity = 0.35;
    exitGlow.position.set(0, 2.45, 0.2);
    group.add(exitGlow);
    // Furniture.
    let safeDoor: THREE.Group | null = null;
    const safeAt = l.loot.find((x) => x.kind === 'safe');
    for (const b of l.boxes) {
      // The safe's door faces where you stand to crack it.
      const face = safeAt ? Math.atan2(safeAt.stand.x - (b.x0 + b.x1) / 2, safeAt.stand.z - (b.z0 + b.z1) / 2) : 0;
      const obj = this.furniture(b, l.wall, l.h, face);
      group.add(obj);
      if (b.look === 'safe') safeDoor = obj.getObjectByName('safeDoor') as THREE.Group;
    }
    // Loot.
    const loot: LootView[] = [];
    for (const spot of l.loot) {
      if (spot.kind === 'safe') continue;
      const obj = this.lootMesh(spot);
      obj.position.set(spot.x, spot.y, spot.z);
      const glow = glowSprite(spot.kind === 'jewels' || spot.kind === 'watches' ? '#ffd76a' : '#7cf7c8', 0.9);
      glow.position.set(spot.x, spot.y + 0.12, spot.z);
      group.add(obj, glow);
      loot.push({ obj, glow, spot });
    }
    // The safe glows too until it's open.
    const safeSpot = l.loot.find((s) => s.kind === 'safe');
    if (safeSpot) {
      const obj = new THREE.Group();
      const glow = glowSprite('#ffd76a', 1.3);
      glow.position.set(safeSpot.x, safeSpot.y + 0.2, safeSpot.z);
      group.add(glow);
      loot.push({ obj, glow, spot: safeSpot });
    }
    // Lasers: three beams across the doorway with an emitter at each end.
    const lasers: LaserView[] = [];
    const beamM = new THREE.MeshBasicMaterial({ color: '#ff1f3d', transparent: true, opacity: 0.85, toneMapped: false, depthWrite: false, blending: THREE.AdditiveBlending });
    for (const def of l.lasers) {
      const dx = def.b.x - def.a.x;
      const dz = def.b.z - def.a.z;
      const len = Math.hypot(dx, dz);
      const beams: THREE.Mesh[] = [];
      const glow: THREE.Sprite[] = [];
      for (const y of [0.45, 0.9, 1.35]) {
        const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, len, 6).rotateZ(Math.PI / 2), beamM);
        beam.position.set((def.a.x + def.b.x) / 2, y, (def.a.z + def.b.z) / 2);
        beam.rotation.y = -Math.atan2(dz, dx);
        beams.push(beam);
        group.add(beam);
        for (const p of [def.a, def.b]) {
          const g = glowSprite('#ff2244', 0.35);
          g.position.set(p.x, y, p.z);
          glow.push(g);
          group.add(g);
        }
      }
      for (const p of [def.a, def.b]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.6, 0.08), mat('#1d2026', { metalness: 0.6, roughness: 0.4 }));
        post.position.set(p.x, 0.8, p.z);
        group.add(post);
      }
      lasers.push({ beams, glow, def });
    }
    // Motion sensors: on the nearest wall, high up, facing in; the circle they watch.
    const sensors: SensorView[] = [];
    for (const def of l.sensors) {
      const wx = Math.abs(def.x) > l.w / 2 - 2.5 ? Math.sign(def.x) * (l.w / 2 - 0.08) : def.x;
      const wz = Math.abs(def.x) > l.w / 2 - 2.5 ? def.z : def.z > l.d / 2 ? l.d - 0.08 : 0.08;
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.12, 0.16), mat('#f2f2f2', { roughness: 0.4 }));
      body.position.set(wx, l.h - 0.25, wz);
      const led = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 6), new THREE.MeshBasicMaterial({ color: '#ff2a2a', toneMapped: false }));
      led.position.set(wx, l.h - 0.33, wz);
      const ledGlow = glowSprite('#ff2a2a', 0.5);
      ledGlow.position.copy(led.position);
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(def.r - 0.06, def.r, 48).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ color: '#ff2a2a', transparent: true, opacity: 0.35, depthWrite: false, toneMapped: false }),
      );
      ring.position.set(def.x, 0.012, def.z);
      group.add(body, led, ledGlow, ring);
      sensors.push({ led, ledGlow, ring, def, was: false });
    }
    // Things to knock over.
    const knock: KnockView[] = l.knock.map((def) => {
      const obj = this.knockMesh(def.look);
      obj.position.set(def.x, 0, def.z);
      group.add(obj);
      return { obj, def, fall: 0, down: false, dir: Math.random() * Math.PI * 2 };
    });
    // The alarm: red beacons on the ceiling and a red light that pulses.
    const alarmLight = new THREE.PointLight('#ff1a1a', 0, Math.max(l.w, l.d) * 1.3, 1.4);
    alarmLight.position.set(0, l.h - 0.5, l.d / 2);
    group.add(alarmLight);
    const beacons: THREE.Group[] = [];
    for (const [x, z] of [
      [-l.w / 3, l.d / 2],
      [l.w / 3, l.d / 2],
    ] as const) {
      const b = new THREE.Group();
      b.position.set(x, l.h - 0.12, z);
      const dome = new THREE.Mesh(new THREE.SphereGeometry(0.14, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(Math.PI), new THREE.MeshBasicMaterial({ color: '#ff2020', transparent: true, opacity: 0.8, toneMapped: false }));
      const spin = new THREE.Group();
      for (const k of [0, Math.PI]) {
        const g = glowSprite('#ff2020', 2.6);
        g.position.set(Math.cos(k) * 0.4, -0.1, Math.sin(k) * 0.4);
        spin.add(g);
      }
      spin.name = 'spin';
      b.add(dome, spin);
      b.visible = false;
      group.add(b);
      beacons.push(b);
    }
    this.scene.add(group);
    const room: Room = { target: t, group, lights, alarmLight, beacons, lasers, sensors, knock, loot, safeDoor };
    this.rooms.set(t.id, room);
    return room;
  }

  /** A piece of furniture from its collider box. */
  private furniture(b: LocalBox, wall: string, roomH: number, face: number): THREE.Group {
    const g = new THREE.Group();
    const w = b.x1 - b.x0;
    const d = b.z1 - b.z0;
    g.position.set((b.x0 + b.x1) / 2, 0, (b.z0 + b.z1) / 2);
    const add = (geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number) => {
      const mesh = new THREE.Mesh(geo, m);
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      g.add(mesh);
      return mesh;
    };
    switch (b.look) {
      case 'counter': {
        // A display counter: dark wood base, a lit glass case on top.
        add(new THREE.BoxGeometry(w, b.h * 0.62, d), mat('#2a1d14', { roughness: 0.5 }), 0, b.h * 0.31, 0);
        add(new THREE.BoxGeometry(w - 0.06, 0.02, d - 0.06), new THREE.MeshBasicMaterial({ color: '#fff3d6', toneMapped: false }), 0, b.h * 0.63, 0);
        const glass = new THREE.MeshStandardMaterial({ color: '#cfe8ff', transparent: true, opacity: 0.22, roughness: 0.05, metalness: 0.1, depthWrite: false });
        add(new THREE.BoxGeometry(w, b.h * 0.38, d), glass, 0, b.h * 0.81, 0);
        add(new THREE.BoxGeometry(w + 0.02, 0.03, d + 0.02), mat('#d6b25e', { metalness: 0.9, roughness: 0.25 }), 0, b.h, 0);
        break;
      }
      case 'shelf': {
        // A metal gondola with three shelves of boxed goods.
        const metal = mat('#9aa3ad', { metalness: 0.6, roughness: 0.4 });
        add(new THREE.BoxGeometry(w * 0.2, b.h, d), metal, 0, b.h / 2, 0);
        const colors = ['#1f6feb', '#e5534b', '#2ea043', '#f0b72f', '#8957e5', '#20232a'];
        for (let i = 0; i < 3; i++) {
          const y = 0.25 + i * (b.h - 0.3) / 2.6;
          add(new THREE.BoxGeometry(w, 0.04, d), metal, 0, y, 0);
          const long = d > w;
          const n = Math.floor((long ? d : w) / 0.45);
          for (let k = 0; k < n; k++) {
            const along = -((long ? d : w) / 2) + 0.25 + k * 0.45;
            for (const side of [-1, 1]) {
              const bw = 0.3;
              const bh = 0.22 + ((k + i) % 3) * 0.06;
              const geo = new THREE.BoxGeometry(long ? 0.28 : bw, bh, long ? bw : 0.28);
              const m = mat(colors[(k * 3 + i + (side > 0 ? 1 : 0)) % colors.length]!, { roughness: 0.5 });
              add(geo, m, long ? side * (w / 2 - 0.16) : along, y + bh / 2 + 0.02, long ? along : side * (d / 2 - 0.16));
            }
          }
        }
        break;
      }
      case 'wall':
        add(new THREE.BoxGeometry(w, roomH, d), mat(wall, { roughness: 0.9 }), 0, roomH / 2, 0);
        break;
      case 'sofa': {
        const fabric = mat('#4b5563', { roughness: 0.95 });
        add(new THREE.BoxGeometry(w, b.h * 0.5, d), fabric, 0, b.h * 0.25, 0);
        const backZ = d > w ? 0 : d / 2 - 0.12;
        add(new THREE.BoxGeometry(d > w ? 0.24 : w, b.h, d > w ? d : 0.24), fabric, d > w ? w / 2 - 0.12 : 0, b.h / 2, backZ);
        for (const k of [-1, 1]) add(new THREE.BoxGeometry(w * 0.45, 0.14, d * 0.7), mat('#6b7280', { roughness: 1 }), k * w * 0.24, b.h * 0.57, -0.05);
        break;
      }
      case 'table': {
        const wood = mat('#7a5230', { roughness: 0.45 });
        add(new THREE.BoxGeometry(w, 0.05, d), wood, 0, b.h, 0);
        for (const [sx, sz] of [
          [-1, -1],
          [1, -1],
          [-1, 1],
          [1, 1],
        ] as const)
          add(new THREE.BoxGeometry(0.06, b.h, 0.06), wood, sx * (w / 2 - 0.08), b.h / 2, sz * (d / 2 - 0.08));
        break;
      }
      case 'desk': {
        const wood = mat('#3d2b1f', { roughness: 0.5 });
        add(new THREE.BoxGeometry(w, 0.05, d), wood, 0, b.h, 0);
        add(new THREE.BoxGeometry(0.06, b.h, d - 0.1), wood, -w / 2 + 0.05, b.h / 2, 0);
        add(new THREE.BoxGeometry(0.06, b.h, d - 0.1), wood, w / 2 - 0.05, b.h / 2, 0);
        // A monitor, off.
        add(new THREE.BoxGeometry(0.6, 0.36, 0.03), mat('#111317', { roughness: 0.2 }), w * 0.25, b.h + 0.26, d / 2 - 0.15);
        break;
      }
      case 'bed': {
        add(new THREE.BoxGeometry(w, 0.3, d), mat('#5b3a22', { roughness: 0.6 }), 0, 0.15, 0);
        add(new THREE.BoxGeometry(w - 0.1, 0.22, d - 0.1), mat('#f3f1ea', { roughness: 0.95 }), 0, 0.41, 0);
        add(new THREE.BoxGeometry(w - 0.08, 0.06, d * 0.62), mat('#36507a', { roughness: 1 }), 0, b.h - 0.02, -d * 0.18);
        add(new THREE.BoxGeometry(w * 0.7, 0.14, 0.4), mat('#ffffff', { roughness: 1 }), 0, b.h + 0.04, d / 2 - 0.35);
        add(new THREE.BoxGeometry(w, 1.1, 0.08), mat('#4a2f1c', { roughness: 0.6 }), 0, 0.55, d / 2 + 0.02);
        break;
      }
      case 'wardrobe': {
        add(new THREE.BoxGeometry(w, b.h, d), mat('#8a6a4a', { roughness: 0.55 }), 0, b.h / 2, 0);
        const line = mat('#3b2a1e');
        add(new THREE.BoxGeometry(w > d ? 0.02 : w + 0.01, b.h - 0.1, w > d ? d + 0.01 : 0.02), line, 0, b.h / 2, 0);
        break;
      }
      case 'tv': {
        add(new THREE.BoxGeometry(w, b.h, d), mat('#1f1f22', { roughness: 0.4 }), 0, b.h / 2, 0);
        const long = d > w;
        add(new THREE.BoxGeometry(long ? 0.06 : 1.6, 0.95, long ? 1.6 : 0.06), mat('#08090b', { roughness: 0.15, metalness: 0.3 }), 0, b.h + 0.55, 0);
        break;
      }
      case 'safe': {
        // A heavy steel safe; its door (hinged on one edge) faces where you stand to crack it.
        add(new THREE.BoxGeometry(w, b.h, d), mat('#2d3238', { metalness: 0.7, roughness: 0.35 }), 0, b.h / 2, 0);
        const fx = Math.sin(face);
        const fz = Math.cos(face);
        const onZ = Math.abs(fz) >= Math.abs(fx);
        const doorW = onZ ? w : d;
        const holder = new THREE.Group();
        holder.rotation.y = onZ ? (fz > 0 ? 0 : Math.PI) : fx > 0 ? Math.PI / 2 : -Math.PI / 2;
        holder.position.set(onZ ? 0 : Math.sign(fx) * (w / 2), 0, onZ ? Math.sign(fz) * (d / 2) : 0);
        const pivot = new THREE.Group();
        pivot.name = 'safeDoor';
        pivot.position.set(-doorW / 2, 0, 0);
        const steel = mat('#3a4049', { metalness: 0.8, roughness: 0.3 });
        const chrome = mat('#c9ced4', { metalness: 0.9, roughness: 0.2 });
        const door = new THREE.Mesh(new THREE.BoxGeometry(doorW - 0.08, b.h - 0.12, 0.06), steel);
        door.position.set(doorW / 2, b.h / 2, 0.03);
        const dial = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.05, 24).rotateX(Math.PI / 2), chrome);
        dial.position.set(doorW / 2, b.h * 0.6, 0.08);
        const handle = new THREE.Mesh(new THREE.TorusGeometry(0.09, 0.015, 6, 16), chrome);
        handle.position.set(doorW / 2 + Math.min(0.25, doorW * 0.3), b.h * 0.38, 0.08);
        pivot.add(door, dial, handle);
        holder.add(pivot);
        g.add(holder);
        break;
      }
    }
    return g;
  }

  /** The loot lying on a counter / shelf. */
  private lootMesh(spot: LootSpot): THREE.Group {
    const g = new THREE.Group();
    const gold = mat('#ffcf4d', { metalness: 1, roughness: 0.2, emissive: '#6b4a00', emissiveIntensity: 0.4 });
    const add = (geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, ry = 0) => {
      const mesh = new THREE.Mesh(geo, m);
      mesh.position.set(x, y, z);
      mesh.rotation.y = ry;
      g.add(mesh);
      return mesh;
    };
    switch (spot.kind) {
      case 'jewels':
        // Rings and a necklace on velvet.
        add(new THREE.BoxGeometry(0.5, 0.03, 0.3), mat('#5a0f2e', { roughness: 1 }), 0, 0.015, 0);
        for (let i = 0; i < 4; i++) add(new THREE.TorusGeometry(0.035, 0.009, 8, 16).rotateX(Math.PI / 2.4), gold, -0.18 + i * 0.12, 0.05, -0.05);
        add(new THREE.TorusGeometry(0.11, 0.008, 6, 24).rotateX(Math.PI / 2), gold, 0, 0.035, 0.07);
        add(new THREE.OctahedronGeometry(0.025), mat('#bfe9ff', { metalness: 0.2, roughness: 0, emissive: '#5fb6ff', emissiveIntensity: 0.8 }), 0, 0.04, 0.17);
        break;
      case 'watches':
        for (let i = 0; i < 3; i++) {
          add(new THREE.CylinderGeometry(0.045, 0.045, 0.02, 20), i % 2 ? gold : mat('#d9dde3', { metalness: 1, roughness: 0.15 }), -0.15 + i * 0.15, 0.03, 0);
          add(new THREE.BoxGeometry(0.03, 0.01, 0.18), mat('#1b1b1b', { roughness: 0.6 }), -0.15 + i * 0.15, 0.015, 0);
        }
        break;
      case 'laptop': {
        add(new THREE.BoxGeometry(0.36, 0.02, 0.25), mat('#c0c4ca', { metalness: 0.8, roughness: 0.3 }), 0, 0.01, 0);
        const lid = add(new THREE.BoxGeometry(0.36, 0.23, 0.01), mat('#c0c4ca', { metalness: 0.8, roughness: 0.3 }), 0, 0.12, -0.12);
        lid.rotation.x = -0.25;
        add(new THREE.PlaneGeometry(0.32, 0.19), new THREE.MeshBasicMaterial({ color: '#4ea1ff', toneMapped: false }), 0, 0.12, -0.112).rotation.x = -0.25;
        break;
      }
      case 'electronics':
        for (let i = 0; i < 3; i++) {
          add(new THREE.BoxGeometry(0.08, 0.01, 0.16), mat('#14161a', { roughness: 0.2 }), -0.12 + i * 0.12, 0.01, 0);
          add(new THREE.PlaneGeometry(0.07, 0.14).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: i === 1 ? '#7cf7c8' : '#4ea1ff', toneMapped: false }), -0.12 + i * 0.12, 0.016, 0);
        }
        add(new THREE.BoxGeometry(0.26, 0.015, 0.18), mat('#2a2d33', { roughness: 0.3 }), 0, 0.03, 0.17);
        break;
      default:
        break;
    }
    return g;
  }

  private knockMesh(look: Knockable['look']): THREE.Group {
    const g = new THREE.Group();
    const add = (geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number) => {
      const mesh = new THREE.Mesh(geo, m);
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      g.add(mesh);
    };
    switch (look) {
      case 'vase':
        add(new THREE.LatheGeometry([new THREE.Vector2(0.001, 0), new THREE.Vector2(0.14, 0.05), new THREE.Vector2(0.18, 0.3), new THREE.Vector2(0.09, 0.62), new THREE.Vector2(0.12, 0.7)], 18), mat('#2f6fb3', { roughness: 0.2, metalness: 0.1 }), 0, 0, 0);
        break;
      case 'plant':
        add(new THREE.CylinderGeometry(0.18, 0.14, 0.34, 14), mat('#b5651d', { roughness: 0.8 }), 0, 0.17, 0);
        add(new THREE.IcosahedronGeometry(0.32, 0), mat('#2f7d32', { roughness: 0.9 }), 0, 0.62, 0);
        break;
      case 'chair': {
        const wood = mat('#6b4a2c', { roughness: 0.6 });
        add(new THREE.BoxGeometry(0.44, 0.05, 0.44), wood, 0, 0.46, 0);
        add(new THREE.BoxGeometry(0.44, 0.5, 0.04), wood, 0, 0.72, -0.2);
        for (const [x, z] of [
          [-0.19, -0.19],
          [0.19, -0.19],
          [-0.19, 0.19],
          [0.19, 0.19],
        ] as const)
          add(new THREE.BoxGeometry(0.04, 0.46, 0.04), wood, x, 0.23, z);
        break;
      }
      case 'box':
        add(new THREE.BoxGeometry(0.5, 0.4, 0.4), mat('#b08850', { roughness: 0.9 }), 0, 0.2, 0);
        add(new THREE.BoxGeometry(0.4, 0.32, 0.36), mat('#a07a44', { roughness: 0.9 }), 0.02, 0.56, 0);
        break;
      case 'lamp':
        add(new THREE.CylinderGeometry(0.15, 0.18, 0.04, 16), mat('#222', { metalness: 0.6 }), 0, 0.02, 0);
        add(new THREE.CylinderGeometry(0.015, 0.015, 1.4, 8), mat('#222', { metalness: 0.6 }), 0, 0.72, 0);
        add(new THREE.CylinderGeometry(0.16, 0.24, 0.26, 16, 1, true), new THREE.MeshStandardMaterial({ color: '#f6e7c8', emissive: '#ffcf8a', emissiveIntensity: 0.8, side: THREE.DoubleSide }), 0, 1.45, 0);
        break;
      case 'bottles':
        for (let i = 0; i < 4; i++) add(new THREE.CylinderGeometry(0.035, 0.04, 0.3, 10), mat(i % 2 ? '#2e7d32' : '#6d4c41', { roughness: 0.1, transparent: true, opacity: 0.85 }), -0.1 + i * 0.07, 0.15, (i % 2) * 0.06);
        break;
    }
    return g;
  }

  // ---------------------------------------------------------------- per frame

  /** The room a target id has (built on first use). */
  room(targetId: string): Room | undefined {
    const t = findTarget(targetId);
    if (!t) return undefined;
    return this.rooms.get(targetId) ?? this.build(t);
  }

  update(dt: number, serverNow: number, inside: string | null, st: BurglaryState | null, targets: readonly BurglaryTargetView[], night: number): void {
    this.time += dt;
    // Only the room I'm in is drawn.
    for (const [id, r] of this.rooms) r.group.visible = id === inside;
    if (inside) {
      const r = this.room(inside)!;
      this.updateRoom(r, dt, serverNow, st);
    }
    this.updateOutdoor(targets, night);
  }

  private updateRoom(r: Room, dt: number, serverNow: number, st: BurglaryState | null): void {
    const taken = new Set(st?.taken ?? []);
    const knocked = new Set(st?.knocked ?? []);
    const pulse = 0.55 + 0.35 * Math.sin(this.time * 4);
    for (const l of r.loot) {
      const gone = taken.has(l.spot.id);
      l.obj.visible = !gone;
      l.glow.visible = !gone;
      (l.glow.material as THREE.SpriteMaterial).opacity = pulse;
      if (!gone) l.obj.rotation.y = l.spot.kind === 'watches' || l.spot.kind === 'jewels' ? Math.sin(this.time * 0.8) * 0.08 : 0;
    }
    if (r.safeDoor) r.safeDoor.rotation.y += ((st?.safe.open ? -1.9 : 0) - r.safeDoor.rotation.y) * Math.min(1, dt * 3);
    for (const lz of r.lasers) {
      const on = cycleOn(lz.def, serverNow);
      const flicker = 0.75 + 0.25 * Math.sin(this.time * 40);
      for (const b of lz.beams) {
        b.visible = on;
        (b.material as THREE.MeshBasicMaterial).opacity = 0.85 * flicker;
      }
      for (const g of lz.glow) g.material.opacity = on ? 0.9 : 0.15;
    }
    for (const s of r.sensors) {
      const on = cycleOn(s.def, serverNow);
      const c = on ? '#ff2a2a' : '#2ee59d';
      (s.led.material as THREE.MeshBasicMaterial).color.set(c);
      s.ledGlow.material.color.set(c);
      s.ledGlow.material.opacity = on ? 0.95 : 0.5;
      const ring = s.ring.material as THREE.MeshBasicMaterial;
      ring.color.set(c);
      ring.opacity = on ? 0.5 + 0.15 * Math.sin(this.time * 10) : 0.12;
      if (on && !s.was) this.onSensorArm?.();
      s.was = on;
    }
    for (const k of r.knock) {
      if (knocked.has(k.def.id) && !k.down) {
        k.down = true;
        this.onKnock?.(k.def.look);
      }
      if (!k.down) continue;
      k.fall = Math.min(1, k.fall + dt * 3.2);
      // Tip over about the base, away from where it was hit.
      const e = k.fall * k.fall;
      k.obj.rotation.set(Math.cos(k.dir) * e * (Math.PI / 2), 0, Math.sin(k.dir) * e * (Math.PI / 2));
      k.obj.position.y = 0.05 * e;
    }
    const alarm = !!st?.alarm;
    for (const b of r.beacons) {
      b.visible = alarm;
      const spin = b.getObjectByName('spin');
      if (spin) spin.rotation.y += dt * 9;
    }
    r.alarmLight.intensity = alarm ? 6 + 5 * Math.max(0, Math.sin(this.time * 9)) : 0;
    for (const l of r.lights) l.intensity = alarm ? 2.5 : r.target.kind === 'villa' || r.target.kind === 'flat' ? 7 : 6;
  }

  /** Red flashers over the door of every place whose alarm is ringing. */
  private updateOutdoor(targets: readonly BurglaryTargetView[], night: number): void {
    const ringing = new Set(targets.filter((t) => t.alarm).map((t) => t.id));
    for (const [id, o] of this.outdoor) {
      if (ringing.has(id)) continue;
      o.group.removeFromParent();
      for (const g of o.glow) g.material.dispose();
      this.outdoor.delete(id);
    }
    for (const id of ringing) {
      let o = this.outdoor.get(id);
      if (!o) {
        const t = findTarget(id)!;
        const group = new THREE.Group();
        group.position.set(t.door.x, surfaceY(t.door.x, t.door.z) + 3.2, t.door.z);
        const glow = [glowSprite('#ff1a1a', 3.2), glowSprite('#ff1a1a', 3.2)];
        glow[0]!.position.x = -0.8;
        glow[1]!.position.x = 0.8;
        const box = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.3, 0.2), new THREE.MeshBasicMaterial({ color: '#c8102e', toneMapped: false }));
        const light = new THREE.PointLight('#ff1a1a', 0, 22, 1.5);
        group.add(box, light, ...glow);
        this.scene.add(group);
        o = { group, glow, light };
        this.outdoor.set(id, o);
      }
      const on = Math.sin(this.time * 12) > 0;
      o.glow[0]!.material.opacity = on ? 1 : 0.1;
      o.glow[1]!.material.opacity = on ? 0.1 : 1;
      o.light.intensity = (on ? 8 : 3) * (0.5 + night * 0.5);
    }
  }

  /** The nearest ringing place (for the bell's loudness): distance in metres. */
  nearestAlarm(x: number, z: number, targets: readonly BurglaryTargetView[]): number {
    let best = Infinity;
    for (const v of targets) {
      if (!v.alarm) continue;
      const t = findTarget(v.id);
      if (t) best = Math.min(best, Math.hypot(t.door.x - x, t.door.z - z));
    }
    return best;
  }

  /** All the targets (minimap, prompts). */
  static targets(): readonly BurglaryTarget[] {
    return BURGLARY_TARGETS;
  }
}
