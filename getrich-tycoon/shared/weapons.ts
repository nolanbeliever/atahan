// Weapons, ammunition and bullet damage (Ammu-Nation, shooting, vehicle damage, health).
//
// The guns are bought at Ammu-Nation (east of the city) with cash, the premium ones with VIP Coins
// (earned from the daily login streak and the 3-hour playtime reward; there is no real-money shop).
// A gun stays in the inventory (weapon_<id>), its rounds come in ammo boxes (ammo_<kind>).
//
// The server decides every hit: shots are rays from the shooter's chest along the aim; the first
// thing in the way (a building, a car, a person) takes the damage. Vehicles have body HP: as it
// drops the glass breaks, the bumper and then the doors come off, the engine smokes (grey, then
// black) and at zero the engine blows (an explosion; the car is a wreck until repaired).

import { ECONOMY } from './economy.config';

export type WeaponId = 'pistol' | 'shotgun' | 'rifle' | 'gold_deagle' | 'laser_rpg' | 'minigun';
export type AmmoId = 'ammo_pistol' | 'ammo_shells' | 'ammo_rifle' | 'ammo_deagle' | 'ammo_rocket' | 'ammo_minigun';
export type ShotSound = 'pistol' | 'shotgun' | 'rifle' | 'deagle' | 'rpg' | 'minigun';

export interface WeaponDef {
  id: WeaponId;
  name: string;
  /** Number key that selects it. */
  slot: number;
  /** Cash price, or null for the VIP-only guns. */
  price: number | null;
  /** VIP Coin price (premium guns). */
  vip: number | null;
  ammo: AmmoId;
  /** Shots per second; pellets per shot; damage per pellet; reach (m); spread (rad, either way). */
  rate: number;
  pellets: number;
  damage: number;
  range: number;
  spread: number;
  /** Fires while the button is held. */
  auto: boolean;
  /** Explodes where it hits (the RPG): radius (m) and damage at the centre. */
  blast?: { radius: number; damage: number };
  sound: ShotSound;
  /** Tracer and model colours. */
  tracer: string;
  color: string;
  description: string;
  /** How the gun kicks (see recoilKick). */
  recoil: Recoil;
}

/**
 * Recoil, per shot: the view kicks up by `kick` (rad), sideways by up to `side` either way (a
 * spray), the gun is pushed back towards you by `shove` (m), and it all settles at `recover` per
 * second. Automatic guns climb: every shot in a burst kicks a little more, up to `climb` times.
 */
export interface Recoil {
  kick: number;
  side: number;
  shove: number;
  recover: number;
  climb: number;
}

export const WEAPONS: WeaponDef[] = [
  { id: 'pistol', name: 'Pistol', slot: 1, price: 5_000, vip: null, ammo: 'ammo_pistol', rate: 3, pellets: 1, damage: 24, range: 60, spread: 0.012, auto: false, sound: 'pistol', tracer: '#ffe9a8', color: '#2b2d31', description: 'A reliable 9 mm sidearm. 12 rounds a clip.', recoil: { kick: 0.032, side: 0.004, shove: 0.035, recover: 5, climb: 1 } },
  { id: 'shotgun', name: 'Pump Shotgun', slot: 2, price: 18_000, vip: null, ammo: 'ammo_shells', rate: 1.1, pellets: 8, damage: 11, range: 28, spread: 0.075, auto: false, sound: 'shotgun', tracer: '#ffd38a', color: '#5a3b24', description: 'Eight pellets a shell: brutal up close, useless far away.', recoil: { kick: 0.12, side: 0.012, shove: 0.11, recover: 2.6, climb: 1 } },
  { id: 'rifle', name: 'AK-47 / M4', slot: 3, price: 45_000, vip: null, ammo: 'ammo_rifle', rate: 9, pellets: 1, damage: 19, range: 95, spread: 0.022, auto: true, sound: 'rifle', tracer: '#ffcf6b', color: '#3a3326', description: 'Full-auto assault rifle. Hold the button.', recoil: { kick: 0.017, side: 0.016, shove: 0.022, recover: 3.2, climb: 1.8 } },
  { id: 'gold_deagle', name: 'Golden Desert Eagle', slot: 4, price: null, vip: 20, ammo: 'ammo_deagle', rate: 2.2, pellets: 1, damage: 62, range: 85, spread: 0.008, auto: false, sound: 'deagle', tracer: '#ffd700', color: '#d4af37', description: 'Premium. Solid gold, hits like a truck.', recoil: { kick: 0.075, side: 0.008, shove: 0.07, recover: 3, climb: 1 } },
  {
    id: 'laser_rpg',
    name: 'Laser-Guided RPG',
    slot: 5,
    price: null,
    vip: 35,
    ammo: 'ammo_rocket',
    rate: 0.6,
    pellets: 1,
    damage: 60,
    range: 140,
    spread: 0,
    auto: false,
    blast: { radius: 7, damage: 220 },
    sound: 'rpg',
    tracer: '#ff2a3a',
    color: '#4a5a3a',
    description: 'Premium. A red laser shows where the rocket lands. Cars do not survive it.',
    recoil: { kick: 0.09, side: 0.01, shove: 0.13, recover: 2.2, climb: 1 },
  },
  { id: 'minigun', name: 'Minigun', slot: 6, price: null, vip: 45, ammo: 'ammo_minigun', rate: 16, pellets: 1, damage: 13, range: 85, spread: 0.035, auto: true, sound: 'minigun', tracer: '#ffb347', color: '#555b63', description: 'Premium. Six barrels, sixteen rounds a second.', recoil: { kick: 0.006, side: 0.009, shove: 0.012, recover: 4, climb: 1.5 } },
];

