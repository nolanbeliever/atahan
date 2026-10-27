// Local player: movement, first/third-person cameras, viewmodel weapons, vitals,
// flashlight and driving.
import * as THREE from 'three';
import { stepBody, headroom, raycast } from '../shared/physics.js';
import { ITEMS } from '../shared/items.js';
import { VTYPES, stepVehicle } from '../shared/vehicle.js';
import { Inventory } from './inventory.js';
import { Character, humanGeometry, SURVIVOR_LOOKS } from './rig.js';
import { weaponModel } from './assets.js';
import { clamp, angleDiff } from '../shared/util.js';

const EYE = 1.62, EYE_C = 1.05, H = 1.75, H_C = 1.15, RAD = 0.34;

export class Player {
  constructor(game) {
    this.g = game;
    this.cam = game.camera;
    this.body = { x: 0, y: 0, z: 0, vy: 0, onGround: true };
    this.vel = new THREE.Vector2();
    this.yaw = 0; this.pitch = 0;
    this.crouch = false; this.eye = EYE; this.camY = EYE;
    this.hp = 100; this.stamina = 100; this.hunger = 100; this.thirst = 100; this.infection = 0; this.bleed = 0; this.battery = 100;
    this.light = false; this.dead = false;
    this.inv = new Inventory();
    this.tp = game.settings.thirdPerson; this.tpBlend = this.tp ? 1 : 0;
    this.stepAcc = 0; this.bob = 0; this.bobAmt = 0;
    this.fireCd = 0; this.reloadT = 0; this.swingT = 0; this.meleePending = 0; this.equipT = 0; this.useT = 0; this.useItem = null;
    this.recoil = 0; this.kick = 0;
    this.veh = null; this.vehCamYaw = 0; this.vehView = 0;
    this.distDriven = 0;
    this.shake = 0;
    const look = SURVIVOR_LOOKS[0];
    this.char = new Character(humanGeometry(look), game.charMat);
    game.scene.add(this.char.root);
    this.weaponMesh = new THREE.Group();
    this.char.b.handR.add(this.weaponMesh);
    // flashlight
    this.flash = new THREE.SpotLight(0xfff2d8, 0, 34, 0.42, 0.55, 1.4);
    this.flash.castShadow = game.settings.preset === 'ultra';
    this.flash.shadow.mapSize.set(512, 512);
    game.scene.add(this.flash); game.scene.add(this.flash.target);
    this.vm = new ViewModel(game);
    this.speed = 0;
    this.camPos = new THREE.Vector3();
  }

