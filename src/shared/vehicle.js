// Vehicle dynamics: bicycle-model steering, engine/brake/drag forces, tyre lateral
// grip with handbrake slides, and multi-circle collision against the city colliders.
// Runs on the driving client; the server relays and sanity-checks the result.
import { resolveXZ } from './physics.js';
import { clamp } from './util.js';

export const VTYPES = {
  sedan: { name: 'Sedan', accel: 9.0, maxSpeed: 33, reverse: 7, brake: 18, grip: 10, maxSteer: 0.58, wheelbase: 2.7, hw: 0.95, hl: 2.25, tank: 45, use: 0.012, hp: 100 },
  pickup: { name: 'Pickup truck', accel: 8.2, maxSpeed: 30, reverse: 7, brake: 17, grip: 9, maxSteer: 0.55, wheelbase: 3.1, hw: 1.0, hl: 2.6, tank: 70, use: 0.016, hp: 140 },
  police: { name: 'Police cruiser', accel: 10.5, maxSpeed: 39, reverse: 8, brake: 20, grip: 11, maxSteer: 0.58, wheelbase: 2.8, hw: 0.95, hl: 2.35, tank: 55, use: 0.014, hp: 120 },
  van: { name: 'Delivery van', accel: 6.8, maxSpeed: 26, reverse: 6, brake: 15, grip: 8, maxSteer: 0.52, wheelbase: 3.0, hw: 1.0, hl: 2.5, tank: 70, use: 0.018, hp: 160 },
};

export function makeVehicle(id, spawn, rng) {
  const t = VTYPES[spawn.type] || VTYPES.sedan;
  return {
    id, type: spawn.type, x: spawn.x, y: 0, z: spawn.z, yaw: spawn.yaw, vx: 0, vz: 0, speed: 0, steer: 0, yawRate: 0,
    fuel: Math.round(t.tank * (spawn.fuel ?? (rng ? rng.range(0.15, 0.6) : 0.4))), hp: t.hp, driver: null, lights: false, brake: false,
    pitch: 0, roll: 0, wheel: 0, rpm: 0, col: { x0: 0, y0: 0, z0: 0, x1: 0, y1: 1.5, z1: 0, en: true, veh: id },
    color: spawn.color,
  };
}

export function updateVehicleCollider(v) {
  const t = VTYPES[v.type];
  const c = Math.abs(Math.cos(v.yaw)), s = Math.abs(Math.sin(v.yaw));
  const k = c > 0.2 && s > 0.2 ? 0.85 : 1;
  const ex = (t.hw * c + t.hl * s) * k, ez = (t.hw * s + t.hl * c) * k;
  Object.assign(v.col, { x0: v.x - ex, x1: v.x + ex, z0: v.z - ez, z1: v.z + ez, y0: v.y, y1: v.y + 1.5 });
}

const circ = { x: 0, z: 0, y: 0 };
// input: {throttle -1..1, steer -1..1, hand: bool}. Returns impact speed (m/s) if it hit something.
export function stepVehicle(v, input, dt, cs) {
  const t = VTYPES[v.type];
  const fx = Math.sin(v.yaw), fz = Math.cos(v.yaw);
  const rx = Math.cos(v.yaw), rz = -Math.sin(v.yaw);
  let vF = v.vx * fx + v.vz * fz;
  let vR = v.vx * rx + v.vz * rz;
  const thr = v.fuel > 0 && v.hp > 0 ? input.throttle : Math.min(0, input.throttle) * (v.hp > 0 ? 1 : 0);
  let a = 0;
  v.brake = false;
  if (thr > 0.05) {
    if (vF < -0.5) { a = t.brake * thr; v.brake = true; }
    else a = t.accel * thr * Math.max(0, 1 - vF / t.maxSpeed) * (0.6 + 0.4 * Math.min(1, Math.abs(vF) / 6 + 0.4));
  } else if (thr < -0.05) {
    if (vF > 0.5) { a = -t.brake * -thr; v.brake = true; }
    else a = vF > -t.reverse ? -t.accel * 0.6 * -thr : 0;
  }
  // rolling resistance + aero drag
  const drag = 0.35 * Math.sign(vF) + vF * Math.abs(vF) * 0.0045;
  vF += (a - drag) * dt;
  if (Math.abs(vF) < 0.08 && Math.abs(thr) < 0.05) vF = 0;
  if (input.hand) { vF -= Math.sign(vF) * Math.min(Math.abs(vF), 9 * dt); v.brake = true; }
  const grip = (input.hand ? t.grip * 0.18 : t.grip) * dt;
  vR -= vR * Math.min(1, grip);
  // steering (bicycle model), reduced at speed
  const target = clamp(input.steer, -1, 1) * t.maxSteer * (1 - Math.min(0.62, Math.abs(vF) / 45));
  v.steer += (target - v.steer) * Math.min(1, dt * 7);
  const yawRate = (vF / t.wheelbase) * Math.tan(v.steer) * (input.hand ? 1.35 : 1);
  v.yaw += yawRate * dt;
  const nfx = Math.sin(v.yaw), nfz = Math.cos(v.yaw), nrx = Math.cos(v.yaw), nrz = -Math.sin(v.yaw);
  v.vx = nfx * vF + nrx * vR;
  v.vz = nfz * vF + nrz * vR;
  // suspension visuals
  v.pitch += ((-a * 0.006) - v.pitch) * Math.min(1, dt * 6);
  v.roll += ((yawRate * vF * 0.004) - v.roll) * Math.min(1, dt * 6);
  v.wheel += vF * dt / 0.36;
  v.rpm = Math.min(1, Math.abs(vF) / t.maxSpeed);
  v.yawRate = yawRate;
  // integrate with collision substeps
  const steps = Math.max(1, Math.ceil(Math.hypot(v.vx, v.vz) * dt / 0.3));
  let impact = 0;
  for (let s = 0; s < steps; s++) {
    v.x += (v.vx * dt) / steps; v.z += (v.vz * dt) / steps;
    let px = 0, pz = 0;
    const fwx = Math.sin(v.yaw), fwz = Math.cos(v.yaw);
    const r = t.hw;
    const offs = [-(t.hl - r), 0, t.hl - r];
    for (const o of offs) {
      circ.x = v.x + fwx * o; circ.z = v.z + fwz * o; circ.y = v.y + 0.25;
      const ox = circ.x, oz = circ.z;
      resolveXZ(cs, circ, r, 1.3, 0.32, (c) => c.veh !== v.id);
      px += circ.x - ox; pz += circ.z - oz;
    }
    if (px || pz) {
      v.x += px; v.z += pz;
      const l = Math.hypot(px, pz) || 1, nx = px / l, nz = pz / l;
      const vn = v.vx * nx + v.vz * nz;
      if (vn < 0) {
        impact = Math.max(impact, -vn);
        v.vx -= nx * vn * 1.25; v.vz -= nz * vn * 1.25;
        v.vx *= 0.9; v.vz *= 0.9;
      }
    }
  }
  v.speed = v.vx * Math.sin(v.yaw) + v.vz * Math.cos(v.yaw);
  v.fuel = Math.max(0, v.fuel - Math.abs(v.speed) * dt * t.use * (0.6 + 0.4 * Math.abs(thr)));
  if (impact > 7) v.hp = Math.max(0, v.hp - (impact - 7) * 2.2);
  updateVehicleCollider(v);
  return impact;
}
