// Client side of car theft: the street-parked cars (drawn, solid, hazard lights on the highway
// shoulder, the alarm flashing and wailing), the lockpick prompt, the Sanayi lifts (which bay a car
// is lined up in), the glowing work spots round a car on the lift and the stripping job itself
// (the server times it: start, wait, finish).

import { findHeist } from '../../../shared/heists';
import * as THREE from 'three';
import type { ObstacleVehicle } from '../../../shared/collision';
import { ECONOMY } from '../../../shared/economy.config';
import type { StripResult } from '../../../shared/protocol';
import { bayAt, partLabelTr, partsFor, removedParts, stripPart, STRIP_PARTS, type StreetCar, type StripPart } from '../../../shared/theft';
import type { Vehicle } from '../../../shared/types';
import { getModel } from '../../../shared/vehicles';
import { groundHeight } from '../render/City';
import { lightGlowTexture } from '../render/Highway';
import { Label } from '../render/Labels';
import { createVehicleView, type AnyVehicleView } from '../render/VehicleMesh';
import { h } from '../ui/dom';
import type { Game } from './Game';

const T = ECONOMY.theft;

interface StreetView {
  car: StreetCar;
  view: AnyVehicleView;
  /** Indicator lamps at the four corners (hazards / alarm). */
  blink: THREE.Sprite[];
}

/** A place to work on a car on the lift: one body part, or the engine bay (all engine parts). */
export interface StripTarget {
  vehicleId: string;
  /** A body part, or 'bay' for the engine bay. */
  part: StripPart | 'bay';
  x: number;
  z: number;
  label: string;
  seconds: number;
}

export interface StripJob {
  vehicleId: string;
  part: StripPart;
  /** Server clock (ms). */
  startAt: number;
  readyAt: number;
  finishing: boolean;
  at: { x: number; z: number };
}

const blinkMat = (color: string) => new THREE.SpriteMaterial({ map: lightGlowTexture(), color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 });

/** World position of a point given in a car's frame (x left, z forward). */
function toWorld(v: { x: number; z: number; rotation: number }, local: { x: number; z: number }): { x: number; z: number } {
  const left = { x: Math.cos(v.rotation), z: -Math.sin(v.rotation) };
  const fwd = { x: Math.sin(v.rotation), z: Math.cos(v.rotation) };
  return { x: v.x + left.x * local.x + fwd.x * local.z, z: v.z + left.z * local.x + fwd.z * local.z };
}

/** Where to stand for each part still on a lifted car (engine parts share the engine bay spot). */
export function stripTargets(v: Vehicle): StripTarget[] {
  if (!v.mods.strip) return [];
  const model = getModel(v.modelId);
  const left = new Set(partsFor(model).filter((p) => !removedParts(v.mods).includes(p)));
  const out: StripTarget[] = [];
  let bay: StripTarget | null = null;
  for (const def of STRIP_PARTS) {
    if (!left.has(def.id)) continue;
    const at = toWorld(v, def.point(model.shape.length, model.shape.width));
    if (def.group === 'engine') {
      bay ??= { vehicleId: v.id, part: 'bay', ...at, label: 'Motor Bölmesi', seconds: 0 };
      bay.seconds += def.seconds;
    } else out.push({ vehicleId: v.id, part: def.id, ...at, label: partLabelTr(def.id, model), seconds: def.seconds });
  }
  if (bay) out.push(bay);
  return out;
}

export class TheftClient {
  readonly group = new THREE.Group();
  private cars = new Map<string, StreetView>();

  /** The view of a street car (combat damage). */
  viewOf(id: string): AnyVehicleView | undefined {
    return this.cars.get(id)?.view;
  }

