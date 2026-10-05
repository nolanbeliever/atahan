// The cockpit handover in a Telegram deal car (shared/telegram.ts): the camera sits in the front
// passenger seat looking at the driver; the black bag (siyah poşet) and a stack of money change
// hands; then "DEAL COMPLETED". When the customer is an undercover cop, the driver pulls a badge
// instead, red and blue light fills the car and the sirens start.

import * as THREE from 'three';
import type { DealScene } from '../../../shared/telegram';
import { emojiTexture } from '../render/DealCars';
import type { VehicleView } from '../render/VehicleMesh';

/** A black plastic bag with its handles tied. */
function blackBag(): THREE.Group {
  const g = new THREE.Group();
  const plastic = new THREE.MeshStandardMaterial({ color: '#0b0b0d', roughness: 0.25, metalness: 0.1 });
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.14, 14, 10).scale(1, 1.15, 0.7), plastic);
  const knot = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), plastic);
  knot.position.y = 0.17;
  const handleGeo = new THREE.TorusGeometry(0.045, 0.012, 6, 12);
  for (const s of [-1, 1]) {
    const h = new THREE.Mesh(handleGeo, plastic);
    h.position.set(s * 0.035, 0.21, 0);
    h.rotation.y = s * 0.5;
    g.add(h);
  }
  g.add(body, knot);
  return g;
}

/** A stack of banknotes with a paper band. */
function moneyStack(): THREE.Group {
  const g = new THREE.Group();
  const notes = new THREE.MeshStandardMaterial({ color: '#4f9a52', roughness: 0.8 });
  const band = new THREE.MeshStandardMaterial({ color: '#f1e6c8', roughness: 0.7 });
  for (let i = 0; i < 3; i++) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.025, 0.075), notes);
    m.position.set((i - 1) * 0.01, i * 0.026, (i % 2) * 0.008);
    g.add(m);
  }
  const b = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.085, 0.078), band);
  b.position.y = 0.026;
  g.add(b);
  return g;
}

/** A police badge: a gold shield in a black wallet. */
function badge(): THREE.Group {
  const g = new THREE.Group();
  const wallet = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.16, 0.012), new THREE.MeshStandardMaterial({ color: '#141414', roughness: 0.6 }));
  const shield = new THREE.Mesh(new THREE.CircleGeometry(0.045, 6), new THREE.MeshStandardMaterial({ color: '#d9a527', metalness: 0.9, roughness: 0.25, emissive: '#5a3c00', emissiveIntensity: 0.4 }));
  shield.position.z = 0.008;
  const star = new THREE.Mesh(new THREE.PlaneGeometry(0.05, 0.05), new THREE.MeshBasicMaterial({ map: emojiTexture('⭐', 64), transparent: true }));
  star.position.z = 0.01;
  g.add(wallet, shield, star);
  return g;
}

const smooth = (t: number) => t * t * (3 - 2 * t);
const seg = (t: number, a: number, b: number) => smooth(Math.max(0, Math.min(1, (t - a) / (b - a))));

export class DealCutscene {
  t = 0;
  readonly duration: number;
  done = false;
  private readonly bag = blackBag();
  private readonly cash = moneyStack();
  private readonly badge: THREE.Group | null;
  private readonly strobe: THREE.PointLight | null;
  private readonly fade: HTMLElement;
  private bannerShown = false;
  private readonly tmp = new THREE.Vector3();
  private readonly started = performance.now();

  constructor(
    readonly scene: DealScene,
    private readonly car: VehicleView,
    private readonly onBanner: (s: DealScene) => void,
  ) {
    this.duration = scene.ms / 1000;
    // Props live in the car body's frame (the seats are there too).
    car.body.add(this.bag, this.cash);
    this.badge = scene.cop ? badge() : null;
    if (this.badge) {
      this.badge.visible = false;
      car.body.add(this.badge);
    }
    this.strobe = scene.cop ? new THREE.PointLight('#ff2a2a', 0, 6) : null;
    if (this.strobe) car.body.add(this.strobe);
    // A short fade from black as you sit down.
    this.fade = document.createElement('div');
    this.fade.className = 'deal-fade';
    document.body.appendChild(this.fade);
    requestAnimationFrame(() => this.fade.classList.add('out'));
  }

  /** How close a siren is (m), for the sound: the cop's car is where you are. */
  get sirenDistance(): number {
    return this.scene.cop && this.t > this.duration * 0.42 ? 4 : Infinity;
  }

  update(_dt: number, camera: THREE.PerspectiveCamera): void {
    // Wall-clock time: the handover ends when the server's does, however slow the frames are.
    this.t = (performance.now() - this.started) / 1000;
    const t = this.t / this.duration;
    // In the body's frame (front is +z): the driver's eye point; yours is its mirror.
    const seat = this.car.info?.seat ?? new THREE.Vector3(0.38, 1.15, 0);
    const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
    const eye = v(-seat.x * 1.12, seat.y + 0.02, seat.z - 0.16);
    const driverHands = v(seat.x * 0.75, seat.y - 0.5, seat.z + 0.36);
    const lap = v(-seat.x * 0.8, seat.y - 0.58, seat.z + 0.34);
    const console = v(0, seat.y - 0.38, seat.z + 0.48);
    // Looking across at the driver and the console, a little ahead.
    const look = v(seat.x * 0.8, seat.y - 0.36, seat.z + 0.45);
    this.car.root.updateMatrixWorld(true);
    camera.position.copy(this.car.body.localToWorld(this.tmp.copy(eye)));
    camera.lookAt(this.car.body.localToWorld(look.clone()));
    const lerp3 = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, k: number) => (k < 0.5 ? a.clone().lerp(b, k * 2) : b.clone().lerp(c, (k - 0.5) * 2));
    const buy = this.scene.kind === 'buy';
    // The bag: from the seller's hands over the console to the buyer.
    const bagK = seg(t, 0.12, 0.42);
    const bagFrom = buy ? driverHands : lap;
    const bagTo = buy ? lap : driverHands;
    this.bag.position.copy(lerp3(bagFrom, console, bagTo, bagK));
    this.bag.rotation.y = bagK * 1.2;
    // The money: the other way, a moment later (no money from a cop).
    const cashK = seg(t, 0.44, 0.7);
    const cashFrom = buy ? lap : driverHands;
    const cashTo = buy ? driverHands : lap;
    this.cash.visible = !this.scene.cop;
    this.cash.position.copy(lerp3(cashFrom, console, cashTo, cashK));
    this.cash.rotation.y = -cashK * 0.8;
    if (this.badge && this.strobe) {
      // The cop: the badge comes up in front of your face, the car fills with red and blue.
      const k = seg(t, 0.42, 0.55);
      this.badge.visible = t > 0.42;
      this.badge.position.copy(driverHands.clone().lerp(v(seat.x * 0.15, seat.y - 0.12, seat.z + 0.45), k));
      this.badge.lookAt(this.car.body.localToWorld(eye.clone()));
      const on = t > 0.45;
      this.strobe.position.copy(console).add(new THREE.Vector3(0, 0.5, 0));
      this.strobe.color.set(Math.floor(this.t * 6) % 2 ? '#2a5bff' : '#ff2a2a');
      this.strobe.intensity = on ? 6 : 0;
    }
    if (!this.bannerShown && t >= 0.74) {
      this.bannerShown = true;
      this.onBanner(this.scene);
    }
    if (this.t >= this.duration) this.done = true;
  }

  dispose(): void {
    this.bag.removeFromParent();
    this.cash.removeFromParent();
    this.badge?.removeFromParent();
    this.strobe?.removeFromParent();
    this.fade.remove();
  }
}