export interface AmmoDef {
  id: AmmoId;
  name: string;
  /** Rounds in a box and its price. */
  rounds: number;
  price: number;
  weapon: WeaponId;
}

export const AMMO: AmmoDef[] = [
  { id: 'ammo_pistol', name: '9 mm box', rounds: 36, price: 400, weapon: 'pistol' },
  { id: 'ammo_shells', name: 'Shotgun shells', rounds: 16, price: 600, weapon: 'shotgun' },
  { id: 'ammo_rifle', name: 'Rifle magazines', rounds: 90, price: 1_200, weapon: 'rifle' },
  { id: 'ammo_deagle', name: '.50 AE box', rounds: 21, price: 900, weapon: 'gold_deagle' },
  { id: 'ammo_rocket', name: 'Rockets', rounds: 3, price: 2_500, weapon: 'laser_rpg' },
  { id: 'ammo_minigun', name: 'Minigun belt', rounds: 400, price: 1_800, weapon: 'minigun' },
];

export function weapon(id: string): WeaponDef | undefined {
  return WEAPONS.find((w) => w.id === id);
}

export function ammoDef(id: string): AmmoDef | undefined {
  return AMMO.find((a) => a.id === id);
}

/** Inventory id of a gun. */
export const weaponItem = (id: WeaponId): string => `weapon_${id}`;

/** Guns in an inventory, in slot order. */
export function ownedWeapons(inv: Record<string, number>): WeaponDef[] {
  return WEAPONS.filter((w) => (inv[weaponItem(w.id)] ?? 0) > 0);
}

/** The gun bought with the first purchase comes with this many rounds. */
export const STARTER_ROUNDS = 24;

// ------------------------------------------------------------------ vehicle damage

/** What a vehicle's body HP (0-100) shows. */
export interface VehicleDamageLook {
  glass: boolean;
  bumper: boolean;
  doorL: boolean;
  doorR: boolean;
  /** 0 none, 1 grey smoke, 2 black smoke. */
  smoke: 0 | 1 | 2;
  blown: boolean;
}

export function damageLook(hp: number): VehicleDamageLook {
  return {
    glass: hp <= 85,
    bumper: hp <= 68,
    doorL: hp <= 52,
    doorR: hp <= 38,
    smoke: hp <= 0 ? 2 : hp <= 18 ? 2 : hp <= 35 ? 1 : 0,
    blown: hp <= 0,
  };
}

// ------------------------------------------------------------------ rays

/** A shot in the horizontal plane with a slope: origin (x, y, z), unit horizontal direction, rise per metre. */
export interface Ray2 {
  x: number;
  y: number;
  z: number;
  dx: number;
  dz: number;
  slope: number;
}

/** Make a ray from an aim (yaw: heading, x = sin; pitch: + up). */
export function aimRay(x: number, y: number, z: number, yaw: number, pitch: number): Ray2 {
  return { x, y, z, dx: Math.sin(yaw), dz: Math.cos(yaw), slope: Math.tan(Math.max(-1.2, Math.min(1.2, pitch))) };
}

/** Height of the ray after `t` metres. */
export function rayY(r: Ray2, t: number): number {
  return r.y + r.slope * t;
}

/** Distance along the ray to an axis-aligned box (null: missed), and the face it enters. */
export function rayBox(r: Ray2, minX: number, maxX: number, minZ: number, maxZ: number): { t: number; nx: number; nz: number } | null {
  let tmin = 0;
  let tmax = Infinity;
  let nx = 0;
  let nz = 0;
  for (const [o, d, lo, hi, ax] of [
    [r.x, r.dx, minX, maxX, 0],
    [r.z, r.dz, minZ, maxZ, 1],
  ] as const) {
    if (Math.abs(d) < 1e-9) {
      if (o < lo || o > hi) return null;
      continue;
    }
    let t1 = (lo - o) / d;
    let t2 = (hi - o) / d;
    let n = -1;
    if (t1 > t2) {
      [t1, t2] = [t2, t1];
      n = 1;
    }
    if (t1 > tmin) {
      tmin = t1;
      nx = ax === 0 ? n : 0;
      nz = ax === 1 ? n : 0;
    }
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
  }
  return { t: tmin, nx, nz };
}

