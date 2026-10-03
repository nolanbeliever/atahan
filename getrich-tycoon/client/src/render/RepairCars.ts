// The part-time mechanic's customers (shared/mechanic.ts): their damaged cars up on the Sanayi lifts,
// smoke from under the bonnet until the engine is fixed, the bumper and a door hanging off until the
// body is done, the tyres flat until they're changed. The mechanic sees a floating marker at each
// job's spot; everyone sees the cars. And the job board on the hall's west wall.

import * as THREE from 'three';
import { JOB_BOARD, taskPoint, type RepairCar, type RepairTask } from '../../../shared/mechanic';
import { LIFT_BAYS, LIFT_HEIGHT, SANAYI } from '../../../shared/theft';
import type { VehicleMods } from '../../../shared/types';
import { getModel } from '../../../shared/vehicles';
import { emojiTexture } from './DealCars';
import { Tex } from './Textures';
import { VehicleView } from './VehicleMesh';

const CONDITION = { engine: 35, transmission: 80, brakes: 70, tires: 40, body: 45, interior: 70, cleanliness: 40 };
const BASE_MODS: VehicleMods = { paint: null, wheels: 'wheel_stock', tint: 'tint_none', bodyKit: 'kit_none', headlights: 'lights_stock', accessory: 'acc_none' };
const ICON: Record<RepairTask, string> = { engine: '🔧', body: '🔨', tyres: '🛞' };
/** Up on the lift over this long; down again over this long once the jobs are done. */
const RISE_MS = 2600;
const LOWER_MS = 1500;

const ease = (t: number) => {
  const u = Math.max(0, Math.min(1, t));
  return u * u * (3 - 2 * u);
};

interface Entry {
  car: RepairCar;
  view: VehicleView;
  marks: Map<RepairTask, THREE.Sprite>;
  /** When the last job was done (client ms): the lift comes down. */
  doneAt: number | null;
  look: string;
}

export class RepairCarsView {
  readonly group = new THREE.Group();
  private readonly cars = new Map<string, Entry>();
  private readonly tmp = new THREE.Vector3();
  private time = 0;
  private readonly board: THREE.Sprite;

  constructor(private readonly me: () => string | null) {
    this.group.name = 'repair-cars';
    // The job board on the west wall, next to the office.
    const tex = Tex.sign('TAMİRCİ ARANIYOR', { bg: '#1a1208', fg: '#ffc53d', accent: '#ff7a1a', sub: 'ARAÇ BAŞI $1,000 · HEMEN BAŞLA', w: 768, h: 384 });
    const mat = new THREE.MeshStandardMaterial({ map: tex, emissive: '#ffffff', emissiveMap: tex, emissiveIntensity: 0.3, roughness: 0.6 });
    const board = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.2), mat);
    board.position.set(SANAYI.hall.minX + 0.06, 1.9, JOB_BOARD.z);
    board.rotation.y = Math.PI / 2;
    const frame = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.36, 2.56), new THREE.MeshStandardMaterial({ color: '#4a3524', roughness: 0.8 }));
    frame.position.set(SANAYI.hall.minX + 0.02, 1.9, JOB_BOARD.z);
    this.group.add(frame, board);
    // A floating wrench over it while you're not on a shift.
    this.board = new THREE.Sprite(new THREE.SpriteMaterial({ map: emojiTexture('🔧'), transparent: true, depthWrite: false }));
    this.board.scale.setScalar(0.8);
    this.board.position.set(JOB_BOARD.x, 3.1, JOB_BOARD.z);
    this.group.add(this.board);
  }

  /** The cars now on the lifts (replaces the list). */
  set(list: RepairCar[]): void {
    const keep = new Map(list.map((c) => [c.id, c]));
    for (const [id, e] of this.cars) {
      if (keep.has(id)) continue;
      e.view.root.removeFromParent();
      e.view.dispose();
      this.cars.delete(id);
    }
    for (const car of list) {
      const e = this.cars.get(car.id);
      if (!e) this.add(car);
      else {
        e.car = car;
        this.dress(e);
      }
    }
  }

  /** The cars, for the lifts' arms and the prompts. */
  list(): RepairCar[] {
    return [...this.cars.values()].map((e) => e.car);
  }

  mine(): RepairCar | null {
    const me = this.me();
    return [...this.cars.values()].find((e) => e.car.forId === me)?.car ?? null;
  }

  /** How high the car is on its lift right now (m). */
  liftOf(id: string, serverNow: number): number {
    const e = this.cars.get(id);
    if (!e) return 0;
    const up = LIFT_HEIGHT * ease((serverNow - e.car.upAt) / RISE_MS);
    return e.doneAt === null ? up : up * (1 - ease((performance.now() - e.doneAt) / LOWER_MS));
  }

  showBoard(on: boolean): void {
    this.board.visible = on;
  }

  update(dt: number, serverNow: number, smoke: (at: THREE.Vector3, level: number, dt: number) => void): void {
    this.time += dt;
    this.board.position.y = 3.1 + Math.sin(this.time * 2.2) * 0.12;
    for (const e of this.cars.values()) {
      e.view.root.position.y = this.liftOf(e.car.id, serverNow);
      if (e.car.todo.includes('engine')) smoke(e.view.hoodPoint(this.tmp), 1, dt);
      let i = 0;
      for (const m of e.marks.values()) m.position.y = 1.5 + Math.sin(this.time * 2.6 + i++) * 0.12;
    }
  }

  private add(car: RepairCar): void {
    const view = new VehicleView({ modelId: car.modelId, color: car.color, mods: BASE_MODS, condition: CONDITION });
    const bay = LIFT_BAYS[car.bay]!;
    view.root.position.set(bay.x, 0, bay.z);
    view.root.rotation.y = bay.yaw;
    this.group.add(view.root);
    const e: Entry = { car, view, marks: new Map(), doneAt: null, look: '' };
    this.cars.set(car.id, e);
    void view.ready.then(() => this.dress(e));
    this.dress(e);
  }

  /** The damage still to fix, and the markers at the jobs' spots (the mechanic's own car only). */
  private dress(e: Entry): void {
    const todo = e.car.todo;
    const look = todo.join(',');
    if (look !== e.look) {
      e.look = look;
      e.view.update({ modelId: e.car.modelId, color: e.car.color, mods: { ...BASE_MODS, blown: todo.includes('tyres') }, condition: CONDITION });
      e.view.setShotDamage(todo.length ? { glass: false, bumper: todo.includes('body'), doorL: todo.includes('body'), doorR: false, smoke: todo.includes('engine') ? 1 : 0, blown: false } : null);
      if (todo.length === 0 && e.doneAt === null) e.doneAt = performance.now();
    }
    const mine = e.car.forId === this.me();
    const m = getModel(e.car.modelId);
    for (const [task, s] of e.marks) {
      if (mine && todo.includes(task)) continue;
      s.removeFromParent();
      e.marks.delete(task);
    }
    if (!mine) return;
    for (const task of todo) {
      if (e.marks.has(task)) continue;
      const p = taskPoint(e.car.bay, task, m.shape.length, m.shape.width);
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: emojiTexture(ICON[task]), transparent: true, depthWrite: false }));
      s.scale.setScalar(0.55);
      s.position.set(p.x, 1.5, p.z);
      this.group.add(s);
      e.marks.set(task, s);
    }
  }
}
