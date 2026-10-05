// First-person cockpit: the generic interior (cockpit.glb) fitted to the car at the driver's seat,
// with live needles (rev counter and speedometer), a steering wheel that turns with the input
// (540-1080 degrees lock to lock, per car), a gear lever that moves through the gate, pedals that
// go down and a small screen showing the gear.

import * as THREE from 'three';
import { cockpitTemplate } from './ModelLibrary';
import { OVERLAY_LAYER } from './Renderer';
import type { AnyVehicleView } from './VehicleMesh';

/** The cockpit model is built for a car this wide (m); it is stretched to the actual width. */
const DESIGN_WIDTH = 1.85;
/** Dial sweep (radians, needle pointing up = 0): 240 degrees, bottom left to bottom right. */
const SWEEP_FROM = (-120 * Math.PI) / 180;
const SWEEP = (240 * Math.PI) / 180;
const DIAL_RPM_MAX = 9000;
const DIAL_KMH_MAX = 360;

export interface CockpitState {
  kmh: number;
  rpm: number;
  gear: number;
  /** Smoothed steering input -1..1 (+1 = full lock left). */
  steer: number;
  /** Steering wheel turns lock to lock (degrees). */
  wheelTurns: number;
  throttle: number;
  brake: number;
  /** Automatic / dual-clutch: the lever stays in D and taps for shifts. */
  automatic: boolean;
  electric: boolean;
  dt: number;
}

export class CockpitRig {
  readonly root = new THREE.Group();
  private wheel: THREE.Object3D | null = null;
  private needleRpm: THREE.Object3D | null = null;
  private needleSpeed: THREE.Object3D | null = null;
  private shifter: THREE.Object3D | null = null;
  private pedalThrottle: THREE.Object3D | null = null;
  private pedalBrake: THREE.Object3D | null = null;
  private screen: { canvas: HTMLCanvasElement; tex: THREE.CanvasTexture; mat: THREE.MeshBasicMaterial } | null = null;
  private shown = '';
  private lastGear = 0;
  private tap = 0;
  private lever = new THREE.Vector2();
  private disposed = false;
  /** Driver's eye in the car's body frame (where the camera goes). */
  readonly eye = new THREE.Vector3();

