// What a stolen car up on a Sanayi lift shows underneath and inside: the engine bay (engine block,
// gearbox, turbo, radiator, alternator, battery, ECU), the exhaust with its catalytic converter and
// silencer, and the seats and steering wheel (from the generic cockpit model). Each part disappears
// when it is stripped. The car's own mirrors and doors come off in VehicleMesh (named model nodes).

import * as THREE from 'three';
import type { StripPart } from '../../../shared/theft';
import { getModel } from '../../../shared/vehicles';
import { cockpitTemplate } from './ModelLibrary';
import type { AnyVehicleView } from './VehicleMesh';

const DESIGN_WIDTH = 1.85;

const mats = {
  iron: new THREE.MeshStandardMaterial({ name: 'strip_iron', color: '#3b3f45', metalness: 0.75, roughness: 0.45 }),
  alu: new THREE.MeshStandardMaterial({ name: 'strip_alu', color: '#b7bdc4', metalness: 0.85, roughness: 0.32 }),
  black: new THREE.MeshStandardMaterial({ name: 'strip_black', color: '#141518', metalness: 0.2, roughness: 0.7 }),
  exhaust: new THREE.MeshStandardMaterial({ name: 'strip_exhaust', color: '#6e5d4c', metalness: 0.8, roughness: 0.5 }),
  rad: new THREE.MeshStandardMaterial({ name: 'strip_radiator', color: '#2a2d31', metalness: 0.6, roughness: 0.55 }),
  red: new THREE.MeshStandardMaterial({ name: 'strip_red', color: '#c0392b', roughness: 0.5 }),
  copper: new THREE.MeshStandardMaterial({ name: 'strip_copper', color: '#b0703a', metalness: 0.9, roughness: 0.35 }),
};

function box(mat: THREE.Material, w: number, h: number, d: number, x: number, y: number, z: number): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}

/** A cylinder along the car's length (z). */
function tube(mat: THREE.Material, r: number, len: number, x: number, y: number, z: number, r2 = r): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r2, len, 14), mat);
  m.rotation.x = Math.PI / 2;
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}

export class StripRig {
  readonly root = new THREE.Group();
  private parts = new Map<StripPart, THREE.Object3D[]>();
  private removed = new Set<string>();
  private disposed = false;
  private geos: THREE.BufferGeometry[] = [];

  constructor(view: AnyVehicleView & { body?: THREE.Group }, modelId: string) {
    this.root.name = 'strip_rig';
    const vm = getModel(modelId);
    const l = view.length;
    const w = view.width;
    const floor = vm.shape.rideHeight;
    const electric = vm.specs.aspiration === 'electric';
    const front = l / 2;
    const add = (part: StripPart, ...objs: THREE.Object3D[]) => {
      for (const o of objs) this.root.add(o);
      this.parts.set(part, [...(this.parts.get(part) ?? []), ...objs]);
    };
    // Engine block with its sump hanging just below the floor, rocker cover on top.
    const ez = front - 0.95;
    if (electric) {
      add('engine', tube(mats.alu, 0.22, 0.5, 0, floor + 0.2, ez), tube(mats.copper, 0.12, 0.54, 0, floor + 0.2, ez));
    } else {
      add('engine', box(mats.iron, 0.6, 0.42, 0.72, 0, floor + 0.25, ez), box(mats.black, 0.5, 0.12, 0.6, 0, floor + 0.01, ez), box(mats.alu, 0.46, 0.08, 0.62, 0, floor + 0.5, ez));
    }
    // Gearbox (bell housing tapering back) behind the engine.
    add('gearbox', tube(mats.alu, 0.24, 0.75, 0, floor + 0.16, ez - 0.75, 0.15));
    // Turbo: a snail on the exhaust side with its downpipe.
    add('turbo', tube(mats.iron, 0.13, 0.12, -0.42, floor + 0.32, ez + 0.1), tube(mats.alu, 0.08, 0.16, -0.42, floor + 0.32, ez + 0.22), tube(mats.exhaust, 0.045, 0.3, -0.42, floor + 0.12, ez - 0.05));
    // Radiator behind the grille.
    add('radiator', box(mats.rad, Math.min(0.72 * w, 1.3), 0.44, 0.06, 0, floor + 0.32, front - 0.3), box(mats.black, 0.08, 0.06, 0.3, 0.3, floor + 0.12, front - 0.47));
    // Alternator on the front of the engine (none on an electric car: it has its DC-DC unit).
    add('alternator', tube(mats.alu, 0.085, 0.15, 0.24, floor + 0.36, ez + 0.44));
    // Battery and the ECU on either side of the bay.
    add('battery', box(mats.black, 0.3, 0.2, 0.18, w / 2 - 0.42, floor + 0.42, ez + 0.2), box(mats.red, 0.04, 0.04, 0.04, w / 2 - 0.5, floor + 0.54, ez + 0.25));
    add('ecu', box(mats.alu, 0.2, 0.05, 0.16, -(w / 2 - 0.4), floor + 0.46, ez + 0.25));
    // Exhaust: pipe along the floor, catalytic converter, silencer at the back.
    if (!electric) {
      const run = front - 1.4 + l / 2 - 0.25;
      const mid = (front - 1.4 - (l / 2 - 0.25)) / 2;
      add(
        'exhaust',
        tube(mats.exhaust, 0.045, run, -0.22, floor - 0.02, mid),
        tube(mats.exhaust, 0.11, 0.38, -0.22, floor - 0.02, front - 1.75),
        box(mats.exhaust, 0.5, 0.2, 0.36, -0.22, floor + 0.02, -l / 2 + 0.45),
      );
    }
    this.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) this.geos.push(m.geometry);
    });
    (view.body ?? view.root).add(this.root);
    // Seats and the steering wheel from the cockpit model, fitted at the driver's seat.
    void Promise.all([cockpitTemplate(), view.ready])
      .then(([template]) => {
        if (this.disposed || view.info?.interior) return;
        const rig = template.clone(true);
        const eye = view.info?.seat ?? new THREE.Vector3(0.38, 1.15, 0);
        const sx = Math.max(0.75, Math.min(1.35, (view.info?.width ?? DESIGN_WIDTH) / DESIGN_WIDTH));
        rig.scale.set(sx, 1, 1);
        const eyeX = (rig.getObjectByName('eye')?.position.x ?? 0.38) * sx;
        rig.position.set(eye.x - eyeX, eye.y, eye.z);
        const keep = new Set(['seat_left', 'seat_right', 'steering_column', 'dash', 'dash_top', 'dash_trim', 'console', 'floor', 'eye']);
        for (const c of [...rig.children]) c.visible = keep.has(c.name);
        const seats = ['seat_left', 'seat_right'].map((n) => rig.getObjectByName(n)).filter((o): o is THREE.Object3D => !!o);
        const wheel = rig.getObjectByName('steering_column');
        this.parts.set('seats', seats);
        if (wheel) this.parts.set('steering', [wheel]);
        this.root.add(rig);
        this.apply();
      })
      .catch(() => undefined);
  }

  /** Hide the parts that have come off. */
  set(removed: readonly string[]): void {
    const next = new Set(removed);
    if (next.size === this.removed.size && [...next].every((p) => this.removed.has(p))) return;
    this.removed = next;
    this.apply();
  }

  private apply(): void {
    for (const [part, objs] of this.parts) for (const o of objs) o.visible = !this.removed.has(part);
  }

  dispose(): void {
    this.disposed = true;
    this.root.removeFromParent();
    for (const g of this.geos) g.dispose();
  }
}
