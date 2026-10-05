// Crime scenes (olay yeri). The police got to a reported scene and the suspect was gone: they tape
// it off. Cones round a ring with the yellow-black tape between them, red road flares, numbered
// evidence markers (shell casings, blood, broken glass), and two officers out of the cars who comb
// the area with their torches and kneel at each marker to photograph it. The cars stay with their
// lights flashing (no siren). After ECONOMY.police.scene.lifeSec the officers walk back, the cars
// drive back to the station and the props are cleared away.
//
// Anybody may stand outside the tape and watch (unarmed, not wanted). Crossing the tape (on foot
// or in a car), a gun out close by, or hanging round right next to an officer is tampering: the
// police service raises the wanted level (1 star) and the officers give a stop warning.

import { ECONOMY } from '../../../shared/economy.config';
import { OFFENCES, insideCordon, planCordon, type CrimeSceneView, type OffenceId } from '../../../shared/police';
import { bridgeByN, crossesWater, inFootprint } from '../../../shared/strait';
import { Anim } from '../../../shared/types';
import { angleDiff } from '../../../shared/util';
import type { Ctx } from '../context';
import type { NpcEntity } from '../simulation';
import type { Unit } from './police';

const S = ECONOMY.police.scene;
const WALK = 1.3;
const RUN = 3.6;

type Phase = 'walk' | 'kneel' | 'guard' | 'back' | 'halt' | 'board' | 'dead';

interface Officer {
  npc: NpcEntity;
  /** Its car, and which side it gets out (+1 / -1). */
  car: Unit;
  side: number;
  /** Evidence to look at (stand here, facing it), and which one is next. */
  tasks: { x: number; z: number; rot: number }[];
  step: number;
  /** Where it stands guard afterwards, facing out. */
  guard: { x: number; z: number; rot: number };
  phase: Phase;
  /** End of a kneel or of a stop warning (ms), and what it went back to after the warning. */
  until: number;
  resume: Phase;
  /** Who it is warning (a stop warning). */
  haltAt: string | null;
  hp: number;
}

export interface CrimeScene {
  id: number;
  x: number;
  z: number;
  deck: number;
  what: OffenceId;
  view: CrimeSceneView;
  units: Unit[];
  officers: Officer[];
  /** Cleared away at (ms). */
  until: number;
  /** Seconds each player has stood right next to an officer, and when each was last warned (ms). */
  loiter: Map<string, number>;
  warned: Map<string, number>;
  packing: boolean;
}

export interface SceneHooks {
  /** A player tampered with a scene (why, in words). */
  tamper(playerId: string, scene: CrimeScene, reason: string): void;
  /** The scene is over: its cars go back to the station. */
  done(units: Unit[]): void;
  /** A gun in the hand. */
  armed(playerId: string): boolean;
  /** Already wanted (their crimes are handled by the pursuit). */
  wanted(playerId: string): boolean;
}

let seq = 1;
let officerSeq = 1;

export class CrimeScenes {
  private scenes = new Map<number, CrimeScene>();
  private checkAt = 0;

  constructor(
    private readonly ctx: Ctx,
    private readonly hooks: SceneHooks,
  ) {}

