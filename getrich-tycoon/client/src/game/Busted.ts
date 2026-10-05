// The arrest cutscene ("BUSTED!"). The camera leaves the car; a police car with its lights flashing
// pulls up alongside; the driver's door opens and the player steps out with their hands up; an
// officer walks over and handcuffs them; the BUSTED screen shows the fine ("Aracınız bağlandı ve
// $1,500 ceza kesildi"). When it ends the server tows the car to the garage and the player walks
// out of the nearest garage.

import * as THREE from 'three';
import type { BustedEvent } from '../../../shared/police';
import { Anim } from '../../../shared/types';
import { clamp } from '../../../shared/util';
import { groundHeight } from '../render/City';
import { CharacterView, POLICE_OFFICER } from '../render/Character';
import type { EntityViews } from './EntityViews';
import type { PoliceClient } from './Police';

const ease = (t: number) => {
  const u = clamp(t, 0, 1);
  return u * u * (3 - 2 * u);
};

/** Timeline (s). */
const PULL_UP = 1.5;
const STEP_OUT = 1.5;
const HANDS_UP = 2.5;
const OFFICER_WALK = 2.7;
const CUFFED = 4.0;
const BANNER = 3.9;

export class BustedCutscene {
  t = 0;
  readonly duration: number;
  private officer: CharacterView;
  private bannerShown = false;
  private readonly car: { x: number; z: number; rot: number };
  private readonly police: { x: number; z: number; rot: number };
  /** Where the player stands with their hands up (beside the driver's door). */
  private readonly stand: { x: number; z: number };
  private cam = new THREE.Vector3();
  private look = new THREE.Vector3();

  constructor(
    e: BustedEvent,
    private readonly me: string,
    scene: THREE.Scene,
    private readonly entities: EntityViews,
    private readonly policeCars: PoliceClient,
    private readonly vehicleId: string | null,
    appearanceHalfWidth: number,
    private readonly onBanner: () => void,
  ) {
    this.duration = e.cutsceneMs / 1000;
    this.car = e.at;
    // The police car stops on the driver's side (the server's spot), or beside the player on foot.
    const left = { x: Math.cos(e.at.rot), z: -Math.sin(e.at.rot) };
    this.police = e.police ?? { x: e.at.x + left.x * (appearanceHalfWidth + 2.2), z: e.at.z + left.z * (appearanceHalfWidth + 2.2), rot: e.at.rot };
    const side = vehicleId ? appearanceHalfWidth + 0.75 : 0;
    this.stand = { x: e.at.x + left.x * side, z: e.at.z + left.z * side };
    this.officer = new CharacterView(POLICE_OFFICER);
    this.officer.root.visible = false;
    scene.add(this.officer.root);
    if (vehicleId) entities.skipExit.add(me);
  }

  get done(): boolean {
    return this.t >= this.duration;
  }

  private start = performance.now();
  private last = performance.now();

