// Wanted level, police response and pursuits: what the client needs to know (the logic lives in
// server/game/services/police.ts and crimeScene.ts).

import { POLICE_STATIONS } from './compounds';
import { DOCKS } from './farShore';
import { CARRIAGEWAY_EDGE, projectToHighway } from './highway';
import { inSanayi } from './sanayiLayout';
import { WATER, bridgeByN } from './strait';
import { zoneAt } from './world';

export { POLICE_STATIONS };

/** A police car in a snapshot: [id, x, z, rot, speed, steer, flags (PF), bridge deck?]. */
export type PoliceSnap = [number, number, number, number, number, number, number, number?];

export const PF = {
  /** Lights and siren on. */
  SIREN: 1,
  BRAKE: 2,
  /** Lost you: searching round where you were last seen (yellow lights). */
  SEARCH: 4,
  /** Parked at a crime scene: lights flashing, the siren off. */
  QUIET: 8,
  /** A SWAT van (from 3 stars). */
  SWAT: 16,
} as const;

/** What was reported: the radio wording, and whether it gets a crime scene (tape, evidence) when
 *  the police find it empty (traffic offences don't). */
export type OffenceId = 'gunshot' | 'shooting' | 'copShot' | 'heist' | 'carAlarm' | 'deal' | 'crash' | 'reckless' | 'copRam' | 'anpr' | 'race' | 'stolenCar' | 'tamper';

export const OFFENCES: Record<OffenceId, { kind: 'crime' | 'traffic'; radio: string; evidence: EvidenceKind[] }> = {
  gunshot: { kind: 'crime', radio: 'silah sesi ihbarı', evidence: ['casing', 'casing', 'glass'] },
  shooting: { kind: 'crime', radio: 'silahlı çatışma ihbarı', evidence: ['casing', 'blood', 'casing', 'blood'] },
  copShot: { kind: 'crime', radio: 'polise ateş açıldı, memur yardım istiyor', evidence: ['casing', 'blood', 'casing'] },
  heist: { kind: 'crime', radio: 'soygun alarmı', evidence: ['glass', 'casing', 'glass'] },
  carAlarm: { kind: 'crime', radio: 'araç hırsızlığı ihbarı, alarm çalıyor', evidence: ['glass', 'glass'] },
  deal: { kind: 'crime', radio: 'uyuşturucu satışı ihbarı, sivil ekip yardım istiyor', evidence: ['glass', 'blood'] },
  crash: { kind: 'traffic', radio: 'trafik kazası, kaçan sürücü ihbarı', evidence: [] },
  reckless: { kind: 'traffic', radio: 'tehlikeli sürüş ihbarı', evidence: [] },
  copRam: { kind: 'crime', radio: 'polis aracına çarpıldı', evidence: ['glass', 'glass'] },
  anpr: { kind: 'traffic', radio: 'plaka okuma kamerası aranan aracı tespit etti', evidence: [] },
  race: { kind: 'traffic', radio: 'yasa dışı sokak yarışı ihbarı', evidence: [] },
  stolenCar: { kind: 'crime', radio: 'çalıntı araç ihbarı (kamera)', evidence: ['glass'] },
  tamper: { kind: 'crime', radio: 'olay yeri ihlali', evidence: [] },
};

/** Where something is, the way the radio says it ("Fortune Plaza civarında", "otoyolda"). */
export function placeName(x: number, z: number, deck = 0): string {
  const b = deck ? bridgeByN(deck) : undefined;
  if (b) return `${b.name.split(' · ')[0]} üzerinde`;
  if (x > WATER.east) {
    if (x > DOCKS.minX && z > DOCKS.minZ) return 'limanda';
    return 'Karşı Kıyı civarında';
  }
  if (Math.abs(projectToHighway(x, z).offset) < CARRIAGEWAY_EDGE) return 'otoyolda';
  if (inSanayi(x, z, 4)) return 'Sanayi civarında';
  const zone = zoneAt(x, z);
  if (zone) return `${zone.name} civarında`;
  if (Math.abs(x) < 160 && Math.abs(z) < 160) return 'merkez caddede';
  return 'şehir çevresinde';
}

/** The radio call for a reported offence. */
export function radioCall(what: OffenceId, x: number, z: number, deck = 0): string {
  return `Tüm birimlerin dikkatine, ${placeName(x, z, deck)} ${OFFENCES[what].radio}!`;
}

/** A police call out for the player: where to, and how long until the first car is there. */
export interface PoliceCall {
  /** The reported scene and roughly how big an area they will look round (m). */
  x: number;
  z: number;
  r: number;
  /** What was reported (radio wording). */
  what: string;
  /** Estimated seconds to the first car on the scene when the call went out. */
  eta0: number;
  /** Patrol cars, SWAT vans and a helicopter sent. */
  cars: number;
  swat: number;
  heli: boolean;
  /** On the scene now: looking round for the suspect. */
  arrived: boolean;
  /** Police scanner only: live seconds to the first car on the scene, and where the units are. */
  eta?: number;
  units?: [number, number][];
}

