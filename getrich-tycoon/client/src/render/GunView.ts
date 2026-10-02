// First-person gun: with a gun drawn on foot the camera goes to the eyes and you aim down the gun's
// own sights (no crosshair). Each gun is built so the top of its rear and front sights sits exactly
// on the line through the middle of the screen. Drawn in the overlay pass (on top of the world, like
// the car interior), it bobs while walking, kicks back with every shot and flashes at the muzzle.

import * as THREE from 'three';
import { OVERLAY_LAYER } from './Renderer';

const box = new THREE.BoxGeometry(1, 1, 1);
const mats = new Map<string, THREE.MeshStandardMaterial>();
function mat(color: string, metal = 0.55, rough = 0.4): THREE.MeshStandardMaterial {
  const key = `${color}:${metal}:${rough}`;
  let m = mats.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, metalness: metal, roughness: rough });
    mats.set(key, m);
  }
  return m;
}

interface Built {
  group: THREE.Group;
  /** Muzzle in the gun's space. */
  muzzle: THREE.Vector3;
  /** Where the gun pivots when it kicks (the shooting hand), in the gun's space. */
  pivot: THREE.Vector3;
  /** The part that slides back after a shot (pump or slide), if any. */
  slide: THREE.Object3D | null;
  slideTravel: number;
  /** Barrels that spin (minigun). */
  spin: THREE.Object3D | null;
}

/** Builder: boxes and cylinders in the gun's space (-z forward, sight line at y = 0). */
class Kit {
  readonly group = new THREE.Group();
  constructor(private readonly skin: string, private readonly sleeve: string) {}

  box(m: THREE.Material, sx: number, sy: number, sz: number, x: number, y: number, z: number, rx = 0, parent: THREE.Object3D = this.group): THREE.Mesh {
    const o = new THREE.Mesh(box, m);
    o.scale.set(sx, sy, sz);
    o.position.set(x, y, z);
    o.rotation.x = rx;
    parent.add(o);
    return o;
  }

  /** A cylinder along z. */
  tube(m: THREE.Material, r: number, len: number, x: number, y: number, z: number, parent: THREE.Object3D = this.group, seg = 14): THREE.Mesh {
    const o = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, seg), m);
    o.rotation.x = Math.PI / 2;
    o.position.set(x, y, z);
    parent.add(o);
    return o;
  }

  /** A box stretched between two points (arms). */
  limb(m: THREE.Material, from: THREE.Vector3, to: THREE.Vector3, w: number, h: number): void {
    const o = new THREE.Mesh(box, m);
    const len = from.distanceTo(to);
    o.scale.set(w, h, len);
    o.position.copy(from).add(to).multiplyScalar(0.5);
    o.lookAt(to);
    this.group.add(o);
  }

  /** A hand round a grip at `at` (right hand: side 1), the forearm and sleeve running down and
   *  back out of the bottom of the view. */
  hand(at: THREE.Vector3, side: number, size = 1): void {
    const skin = mat(this.skin, 0, 0.75);
    this.box(skin, 0.052 * size, 0.07 * size, 0.075 * size, at.x, at.y, at.z);
    const elbow = at.clone().add(new THREE.Vector3(0.35 * side, -0.75, 0.55).normalize().multiplyScalar(0.34));
    const wrist = at.clone().lerp(elbow, 0.2);
    this.limb(skin, at, wrist, 0.046 * size, 0.05 * size);
    this.limb(mat(this.sleeve, 0, 0.85), wrist, elbow, 0.07 * size, 0.075 * size);
  }
}

function v(x: number, y: number, z: number): THREE.Vector3 {
  return new THREE.Vector3(x, y, z);
}