  /** Tape off a scene round (x, z) with the cars that got there. */
  open(units: Unit[], x: number, z: number, deck: number, what: OffenceId, now = Date.now()): CrimeScene {
    const boxes = this.ctx.sim.collisionWorld.boxes;
    const bridge = deck ? bridgeByN(deck) : undefined;
    const blocked = (px: number, pz: number): boolean => {
      if (bridge) return !inFootprint(bridge, px, pz, -1.5);
      if (crossesWater(x, z, px, pz)) return true;
      return boxes.some((b) => px > b.minX - 0.4 && px < b.maxX + 0.4 && pz > b.minZ - 0.4 && pz < b.maxZ + 0.4);
    };
    const layout = planCordon(x, z, S.radius, S.posts, OFFENCES[what].evidence, blocked, () => this.ctx.rng());
    const id = seq++;
    const until = now + S.lifeSec * 1000;
    const view: CrimeSceneView = { id, x: round(x), z: round(z), deck, ...layout, until, what: OFFENCES[what].radio };
    const scene: CrimeScene = { id, x, z, deck, what, view, units, officers: [], until, loiter: new Map(), warned: new Map(), packing: false };
    for (const u of units) {
      u.mode = 'scene';
      u.parked = true;
      u.dyn.speed = 0;
    }
    // Two officers: from the car nearest the scene (one each side), or one from each of two cars.
    const cars = [...units].sort((a, b) => Math.hypot(a.dyn.x - x, a.dyn.z - z) - Math.hypot(b.dyn.x - x, b.dyn.z - z));
    for (let i = 0; i < 2 && cars.length > 0; i++) {
      const car = cars[Math.min(i, cars.length - 1)]!;
      const side = i === 0 ? 1 : -1;
      const door = doorOf(car, side);
      // Every other evidence marker; with none, a couple of spots inside the ring.
      const marks = layout.evidence.filter((_, k) => k % 2 === i);
      const tasks = (marks.length ? marks : [[x + (i ? -2 : 2), z + 1.5] as const]).map(([ex, ez]) => {
        const a = Math.atan2(door.x - ex, door.z - ez);
        return { x: ex + Math.sin(a) * 0.85, z: ez + Math.cos(a) * 0.85, rot: a + Math.PI };
      });
      const post = layout.posts[Math.floor((i * layout.posts.length) / 2) % layout.posts.length]!;
      const out = Math.atan2(post[0] - x, post[1] - z);
      const guard = { x: post[0] - Math.sin(out) * 1.2, z: post[1] - Math.cos(out) * 1.2, rot: out };
      const npc: NpcEntity = { id: `csi_${officerSeq++}`, x: door.x, z: door.z, rot: car.dyn.rot, anim: Anim.TorchWalk, style: 0 };
      scene.officers.push({ npc, car, side, tasks, step: 0, guard, phase: 'walk', until: 0, resume: 'walk', haltAt: null, hp: ECONOMY.combat.officerHp });
      this.ctx.sim.npcs.set(npc.id, npc);
    }
    this.scenes.set(id, scene);
    this.ctx.hub.broadcast('police.scene', view);
    return scene;
  }

  /** The taped-off scene nearest a point within `dist` m that still has a car there. */
  near(x: number, z: number, dist: number): CrimeScene | undefined {
    let best: CrimeScene | undefined;
    let bestD = dist;
    for (const s of this.scenes.values()) {
      if (s.packing || s.units.length === 0) continue;
      const d = Math.hypot(s.x - x, s.z - z);
      if (d < bestD) {
        best = s;
        bestD = d;
      }
    }
    return best;
  }

  /**
   * Take the car nearest a point off a scene (it goes after somebody). Its officers run back to it
   * (`holdSec` from now they are in); the others give a stop warning to `haltAt` meanwhile.
   */
  take(scene: CrimeScene, at: { x: number; z: number }, holdSec: number, haltAt: string | null, now = Date.now()): Unit | null {
    if (scene.units.length === 0) return null;
    const u = scene.units.reduce((a, b) => (Math.hypot(b.dyn.x - at.x, b.dyn.z - at.z) < Math.hypot(a.dyn.x - at.x, a.dyn.z - at.z) ? b : a));
    scene.units = scene.units.filter((x) => x !== u);
    for (const o of scene.officers) {
      if (o.phase === 'dead') continue;
      if (haltAt) {
        o.resume = o.phase === 'halt' ? o.resume : o.phase;
        o.phase = 'halt';
        o.haltAt = haltAt;
        o.until = now + Math.max(0.5, holdSec - (o.car === u ? 1.6 : 0)) * 1000;
      }
      // The car's own officers get back in.
      if (o.car === u) {
        o.resume = 'board';
        if (!haltAt) o.phase = 'board';
      }
    }
    return u;
  }

  /** People bullets can hit (combat). */
  officers(): NpcEntity[] {
    const out: NpcEntity[] = [];
    for (const s of this.scenes.values()) for (const o of s.officers) if (o.phase !== 'dead') out.push(o.npc);
    return out;
  }

  /** An officer was shot (down at zero health). */
  hitOfficer(id: string, amount: number): void {
    for (const s of this.scenes.values()) {
      const o = s.officers.find((x) => x.npc.id === id);
      if (!o || o.phase === 'dead') continue;
      o.hp -= amount;
      if (o.hp > 0) return;
      o.phase = 'dead';
      o.npc.anim = Anim.Dead;
      return;
    }
  }

