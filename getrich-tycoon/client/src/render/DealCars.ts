// The Telegram deal cars (shared/telegram.ts): the supplier's and the customers' cars parked at the
// kerb with somebody at the wheel and a sticker in the rear window (the picture on the phone shows
// the same). The player they wait for sees a small floating marker over theirs.

import * as THREE from 'three';
import type { DealCar } from '../../../shared/telegram';
import { Anim } from '../../../shared/types';
import { CharacterView, NPC_PALETTE } from './Character';
import { surfaceY } from './City';
import { VehicleView } from './VehicleMesh';

const PERFECT = { engine: 100, transmission: 100, brakes: 100, tires: 100, body: 100, interior: 100, cleanliness: 100 };
const MODS = { paint: null, wheels: 'wheel_stock', tint: 'tint_dark', bodyKit: 'kit_none', headlights: 'lights_stock', accessory: 'acc_none' };

/** An emoji on a transparent square (window stickers, markers). */
export function emojiTexture(emoji: string, size = 128): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  g.font = `${Math.round(size * 0.78)}px 'Apple Color Emoji', 'Segoe UI Emoji', 'Noto Color Emoji', sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(emoji, size / 2, size / 2 + size * 0.04);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

interface Entry {
  car: DealCar;
  view: VehicleView;
  driver: CharacterView;
  marker: THREE.Sprite | null;
}

export class DealCarsView {
  readonly group = new THREE.Group();
  private readonly cars = new Map<string, Entry>();
  private time = 0;

  constructor(private readonly me: () => string | null) {
    this.group.name = 'deal-cars';
  }

  /** The cars now parked (replaces the list). */
  set(list: DealCar[]): void {
    const keep = new Set(list.map((c) => c.id));
    for (const [id, e] of this.cars) {
      if (keep.has(id)) continue;
      e.view.root.removeFromParent();
      this.cars.delete(id);
    }
    for (const car of list) if (!this.cars.has(car.id)) this.add(car);
  }

  get(id: string): Entry | undefined {
    return this.cars.get(id);
  }

  /** The deal cars waiting for the local player. */
  mine(): DealCar[] {
    const me = this.me();
    return [...this.cars.values()].filter((e) => e.car.forId === me).map((e) => e.car);
  }

  /** Collision boxes of the parked cars are the server's; this only animates the markers. */
  update(dt: number): void {
    this.time += dt;
    for (const e of this.cars.values()) {
      e.driver.animate(Anim.Idle, dt);
      if (e.marker) e.marker.position.y = (e.view.info?.height ?? 1.5) + 1.2 + Math.sin(this.time * 2.5) * 0.15;
    }
  }

  private add(car: DealCar): void {
    const view = new VehicleView({ modelId: car.modelId, color: car.color, mods: MODS, condition: PERFECT });
    view.root.position.set(car.x, surfaceY(car.x, car.z), car.z);
    view.root.rotation.y = car.rot;
    const driver = new CharacterView(NPC_PALETTE[(car.id.length + car.sticker.length) % NPC_PALETTE.length]!);
    driver.pose = 'sit';
    view.driverMount.add(driver.root);
    // The sticker in the rear window, once the model's size is known.
    void view.ready.then(() => {
      const len = view.length;
      const h = view.info?.height ?? 1.45;
      const sticker = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.34), new THREE.MeshBasicMaterial({ map: emojiTexture(car.sticker), transparent: true, depthWrite: false }));
      sticker.position.set(0.32, h - 0.38, -len / 2 + 0.42);
      sticker.rotation.set(-0.35, Math.PI, 0);
      sticker.name = 'deal-sticker';
      view.root.add(sticker);
    });
    let marker: THREE.Sprite | null = null;
    if (car.forId === this.me()) {
      marker = new THREE.Sprite(new THREE.SpriteMaterial({ map: emojiTexture(car.kind === 'supplier' ? '📦' : '🤝'), transparent: true, depthWrite: false }));
      marker.scale.setScalar(1.1);
      view.root.add(marker);
    }
    this.group.add(view.root);
    this.cars.set(car.id, { car, view, driver, marker });
  }
}