export interface WantedState {
  /** 0-5 stars. */
  stars: number;
  /** Police cars after you (or on their way). */
  units: number;
  /** Hidden from the police: seconds left on the escape countdown (it only starts over when a
   *  police car keeps you in sight for 2 s); null while they can see you. */
  escapeLeft: number | null;
  /** A police car has you in its sight right now: how close it is to spotting you (0-1). */
  seen?: number;
  /** The units lost you and are searching round where you were last seen. */
  search?: boolean;
  /** How close you are to being arrested (0-1). */
  bust: number;
  /** The helicopter: tracking you, or lost you (under cover); null: none. */
  heli?: 'seen' | 'lost' | null;
  /** The police are on their way to a reported scene (not after you yet). */
  call?: PoliceCall;
  /** A pursuit: the police have seen you. */
  engaged?: boolean;
  /** The police scanner is listening (live countdown). */
  scanner?: boolean;
}

/** A line on the police radio (the scanner panel shows it and the radio voice reads it). */
export interface RadioLine {
  text: string;
  /** call: a new report (yellow); info: units on the way / on the scene; alert: a chase, a stop
   *  warning; clear: called off. */
  tone: 'call' | 'info' | 'alert' | 'clear';
  /** Seconds to the scene (a new call). */
  eta?: number;
}

export type EvidenceKind = 'casing' | 'blood' | 'glass';

/** A taped-off crime scene (everyone sees it). */
export interface CrimeSceneView {
  id: number;
  x: number;
  z: number;
  deck: number;
  /** Cones the tape runs between (a closed loop), the segments left open (a wall in the way) and
   *  the ones a car went through (hanging loose). */
  posts: [number, number][];
  gaps: number[];
  broken?: number[];
  /** Burning road flares. */
  flares: [number, number][];
  /** Numbered evidence markers and what lies there. */
  evidence: [number, number, EvidenceKind][];
  /** When it is cleared away (server ms). */
  until: number;
  what: string;
}

/**
 * Lay out a crime scene round (x, z): `posts` cones on a ring of `radius` m (pulled in out of
 * walls; a segment through a wall is left open), flares on the road just outside, and the
 * evidence markers inside. `blocked` says whether a point is inside a wall or building.
 */
export function planCordon(
  x: number,
  z: number,
  radius: number,
  posts: number,
  evidence: EvidenceKind[],
  blocked: (x: number, z: number) => boolean,
  rng: () => number,
): Pick<CrimeSceneView, 'posts' | 'gaps' | 'flares' | 'evidence'> {
  const r2 = (v: number) => Math.round(v * 100) / 100;
  const turn = rng() * Math.PI * 2;
  const ring: [number, number][] = [];
  for (let k = 0; k < posts; k++) {
    const a = turn + (k / posts) * Math.PI * 2;
    let r = radius;
    while (r > 2 && blocked(x + Math.sin(a) * r, z + Math.cos(a) * r)) r -= 0.5;
    ring.push([r2(x + Math.sin(a) * r), r2(z + Math.cos(a) * r)]);
  }
  const gaps: number[] = [];
  for (let k = 0; k < ring.length; k++) {
    const [ax, az] = ring[k]!;
    const [bx, bz] = ring[(k + 1) % ring.length]!;
    if ([0.25, 0.5, 0.75].some((t) => blocked(ax + (bx - ax) * t, az + (bz - az) * t))) gaps.push(k);
  }
  const flares: [number, number][] = [];
  for (let k = 0; k < 4; k++) {
    const a = turn + Math.PI / 4 + (k / 4) * Math.PI * 2;
    const fx = x + Math.sin(a) * (radius + 3);
    const fz = z + Math.cos(a) * (radius + 3);
    if (!blocked(fx, fz)) flares.push([r2(fx), r2(fz)]);
  }
  const marks: [number, number, EvidenceKind][] = [];
  for (const kind of evidence) {
    for (let tries = 0; tries < 12; tries++) {
      const a = rng() * Math.PI * 2;
      const d = 1.2 + rng() * (radius - 3.5);
      const ex = x + Math.sin(a) * d;
      const ez = z + Math.cos(a) * d;
      if (blocked(ex, ez) || marks.some((m) => Math.hypot(m[0] - ex, m[1] - ez) < 1.6)) continue;
      marks.push([r2(ex), r2(ez), kind]);
      break;
    }
  }
  return { posts: ring, gaps, flares, evidence: marks };
}

/** Is a point inside a taped-off scene's ring (the cones' polygon)? */
export function insideCordon(posts: readonly (readonly [number, number])[], x: number, z: number): boolean {
  let inside = false;
  for (let i = 0, j = posts.length - 1; i < posts.length; j = i++) {
    const [xi, zi] = posts[i]!;
    const [xj, zj] = posts[j]!;
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

export interface BustedEvent {
  fine: number;
  /** Where it happened (the car or the player on foot) and the police car beside it. */
  at: { x: number; z: number; rot: number };
  police: { x: number; z: number; rot: number } | null;
  /** Where the player walks out afterwards. */
  respawn: { x: number; z: number; rot: number };
  /** The car that was towed to the garage (impounded). */
  vehicleId: string | null;
  cutsceneMs: number;
}