  /** Every scene's cars (snapshots, obstacles). */
  unitGroups(): Unit[][] {
    return [...this.scenes.values()].map((s) => s.units);
  }

  /** The scenes up now (a player who just connected). */
  views(): CrimeSceneView[] {
    return [...this.scenes.values()].map((s) => s.view);
  }

  get size(): number {
    return this.scenes.size;
  }

  /** Scene by id (tests). */
  get(id: number): CrimeScene | undefined {
    return this.scenes.get(id);
  }

  forget(playerId: string): void {
    for (const s of this.scenes.values()) {
      s.loiter.delete(playerId);
      s.warned.delete(playerId);
    }
  }

  // ---------------------------------------------------------------- tick

  tick(dt: number, now = Date.now()): void {
    if (this.scenes.size === 0) return;
    const check = now >= this.checkAt;
    if (check) this.checkAt = now + 200;
    for (const [id, s] of this.scenes) {
      if (now >= s.until) {
        this.close(id, s);
        continue;
      }
      // Packing up: everybody back to the cars.
      if (!s.packing && now >= s.until - 7000) {
        s.packing = true;
        for (const o of s.officers) if (o.phase !== 'dead') o.phase = 'back';
      }
      for (const o of s.officers) this.officer(o, dt, now);
      // Officers getting back into a car that is leaving: gone once they are in (or it went).
      s.officers = s.officers.filter((o) => {
        if (o.phase !== 'board') return true;
        const door = doorOf(o.car, o.side);
        if (Math.hypot(o.npc.x - door.x, o.npc.z - door.z) > 0.5 && o.car.parked) return true;
        this.ctx.sim.npcs.delete(o.npc.id);
        return false;
      });
      if (check && !s.packing) this.watch(s, 0.2, now);
    }
  }

  private close(id: number, s: CrimeScene): void {
    for (const o of s.officers) this.ctx.sim.npcs.delete(o.npc.id);
    this.scenes.delete(id);
    this.ctx.hub.broadcast('police.sceneEnd', { id });
    if (s.units.length) this.hooks.done(s.units);
  }

