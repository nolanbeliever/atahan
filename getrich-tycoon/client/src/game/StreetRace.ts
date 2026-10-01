// Street races on the client: the start flag (a pillar of light seen across the city), the ring of
// the next checkpoint, the street racer bots' cars, and the numbers for the race HUD.

import * as THREE from 'three';
import { DEFAULT_MODS } from '../../../shared/customization';
import { RACE, raceRoute, type RaceBotSnap, type RaceRoute, type RacerView, type StreetRaceView } from '../../../shared/streetRace';
import { groundHeight } from '../render/City';
import { createVehicleView, type AnyVehicleView } from '../render/VehicleMesh';

const PERFECT = { engine: 100, transmission: 100, brakes: 100, tires: 100, body: 100, interior: 100, cleanliness: 100 };

interface BotCar {
  view: AnyVehicleView;
  x: number;
  z: number;
  rot: number;
  tx: number;
  tz: number;
  trot: number;
  speed: number;
  seen: boolean;
}

function checkerTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 256;
  const g = c.getContext('2d')!;
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 4; x++) {
      g.fillStyle = (x + y) % 2 === 0 ? '#ffffff' : '#111111';
      g.fillRect(x * 16, y * 16, 16, 16);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class RaceClient {
  readonly group = new THREE.Group();
  view: StreetRaceView | null = null;
  route: RaceRoute | null = null;
  private start = new THREE.Group();
  private beam: THREE.Mesh;
  private ring: THREE.Mesh;
  private ringNext: THREE.Mesh;
  private bots = new Map<number, BotCar>();
  private raceId = '';
  private t = 0;

  constructor(private readonly playerId: () => string) {
    this.group.name = 'streetRace';
    // Start line: two chequered pillars, a banner across, and a tall beam of light.
    const checker = new THREE.MeshStandardMaterial({ map: checkerTexture(), roughness: 0.6 });
    for (const side of [-1, 1]) {
      const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.6, 6, 0.6), checker);
      pillar.position.set(side * 7.2, 3, 0);
      this.start.add(pillar);
    }
    const banner = new THREE.Mesh(new THREE.BoxGeometry(15, 1.2, 0.3), new THREE.MeshStandardMaterial({ color: '#ff3b47', emissive: '#ff3b47', emissiveIntensity: 0.6 }));
    banner.position.set(0, 6, 0);
    this.start.add(banner);
    this.beam = new THREE.Mesh(
      new THREE.CylinderGeometry(3, 3, 160, 20, 1, true),
      new THREE.MeshBasicMaterial({ color: '#ff8a3d', transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, toneMapped: false }),
    );
    this.beam.position.y = 80;
    this.start.add(this.beam);
    this.start.visible = false;
    const ringMat = (color: string, opacity: number) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, toneMapped: false });
    this.ring = new THREE.Mesh(new THREE.CylinderGeometry(RACE.checkpointRadius, RACE.checkpointRadius, 5, 40, 1, true), ringMat('#ffd35a', 0.4));
    this.ringNext = new THREE.Mesh(new THREE.CylinderGeometry(RACE.checkpointRadius, RACE.checkpointRadius, 2.5, 40, 1, true), ringMat('#ffffff', 0.12));
    this.ring.visible = false;
    this.ringNext.visible = false;
    this.group.add(this.start, this.ring, this.ringNext);
  }

  set(v: StreetRaceView | null): void {
    this.view = v;
    this.route = v ? raceRoute(v.routeId) ?? null : null;
    if (!v || v.id !== this.raceId) {
      for (const b of this.bots.values()) b.view.dispose();
      this.bots.clear();
      this.raceId = v?.id ?? '';
    }
    if (this.route) {
      const a = this.route.points[0]!;
      const b = this.route.points[1]!;
      this.start.position.set(a.x, groundHeight(a.x, a.z), a.z);
      this.start.rotation.y = Math.atan2(b.x - a.x, b.z - a.z);
    }
  }

  me(): RacerView | undefined {
    return this.view?.racers.find((r) => r.id === this.playerId());
  }

  get joined(): boolean {
    return !!this.me();
  }

  /** Bot positions from a snapshot. */
  apply(sr: { id: string; cars: RaceBotSnap[] }): void {
    const v = this.view;
    if (!v || sr.id !== v.id) return;
    for (const [i, x, z, rot, speed] of sr.cars) {
      let b = this.bots.get(i);
      if (!b) {
        const r = v.racers[i];
        if (!r) continue;
        const view = createVehicleView({ id: `${v.id}-${i}`, modelId: r.modelId, color: r.color ?? '#d7263d', mods: { ...DEFAULT_MODS }, condition: PERFECT });
        this.group.add(view.root);
        b = { view, x, z, rot, tx: x, tz: z, trot: rot, speed, seen: true };
        this.bots.set(i, b);
      }
      b.tx = x;
      b.tz = z;
      b.trot = rot;
      b.speed = speed;
      b.seen = true;
    }
  }

  /** Where a bot car is now (for the standings). */
  botAt(index: number): { x: number; z: number } | null {
    const b = this.bots.get(index);
    return b ? { x: b.x, z: b.z } : null;
  }

  update(dt: number): void {
    this.t += dt;
    const v = this.view;
    const me = this.me();
    this.start.visible = !!v && (v.phase === 'open' || v.phase === 'countdown');
    (this.beam.material as THREE.MeshBasicMaterial).opacity = 0.16 + 0.08 * Math.sin(this.t * 3);
    // The next checkpoint (and the one after) for a racer.
    const route = this.route;
    if (route && me && !me.dnf && me.place === null && (v!.phase === 'racing' || v!.phase === 'countdown')) {
      const cp = route.points[Math.min(me.next, route.points.length - 1)]!;
      this.ring.visible = true;
      this.ring.position.set(cp.x, groundHeight(cp.x, cp.z) + 2.5, cp.z);
      (this.ring.material as THREE.MeshBasicMaterial).color.set(me.next === route.points.length - 1 ? '#2ee59d' : '#ffd35a');
      this.ring.scale.setScalar(1 + 0.04 * Math.sin(this.t * 5));
      const after = route.points[me.next + 1];
      this.ringNext.visible = !!after;
      if (after) this.ringNext.position.set(after.x, groundHeight(after.x, after.z) + 1.25, after.z);
    } else {
      this.ring.visible = false;
      this.ringNext.visible = false;
    }
    // Bots glide to their latest positions.
    for (const b of this.bots.values()) {
      const k = Math.min(1, dt * 8);
      b.tx += Math.sin(b.trot) * b.speed * dt;
      b.tz += Math.cos(b.trot) * b.speed * dt;
      b.x += (b.tx - b.x) * k;
      b.z += (b.tz - b.z) * k;
      let d = b.trot - b.rot;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      b.rot += d * k;
      b.view.root.position.set(b.x, groundHeight(b.x, b.z), b.z);
      b.view.root.rotation.y = b.rot;
      b.view.animate(b.speed, 0, dt);
    }
  }

  /** Racers ahead of the player + 1 (live position), and the checkpoint count. */
  position(myX: number, myZ: number, others: (id: string) => { x: number; z: number } | null): { place: number; of: number } {
    const v = this.view;
    const route = this.route;
    const me = this.me();
    if (!v || !route || !me) return { place: 0, of: 0 };
    const field = v.racers.filter((r) => !r.dnf);
    const dist = (r: RacerView, at: { x: number; z: number } | null) => {
      const cp = route.points[Math.min(r.next, route.points.length - 1)]!;
      return at ? Math.hypot(at.x - cp.x, at.z - cp.z) : 1e9;
    };
    const mine = dist(me, { x: myX, z: myZ });
    let ahead = 0;
    v.racers.forEach((r, i) => {
      if (r.id === me.id || r.dnf) return;
      if (r.place !== null && (me.place === null || r.place < me.place)) ahead++;
      else if (r.place === null && me.place === null && (r.next > me.next || (r.next === me.next && dist(r, r.bot ? this.botAt(i) : others(r.id)) < mine))) ahead++;
    });
    return { place: me.place ?? ahead + 1, of: field.length };
  }
}
