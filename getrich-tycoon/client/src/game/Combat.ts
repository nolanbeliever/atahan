// Guns on the client: drawing one (1-6, Q to put it away), aiming down its sights, firing
// (the server decides the hits), and showing the fight: tracers, holes, blood, explosions, cars
// losing glass and parts and smoking, the health bar and WASTED.

import * as THREE from 'three';
import { getModel } from '../../../shared/vehicles';
import { BUILDINGS } from '../../../shared/world';
import { COMBAT, damageLook, rayBox, rayCircle, rayObb, rayY, weapon, ownedWeapons, type ExplosionFx, type HealthView, type Ray2, type ShotFx, type VehicleDamageLook, type WeaponDef } from '../../../shared/weapons';
import { CombatFx } from '../render/CombatFx';
import type { AnyVehicleView } from '../render/VehicleMesh';
import type { Game } from './Game';

const RANGE = 150;
const tmp = new THREE.Vector3();

export class CombatClient {
  readonly fx: CombatFx;
  equipped: WeaponDef | null = null;
  /** Rounds fired since the inventory last came from the server (shown right away). */
  private spent = new Map<string, number>();
  /** Rounds of each kind in the last inventory from the server. */
  private seenAmmo = new Map<string, number>();
  private cooldown = 0;
  private shotNo = 0;
  readonly carHp = new Map<string, number>();
  private looks = new Map<string, VehicleDamageLook>();
  dead = false;
  /** Called when the HUD should change (gun, ammo). */
  onChange: (() => void) | null = null;

  constructor(private readonly game: Game) {
    this.fx = new CombatFx(game.renderer.scene);
  }

  // ---------------------------------------------------------------- guns

  /** Number keys draw a gun, Q puts it away. Returns true when the key was used. */
  onKey(code: string): boolean {
    if (code === 'KeyQ') {
      if (this.equipped) void this.equip(null);
      return !!this.equipped;
    }
    const m = /^Digit([1-6])$/.exec(code);
    if (!m || this.game.driving || (this.game.riding && !this.game.onPillion())) return false;
    const slot = Number(m[1]);
    const inv = this.game.store.me?.inventory ?? {};
    const w = ownedWeapons(inv).find((x) => x.slot === slot);
    if (!w) {
      const any = weapon(['pistol', 'shotgun', 'rifle', 'gold_deagle', 'laser_rpg', 'minigun'][slot - 1]!);
      this.game.ui?.toast({ kind: 'info', title: `No ${any?.name ?? 'gun'}`, text: 'Ammu-Nation (east of the city, past the outer road) sells guns and ammo.' });
      return true;
    }
    void this.equip(this.equipped?.id === w.id ? null : w);
    return true;
  }

  /** Guns in the inventory, by slot. */
  owned(): WeaponDef[] {
    return ownedWeapons(this.game.store.me?.inventory ?? {});
  }

  /** The touch gun button: draw the first gun, then the next one, then put it away. */
  cycleWeapon(): void {
    if (this.game.driving || (this.game.riding && !this.game.onPillion()) || this.dead) return;
    const guns = this.owned();
    if (!guns.length) {
      this.game.ui?.toast({ kind: 'info', title: 'Silahın yok', text: 'Ammu-Nation (east of the city, past the outer road) sells guns and ammo.' });
      return;
    }
    const i = this.equipped ? guns.findIndex((g) => g.id === this.equipped!.id) : -1;
    void this.equip(i + 1 < guns.length ? guns[i + 1]! : null);
  }

  async equip(w: WeaponDef | null): Promise<void> {
    try {
      await this.game.net.rpc('weapon.equip', { weapon: w ? w.id : null });
      this.equipped = w;
      this.game.entities.players.get(this.game.store.playerId)?.view.setWeapon(w?.slot ?? 0);
      this.game.audio.play('click');
      if (!w) this.fx.setLaser(null, null);
      this.onChange?.();
    } catch (err) {
      this.game.ui?.error(err);
    }
  }

  /** Rounds left for the drawn gun. */
  ammo(): number {
    const w = this.equipped;
    if (!w) return 0;
    return Math.max(0, (this.game.store.me?.inventory[w.ammo] ?? 0) - (this.spent.get(w.ammo) ?? 0));
  }