  /** One officer's step: walk to the evidence with the torch, kneel and photograph, then stand guard. */
  private officer(o: Officer, dt: number, now: number): void {
    const n = o.npc;
    const walkTo = (x: number, z: number, speed: number, anim: number): boolean => {
      const dx = x - n.x;
      const dz = z - n.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.12) return true;
      const step = Math.min(d, speed * dt);
      n.x += (dx / d) * step;
      n.z += (dz / d) * step;
      n.rot += angleDiff(n.rot, Math.atan2(dx, dz)) * Math.min(1, dt * 8);
      n.anim = anim;
      return false;
    };
    switch (o.phase) {
      case 'dead':
        return;
      case 'walk': {
        const t = o.tasks[o.step];
        if (!t) {
          o.phase = 'guard';
          return;
        }
        if (walkTo(t.x, t.z, WALK, Anim.TorchWalk)) {
          o.phase = 'kneel';
          o.until = now + 4500 + this.ctx.rng() * 2000;
        }
        return;
      }
      case 'kneel': {
        const t = o.tasks[o.step]!;
        n.rot += angleDiff(n.rot, t.rot) * Math.min(1, dt * 6);
        n.anim = Anim.Kneel;
        if (now >= o.until) {
          o.step++;
          o.phase = o.step < o.tasks.length ? 'walk' : 'guard';
        }
        return;
      }
      case 'guard':
        if (walkTo(o.guard.x, o.guard.z, WALK, Anim.TorchWalk)) {
          // Looking out over the tape, now and then glancing round.
          n.rot += angleDiff(n.rot, o.guard.rot + Math.sin(now / 2600 + n.x) * 0.7) * Math.min(1, dt * 2);
          n.anim = Anim.TorchIdle;
        }
        return;
      case 'back': {
        const door = doorOf(o.car, o.side);
        if (walkTo(door.x, door.z, WALK, Anim.TorchWalk)) n.anim = Anim.Idle;
        return;
      }
      case 'board': {
        const door = doorOf(o.car, o.side);
        walkTo(door.x, door.z, RUN, Anim.Run);
        return;
      }
      case 'halt': {
        // Gun out at whoever crossed the line: "DUR! POLİS!".
        const c = o.haltAt ? this.ctx.sim.chars.get(o.haltAt) : undefined;
        const p = c ? (c.drivingId ? this.ctx.sim.drives.get(c.drivingId)?.dyn : c) : undefined;
        if (p) n.rot += angleDiff(n.rot, Math.atan2(p.x - n.x, p.z - n.z)) * Math.min(1, dt * 8);
        n.anim = Anim.Aim;
        if (now >= o.until) {
          o.phase = o.resume === 'halt' ? 'guard' : o.resume;
          o.haltAt = null;
        }
        return;
      }
    }
  }

  /** Tampering: through the tape, a gun out close by, or right up against an officer. */
  private watch(s: CrimeScene, dt: number, now: number): void {
    for (const c of this.ctx.sim.chars.values()) {
      if (c.dead || c.ridingId || this.hooks.wanted(c.id)) {
        s.loiter.delete(c.id);
        continue;
      }
      const d = c.drivingId ? this.ctx.sim.drives.get(c.drivingId) : undefined;
      const x = d ? d.dyn.x : c.x;
      const z = d ? d.dyn.z : c.z;
      const deck = d ? d.dyn.deck ?? 0 : c.deck ?? 0;
      if (deck !== s.deck || Math.hypot(x - s.x, z - s.z) > S.radius + S.armedDist + 6) {
        s.loiter.delete(c.id);
        continue;
      }
      let reason: string | null = null;
      if (insideCordon(s.view.posts, x, z)) {
        reason = d ? 'Emniyet şeridini araçla yardın!' : 'Emniyet şeridinin içine girdin!';
        if (d) this.breakTape(s, x, z);
      } else if (!d && this.hooks.armed(c.id) && Math.hypot(x - s.x, z - s.z) < S.armedDist) {
        reason = 'Olay yerine silahla yaklaştın!';
      } else if (!d) {
        const close = s.officers.some((o) => o.phase !== 'dead' && Math.hypot(o.npc.x - x, o.npc.z - z) < S.closeDist);
        const t = close ? (s.loiter.get(c.id) ?? 0) + dt : 0;
        s.loiter.set(c.id, t);
        if (t >= S.loiterSec) reason = 'Polisin dibinde şüpheli şekilde dolaştın!';
      }
      if (!reason || now - (s.warned.get(c.id) ?? -Infinity) < 20_000) continue;
      s.warned.set(c.id, now);
      s.loiter.delete(c.id);
      this.hooks.tamper(c.id, s, reason);
    }
  }

  /** A car through the tape: the segment it went through snaps (everyone sees it hang loose). */
  private breakTape(s: CrimeScene, x: number, z: number): void {
    const p = s.view.posts;
    let best = -1;
    let bestD = Infinity;
    for (let k = 0; k < p.length; k++) {
      const [ax, az] = p[k]!;
      const [bx, bz] = p[(k + 1) % p.length]!;
      const d = segDist(x, z, ax, az, bx, bz);
      if (d < bestD) {
        bestD = d;
        best = k;
      }
    }
    const broken = s.view.broken ?? [];
    if (best < 0 || broken.includes(best) || s.view.gaps.includes(best)) return;
    s.view = { ...s.view, broken: [...broken, best] };
    this.ctx.hub.broadcast('police.scene', s.view);
  }
}

/** Beside a car's front door (+1: the left / driver's side). */
function doorOf(car: Unit, side: number): { x: number; z: number } {
  return { x: car.dyn.x + Math.cos(car.dyn.rot) * 1.6 * side + Math.sin(car.dyn.rot) * 0.4, z: car.dyn.z - Math.sin(car.dyn.rot) * 1.6 * side + Math.cos(car.dyn.rot) * 0.4 };
}

function round(v: number): number {
  return Math.round(v * 100) / 100;
}

function segDist(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax;
  const dz = bz - az;
  const l2 = dx * dx + dz * dz;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / l2)) : 0;
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
}