  /** Street cars as boxes (aiming): id, centre, heading, half length and width. */
  boxes(): { id: string; x: number; z: number; rot: number; hl: number; hw: number }[] {
    return [...this.cars.values()].map((c) => ({ id: c.car.id, x: c.car.x, z: c.car.z, rot: c.car.rot, hl: c.view.length / 2, hw: c.view.width / 2 }));
  }
  private alarms = new Map<string, { x: number; z: number; until: number }>();
  private blinkT = 0;
  private markers = new THREE.Group();
  private markerKey = '';
  private markerLabels: Label[] = [];
  private ringMat = new THREE.MeshBasicMaterial({ color: '#ffc53d', transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
  private ringGeo = new THREE.RingGeometry(0.42, 0.62, 32).rotateX(-Math.PI / 2);
  job: StripJob | null = null;
  private ratchetT = 0;
  /** Progress bar for stripping (HUD). */
  readonly hud: HTMLElement;
  private hudLabel: HTMLElement;
  private hudFill: HTMLElement;
  /** Someone wants to know when a part comes off (the engine bay panel). */
  onStripped: ((part: StripPart, r: StripResult) => void) | null = null;

  constructor(private readonly game: Game) {
    this.group.name = 'theft';
    this.group.add(this.markers);
    this.hudLabel = h('div', { class: 'work-label' });
    this.hudFill = h('div');
    this.hud = h('div', { class: 'work-hud', 'data-testid': 'work-hud' }, this.hudLabel, h('div', { class: 'work-bar' }, this.hudFill));
  }

  // ---------------------------------------------------------------- street cars

  sync(cars: StreetCar[]): void {
    const ids = new Set(cars.map((c) => c.id));
    for (const [id, s] of this.cars) {
      if (ids.has(id)) continue;
      s.view.dispose();
      for (const b of s.blink) (b.material as THREE.Material).dispose();
      this.cars.delete(id);
    }
    for (const car of cars) {
      if (car.alarmUntil > this.game.store.serverNow()) this.alarms.set(car.id, { x: car.x, z: car.z, until: car.alarmUntil });
      const old = this.cars.get(car.id);
      if (old) {
        old.car = car;
        continue;
      }
      const view = createVehicleView(car);
      view.root.position.set(car.x, groundHeight(car.x, car.z), car.z);
      view.root.rotation.y = car.rot;
      const blink: THREE.Sprite[] = [];
      const m = getModel(car.modelId).shape;
      for (const [sx, sz] of [
        [1, 1],
        [-1, 1],
        [1, -1],
        [-1, -1],
      ] as const) {
        const s = new THREE.Sprite(blinkMat('#ffa31a'));
        s.position.set(sx * (m.width / 2 - 0.08), m.rideHeight + m.bodyHeight * 0.75, sz * (m.length / 2 - 0.02));
        s.scale.setScalar(0.9);
        view.root.add(s);
        blink.push(s);
      }
      this.group.add(view.root);
      this.cars.set(car.id, { car, view, blink });
    }
  }

  onAlarm(d: { carId: string; x: number; z: number; until: number }): void {
    this.alarms.set(d.carId, { x: d.x, z: d.z, until: d.until });
  }

  /** Street cars as obstacles for local prediction (the server has them too). */
  obstacles(list: ObstacleVehicle[]): void {
    for (const { car } of this.cars.values()) list.push({ id: car.id, modelId: car.modelId, x: car.x, z: car.z, rot: car.rot });
  }

  /** The street car within lockpicking reach, nearest first. */
  nearestCar(x: number, z: number): { car: StreetCar; d: number } | null {
    let best: { car: StreetCar; d: number } | null = null;
    for (const { car } of this.cars.values()) {
      const d = Math.hypot(car.x - x, car.z - z);
      const reach = getModel(car.modelId).shape.length / 2 + Math.min(1.8, T.pickReach);
      if (d <= reach && (!best || d < best.d)) best = { car, d };
    }
    return best;
  }

  alarmOn(carId: string): boolean {
    return (this.alarms.get(carId)?.until ?? 0) > this.game.store.serverNow();
  }

  get count(): number {
    return this.cars.size;
  }

  // ---------------------------------------------------------------- Sanayi

  /** The lift bay the car being driven is lined up in (-1 when none). */
  bayFor(x: number, z: number, rot: number): number {
    return bayAt(x, z, rot);
  }

  /** The nearest place to work on one of my lifted cars, within reach. */
  nearestTarget(x: number, z: number): StripTarget | null {
    let best: StripTarget | null = null;
    let bestD = T.stripReach;
    for (const v of this.game.store.myVehicles()) {
      for (const t of stripTargets(v)) {
        const d = Math.hypot(t.x - x, t.z - z);
        if (d <= bestD) {
          bestD = d;
          best = t;
        }
      }
    }
    return best;
  }

  /** Take a part off: the server starts the clock, we wait, then finish it. */
  async startStrip(vehicleId: string, part: StripPart): Promise<boolean> {
    if (this.job) return false;
    const v = this.game.store.myVehicle(vehicleId);
    if (!v) return false;
    const m = getModel(v.modelId);
    const at = toWorld(v, stripPart(part)!.point(m.shape.length, m.shape.width));
    try {
      const r = await this.game.net.rpc('sanayi.strip', { vehicleId, part });
      if (r.done) {
        this.stripped(part, r);
        return true;
      }
      const now = this.game.store.serverNow();
      this.job = { vehicleId, part, startAt: now, readyAt: Math.max(now + 200, r.readyAt), finishing: false, at };
      this.ratchetT = 0;
      this.hudLabel.textContent = `Sökülüyor: ${partLabelTr(part, m)}`;
      this.hud.classList.add('show');
      return true;
    } catch (err) {
      this.game.ui.error(err);
      return false;
    }
  }

  cancelJob(reason: string | null): void {
    if (!this.job) return;
    this.job = null;
    this.hud.classList.remove('show');
    if (reason) this.game.ui.toast({ kind: 'warning', title: 'Work stopped', text: reason });
  }

  private async finishJob(job: StripJob): Promise<void> {
    job.finishing = true;
    try {
      const r = await this.game.net.rpc('sanayi.strip', { vehicleId: job.vehicleId, part: job.part });
      if (this.job !== job) return;
      if (!r.done) {
        job.readyAt = r.readyAt;
        job.finishing = false;
        return;
      }
      this.job = null;
      this.hud.classList.remove('show');
      this.stripped(job.part, r);
    } catch (err) {
      if (this.job === job) this.cancelJob(null);
      this.game.ui.error(err);
    }
  }

  private stripped(part: StripPart, r: StripResult): void {
    const def = stripPart(part)!;
    this.game.audio.play('clunk');
    const p = this.game.position();
    this.game.effects.floatText(`+ ${def.labelTr}`, new THREE.Vector3(p.x, groundHeight(p.x, p.z) + 2.4, p.z), '#ffc53d');
    if (r.scrapped) this.game.effects.sparkle(new THREE.Vector3(p.x, groundHeight(p.x, p.z) + 1.2, p.z), '#ffc53d', 70);
    this.onStripped?.(part, r);
  }

  // ---------------------------------------------------------------- per frame

  update(dt: number, me: { x: number; z: number }): void {
    const now = this.game.store.serverNow();
    this.blinkT += dt;
    let nearestAlarm = Infinity;
    for (const [id, a] of this.alarms) {
      if (a.until <= now) this.alarms.delete(id);
      else nearestAlarm = Math.min(nearestAlarm, Math.hypot(a.x - me.x, a.z - me.z));
    }
    // Heist targets' alarm bells too.
    for (const id of this.game.heistAlarms) {
      const h = findHeist(id);
      if (h) nearestAlarm = Math.min(nearestAlarm, Math.hypot(h.door.x - me.x, h.door.z - me.z) * 0.6);
    }
    this.game.audio.alarm(nearestAlarm);
    for (const s of this.cars.values()) {
      const alarm = this.alarmOn(s.car.id);
      // Alarm: everything flashes fast with the headlights; broken down: slow hazards.
      const on = alarm ? Math.sin(this.blinkT * Math.PI * 5) > 0 : s.car.highway && Math.sin(this.blinkT * Math.PI * 1.6) > 0;
      for (const b of s.blink) (b.material as THREE.SpriteMaterial).opacity = on ? 0.95 : 0;
      s.view.setLights({ brake: alarm && on, reverse: false, night: alarm && on ? 1 : 0 });
      s.view.animate(0, 0, dt);
    }
    this.updateMarkers();
    // Stripping: progress, tool noises, finish on time, stop when walking away.
    const job = this.job;
    if (job) {
      const k = Math.min(1, (now - job.startAt) / Math.max(1, job.readyAt - job.startAt));
      this.hudFill.style.width = `${Math.round(k * 100)}%`;
      this.ratchetT -= dt;
      if (this.ratchetT <= 0 && k < 1) {
        this.ratchetT = 0.75;
        this.game.audio.play('ratchet');
      }
      if (Math.hypot(me.x - job.at.x, me.z - job.at.z) > T.stripReach + 0.5 || this.game.driving) this.cancelJob('You walked away from the car.');
      else if (!job.finishing && now >= job.readyAt + 60) void this.finishJob(job);
    }
    const t = performance.now() / 1000;
    this.ringMat.opacity = 0.55 + 0.35 * Math.sin(t * 4);
  }

  /** Glowing rings and labels at the work spots round my lifted cars. */
  private updateMarkers(): void {
    const targets = this.game.store.myVehicles().flatMap((v) => stripTargets(v));
    const key = targets.map((t) => `${t.part}:${t.x.toFixed(2)}:${t.z.toFixed(2)}`).join('|');
    if (key === this.markerKey) return;
    this.markerKey = key;
    for (const l of this.markerLabels) {
      l.sprite.removeFromParent();
      l.dispose();
    }
    this.markerLabels = [];
    this.markers.clear();
    for (const t of targets) {
      const y = groundHeight(t.x, t.z);
      const ring = new THREE.Mesh(this.ringGeo, this.ringMat);
      ring.position.set(t.x, y + 0.04, t.z);
      ring.renderOrder = 3;
      this.markers.add(ring);
      const label = new Label(t.label, { color: '#ffc53d', sub: t.part === 'bay' ? 'Engine parts' : `${t.seconds}s`, subColor: '#ffffff', height: 0.42, bg: 'rgba(20,14,2,0.72)' });
      label.sprite.position.set(t.x, y + 1.1, t.z);
      this.markers.add(label.sprite);
      this.markerLabels.push(label);
    }
  }

  clear(): void {
    this.sync([]);
    this.alarms.clear();
    this.cancelJob(null);
  }
}