  /** The inventory came from the server. It counts the rounds fired only once the server has saved
   *  them (every few seconds), so only take off what it has taken off since the last update. */
  onInventory(): void {
    const inv = this.game.store.me?.inventory ?? {};
    for (const [ammo, n] of this.spent) {
      const taken = (this.seenAmmo.get(ammo) ?? inv[ammo] ?? 0) - (inv[ammo] ?? 0);
      const left = taken < 0 ? 0 : n - taken;
      if (left > 0) this.spent.set(ammo, left);
      else this.spent.delete(ammo);
    }
    this.seenAmmo.clear();
    for (const [k, n] of Object.entries(inv)) if (k.startsWith('ammo_')) this.seenAmmo.set(k, n);
    // A gun sold or lost (WASTED): put it away.
    if (this.equipped && (this.game.store.me?.inventory[`weapon_${this.equipped.id}`] ?? 0) < 1) void this.equip(null);
    this.onChange?.();
  }

  /** Where the sights point (the middle of the view): the first thing along the camera's ray. */
  private aimPoint(): THREE.Vector3 {
    const cam = this.game.renderer.camera;
    const o = cam.getWorldPosition(new THREE.Vector3());
    const d = cam.getWorldDirection(new THREE.Vector3());
    const h = Math.hypot(d.x, d.z) || 1e-6;
    const r: Ray2 = { x: o.x, y: o.y, z: o.z, dx: d.x / h, dz: d.z / h, slope: d.y / h };
    let best = RANGE;
    if (r.slope < -1e-4) best = Math.min(best, r.y / -r.slope);
    for (const b of BUILDINGS) {
      const hit = rayBox(r, b.box.minX, b.box.maxX, b.box.minZ, b.box.maxZ);
      if (hit && hit.t < best && rayY(r, hit.t) <= b.height) best = hit.t;
    }
    const me = this.game.store.playerId;
    const own = this.game.riding?.vehicleId;
    for (const box of this.carBoxes()) {
      if (box.id === own) continue;
      const hit = rayObb(r, box.x, box.z, box.rot, box.hl, box.hw);
      if (hit && hit.t < best && hit.t > 0.5) {
        const y = rayY(r, hit.t);
        if (y >= 0 && y <= 1.7) best = hit.t;
      }
    }
    const person = (x: number, z: number) => {
      const t = rayCircle(r, x, z, 0.4);
      if (t !== null && t < best && t > 0.5 && rayY(r, t) <= 1.9 && rayY(r, t) >= 0) best = t;
    };
    for (const [id, e] of this.game.entities.players) if (id !== me && !e.driving) person(e.view.root.position.x, e.view.root.position.z);
    for (const e of this.game.entities.npcs.values()) person(e.view.root.position.x, e.view.root.position.z);
    // Never aim at a point behind the player (the camera sits behind them).
    best = Math.max(best, 4);
    return new THREE.Vector3(r.x + r.dx * best, rayY(r, best), r.z + r.dz * best);
  }

  /** Cars as boxes: the players' and parked ones, street cars, police and highway traffic. */
  private carBoxes(): { id: string; x: number; z: number; rot: number; hl: number; hw: number }[] {
    const out: { id: string; x: number; z: number; rot: number; hl: number; hw: number }[] = [];
    for (const [id, e] of this.game.entities.vehicles) out.push({ id, x: e.x, z: e.z, rot: e.rot, hl: e.view.length / 2, hw: e.view.width / 2 });
    out.push(...this.game.theft.boxes());
    for (const u of this.game.police.units.values()) out.push({ id: `po:${u.id}`, x: u.x, z: u.z, rot: u.view.root.rotation.y, hl: u.view.length / 2, hw: u.view.width / 2 });
    for (const [id, c] of this.game.traffic.cars) out.push({ id: `tr:${id}`, x: c.x, z: c.z, rot: c.yaw, hl: c.spec.length / 2, hw: c.spec.width / 2 });
    return out;
  }