  constructor(view: AnyVehicleView & { body?: THREE.Group }) {
    void Promise.all([cockpitTemplate(), view.ready]).then(([template]) => {
      if (this.disposed) return;
      const info = view.info;
      const parent = view.body ?? view.root;
      this.eye.copy(info?.seat ?? new THREE.Vector3(0.38, 1.15, 0));
      // A model with its own interior keeps it (the camera still sits at its seat).
      if (info?.interior) {
        parent.add(this.root);
        return;
      }
      const rig = template.clone(true);
      const sx = Math.max(0.75, Math.min(1.35, (info?.width ?? DESIGN_WIDTH) / DESIGN_WIDTH));
      rig.scale.set(sx, 1, 1);
      const eyeNode = rig.getObjectByName('eye');
      const eyeX = (eyeNode?.position.x ?? 0.38) * sx;
      rig.position.set(this.eye.x - eyeX, this.eye.y, this.eye.z);
      // Drawn in the overlay pass, on top of the car's outer shell.
      rig.traverse((o) => {
        o.layers.set(OVERLAY_LAYER);
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        m.castShadow = false;
        m.receiveShadow = false;
      });
      // The instrument binnacle sits on top of the dashboard, above the steering wheel rim.
      const binnacle = rig.getObjectByName('binnacle');
      if (binnacle) binnacle.position.set(binnacle.position.x, -0.24, 0.7);
      const hood = rig.getObjectByName('binnacle_hood');
      if (hood) hood.visible = false;
      this.wheel = rig.getObjectByName('steering_wheel') ?? null;
      this.needleRpm = rig.getObjectByName('needle_rpm') ?? null;
      this.needleSpeed = rig.getObjectByName('needle_speed') ?? null;
      this.shifter = rig.getObjectByName('shifter') ?? null;
      this.pedalThrottle = rig.getObjectByName('pedal_throttle') ?? null;
      this.pedalBrake = rig.getObjectByName('pedal_brake') ?? null;
      const screen = rig.getObjectByName('screen') as THREE.Mesh | undefined;
      if (screen?.isMesh) {
        const canvas = document.createElement('canvas');
        canvas.width = 140;
        canvas.height = 100;
        const tex = new THREE.CanvasTexture(canvas);
        tex.colorSpace = THREE.SRGBColorSpace;
        const mat = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false });
        screen.material = mat;
        this.screen = { canvas, tex, mat };
      }
      this.root.add(rig);
      parent.add(this.root);
    });
  }

  update(s: CockpitState): void {
    const k = Math.min(1, s.dt * 14);
    const dial = (frac: number) => SWEEP_FROM + SWEEP * Math.max(0, Math.min(1, frac));
    // Needles turn clockwise as the driver sees them (their +z rotation).
    if (this.needleRpm) {
      const target = dial(s.electric ? Math.abs(s.kmh) / 250 : s.rpm / DIAL_RPM_MAX);
      this.needleRpm.rotation.z += (target - this.needleRpm.rotation.z) * Math.min(1, s.dt * 20);
    }
    if (this.needleSpeed) {
      const target = dial(Math.abs(s.kmh) / DIAL_KMH_MAX);
      this.needleSpeed.rotation.z += (target - this.needleSpeed.rotation.z) * Math.min(1, s.dt * 10);
    }
    // Steering wheel: full lock is half the lock-to-lock turns; turning left is anticlockwise.
    if (this.wheel) this.wheel.rotation.z = -s.steer * ((s.wheelTurns / 2) * Math.PI) / 180;
    // Pedals hinge at the top; pressed = the pad swings forward.
    if (this.pedalThrottle) this.pedalThrottle.rotation.x += (-0.38 * s.throttle - this.pedalThrottle.rotation.x) * k;
    if (this.pedalBrake) this.pedalBrake.rotation.x += (-0.32 * s.brake - this.pedalBrake.rotation.x) * k;
    // Gear lever: an H gate for manuals, a tap forward/back on sequential / automatic shifts.
    if (s.gear !== this.lastGear) {
      this.tap = s.gear > this.lastGear ? -1 : 1;
      this.lastGear = s.gear;
    }
    this.tap *= Math.exp(-s.dt * 8);
    let gx = 0;
    let gz = 0;
    if (s.automatic || s.electric) gz = s.gear < 0 ? 0.22 : -0.12;
    else if (s.gear < 0) {
      gx = -0.3;
      gz = -0.28;
    } else if (s.gear > 0) {
      const column = Math.floor((s.gear - 1) / 2);
      gx = [0.22, 0, -0.22, -0.3][Math.min(3, column)]!;
      gz = (s.gear - 1) % 2 === 0 ? 0.3 : -0.28;
    }
    this.lever.x += (gx - this.lever.x) * Math.min(1, s.dt * 18);
    this.lever.y += (gz + this.tap * 0.18 - this.lever.y) * Math.min(1, s.dt * 18);
    if (this.shifter) {
      this.shifter.rotation.x = this.lever.y;
      this.shifter.rotation.z = -this.lever.x;
    }
    // Small screen: gear and speed (redrawn only when they change).
    if (this.screen) {
      const gear = s.gear < 0 ? 'R' : s.gear === 0 ? 'N' : s.automatic || s.electric ? `D${s.electric ? '' : s.gear}` : String(s.gear);
      const key = `${gear}|${Math.round(Math.abs(s.kmh))}`;
      if (key !== this.shown) {
        this.shown = key;
        const g = this.screen.canvas.getContext('2d')!;
        g.fillStyle = '#05070a';
        g.fillRect(0, 0, 140, 100);
        g.fillStyle = '#ffc53d';
        g.font = '900 48px system-ui, sans-serif';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText(gear, 70, 40);
        g.fillStyle = '#e8edf2';
        g.font = '800 22px system-ui, sans-serif';
        g.fillText(`${Math.round(Math.abs(s.kmh))} km/h`, 70, 82);
        this.screen.tex.needsUpdate = true;
      }
    }
  }

  dispose(): void {
    this.disposed = true;
    this.root.removeFromParent();
    if (this.screen) {
      this.screen.tex.dispose();
      this.screen.mat.dispose();
    }
  }
}