function pistol(k: Kit, gold: boolean): Built {
  const s = gold ? 1.22 : 1;
  const body = gold ? mat('#d4af37', 0.95, 0.22) : mat('#26282c', 0.35, 0.5);
  const frame = gold ? mat('#b8962e', 0.9, 0.3) : mat('#1c1d20', 0.3, 0.6);
  const zf = -0.27 - 0.2 * s;
  const slide = new THREE.Group();
  k.group.add(slide);
  // Slide (top 6 mm under the sight line), sights on top of it.
  k.box(body, 0.03 * s, 0.032 * s, 0.2 * s, 0, -0.006 - 0.016 * s, -0.27 - 0.1 * s, 0, slide);
  k.box(mat('#111214', 0.2, 0.5), 0.005, 0.006, 0.008, 0, -0.003, zf + 0.008, 0, slide);
  for (const x of [-0.0085, 0.0085]) k.box(mat('#111214', 0.2, 0.5), 0.008, 0.007, 0.008, x, -0.0025, -0.278, 0, slide);
  // Frame, trigger guard and grip.
  k.box(frame, 0.028 * s, 0.022 * s, 0.17 * s, 0, -0.006 - 0.032 * s - 0.011 * s, -0.27 - 0.1 * s);
  k.box(frame, 0.006, 0.02, 0.05, 0, -0.07 * s, -0.34);
  k.box(frame, 0.03 * s, 0.1 * s, 0.045 * s, 0, -0.1 * s, -0.295, -0.25);
  k.hand(v(0.006, -0.1 * s, -0.29), 1);
  k.hand(v(-0.024, -0.106 * s, -0.305), -1, 0.95);
  return { group: k.group, muzzle: v(0, -0.006 - 0.016 * s, zf - 0.01), pivot: v(0, -0.1 * s, -0.29), slide, slideTravel: 0.03 * s, spin: null };
}

function shotgun(k: Kit): Built {
  const steel = mat('#2a2c30', 0.35, 0.5);
  const wood = mat('#6b4426', 0.05, 0.7);
  k.tube(steel, 0.011, 0.55, 0, -0.013, -0.62);
  k.tube(steel, 0.0095, 0.42, 0, -0.037, -0.56);
  // Bead front sight on the muzzle, a groove on the receiver at the back.
  const bead = new THREE.Mesh(new THREE.SphereGeometry(0.004, 10, 8), mat('#e8e2c8', 0.7, 0.3));
  bead.position.set(0, -0.004, -0.885);
  k.group.add(bead);
  k.box(steel, 0.045, 0.062, 0.2, 0, -0.037, -0.25);
  for (const x of [-0.011, 0.011]) k.box(steel, 0.009, 0.007, 0.04, x, -0.0035, -0.17);
  const pump = new THREE.Group();
  k.group.add(pump);
  k.box(wood, 0.05, 0.045, 0.17, 0, -0.042, -0.52, 0, pump);
  k.box(wood, 0.035, 0.085, 0.05, 0, -0.095, -0.16, -0.4);
  k.box(steel, 0.006, 0.022, 0.05, 0, -0.072, -0.22);
  k.hand(v(0.01, -0.1, -0.16), 1);
  k.hand(v(-0.004, -0.072, -0.52), -1, 1.05);
  return { group: k.group, muzzle: v(0, -0.013, -0.9), pivot: v(0, -0.08, -0.12), slide: pump, slideTravel: 0.09, spin: null };
}

function rifle(k: Kit): Built {
  const steel = mat('#24262a', 0.35, 0.55);
  const wood = mat('#7a4a26', 0.05, 0.65);
  k.box(steel, 0.046, 0.052, 0.32, 0, -0.058, -0.3);
  k.box(steel, 0.03, 0.01, 0.26, 0, -0.033, -0.3);
  // Rear aperture: a ring centred on the sight line.
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.009, 0.0026, 8, 20), steel);
  ring.position.set(0, 0, -0.18);
  k.group.add(ring);
  k.box(steel, 0.008, 0.02, 0.012, 0, -0.021, -0.18);
  // Front sight post with protective ears.
  k.box(mat('#111214', 0.2, 0.5), 0.004, 0.012, 0.006, 0, -0.006, -0.86);
  for (const x of [-0.011, 0.011]) k.box(steel, 0.003, 0.016, 0.008, x, -0.006, -0.86);
  k.box(steel, 0.024, 0.026, 0.024, 0, -0.024, -0.86);
  k.box(wood, 0.052, 0.05, 0.2, 0, -0.056, -0.56);
  k.tube(steel, 0.008, 0.2, 0, -0.03, -0.56);
  k.tube(steel, 0.009, 0.34, 0, -0.056, -0.79);
  k.tube(steel, 0.013, 0.05, 0, -0.056, -0.965);
  // Curved magazine, grip, stock.
  k.box(steel, 0.03, 0.11, 0.06, 0, -0.14, -0.4, 0.25);
  k.box(steel, 0.03, 0.08, 0.055, 0, -0.22, -0.43, 0.5);
  k.box(wood, 0.032, 0.09, 0.045, 0, -0.12, -0.2, -0.35);
  k.hand(v(0.008, -0.12, -0.2), 1);
  k.hand(v(-0.006, -0.075, -0.58), -1, 1.05);
  return { group: k.group, muzzle: v(0, -0.056, -0.99), pivot: v(0, -0.08, -0.12), slide: null, slideTravel: 0, spin: null };
}