  /** The muzzle of the drawn gun (world). */
  private muzzle(): THREE.Vector3 {
    // On the back of a bike: just in front of the eyes, where the camera is.
    if (this.game.onPillion()) {
      const cam = this.game.renderer.camera;
      const d = cam.getWorldDirection(new THREE.Vector3());
      d.y = 0;
      d.normalize();
      return cam.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, -0.3, 0)).addScaledVector(d, 0.45);
    }
    const p = this.game.localPosition();
    const rot = p.rot;
    const fwd = new THREE.Vector3(Math.sin(rot), 0, Math.cos(rot));
    const right = new THREE.Vector3(-Math.cos(rot), 0, Math.sin(rot));
    const big = this.equipped && (this.equipped.slot === 5 || this.equipped.slot === 6);
    return new THREE.Vector3(p.x, big ? 1.25 : 1.38, p.z).addScaledVector(fwd, big ? 0.9 : 0.6).addScaledVector(right, 0.22);
  }

  // ---------------------------------------------------------------- frame

  update(dt: number): void {
    this.fx.update(dt);
    this.cooldown -= dt;
    const w = this.equipped;
    const input = this.game.input;
    // On foot, or on the back of a motorcycle / quad (shooting backwards and sideways while moving).
    const canFire = !!w && !this.dead && !this.game.driving && (!this.game.riding || this.game.onPillion()) && !this.game.inCutscene && input.enabled && !this.game.ui?.anyOpen();
    const clicks = input.consumeFire();
    // The RPG shows where it will land.
    if (canFire && w!.blast) this.fx.setLaser(this.muzzle(), this.aimPoint());
    else this.fx.setLaser(null, null);
    if (canFire && this.cooldown <= 0 && (clicks > 0 || (w!.auto && input.fireHeld))) this.fire(w!);
    this.updateCars(dt);
  }

  private fire(w: WeaponDef): void {
    if (this.ammo() < 1) {
      this.cooldown = 0.35;
      this.game.audio.play('empty');
      this.game.ui?.toast({ kind: 'warning', title: 'Out of ammo', text: `Buy more ${w.name} rounds at Ammu-Nation.` });
      return;
    }
    this.cooldown = 1 / w.rate;
    const from = this.muzzle();
    const to = this.aimPoint();
    const dx = to.x - from.x;
    const dz = to.z - from.z;
    const yaw = Math.atan2(dx, dz);
    const pitch = Math.atan2(to.y - from.y, Math.hypot(dx, dz));
    this.shotNo++;
    this.game.net.socket.emit('fire', [w.id, round(from.x), round(from.y), round(from.z), round(yaw, 10000), round(pitch, 10000), this.shotNo]);
    this.spent.set(w.ammo, (this.spent.get(w.ammo) ?? 0) + 1);
    // Our own shot shows at once (the server's answer adds the impact), from the gun in view.
    const end = from.clone().add(new THREE.Vector3(Math.sin(yaw), Math.tan(pitch), Math.cos(yaw)).normalize().multiplyScalar(Math.min(w.range, from.distanceTo(to))));
    const start = this.game.sightsMuzzle(new THREE.Vector3()) ?? from;
    this.fx.shot(start, end, w.tracer, 'air', null, null, w.slot >= 4);
    this.game.recoilKick(w);
    this.game.audio.shot(w.sound, 1);
    this.onChange?.();
  }

  // ---------------------------------------------------------------- server events

  onShot(s: ShotFx): void {
    const mine = s.by === this.game.store.playerId;
    const from = new THREE.Vector3(...s.from);
    const to = new THREE.Vector3(...s.to);
    const w = weapon(s.weapon);
    const n = s.n ? new THREE.Vector3(...s.n) : null;
    const carRoot = s.carId ? this.carView(s.carId)?.root ?? null : null;
    if (mine) {
      // Just the impact: the tracer was drawn when we fired.
      if (s.hit !== 'air') this.fx.shot(to.clone().addScaledVector(to.clone().sub(from).normalize(), -0.05), to, '#000000', s.hit, n, carRoot);
      return;
    }
    this.fx.shot(from, to, w?.tracer ?? '#ffe9a8', s.hit, n, carRoot, (w?.slot ?? 1) >= 4);
    const me = this.game.localPosition();
    const d = Math.hypot(me.x - s.from[0], me.z - s.from[2]);
    this.game.audio.shot(w?.sound ?? 'pistol', Math.max(0.05, 1 - d / 160));
  }

  onExplosion(e: ExplosionFx): void {
    const at = new THREE.Vector3(e.x, e.y, e.z);
    this.fx.explosion(at, e.radius, this.game.renderer.camera.position);
    const me = this.game.localPosition();
    this.game.audio.boom(Math.max(0.1, 1 - Math.hypot(me.x - e.x, me.z - e.z) / 220));
  }

  onCarHp(id: string, hp: number): void {
    if (hp >= COMBAT.vehicleHp) this.carHp.delete(id);
    else this.carHp.set(id, hp);
    const look = damageLook(hp);
    const before = this.looks.get(id);
    this.looks.set(id, look);
    const view = this.carView(id);
    if (view) {
      view.setShotDamage(hp >= COMBAT.vehicleHp ? null : look);
      // Parts flying off as they break.
      const root = view.root;
      const color = '#5d6168';
      const side = (x: number) => root.localToWorld(new THREE.Vector3(x, 0.8, 0.2));
      const push = (x: number) => new THREE.Vector3(x, 0, 0).applyQuaternion(root.quaternion).multiplyScalar(2);
      if (look.glass && !before?.glass) this.fx.shards(root.localToWorld(new THREE.Vector3(0, view.height * 0.75, 0)));
      if (look.bumper && !before?.bumper) this.fx.part(root.localToWorld(new THREE.Vector3(0, 0.45, view.length / 2)), new THREE.Vector3(view.width * 0.85, 0.22, 0.18), color, new THREE.Vector3(0, 0, 2).applyQuaternion(root.quaternion));
      if (look.doorL && !before?.doorL) this.fx.part(side(view.width / 2 + 0.1), new THREE.Vector3(0.08, 0.75, 1.05), color, push(1));
      if (look.doorR && !before?.doorR) this.fx.part(side(-view.width / 2 - 0.1), new THREE.Vector3(0.08, 0.75, 1.05), color, push(-1));
    }
  }

  onHealth(v: HealthView): void {
    const before = this.game.store.health?.hp ?? COMBAT.playerHp;
    this.game.store.setHealth(v);
    if (v.hp < before) {
      this.game.ui?.combat.hurt(v, this.game.localPosition(), this.game.cam.yaw);
      this.game.audio.play('hit');
    }
  }

  onWasted(lost: string[], ms: number): void {
    this.dead = true;
    if (this.equipped) {
      this.equipped = null;
      this.game.entities.players.get(this.game.store.playerId)?.view.setWeapon(0);
    }
    this.fx.setLaser(null, null);
    this.game.ui?.combat.wasted(lost, ms);
    this.game.audio.play('wasted');
    window.setTimeout(() => {
      this.dead = false;
      this.onChange?.();
    }, ms);
  }

  // ---------------------------------------------------------------- damaged cars

  carView(id: string): AnyVehicleView | undefined {
    if (id.startsWith('po:')) return this.game.police.units.get(Number(id.slice(3)))?.view;
    return this.game.entities.vehicles.get(id)?.view ?? this.game.theft.viewOf(id);
  }

  private updateCars(dt: number): void {
    for (const [id, hp] of this.carHp) {
      const look = damageLook(hp);
      if (look.smoke === 0) continue;
      let at: THREE.Vector3 | null = null;
      const view = this.carView(id);
      if (view) at = view.hoodPoint(tmp);
      else if (id.startsWith('tr:')) {
        const c = this.game.traffic.cars.get(Number(id.slice(3)));
        if (c) at = tmp.set(c.x, 1.2, c.z);
      }
      if (at) this.fx.smoke(at, look.smoke, look.blown, dt);
    }
  }

  /** Lift the damage looks onto cars that (re)appeared. */
  refreshViews(): void {
    for (const [id, hp] of this.carHp) this.carView(id)?.setShotDamage(damageLook(hp));
  }
}

function round(v: number, k = 1000): number {
  return Math.round(v * k) / k;
}

export function carHeight(modelId: string): number {
  const m = getModel(modelId);
  return m.shape.rideHeight + m.shape.bodyHeight + m.shape.cabinHeight;
}
