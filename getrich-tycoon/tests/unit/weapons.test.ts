// Guns, ammo, damage stages and the ray maths (shared/weapons.ts).

import { describe, expect, it } from 'vitest';
import { AMMO, WEAPONS, aimRay, ammoDef, damageLook, ownedWeapons, rayBox, rayCircle, rayObb, rayY, recoilKick, spreadAim, weapon, weaponItem } from '../../shared/weapons';

describe('Ammu-Nation catalogue', () => {
  it('has the requested guns and prices', () => {
    expect(weapon('pistol')!.price).toBe(5_000);
    expect(weapon('shotgun')!.price).toBe(18_000);
    expect(weapon('rifle')!.price).toBe(45_000);
    for (const id of ['gold_deagle', 'laser_rpg', 'minigun']) {
      expect(weapon(id)!.price, id).toBeNull();
      expect(weapon(id)!.vip, id).toBeGreaterThan(0);
    }
    expect(new Set(WEAPONS.map((w) => w.slot))).toEqual(new Set([1, 2, 3, 4, 5, 6, 7, 8]));
    // The docks' contraband (Micro-Uzi, sniper rifle) is not for sale.
    for (const id of ['uzi', 'sniper']) {
      expect(weapon(id)!.price, id).toBeNull();
      expect(weapon(id)!.contraband, id).toBe(true);
    }
    for (const w of WEAPONS) expect(ammoDef(w.ammo)?.weapon, w.id).toBe(w.id);
    expect(AMMO.every((a) => a.price > 0 && a.rounds > 0)).toBe(true);
    expect(weapon('laser_rpg')!.blast).toBeDefined();
    expect(ownedWeapons({ [weaponItem('rifle')]: 1, [weaponItem('pistol')]: 1 }).map((w) => w.id)).toEqual(['pistol', 'rifle']);
  });
});

describe('vehicle damage', () => {
  it('breaks the glass first, then the bumper, the doors, smoke, and blows at zero', () => {
    expect(damageLook(100)).toEqual({ glass: false, bumper: false, doorL: false, doorR: false, smoke: 0, blown: false });
    expect(damageLook(80).glass).toBe(true);
    expect(damageLook(80).bumper).toBe(false);
    expect(damageLook(60).bumper).toBe(true);
    expect(damageLook(45).doorL).toBe(true);
    expect(damageLook(45).doorR).toBe(false);
    expect(damageLook(30)).toMatchObject({ doorR: true, smoke: 1 });
    expect(damageLook(10).smoke).toBe(2);
    expect(damageLook(0)).toMatchObject({ blown: true, smoke: 2 });
  });
});

describe('ray maths', () => {
  it('hits boxes, rotated boxes and people at the right distance', () => {
    const r = aimRay(0, 1.4, 0, 0, 0); // looking along +z
    expect(rayBox(r, -1, 1, 10, 12)).toMatchObject({ t: 10, nx: 0, nz: -1 });
    expect(rayBox(r, 2, 3, 10, 12)).toBeNull();
    // A car 20 m ahead, side-on (its length along x).
    const hit = rayObb(r, 0, 20, Math.PI / 2, 2.2, 0.9)!;
    expect(hit.t).toBeCloseTo(19.1, 5);
    expect(hit.nz).toBeCloseTo(-1, 5);
    expect(rayObb(r, 5, 20, Math.PI / 2, 2.2, 0.9)).toBeNull();
    expect(rayCircle(r, 0.2, 8, 0.4)).toBeCloseTo(8 - Math.sqrt(0.4 * 0.4 - 0.2 * 0.2), 6);
    expect(rayCircle(r, 1, 8, 0.4)).toBeNull();
    // Behind the shooter: no hit.
    expect(rayCircle(r, 0, -5, 0.4)).toBeNull();
  });

  it('follows the aim up and down', () => {
    const up = aimRay(0, 1.4, 0, Math.PI / 2, 0.2); // along +x, a little up
    expect(up.dx).toBeCloseTo(1);
    expect(rayY(up, 10)).toBeCloseTo(1.4 + Math.tan(0.2) * 10);
    const a = spreadAim(1, 0, 0.05, 7);
    expect(Math.abs(a.yaw - 1)).toBeLessThanOrEqual(0.05);
    expect(spreadAim(1, 0, 0.05, 7)).toEqual(a);
    expect(spreadAim(1, 0, 0, 7)).toEqual({ yaw: 1, pitch: 0 });
  });
});

describe('recoil', () => {
  const seq = (vals: number[]) => {
    let i = 0;
    return () => vals[i++ % vals.length]!;
  };
  it('pistol: a light kick straight up', () => {
    const k = recoilKick(weapon('pistol')!, 0, seq([0.5, 1, 0.5]));
    expect(k.pitch).toBeGreaterThan(0.02);
    expect(k.pitch).toBeLessThan(0.05);
    expect(Math.abs(k.yaw)).toBeLessThan(k.pitch / 5);
  });

  it('shotgun: a hard kick up and back', () => {
    const p = recoilKick(weapon('pistol')!, 0, () => 0.5);
    const s = recoilKick(weapon('shotgun')!, 0, () => 0.5);
    expect(s.pitch).toBeGreaterThan(p.pitch * 3);
    expect(s.shove).toBeGreaterThan(p.shove * 2.5);
  });

  it('rifle: sprays up and sideways, climbing through a burst', () => {
    const w = weapon('rifle')!;
    const yaws = [0, 0.25, 0.5, 0.75, 1].map((r) => recoilKick(w, 0, () => r).yaw);
    expect(Math.min(...yaws)).toBeLessThan(-0.01);
    expect(Math.max(...yaws)).toBeGreaterThan(0.01);
    expect(recoilKick(w, 8, () => 0.5).pitch).toBeGreaterThan(recoilKick(w, 0, () => 0.5).pitch * 1.5);
    // Single-shot guns don't climb.
    expect(recoilKick(weapon('pistol')!, 8, () => 0.5).pitch).toBeCloseTo(recoilKick(weapon('pistol')!, 0, () => 0.5).pitch, 6);
  });

  it('every gun settles again', () => {
    for (const w of WEAPONS) expect(w.recoil.recover, w.id).toBeGreaterThan(1);
  });
});

describe('ray vs upright cylinder (helicopter)', () => {
  it('a steep shot climbs into the body; a flat one passes under', async () => {
    const { rayCylinder } = await import('../../shared/weapons');
    const up = aimRay(0, 1.5, 0, Math.PI / 2, Math.atan2(36.5, 20));
    const t = rayCylinder(up, 20, 0, 2.4, 36.4, 39.5)!;
    expect(t).not.toBeNull();
    expect(rayY(up, t)).toBeGreaterThanOrEqual(36.4 - 1e-6);
    expect(t).toBeGreaterThan(17.6);
    const flat = aimRay(0, 1.5, 0, Math.PI / 2, 0);
    expect(rayCylinder(flat, 20, 0, 2.4, 36.4, 39.5)).toBeNull();
    // Pointing away: nothing.
    expect(rayCylinder(aimRay(0, 1.5, 0, -Math.PI / 2, 1), 20, 0, 2.4, 36.4, 39.5)).toBeNull();
  });
});