  get facing() { return this.yaw + Math.PI; } // sim convention (sin, cos) forward
  get forward() { return new THREE.Vector3(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch)); }

  spawn(x, y, z, yaw = 0) { Object.assign(this.body, { x, y, z, vy: 0, onGround: true }); this.yaw = yaw; this.pitch = 0; this.camY = this.eye; this.dead = false; }

  setThirdPerson(on) { this.tp = on; this.g.settings.thirdPerson = on; }

  equip(id) {
    if (id === this.inv.equipped) return;
    if (id !== 'fists' && !this.inv.has(id)) return;
    this.inv.equipped = id; this.reloadT = 0; this.swingT = 0; this.equipT = 0.35;
    this.vm.setWeapon(id);
    this._attachTPWeapon(id);
    this.g.hud.weapon(this);
  }
  _attachTPWeapon(id) {
    this.weaponMesh.clear();
    const m = this.vm.makeWeapon(id, true);
    if (m) { m.rotation.x = -Math.PI / 2; m.position.set(0, -0.08, 0.02); this.weaponMesh.add(m); }
  }

  look(dx, dy) {
    const inv = this.g.settings.invertY ? -1 : 1;
    if (this.veh !== null) { this.vehCamYaw -= dx; this.vehPitch = clamp((this.vehPitch || -0.15) - dy * inv, -0.8, 0.5); this.vehLookT = 2; return; }
    this.yaw -= dx;
    this.pitch = clamp(this.pitch - dy * inv, -1.45, 1.45);
  }

  // ------------------------------------------------------------- on foot
  update(dt, input) {
    const g = this.g, s = g.settings;
    if (this.dead) { this.updateCamera(dt); return; }
    if (this.veh !== null) { this.drive(dt, input); this.vitals(dt); return; }
    const m = input.move();
    // crouch toggle
    if (input.pressed('crouch')) {
      if (this.crouch) { if (headroom(g.W.cs, this.body.x, this.body.z, this.body.y, RAD, H)) this.crouch = false; }
      else this.crouch = true;
    }
    const sprintWanted = input.sprinting() && m.y > 0.3 && !this.crouch;
    const canSprint = this.stamina > 4 && this.useT <= 0;
    this.sprinting = sprintWanted && canSprint && (m.x || m.y);
    let speed = this.crouch ? 1.7 : this.sprinting ? 6.1 : 3.4;
    if (this.useT > 0) speed *= 0.5;
    if (this.hp < 25) speed *= 0.85;
    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw), rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
    const len = Math.hypot(m.x, m.y) || 1;
    const k = (m.analog ? Math.max(0.3, m.mag) : 1) * speed / len;
    const wx = (fx * m.y + rx * m.x) * k, wz = (fz * m.y + rz * m.x) * k;
    const acc = this.body.onGround ? 14 : 2.5;
    this.vel.x += (wx - this.vel.x) * Math.min(1, dt * acc);
    this.vel.y += (wz - this.vel.y) * Math.min(1, dt * acc);
    if (input.pressed('jump') && this.body.onGround && this.stamina > 8 && !this.crouch) { this.body.vy = 6.0; this.body.onGround = false; this.stamina -= 8; }
    const ox = this.body.x, oz = this.body.z;
    stepBody(g.W.cs, this.body, this.vel.x, this.vel.y, dt, RAD, this.crouch ? H_C : H);
    // push out of zombies
    for (const z of g.session.view.zombies) {
      if (z.dead || Math.abs(z.y - this.body.y) > 1.5) continue;
      const dx = this.body.x - z.x, dz = this.body.z - z.z, d = Math.hypot(dx, dz);
      if (d > 0.001 && d < 0.68) { this.body.x += dx / d * (0.68 - d); this.body.z += dz / d * (0.68 - d); }
    }
    if (this.body.landV !== undefined) {
      if (this.body.landV < -11) this.damage((-this.body.landV - 11) * 7, 'fall');
      if (this.body.landV < -4) { g.audio.step(this.body.x, this.body.y, this.body.z, 'hard', 0.6); this.vm.land = 0.15; }
      this.body.landV = undefined;
    }
    const moved = Math.hypot(this.body.x - ox, this.body.z - oz);
    this.speed = moved / Math.max(dt, 0.0001);
    // footsteps + noise
    if (this.body.onGround && moved > 0.001) {
      this.stepAcc += moved;
      const stride = this.sprinting ? 1.05 : this.crouch ? 0.6 : 0.75;
      if (this.stepAcc > stride) {
        this.stepAcc = 0;
        const surf = g.surfaceAt(this.body.x, this.body.z, this.body.y);
        g.audio.step(this.body.x, this.body.y, this.body.z, surf, this.crouch ? 0.1 : this.sprinting ? 0.45 : 0.25);
        g.session.noise(this.body.x, this.body.z, this.crouch ? 1.5 : this.sprinting ? 15 : 6);
      }
    }
    // stamina
    if (this.sprinting) this.stamina = Math.max(0, this.stamina - dt * 15);
    else this.stamina = Math.min(100, this.stamina + dt * (this.hunger > 20 && this.thirst > 20 ? 13 : 6));
    this.eye += ((this.crouch ? EYE_C : EYE) - this.eye) * Math.min(1, dt * 10);
    // head bob
    const moving = this.body.onGround && this.speed > 0.5;
    this.bobAmt += ((moving && s.headBob ? Math.min(1, this.speed / 6) : 0) - this.bobAmt) * Math.min(1, dt * 8);
    this.bob += dt * (this.sprinting ? 11 : 8) * (moving ? 1 : 0);
    this.weapons(dt, input);
    this.vitals(dt);
    this.updateCamera(dt);
  }

  vitals(dt) {
    if (this.dead) return;
    this.hunger = Math.max(0, this.hunger - dt * 0.06);
    this.thirst = Math.max(0, this.thirst - dt * 0.085);
    if (this.hunger <= 0) this.damage(dt * 0.4, 'starve', true);
    if (this.thirst <= 0) this.damage(dt * 0.6, 'thirst', true);
    if (this.bleed > 0) { this.damage(dt * 0.9, 'bleed', true); this.bleed -= dt; }
    if (this.infection > 0) { this.infection = Math.min(100, this.infection + dt * 0.28); if (this.infection > 50) this.damage(dt * (this.infection - 50) * 0.02, 'infection', true); }
    const safe = this.g.inSafe();
    if (this.hunger > 50 && this.thirst > 50 && this.bleed <= 0 && this.infection < 50) this.hp = Math.min(100, this.hp + dt * (safe ? 0.8 : 0.12));
    if (this.light) { this.battery = Math.max(0, this.battery - dt * 0.12); if (this.battery <= 0) this.toggleLight(false); }
    if (this.useT > 0) {
      this.useT -= dt;
      if (this.useT <= 0) this.g.finishUse(this.useItem);
    }
  }

  toggleLight(on) {
    if (on === undefined) on = !this.light;
    if (on && this.battery <= 0) { this.g.hud.toast('Flashlight battery is dead — find batteries'); return; }
    this.light = on;
    this.g.audio.click(0.2);
  }

  damage(n, kind, silent = false) {
    if (this.dead || n <= 0) return;
    this.hp -= n;
    if (!silent) { this.g.hud.hurt(Math.min(1, n / 25)); this.g.audio.hurt(); this.shake = Math.min(0.6, this.shake + n / 40); }
    if (this.hp <= 0) { this.hp = 0; this.dead = true; this.g.onDeath(kind); }
  }

  // ------------------------------------------------------------- weapons
  weapons(dt, input) {
    const g = this.g, inv = this.inv;
    this.fireCd -= dt; this.equipT = Math.max(0, this.equipT - dt);
    const ws = inv.weapons();
    for (let i = 1; i <= 4; i++) if (input.pressed('slot' + i) && ws[i - 1]) this.equip(ws[i - 1]);
    if (input.pressed('swap') || input.pressed('next')) this.equip(ws[(ws.indexOf(inv.equipped) + 1) % ws.length]);
    if (input.pressed('prev')) this.equip(ws[(ws.indexOf(inv.equipped) - 1 + ws.length) % ws.length]);
    const id = inv.equipped, w = ITEMS[id] || ITEMS.fists;
    if (this.reloadT > 0) {
      this.reloadT -= dt;
      if (this.reloadT <= 0) {
        const need = w.mag - (inv.mag[id] || 0);
        const got = inv.remove(w.ammo, need);
        inv.mag[id] = (inv.mag[id] || 0) + got;
        g.hud.weapon(this);
      }
    }
    if (w.type === 'gun' && input.pressed('reload')) this.startReload();
    if (this.swingT > 0) {
      this.swingT -= dt;
      if (this.meleePending > 0) {
        this.meleePending -= dt;
        if (this.meleePending <= 0) {
          const o = this.cam.position;
          const hits = g.session.melee(id, [this.body.x, this.body.y + 1.6, this.body.z], this.facing);
          if (hits && hits.length) { g.audio.hit(o.x, o.y, o.z, true); this.vm.kick = 0.1; }
          void o;
        }
      }
    }
    const held = input.down('fire');
    const fresh = held && !this.triggerHeld;
    this.triggerHeld = held;
    // semi-automatic guns need a fresh trigger pull (touch players can hold for melee/auto)
    const semi = w.type === 'gun' && !w.auto;
    const firing = held && (!semi || fresh || input.touchMode) && !this.sprinting && this.useT <= 0 && this.equipT <= 0;
    if (!firing || this.fireCd > 0 || this.reloadT > 0) return;
    if (w.type === 'gun') {
      if ((inv.mag[id] || 0) <= 0) {
        if (inv.count(w.ammo) > 0) this.startReload();
        else { g.audio.click(0.4); this.fireCd = 0.35; g.hud.toast('Out of ammo'); }
        return;
      }
      inv.mag[id]--;
      this.fireCd = w.rate;
      if (g.input.touchMode && g.settings.aimAssist) this.aimAssist(w.range);
      const o = this.muzzleWorld(), d = this.forward;
      const eye = this.cam.position;
      const hits = g.session.fire(id, [eye.x, eye.y, eye.z], [d.x, d.y, d.z]);
      if (hits) g.shotEffects({ pid: g.session.id, w: id, ox: o.x, oy: o.y, oz: o.z, hits }, true);
      g.effects.flash(o.x, o.y, o.z);
      g.audio.gunshot(undefined, 0, 0, id, 1);
      const kickAmt = id === 'shotgun' ? 0.07 : id === 'rifle' ? 0.06 : id === 'm4' ? 0.012 : 0.025;
      this.pitch = Math.min(1.45, this.pitch + kickAmt); this.yaw += (Math.random() - 0.5) * kickAmt * 0.4;
      this.vm.recoil = id === 'shotgun' ? 1 : 0.6;
      this.shake = Math.min(0.5, this.shake + kickAmt * 2);
      g.hud.weapon(this);
    } else {
      this.swingT = w.rate; this.fireCd = w.rate; this.meleePending = w.rate * 0.35;
      this.stamina = Math.max(0, this.stamina - 6);
      this.vm.swing = 1;
      g.audio.swing(0.5);
    }
  }
  startReload() {
    const id = this.inv.equipped, w = ITEMS[id];
    if (!w || w.type !== 'gun' || this.reloadT > 0) return;
    if ((this.inv.mag[id] || 0) >= w.mag || this.inv.count(w.ammo) <= 0) return;
    this.reloadT = w.reload; this.vm.reload = w.reload; this.g.audio.reload();
  }
  aimAssist(range) {
    const g = this.g, eye = this.cam.position, f = this.forward;
    let best = null, bestA = 0.14;
    for (const z of g.session.view.zombies) {
      if (z.dead) continue;
      const tx = z.x - eye.x, ty = z.y + 1.3 - eye.y, tz = z.z - eye.z, d = Math.hypot(tx, ty, tz);
      if (d > range || d < 0.5) continue;
      const a = Math.acos(clamp((tx * f.x + ty * f.y + tz * f.z) / d, -1, 1));
      if (a < bestA && g.W.nav.los(eye.x, eye.z, z.x, z.z)) { bestA = a; best = [tx, ty, tz, d]; }
    }
    if (!best) return;
    const [tx, ty, tz, d] = best;
    const ty2 = Math.atan2(-tx, -tz), tp = Math.asin(ty / d);
    this.yaw += angleDiff(this.yaw, ty2) * 0.6;
    this.pitch += (tp - this.pitch) * 0.6;
  }
  muzzleWorld() {
    if (this.tpBlend > 0.5) { const p = new THREE.Vector3(); this.weaponMesh.getWorldPosition(p); return p; }
    const f = this.forward, r = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    return this.cam.position.clone().addScaledVector(f, 0.6).addScaledVector(r, 0.12).add(new THREE.Vector3(0, -0.1, 0));
  }

  // ------------------------------------------------------------- camera
  updateCamera(dt) {
    const g = this.g, cam = this.cam;
    this.tpBlend += ((this.tp ? 1 : 0) - this.tpBlend) * Math.min(1, dt * 6);
    // smooth vertical (stairs)
    const targetY = this.body.y + this.eye;
    this.camY += (targetY - this.camY) * Math.min(1, dt * 18);
    if (Math.abs(targetY - this.camY) > 1.5) this.camY = targetY;
    const bob = Math.sin(this.bob) * 0.045 * this.bobAmt, bobX = Math.cos(this.bob * 0.5) * 0.03 * this.bobAmt;
    const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
    const fp = new THREE.Vector3(this.body.x + rx * bobX, this.camY + bob + (this.dead ? -1.3 : 0), this.body.z + rz * bobX);
    let pos = fp;
    if (this.tpBlend > 0.01) {
      const pivot = new THREE.Vector3(this.body.x + rx * 0.45, this.body.y + this.eye + 0.15, this.body.z + rz * 0.45);
      const back = new THREE.Vector3(Math.sin(this.yaw) * Math.cos(this.pitch), -Math.sin(this.pitch) + 0.12, Math.cos(this.yaw) * Math.cos(this.pitch)).normalize();
      const want = 3.0;
      const hit = raycast(g.W.cs, pivot.x, pivot.y, pivot.z, back.x, back.y, back.z, want + 0.3);
      const dist = Math.max(0.4, Math.min(want, hit.d - 0.3));
      const tpPos = pivot.addScaledVector(back, dist);
      const k = this.tpBlend * this.tpBlend * (3 - 2 * this.tpBlend);
      pos = fp.lerp(tpPos, k);
    }
    // shake
    this.shake = Math.max(0, this.shake - dt * 2);
    const sh = this.shake * 0.04;
    cam.position.set(pos.x + (Math.random() - 0.5) * sh, pos.y + (Math.random() - 0.5) * sh, pos.z + (Math.random() - 0.5) * sh);
    cam.rotation.set(this.pitch + (this.dead ? 0.6 : 0), this.yaw, this.dead ? 0.4 : Math.sin(this.bob * 0.5) * 0.004 * this.bobAmt, 'YXZ');
    // body / weapon visibility
    const showBody = this.tpBlend > 0.25 || this.dead;
    this.char.root.visible = showBody;
    this.vm.group.visible = !showBody && !this.dead;
    this.char.root.position.set(this.body.x, this.body.y, this.body.z);
    this.char.root.rotation.y = this.facing;
    const w = ITEMS[this.inv.equipped];
    this.char.animHuman(dt, { speed: this.speed, crouch: this.crouch, weapon: w && w.type === 'gun' ? 'gun' : w && this.inv.equipped !== 'fists' ? 'melee' : 'none', pitch: this.pitch, swing: this.swingT > 0 ? 1 - this.swingT / (w.rate || 0.5) : 0, air: !this.body.onGround, dead: this.dead });
    this.vm.update(dt, this);
    // flashlight
    const on = this.light && !this.dead;
    this.flash.intensity = on ? 38 * (0.75 + 0.25 * Math.min(1, this.battery / 20)) * (this.battery < 10 && Math.random() < 0.05 ? 0.2 : 1) : 0;
    const f = this.forward;
    const src = showBody ? new THREE.Vector3(this.body.x + rx * 0.2, this.body.y + this.eye - 0.2, this.body.z + rz * 0.2) : cam.position.clone().add(new THREE.Vector3(rx * 0.15, -0.15, rz * 0.15));
    this.flash.position.copy(src);
    this.flash.target.position.copy(src).addScaledVector(f, 10);
    this.camPos.copy(cam.position);
  }

  // ------------------------------------------------------------- driving
  enterVehicle(v) {
    this.veh = v.id; this.vehCamYaw = 0; this.vehPitch = -0.12; this.vel.set(0, 0); this.crouch = false; this.distDriven = 0;
    this.g.audio.door(v.x, 1, v.z);
  }
  exitVehicle(spot) {
    const v = this.g.vehicle(this.veh);
    this.veh = null;
    if (spot) { this.body.x = spot.x; this.body.z = spot.z; this.body.y = v ? v.y : 0; }
    this.body.vy = 0;
    this.yaw = v ? v.yaw + Math.PI : this.yaw;
    if (v) this.g.audio.engine(v.id, false);
  }
  drive(dt, input) {
    const g = this.g, v = g.vehicle(this.veh);
    if (!v) { this.veh = null; return; }
    const m = input.move();
    const inp = { throttle: m.y, steer: -m.x, hand: input.down('jump') || input.down('hand') };
    if (input.pressed('headlights') || input.pressed('light')) v.lights = !v.lights;
    if (input.pressed('horn')) { g.audio.horn(v.x, 1, v.z); g.session.noise(v.x, v.z, 45); }
    if (input.pressed('cam')) this.vehView = (this.vehView + 1) % 2;
    const ox = v.x, oz = v.z;
    const impact = stepVehicle(v, inp, dt, g.W.cs);
    this.distDriven += Math.hypot(v.x - ox, v.z - oz);
    if (impact > 6) { g.audio.hit(v.x, 0.8, v.z, false); this.shake = Math.min(1, impact / 15); if (impact > 14) this.damage((impact - 14) * 2.5, 'crash'); }
    this.body.x = v.x; this.body.z = v.z; this.body.y = v.y;
    g.session.vstate({ id: v.id, x: v.x, y: v.y, z: v.z, yaw: v.yaw, speed: v.speed, steer: v.steer, fuel: v.fuel, hp: v.hp, vx: v.vx, vz: v.vz, lights: v.lights, brake: v.brake });
    g.audio.engine(v.id, v.fuel > 0 && v.hp > 0, v.rpm + Math.abs(inp.throttle) * 0.15, v.x, 1, v.z, true);
    if (v.fuel <= 0 && Math.abs(m.y) > 0.5 && !this._noFuelMsg) { this._noFuelMsg = true; g.hud.toast('Out of fuel — find a fuel can or a pump'); }
    if (v.fuel > 0) this._noFuelMsg = false;
    // camera
    const cam = this.cam;
    if (this.vehLookT > 0) this.vehLookT -= dt; else { this.vehCamYaw *= Math.max(0, 1 - dt * 2); this.vehPitch += (-0.12 - this.vehPitch) * Math.min(1, dt * 2); }
    const t = VTYPES[v.type];
    if (this.vehView === 1 || (!this.tp && this.vehView === 0 && false)) {
      const fx = Math.sin(v.yaw), fz = Math.cos(v.yaw), rx = Math.cos(v.yaw), rz = -Math.sin(v.yaw);
      cam.position.set(v.x + fx * 0.15 - rx * 0.38, v.y + 1.28, v.z + fz * 0.15 - rz * 0.38);
      cam.rotation.set(this.vehPitch * 0.7, v.yaw + Math.PI + this.vehCamYaw, 0, 'YXZ');
      g.vehicleViewInside = true;
    } else {
      const yaw = v.yaw + this.vehCamYaw;
      const dist = 6.2 + t.hl * 0.6, hgt = 2.4;
      const want = new THREE.Vector3(v.x - Math.sin(yaw) * dist * Math.cos(this.vehPitch), v.y + hgt - Math.sin(this.vehPitch) * dist, v.z - Math.cos(yaw) * dist * Math.cos(this.vehPitch));
      const piv = new THREE.Vector3(v.x, v.y + 1.6, v.z);
      const dir = want.clone().sub(piv); const dl = dir.length(); dir.normalize();
      const hit = raycast(g.W.cs, piv.x, piv.y, piv.z, dir.x, dir.y, dir.z, dl, false);
      const target = piv.clone().addScaledVector(dir, Math.max(1.5, Math.min(dl, hit.d - 0.3)));
      if (!this._vcam) this._vcam = target.clone();
      this._vcam.lerp(target, Math.min(1, dt * 7));
      cam.position.copy(this._vcam);
      cam.lookAt(v.x, v.y + 1.3, v.z);
      g.vehicleViewInside = false;
    }
    this.shake = Math.max(0, this.shake - dt * 2);
    if (this.shake > 0) cam.position.y += (Math.random() - 0.5) * this.shake * 0.08;
    this.char.root.visible = false;
    this.vm.group.visible = false;
    this.flash.intensity = 0;
    this.speed = Math.abs(v.speed);
    this.camPos.copy(cam.position);
  }
}