  /** Advance (on the real clock, like the server's); places the camera. */
  update(_dt: number, camera: THREE.PerspectiveCamera): void {
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    this.t = (now - this.start) / 1000;
    const t = this.t;
    const { car, police, stand } = this;
    const fwd = { x: Math.sin(police.rot), z: Math.cos(police.rot) };
    // 1. The police car pulls up alongside, lights flashing, braking to a stop.
    const u = ease(t / PULL_UP);
    const back = (1 - u) * 16;
    this.policeCars.stage({ x: police.x - fwd.x * back, z: police.z - fwd.z * back, rot: police.rot, speed: t < PULL_UP ? (16 / PULL_UP) * 1.5 * (1 - u) : 0, siren: true, brake: t < PULL_UP + 0.3 });
    // 2. The driver's door opens and the player steps out, then raises their hands.
    const rot = car.rot + Math.PI / 2;
    if (this.vehicleId) {
      const open = t < STEP_OUT ? 0 : t < STEP_OUT + 0.35 ? ease((t - STEP_OUT) / 0.35) : t < CUFFED + 0.6 ? 1 : 1 - ease((t - CUFFED - 0.6) / 0.4);
      this.entities.doors.set(this.vehicleId, open);
    }
    if (t >= STEP_OUT || !this.vehicleId) {
      const k = this.vehicleId ? ease((t - STEP_OUT - 0.2) / 0.6) : 1;
      const left = { x: Math.cos(car.rot), z: -Math.sin(car.rot) };
      const inner = { x: car.x + left.x * 0.3, z: car.z + left.z * 0.3 };
      const px = inner.x + (stand.x - inner.x) * k;
      const pz = inner.z + (stand.z - inner.z) * k;
      const pose = t >= CUFFED ? 'cuffed' : t >= HANDS_UP ? 'handsUp' : k < 0.7 && this.vehicleId ? 'duck' : 'none';
      // Cuffed: turned to face the car, the officer behind.
      const facing = t >= CUFFED ? rot + Math.PI : rot;
      this.entities.puppets.set(this.me, { x: px, z: pz, rot: facing, anim: Anim.Idle, pose });
    }
    // 3. The officer gets out of the police car and walks over.
    if (t >= OFFICER_WALK) {
      const from = { x: police.x - Math.cos(police.rot) * 1.1, z: police.z + Math.sin(police.rot) * 1.1 };
      const left = { x: Math.cos(car.rot), z: -Math.sin(car.rot) };
      const to = { x: stand.x + left.x * 0.75, z: stand.z + left.z * 0.75 };
      const k = ease((t - OFFICER_WALK) / (CUFFED - OFFICER_WALK - 0.1));
      const ox = from.x + (to.x - from.x) * k;
      const oz = from.z + (to.z - from.z) * k;
      this.officer.root.visible = true;
      this.officer.root.position.set(ox, groundHeight(ox, oz), oz);
      this.officer.root.rotation.y = k < 1 ? Math.atan2(to.x - from.x, to.z - from.z) : car.rot - Math.PI / 2;
      this.officer.pose = 'none';
      this.officer.animate(k < 0.98 ? Anim.Walk : t >= CUFFED ? Anim.Interact : Anim.Idle, dt);
    }
    if (t >= BANNER && !this.bannerShown) {
      this.bannerShown = true;
      this.onBanner();
    }
    // Camera: first from behind and to the right, watching the police car pull up; then it swings
    // round to the front, looking down the gap between the two cars at the arrest.
    const f = { x: Math.sin(car.rot), z: Math.cos(car.rot) };
    const l = { x: Math.cos(car.rot), z: -Math.sin(car.rot) };
    const y0 = groundHeight(car.x, car.z);
    const wide = { x: car.x - f.x * 9 - l.x * 4, y: y0 + 3.6, z: car.z - f.z * 9 - l.z * 4 };
    const drift = Math.min(1, Math.max(0, t - STEP_OUT) / (this.duration - STEP_OUT));
    const front = { x: stand.x + f.x * (8.5 - drift * 2) + l.x * (1.2 + drift), y: y0 + 2.4 - drift * 0.6, z: stand.z + f.z * (8.5 - drift * 2) + l.z * (1.2 + drift) };
    const k = ease((t - PULL_UP + 0.2) / 1.1);
    this.cam.set(wide.x + (front.x - wide.x) * k, wide.y + (front.y - wide.y) * k, wide.z + (front.z - wide.z) * k);
    const lookCar = { x: (car.x + police.x) / 2, z: (car.z + police.z) / 2 };
    this.look.set(lookCar.x + (stand.x - lookCar.x) * k, y0 + 1 + 0.1 * k, lookCar.z + (stand.z - lookCar.z) * k);
    camera.position.copy(this.cam);
    camera.lookAt(this.look);
  }

  dispose(): void {
    this.entities.puppets.delete(this.me);
    if (this.vehicleId) this.entities.doors.delete(this.vehicleId);
    this.policeCars.stage(null);
    this.officer.root.removeFromParent();
    this.officer.dispose();
  }
}