function rpg(k: Kit): Built {
  const tubeMat = mat('#4a5a3a', 0.15, 0.7);
  const dark = mat('#1d1f22', 0.4, 0.5);
  k.tube(tubeMat, 0.055, 1.05, 0.1, -0.075, -0.33, k.group, 18);
  const head = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.2, 14), mat('#3c4630', 0.2, 0.6));
  head.rotation.x = -Math.PI / 2;
  head.position.set(0.1, -0.075, -0.95);
  k.group.add(head);
  // Optical sight on a bracket out to the left: a ring round the sight line with a post.
  k.box(dark, 0.075, 0.008, 0.012, 0.05, -0.016, -0.32);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.016, 0.0022, 8, 24), dark);
  ring.position.set(0, 0, -0.32);
  k.group.add(ring);
  k.box(mat('#ff2a3a', 0, 0.4), 0.0022, 0.012, 0.002, 0, -0.006, -0.32);
  k.box(mat('#ff2a3a', 0, 0.3), 0.02, 0.02, 0.04, 0.16, -0.06, -0.55);
  k.box(dark, 0.03, 0.09, 0.05, 0.1, -0.15, -0.3, -0.2);
  k.hand(v(0.1, -0.16, -0.3), 1);
  k.hand(v(0.06, -0.13, -0.52), -1, 1.05);
  return { group: k.group, muzzle: v(0.1, -0.075, -0.86), pivot: v(0.1, -0.075, -0.1), slide: null, slideTravel: 0, spin: null };
}

function minigun(k: Kit): Built {
  const steel = mat('#555b63', 0.8, 0.3);
  const dark = mat('#1d1f22', 0.4, 0.5);
  const spin = new THREE.Group();
  spin.position.set(0.15, -0.21, -0.56);
  k.group.add(spin);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    k.tube(steel, 0.011, 0.62, Math.cos(a) * 0.036, Math.sin(a) * 0.036, 0, spin, 10);
  }
  k.tube(dark, 0.05, 0.06, 0, 0, -0.22, spin);
  k.box(dark, 0.13, 0.13, 0.28, 0.15, -0.21, -0.18);
  k.box(dark, 0.025, 0.05, 0.18, 0.15, -0.13, -0.2);
  k.box(mat('#c8a14a', 0.6, 0.4), 0.08, 0.1, 0.12, 0.02, -0.26, -0.16);
  k.hand(v(0.15, -0.12, -0.22), 1);
  k.hand(v(0.08, -0.22, -0.3), -1, 1.05);
  return { group: k.group, muzzle: v(0.15, -0.21, -0.88), pivot: v(0.15, -0.2, -0.2), slide: null, slideTravel: 0, spin };
}

/** How far each gun sits out along the sight line (m): arm's length for a pistol, the cheek on the
 *  stock for long guns. Moving a gun along the line through the screen's middle keeps its sights
 *  lined up. */
const REACH: Record<number, number> = { 1: 0.2, 2: 0.16, 3: 0.17, 4: 0.17, 5: 0.08, 6: 0 };

function build(slot: number, skin: string, sleeve: string): Built {
  const k = new Kit(skin, sleeve);
  const b = slot === 2 ? shotgun(k) : slot === 3 ? rifle(k) : slot === 4 ? pistol(k, true) : slot === 5 ? rpg(k) : slot === 6 ? minigun(k) : pistol(k, false);
  const shift = new THREE.Vector3(0, 0, -(REACH[slot] ?? 0));
  b.group.position.copy(shift);
  b.muzzle.add(shift);
  b.pivot.add(shift);
  return b;
}