// ------------------------------------------------------------------ viewmodel
const SKIN = 0xd2ae8c, SLEEVE = 0x4a5a3a;
function mk(geo, col, x, y, z, rx = 0, ry = 0, rz = 0, mat) {
  const m = new THREE.Mesh(geo, mat || new THREE.MeshStandardMaterial({ color: col, roughness: 0.6, metalness: 0.2 }));
  m.position.set(x, y, z); m.rotation.set(rx, ry, rz);
  return m;
}
const B = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const C = (r0, r1, h, s = 8) => new THREE.CylinderGeometry(r0, r1, h, s);

export class ViewModel {
  constructor(game) {
    this.g = game;
    this.scene = new THREE.Scene();
    this.cam = new THREE.PerspectiveCamera(60, 1, 0.01, 10);
    this.scene.add(this.cam);
    this.group = new THREE.Group();
    this.cam.add(this.group);
    this.amb = new THREE.HemisphereLight(0xc0c8d8, 0x40382e, 1.2);
    this.scene.add(this.amb);
    this.dir = new THREE.DirectionalLight(0xffffff, 1.2); this.dir.position.set(0.5, 1, 0.3);
    this.scene.add(this.dir);
    this.fl = new THREE.PointLight(0xffb060, 0, 3); this.fl.position.set(0.2, -0.1, -0.8); this.cam.add(this.fl);
    this.arms = new THREE.Group(); this.group.add(this.arms);
    this.right = this._arm(1); this.left = this._arm(-1);
    this.arms.add(this.right); this.arms.add(this.left);
    this.weapon = null; this.id = null;
    this.recoil = 0; this.swing = 0; this.reload = 0; this.reloadMax = 1; this.kick = 0; this.land = 0; this.sway = new THREE.Vector2();
    this.setWeapon('fists');
  }
  _arm(side) {
    const g = new THREE.Group();
    const sleeve = mk(C(0.055, 0.05, 0.42), SLEEVE, 0, 0, 0.21, Math.PI / 2);
    const hand = mk(B(0.08, 0.06, 0.12), SKIN, 0, 0, -0.02);
    g.add(sleeve); g.add(hand);
    g.userData.hand = hand;
    g.position.set(side * 0.2, -0.25, -0.35);
    return g;
  }
  makeWeapon(id, small = false) {
    const imported = weaponModel(id);
    if (imported) {
      // imported model is centred; shift so the grip sits in the hand
      const g = new THREE.Group();
      imported.position.set(0, id === 'm4' ? 0.02 : -0.045, id === 'm4' ? -0.2 : -0.09);
      g.add(imported);
      g.userData.imported = true;
      return g;
    }
    const g = new THREE.Group();
    const metal = new THREE.MeshStandardMaterial({ color: 0x2a2c30, roughness: 0.4, metalness: 0.8 });
    const wood = new THREE.MeshStandardMaterial({ color: 0x6a4a2a, roughness: 0.7 });
    switch (id) {
      case 'pistol': g.add(mk(B(0.04, 0.05, 0.2), 0, 0, 0.04, -0.08, 0, 0, 0, metal)); g.add(mk(B(0.035, 0.11, 0.05), 0, 0, -0.03, 0.0, 0.25, 0, 0, metal)); break;
      case 'shotgun': g.add(mk(C(0.018, 0.018, 0.75), 0, 0, 0.03, -0.3, Math.PI / 2, 0, 0, metal)); g.add(mk(C(0.022, 0.022, 0.25), 0, 0, 0.0, -0.25, Math.PI / 2, 0, 0, wood)); g.add(mk(B(0.05, 0.08, 0.3), 0, 0, 0.0, 0.12, 0, 0, 0, wood)); g.add(mk(B(0.045, 0.06, 0.18), 0, 0, 0.02, -0.02, 0, 0, 0, metal)); break;
      case 'm4': g.add(mk(C(0.012, 0.012, 0.45), 0, 0, 0.03, -0.5, Math.PI / 2, 0, 0, metal)); g.add(mk(B(0.045, 0.07, 0.5), 0, 0, 0.01, -0.1, 0, 0, 0, metal)); g.add(mk(B(0.03, 0.12, 0.05), 0, 0, -0.07, -0.18, 0.2, 0, 0, metal)); g.add(mk(B(0.04, 0.09, 0.22), 0, 0, -0.01, 0.22, 0, 0, 0, metal)); g.add(mk(B(0.03, 0.04, 0.12), 0, 0, 0.065, -0.05, 0, 0, 0, metal)); break;
      case 'rifle': g.add(mk(C(0.014, 0.014, 0.8), 0, 0, 0.03, -0.35, Math.PI / 2, 0, 0, metal)); g.add(mk(B(0.05, 0.08, 0.6), 0, 0, -0.01, 0.05, 0, 0, 0, wood)); g.add(mk(C(0.025, 0.025, 0.25), 0, 0, 0.08, -0.08, Math.PI / 2, 0, 0, metal)); break;
      case 'crowbar': g.add(mk(C(0.012, 0.012, 0.7), 0, 0, 0.3, 0, 0, 0, 0, new THREE.MeshStandardMaterial({ color: 0x7a1a14, roughness: 0.5, metalness: 0.6 }))); g.add(mk(C(0.012, 0.012, 0.1), 0, 0, 0.66, 0.03, 0, 0, 0.9, metal)); break;
      case 'bat': g.add(mk(C(0.04, 0.018, 0.8), 0, 0, 0.36, 0, 0, 0, 0, new THREE.MeshStandardMaterial({ color: 0xa8865a, roughness: 0.6 }))); break;
      case 'axe': g.add(mk(C(0.016, 0.016, 0.75), 0, 0, 0.34, 0, 0, 0, 0, wood)); g.add(mk(B(0.02, 0.12, 0.18), 0, 0, 0.66, 0.08, 0, 0, 0, new THREE.MeshStandardMaterial({ color: 0xb01a14, roughness: 0.5, metalness: 0.5 }))); break;
      case 'knife': g.add(mk(B(0.02, 0.025, 0.1), 0, 0, 0.0, 0, 0, 0, 0, new THREE.MeshStandardMaterial({ color: 0x1a1a1a }))); g.add(mk(B(0.005, 0.03, 0.16), 0, 0, 0.0, -0.13, 0, 0, 0, new THREE.MeshStandardMaterial({ color: 0xc8c8c8, metalness: 0.9, roughness: 0.2 }))); break;
      default: return null;
    }
    if (small) g.scale.setScalar(1);
    return g;
  }
  setWeapon(id) {
    if (this.weapon) this.right.remove(this.weapon);
    this.id = id;
    this.weapon = this.makeWeapon(id);
    if (this.weapon) {
      const melee = ['crowbar', 'bat', 'axe', 'knife'].includes(id);
      if (melee) { this.weapon.rotation.set(-1.2, 0, 0); this.weapon.position.set(0, 0.02, -0.04); }
      else this.weapon.position.set(0, 0.03, -0.06);
      this.right.add(this.weapon);
    }
    this.raise = 1;
  }
  update(dt, p) {
    const gun = ['pistol', 'shotgun', 'rifle', 'm4'].includes(this.id);
    const twoHand = this.id === 'shotgun' || this.id === 'rifle' || this.id === 'm4';
    this.recoil = Math.max(0, this.recoil - dt * 6);
    this.kick = Math.max(0, this.kick - dt * 3);
    this.land = Math.max(0, this.land - dt);
    this.raise = Math.max(0, (this.raise || 0) - dt * 3);
    const w = ITEMS[this.id] || ITEMS.fists;
    const bob = Math.sin(p.bob) * 0.012 * p.bobAmt, bobx = Math.cos(p.bob * 0.5) * 0.015 * p.bobAmt;
    const sprint = p.sprinting ? 1 : 0;
    this.sprintK = (this.sprintK || 0) + (sprint - (this.sprintK || 0)) * Math.min(1, dt * 8);
    const sk = this.sprintK;
    // base poses
    const R = this.right, L = this.left;
    R.position.set(0.17 + bobx, -0.2 + bob - this.recoil * 0.02 - this.raise * 0.3 - this.land * 0.2 - sk * 0.08, -0.38 + this.recoil * 0.07);
    R.rotation.set(this.recoil * 0.25 - sk * 0.4, sk * 0.5, 0);
    if (twoHand) { L.visible = true; L.position.set(0.02 + bobx, -0.21 + bob - this.raise * 0.3 - sk * 0.08, -0.62 + this.recoil * 0.07); L.rotation.set(this.recoil * 0.2, -0.2, 0); }
    else if (gun) { L.visible = true; L.position.set(0.12 + bobx, -0.24 + bob - this.raise * 0.3 - sk * 0.08, -0.37 + this.recoil * 0.06); L.rotation.set(this.recoil * 0.25, 0.3, 0); }
    else { L.visible = this.id === 'fists'; L.position.set(-0.2 - bobx, -0.26 + bob - sk * 0.05, -0.38); L.rotation.set(-sk * 0.3, 0, 0); }
    if (this.id === 'fists' || !gun) {
      // melee swing arc (right to left, downward)
      if (this.swing > 0) {
        const k = 1 - this.swing;
        const t = k < 0.3 ? k / 0.3 : 1 - Math.min(1, (k - 0.3) / 0.3);
        const strike = k > 0.3 ? Math.min(1, (k - 0.3) / 0.25) : 0;
        R.position.x += 0.12 * t - strike * 0.3;
        R.position.y += 0.12 * t - strike * 0.12;
        R.position.z += -strike * 0.15;
        R.rotation.z = t * 0.9 - strike * 1.2;
        R.rotation.x += t * 0.6 - strike * 0.9;
        this.swing = Math.max(0, this.swing - dt / Math.max(0.2, w.rate));
      }
    }
    if (p.reloadT > 0) { const k = p.reloadT / (w.reload || 1); const d = Math.sin(k * Math.PI); R.position.y -= d * 0.12; R.rotation.x -= d * 0.6; L.position.y -= d * 0.18; }
    if (p.useT > 0) { R.position.y -= 0.3; L.position.y = -0.15; L.position.z = -0.3; }
    this.fl.intensity = this.recoil > 0.5 ? 2 : 0;
    // light the viewmodel roughly like the world
    const g = this.g;
    const dark = g.darkness || 0;
    this.amb.intensity = 1.1 - dark * 0.8 + (p.light ? 0.3 : 0);
    this.dir.intensity = 1.0 - dark * 0.8;
  }
}
