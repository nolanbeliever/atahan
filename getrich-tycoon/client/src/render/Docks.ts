// The docks at night on the client (shared/docks.ts): the six containers that can be robbed (ribbed
// steel, their number on the side, double doors that swing open, a lamp over the doors: green when
// it can be cut now, red otherwise), sparks fountaining from the lock while someone cuts it, the
// crane hoisting a container onto a flatbed and containers riding on trucks, and the trap: white
// floodlights blazing over the yard, red and blue strobes, concrete barricades with red-white stripes
// across the gates (knocked blocks tumble away).

import * as THREE from 'three';
import { DOCK_CONTAINERS, LIGHT_TOWERS_FOR_TRAP, containerDoor, findContainer, gateBarricades, type Barricade, type DocksState } from '../../../shared/docks';
import { groundHeight } from './City';
import { lightGlowTexture } from './Highway';

function ribs(color: string, label: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = color;
  g.fillRect(0, 0, 512, 128);
  for (let x = 0; x < 512; x += 14) {
    g.fillStyle = 'rgba(0,0,0,0.22)';
    g.fillRect(x, 0, 5, 128);
    g.fillStyle = 'rgba(255,255,255,0.12)';
    g.fillRect(x + 7, 0, 3, 128);
  }
  g.fillStyle = 'rgba(0,0,0,0.3)';
  g.fillRect(0, 0, 512, 6);
  g.fillRect(0, 122, 512, 6);
  g.fillStyle = 'rgba(255,255,255,0.9)';
  g.font = '900 34px system-ui, Arial, sans-serif';
  g.fillText(label, 26, 52);
  g.font = '700 16px system-ui, Arial, sans-serif';
  g.fillText('MAX GROSS 30,480 KG · TARE 3,750 KG', 26, 78);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

let stripeTex: THREE.CanvasTexture | null = null;
function stripes(): THREE.CanvasTexture {
  if (stripeTex) return stripeTex;
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 32;
  const g = c.getContext('2d')!;
  g.fillStyle = '#e8e6e0';
  g.fillRect(0, 0, 128, 32);
  g.fillStyle = '#d0182b';
  for (let x = -32; x < 160; x += 32) {
    g.beginPath();
    g.moveTo(x, 32);
    g.lineTo(x + 16, 0);
    g.lineTo(x + 32, 0);
    g.lineTo(x + 16, 32);
    g.fill();
  }
  stripeTex = new THREE.CanvasTexture(c);
  stripeTex.colorSpace = THREE.SRGBColorSpace;
  return stripeTex;
}

interface Box {
  id: string;
  group: THREE.Group;
  doors: THREE.Group[];
  lamp: THREE.MeshBasicMaterial;
  lampGlow: THREE.Sprite;
  sparks: THREE.Points;
  sparkVel: Float32Array;
  sparkLife: Float32Array;
  open: number;
}

interface Block {
  def: Barricade;
  mesh: THREE.Group;
  /** Knocked: flying aside (velocity, spin), gone after a while. */
  fly: { vx: number; vz: number; vy: number; spin: number; t: number } | null;
}

export class DocksView {
  private boxes = new Map<string, Box>();
  private state: DocksState | null = null;
  private time = 0;
  private blocks = new Map<string, Block>();
  private trap = new THREE.Group();
  private strobes: THREE.Sprite[] = [];
  private floods: THREE.SpotLight[] = [];
  private loads = new Map<string, THREE.Mesh>();
  private crane: { mesh: THREE.Mesh; from: THREE.Vector3; vehicleId: string; t: number; sec: number } | null = null;
  /** The world position of a vehicle (the loads ride on them). */
  vehicleAt: ((id: string) => { x: number; y: number; z: number; rot: number } | null) | null = null;

  constructor(private readonly scene: THREE.Scene) {
    for (const k of DOCK_CONTAINERS) this.build(k.id);
    this.trap.visible = false;
    scene.add(this.trap);
    // Floodlights on the yard's light towers, and strobes over the gates.
    for (const t of LIGHT_TOWERS_FOR_TRAP) {
      const s = new THREE.SpotLight('#f4f8ff', 0, 140, 0.75, 0.4, 1.2);
      s.position.set(t.x, 22.5, t.z);
      s.target.position.set(t.x + (t.x < 880 ? 40 : -40), 0, 205);
      this.trap.add(s, s.target);
      this.floods.push(s);
    }
    for (const g of gateBarricades()) {
      if (!g.id.endsWith('_0')) continue;
      for (const [i, color] of ['#ff2030', '#2050ff'].entries()) {
        const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: lightGlowTexture(), color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
        sp.position.set(g.x + (i ? 1.5 : -1.5), 3.2, g.z);
        sp.scale.setScalar(4);
        this.trap.add(sp);
        this.strobes.push(sp);
      }
    }
  }

  private build(id: string): void {
    const k = findContainer(id)!;
    const L = k.box.maxX - k.box.minX;
    const W = k.box.maxZ - k.box.minZ;
    const H = 2.6;
    const cx = (k.box.minX + k.box.maxX) / 2;
    const cz = (k.box.minZ + k.box.maxZ) / 2;
    const group = new THREE.Group();
    group.position.set(cx, groundHeight(cx, cz), cz);
    const tex = ribs(k.color, id);
    const side = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.55, metalness: 0.35 });
    const plain = new THREE.MeshStandardMaterial({ color: k.color, roughness: 0.6, metalness: 0.3 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(L, H, W), [plain, plain, plain, plain, side, side]);
    body.position.y = H / 2;
    body.castShadow = body.receiveShadow = true;
    group.add(body);
    // The dark inside behind the doors.
    const dx = k.doorSide * (L / 2);
    const inside = new THREE.Mesh(new THREE.PlaneGeometry(W - 0.2, H - 0.2), new THREE.MeshBasicMaterial({ color: '#07080a' }));
    inside.position.set(dx + k.doorSide * 0.01, H / 2, 0);
    inside.rotation.y = k.doorSide > 0 ? Math.PI / 2 : -Math.PI / 2;
    group.add(inside);
    // Two doors hinged at the sides, with locking bars.
    const doorMat = new THREE.MeshStandardMaterial({ color: k.color, roughness: 0.5, metalness: 0.4 });
    const bar = new THREE.MeshStandardMaterial({ color: '#b9bfc6', metalness: 0.9, roughness: 0.3 });
    const doors: THREE.Group[] = [];
    for (const s of [-1, 1]) {
      const hinge = new THREE.Group();
      hinge.position.set(dx + k.doorSide * 0.03, 0, s * (W / 2));
      const d = new THREE.Mesh(new THREE.BoxGeometry(0.06, H - 0.1, W / 2 - 0.02), doorMat);
      d.position.set(0, H / 2, -s * (W / 4));
      d.castShadow = true;
      hinge.add(d);
      for (const bz of [-s * (W / 8), -s * (W / 2.8)]) {
        const b = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, H - 0.2, 8), bar);
        b.position.set(k.doorSide * 0.06, H / 2, bz);
        hinge.add(b);
      }
      group.add(hinge);
      doors.push(hinge);
    }
    // The lamp over the doors.
    const lamp = new THREE.MeshBasicMaterial({ color: '#2ee59d', toneMapped: false });
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 8), lamp);
    bulb.position.set(dx + k.doorSide * 0.12, H + 0.15, 0);
    const lampGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: lightGlowTexture(), color: '#2ee59d', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    lampGlow.position.copy(bulb.position);
    lampGlow.scale.setScalar(1.6);
    group.add(bulb, lampGlow);
    // Sparks from the lock (a little particle fountain).
    const n = 90;
    const pos = new Float32Array(n * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const sparks = new THREE.Points(geo, new THREE.PointsMaterial({ color: '#ffcf5a', size: 0.09, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
    sparks.frustumCulled = false;
    sparks.visible = false;
    group.add(sparks);
    this.scene.add(group);
    this.boxes.set(id, { id, group, doors, lamp, lampGlow, sparks, sparkVel: new Float32Array(n * 3), sparkLife: new Float32Array(n), open: 0 });
  }

  set(st: DocksState): void {
    this.state = st;
    // The trap's barricades: up, or knocked over.
    const standing = new Set(st.ambush?.barricades ?? []);
    if (st.ambush) {
      for (const def of gateBarricades()) if (standing.has(def.id) && !this.blocks.has(def.id)) this.blocks.set(def.id, { def, mesh: this.block(def), fly: null });
    }
    for (const [id, b] of this.blocks) {
      if (standing.has(id) || b.fly) continue;
      if (!st.ambush) {
        b.mesh.removeFromParent();
        this.blocks.delete(id);
      }
    }
    this.trap.visible = !!st.ambush;
  }

  private block(def: Barricade): THREE.Group {
    const g = new THREE.Group();
    g.position.set(def.x, groundHeight(def.x, def.z), def.z);
    g.rotation.y = def.axis === 'x' ? 0 : Math.PI / 2;
    const concrete = new THREE.MeshStandardMaterial({ color: '#c9c6bf', roughness: 0.9 });
    const base = new THREE.Mesh(new THREE.BoxGeometry(def.len, 0.35, 0.7), concrete);
    base.position.y = 0.175;
    const top = new THREE.Mesh(new THREE.BoxGeometry(def.len, 0.6, 0.32), new THREE.MeshStandardMaterial({ map: stripes(), roughness: 0.7 }));
    top.position.y = 0.65;
    for (const m of [base, top]) m.castShadow = true;
    g.add(base, top);
    this.scene.add(g);
    return g;
  }

  /** A block rammed aside. */
  knock(id: string, dir: number): void {
    const b = this.blocks.get(id);
    if (!b || b.fly) return;
    b.fly = { vx: Math.sin(dir) * 9 + (Math.random() - 0.5) * 4, vz: Math.cos(dir) * 9 + (Math.random() - 0.5) * 4, vy: 4, spin: (Math.random() - 0.5) * 8, t: 0 };
  }

  setLoads(list: { vehicleId: string; color: string }[]): void {
    const ids = new Set(list.map((l) => l.vehicleId));
    for (const [id, m] of this.loads) {
      if (ids.has(id)) continue;
      m.removeFromParent();
      this.loads.delete(id);
    }
    for (const l of list) {
      if (this.loads.has(l.vehicleId)) continue;
      const m = new THREE.Mesh(new THREE.BoxGeometry(2.44, 2.4, 6), new THREE.MeshStandardMaterial({ map: ribs(l.color, ''), color: '#ffffff', roughness: 0.6, metalness: 0.3 }));
      m.castShadow = true;
      this.scene.add(m);
      this.loads.set(l.vehicleId, m);
    }
  }

  /** The crane lifting a container onto a truck. */
  craneLift(containerId: string, vehicleId: string, sec: number): void {
    const k = findContainer(containerId);
    if (!k) return;
    const cx = (k.box.minX + k.box.maxX) / 2;
    const cz = (k.box.minZ + k.box.maxZ) / 2;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(k.box.maxX - k.box.minX, 2.6, k.box.maxZ - k.box.minZ), new THREE.MeshStandardMaterial({ color: k.color, roughness: 0.6, metalness: 0.3 }));
    mesh.position.set(cx, 1.3, cz);
    this.scene.add(mesh);
    this.boxes.get(containerId)!.group.visible = false;
    this.crane = { mesh, from: mesh.position.clone(), vehicleId, t: 0, sec };
  }

  update(dt: number, serverNow: number, night: number): void {
    this.time += dt;
    const st = this.state;
    for (const b of this.boxes.values()) {
      const v = st?.containers.find((c) => c.id === b.id);
      const open = v?.open ? 1 : 0;
      b.open += (open - b.open) * Math.min(1, dt * 1.6);
      const k = findContainer(b.id)!;
      b.doors.forEach((d, i) => {
        const s = i === 0 ? -1 : 1;
        d.rotation.y = s * k.doorSide * b.open * 1.9 * -1;
      });
      if (!v?.open && b.group.visible === false && !this.crane) b.group.visible = true;
      const color = v?.orderFor ? '#ffb020' : v?.ready ? '#2ee59d' : '#ff3040';
      b.lamp.color.set(color);
      b.lampGlow.material.color.set(color);
      b.lampGlow.material.opacity = 0.4 + 0.4 * night + (v?.cutting ? 0.2 * Math.sin(this.time * 20) : 0);
      this.sparkle(b, dt, !!v?.cutting);
    }
    // Barricade blocks flying aside.
    for (const [id, b] of this.blocks) {
      if (!b.fly) continue;
      const f = b.fly;
      f.t += dt;
      f.vy -= 18 * dt;
      b.mesh.position.x += f.vx * dt;
      b.mesh.position.z += f.vz * dt;
      b.mesh.position.y = Math.max(groundHeight(b.mesh.position.x, b.mesh.position.z), b.mesh.position.y + f.vy * dt);
      b.mesh.rotation.z += f.spin * dt;
      f.vx *= 0.97;
      f.vz *= 0.97;
      if (f.t > 6) {
        b.mesh.removeFromParent();
        this.blocks.delete(id);
      }
    }
    // The trap's lights.
    if (this.trap.visible) {
      const on = Math.floor(this.time * 6) % 2 === 0;
      this.strobes.forEach((s, i) => (s.material.opacity = (i % 2 === 0) === on ? 1 : 0.1));
      for (const f of this.floods) f.intensity = 260;
    } else for (const f of this.floods) f.intensity = 0;
    // The crane's lift: up, across, down onto the truck.
    if (this.crane) {
      const c = this.crane;
      c.t += dt;
      const k = Math.min(1, c.t / c.sec);
      const truck = this.vehicleAt?.(c.vehicleId);
      if (truck) {
        const up = 8 * Math.sin(Math.PI * k);
        c.mesh.position.set(c.from.x + (truck.x - c.from.x) * k, c.from.y + up + (truck.y + 2.6 - c.from.y) * k, c.from.z + (truck.z - c.from.z) * k);
        c.mesh.rotation.y = (truck.rot - Math.PI / 2) * k;
      }
      if (k >= 1) {
        c.mesh.removeFromParent();
        this.crane = null;
      }
    }
    // Containers riding on trucks.
    for (const [id, m] of this.loads) {
      const t = this.vehicleAt?.(id);
      m.visible = !!t;
      if (!t) continue;
      m.position.set(t.x - Math.sin(t.rot) * 0.6, t.y + 2.4, t.z - Math.cos(t.rot) * 0.6);
      m.rotation.y = t.rot;
    }
    void serverNow;
  }

  private sparkle(b: Box, dt: number, on: boolean): void {
    const pos = b.sparks.geometry.getAttribute('position') as THREE.BufferAttribute;
    const k = findContainer(b.id)!;
    const d = containerDoor(k);
    const ox = d.x - b.group.position.x + k.doorSide * 0.1;
    const oz = d.z - b.group.position.z;
    let alive = false;
    for (let i = 0; i < b.sparkLife.length; i++) {
      if (b.sparkLife[i]! <= 0) {
        if (!on || Math.random() > dt * 60) continue;
        b.sparkLife[i] = 0.4 + Math.random() * 0.5;
        pos.setXYZ(i, ox, 1.25, oz);
        b.sparkVel[i * 3] = k.doorSide * (1 + Math.random() * 3);
        b.sparkVel[i * 3 + 1] = Math.random() * 3;
        b.sparkVel[i * 3 + 2] = (Math.random() - 0.5) * 4;
      }
      alive = true;
      b.sparkLife[i]! -= dt;
      b.sparkVel[i * 3 + 1]! -= 9.8 * dt;
      pos.setXYZ(i, pos.getX(i) + b.sparkVel[i * 3]! * dt, Math.max(0.02, pos.getY(i) + b.sparkVel[i * 3 + 1]! * dt), pos.getZ(i) + b.sparkVel[i * 3 + 2]! * dt);
      if (b.sparkLife[i]! <= 0) pos.setXYZ(i, ox, -10, oz);
    }
    pos.needsUpdate = true;
    b.sparks.visible = alive;
  }

  /** The cutting closest to a point (the grinder's whine): distance, Infinity for none. */
  nearestCut(x: number, z: number): number {
    let best = Infinity;
    for (const c of this.state?.containers ?? []) {
      if (!c.cutting) continue;
      const d = containerDoor(findContainer(c.id)!);
      best = Math.min(best, Math.hypot(d.x - x, d.z - z));
    }
    return best;
  }
}