/** A soft star for the muzzle flash. */
function flashTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,230,1)');
  grad.addColorStop(0.25, 'rgba(255,210,110,0.9)');
  grad.addColorStop(0.6, 'rgba(255,120,30,0.35)');
  grad.addColorStop(1, 'rgba(255,90,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

export class GunView {
  /** Follows the camera; `holder` inside it bobs and kicks. */
  readonly root = new THREE.Group();
  private readonly holder = new THREE.Group();
  private built: Built | null = null;
  private slot = 0;
  private look = '';
  private readonly flash: THREE.Mesh;
  private flashT = 0;
  private draw = 0;
  private bob = 0;
  private bobAmp = 0;
  private shove = 0;
  private tilt = 0;
  private slideT = 1;
  private spinSpeed = 0;

  constructor(scene: THREE.Scene) {
    this.root.visible = false;
    this.root.add(this.holder);
    const fm = new THREE.MeshBasicMaterial({ map: flashTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    this.flash = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), fm);
    const cross = this.flash.clone();
    cross.rotation.y = Math.PI / 2;
    this.flash.add(cross);
    this.flash.visible = false;
    this.holder.add(this.flash);
    this.root.traverse((o) => o.layers.set(OVERLAY_LAYER));
    scene.add(this.root);
  }

  /** Which gun (shared/weapons.ts slot; 0 hides it) and the player's skin and sleeve colours. */
  set(slot: number, skin = '#c68642', sleeve = '#2d3748'): void {
    const look = `${slot}:${skin}:${sleeve}`;
    if (look === this.look) return;
    const changed = slot !== this.slot;
    this.look = look;
    this.slot = slot;
    if (this.built) this.holder.remove(this.built.group);
    this.built = slot > 0 ? build(slot, skin, sleeve) : null;
    if (this.built) {
      this.built.group.traverse((o) => o.layers.set(OVERLAY_LAYER));
      this.holder.add(this.built.group);
    }
    // A new gun comes up from below.
    if (changed) this.draw = 0;
  }

  get visible(): boolean {
    return this.root.visible;
  }

  /** A shot: the gun comes back towards you and its muzzle rises; the pump or slide cycles. */
  kick(shove: number, pitch: number): void {
    this.shove = Math.min(0.16, this.shove + shove);
    this.tilt = Math.min(0.3, this.tilt + pitch * 1.5);
    this.flashT = 0.055;
    this.slideT = 0;
    if (this.built?.spin) this.spinSpeed = 40;
    if (this.built) {
      const s = 0.07 + Math.random() * 0.05 + (this.slot === 2 || this.slot === 5 ? 0.08 : 0);
      this.flash.scale.setScalar(s);
      this.flash.position.copy(this.built.muzzle).add(new THREE.Vector3(0, 0, -s * 0.35));
      this.flash.rotation.z = Math.random() * Math.PI;
    }
  }

  /** Where the muzzle is in the world (for the tracer). */
  muzzleWorld(out: THREE.Vector3): THREE.Vector3 | null {
    if (!this.built || !this.root.visible) return null;
    this.holder.updateWorldMatrix(true, false);
    return out.copy(this.built.muzzle).applyMatrix4(this.holder.matrixWorld);
  }

  update(camera: THREE.Camera, on: boolean, dt: number, moving: boolean, running: boolean): void {
    this.root.visible = on && !!this.built;
    if (!this.root.visible) return;
    this.root.position.copy(camera.position);
    this.root.quaternion.copy(camera.quaternion);
    this.draw = Math.min(1, this.draw + dt * 4);
    // Walking bob (bigger when running), settling when you stop.
    this.bobAmp += ((moving ? (running ? 1.8 : 1) : 0) - this.bobAmp) * Math.min(1, dt * 6);
    this.bob += dt * (running ? 13 : 9) * (moving ? 1 : 0.3);
    // The kick settles fast; the muzzle comes back down a little slower.
    this.shove *= Math.exp(-dt * 11);
    this.tilt *= Math.exp(-dt * 8);
    const ease = 1 - (1 - this.draw) ** 3;
    const b = this.built!;
    // The muzzle rises round the shooting hand (and the gun comes up from below when drawn).
    const a = this.tilt - (1 - ease) * 0.6;
    const p = b.pivot;
    const py = p.y - (p.y * Math.cos(a) - p.z * Math.sin(a));
    const pz = p.z - (p.y * Math.sin(a) + p.z * Math.cos(a));
    this.holder.position.set(Math.sin(this.bob) * 0.006 * this.bobAmp, -Math.abs(Math.cos(this.bob)) * 0.007 * this.bobAmp - (1 - ease) * 0.25 + py, this.shove + pz);
    this.holder.rotation.set(a, Math.sin(this.bob * 0.5) * 0.008 * this.bobAmp, 0);
    // Pump / slide: back and forward again.
    if (b.slide) {
      this.slideT = Math.min(1, this.slideT + dt * (this.slot === 2 ? 2.2 : 14));
      const t = this.slot === 2 ? Math.max(0, Math.min(1, (this.slideT - 0.25) / 0.75)) : this.slideT;
      b.slide.position.z = Math.sin(t * Math.PI) * b.slideTravel;
    }
    if (b.spin) {
      b.spin.rotation.z += this.spinSpeed * dt;
      this.spinSpeed *= Math.exp(-dt * 2.5);
    }
    this.flashT -= dt;
    this.flash.visible = this.flashT > 0;
  }
}