/** Distance along the ray to an oriented box (centre, heading, half length along the heading, half width). */
export function rayObb(r: Ray2, cx: number, cz: number, rot: number, hl: number, hw: number): { t: number; nx: number; nz: number } | null {
  // Into the box's frame: forward = (sin rot, cos rot), right = (cos rot, -sin rot).
  const fx = Math.sin(rot);
  const fz = Math.cos(rot);
  const rx = Math.cos(rot);
  const rz = -Math.sin(rot);
  const ox = r.x - cx;
  const oz = r.z - cz;
  const local: Ray2 = { x: ox * rx + oz * rz, z: ox * fx + oz * fz, y: r.y, dx: r.dx * rx + r.dz * rz, dz: r.dx * fx + r.dz * fz, slope: r.slope };
  const hit = rayBox(local, -hw, hw, -hl, hl);
  if (!hit) return null;
  // Normal back to the world.
  return { t: hit.t, nx: hit.nx * rx + hit.nz * fx, nz: hit.nx * rz + hit.nz * fz };
}

/** Distance along the ray to a vertical cylinder (a person). */
export function rayCircle(r: Ray2, cx: number, cz: number, radius: number): number | null {
  const ox = r.x - cx;
  const oz = r.z - cz;
  const b = ox * r.dx + oz * r.dz;
  const c = ox * ox + oz * oz - radius * radius;
  const disc = b * b - c;
  if (disc < 0) return null;
  const t = -b - Math.sqrt(disc);
  if (t >= 0) return t;
  return c <= 0 ? 0 : null;
}

/**
 * First distance at which the ray is inside an upright cylinder (centre cx, cz, radius, from y0 up
 * to y1): a steep shot up at a helicopter enters its circle below it and climbs into it.
 */
export function rayCylinder(r: Ray2, cx: number, cz: number, radius: number, y0: number, y1: number): number | null {
  const ox = r.x - cx;
  const oz = r.z - cz;
  const b = ox * r.dx + oz * r.dz;
  const c = ox * ox + oz * oz - radius * radius;
  const disc = b * b - c;
  if (disc < 0) return null;
  const tIn = Math.max(0, -b - Math.sqrt(disc));
  const tOut = -b + Math.sqrt(disc);
  if (tOut < 0) return null;
  // The part of [tIn, tOut] where the ray is between y0 and y1.
  let lo = tIn;
  let hi = tOut;
  if (Math.abs(r.slope) < 1e-6) {
    if (r.y < y0 || r.y > y1) return null;
  } else {
    const ta = (y0 - r.y) / r.slope;
    const tb = (y1 - r.y) / r.slope;
    lo = Math.max(lo, Math.min(ta, tb));
    hi = Math.min(hi, Math.max(ta, tb));
  }
  return lo <= hi ? lo : null;
}

/** Fire spread: a direction jittered within ±spread (deterministic from a seed). */
export function spreadAim(yaw: number, pitch: number, spread: number, seed: number): { yaw: number; pitch: number } {
  if (spread <= 0) return { yaw, pitch };
  const a = Math.sin(seed * 12.9898) * 43758.5453;
  const b = Math.sin(seed * 78.233) * 12345.6789;
  const u = a - Math.floor(a);
  const v = b - Math.floor(b);
  return { yaw: yaw + (u * 2 - 1) * spread, pitch: pitch + (v * 2 - 1) * spread * 0.6 };
}

export const COMBAT = ECONOMY.combat;

/**
 * One shot's kick: how far the view jumps up (pitch, rad), sideways (yaw, rad) and how far the gun
 * comes back (m). `burst` is the shot's number in a burst (0 = first); `rand` gives 0..1.
 * Pistols kick straight up, shotguns hard up and back, automatic rifles spray up and sideways.
 */
export function recoilKick(w: WeaponDef, burst: number, rand: () => number): { pitch: number; yaw: number; shove: number } {
  const r = w.recoil;
  const climb = w.auto ? 1 + Math.min(burst, 8) / 8 * (r.climb - 1) : 1;
  return {
    pitch: r.kick * climb * (0.85 + 0.3 * rand()),
    yaw: (rand() * 2 - 1) * r.side * (w.auto ? climb : 1),
    shove: r.shove * (0.9 + 0.2 * rand()),
  };
}

/** A shot as other players see it: from, to, what it hit, the gun. */
export interface ShotFx {
  by: string;
  weapon: WeaponId;
  from: [number, number, number];
  to: [number, number, number];
  /** 'wall' | 'ground' | 'car' | 'person' | 'air' — decides sparks, dust, blood, a bullet hole. */
  hit: 'wall' | 'ground' | 'car' | 'person' | 'air';
  /** Surface normal where it hit (bullet hole orientation). */
  n?: [number, number, number];
  /** The car hit (its id) and where on it (car-local point) for the bullet hole. */
  carId?: string;
}

export interface ExplosionFx {
  x: number;
  y: number;
  z: number;
  radius: number;
  /** A car that blew up (it stays a wreck). */
  carId?: string;
}

/** Player health as the HUD shows it. */
export interface HealthView {
  hp: number;
  max: number;
  /** Last damage (server ms) and from where (for the red hit marker). */
  hitAt: number;
  fromX?: number;
  fromZ?: number;
}
