// Draws the highway traffic with instancing: one set of instanced meshes per vehicle type, so a
// hundred cars, trucks, coaches and semis cost a few dozen draw calls. Every type is its GLB model
// (data/highDetailVehicles.ts) baked into two geometries (paint + fixed colours); cars close to the
// camera use the full model, distant ones its simplified (LOD) copy. Lamps (brake lights, blinking
// indicators, head / tail lights) and night glows are instanced too.

import * as THREE from 'three';
import { TF, TRAFFIC_COUNT, trafficPose, trafficSpec, type TrafficSpec } from '../../../shared/traffic';
import { getModel } from '../../../shared/vehicles';
import type { ClientTrafficCar } from '../game/Traffic';
import { lightGlowTexture } from './Highway';
import { vehicleTemplate, type VehicleTemplate } from './ModelLibrary';
import { bakeTemplate } from './VehicleMesh';

const NEAR_LOD = 120;

interface InstancedSet {
  meshes: { mesh: THREE.InstancedMesh; tint: 0 | 1 | 2 }[];
  n: number;
}

interface LampSpots {
  head: [number, number, number][];
  tail: [number, number, number][];
  /** Indicators at the corners (facing +z, x > 0 is the vehicle's left side). */
  ind: [number, number, number][];
}

interface PartModel {
  near: InstancedSet;
  far: InstancedSet | null;
  lamps: LampSpots;
}

const paintMat = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.45, roughness: 0.35 });
const fixedMat = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.2, roughness: 0.6 });

function makeSet(parts: { geo: THREE.BufferGeometry; tint: 0 | 1 | 2 }[], capacity: number, group: THREE.Group, shadows: boolean): InstancedSet {
  const meshes = parts.map(({ geo, tint }) => {
    const mesh = new THREE.InstancedMesh(geo, tint === 0 ? fixedMat : paintMat, capacity);
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.castShadow = shadows;
    mesh.receiveShadow = false;
    if (tint) mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    group.add(mesh);
    return { mesh, tint };
  });
  return { meshes, n: 0 };
}

function bakedParts(t: VehicleTemplate): { geo: THREE.BufferGeometry; tint: 0 | 1 | 2 }[] {
  const b = bakeTemplate(t);
  const list: { geo: THREE.BufferGeometry; tint: 0 | 1 | 2 }[] = [
    { geo: b.paint, tint: 1 },
    { geo: b.fixed, tint: 0 },
  ];
  if (b.paint2) list.push({ geo: b.paint2, tint: 2 });
  return list;
}

/** Lamp spots of a model: its own lamp helpers (heavy vehicles) or its lamp meshes (cars). */
function lampsOf(t: VehicleTemplate): LampSpots {
  const pick = (prefix: string) => {
    const out: [number, number, number][] = [];
    t.scene.updateMatrixWorld(true);
    t.scene.traverse((o) => {
      if (o.name.startsWith(prefix)) {
        const p = t.scene.worldToLocal(o.getWorldPosition(new THREE.Vector3()));
        out.push([p.x, p.y, p.z]);
      }
    });
    return out;
  };
  const head = pick('lamp_head_');
  const tail = pick('lamp_tail_');
  const ind = pick('lamp_ind_');
  if (head.length || tail.length) return { head, tail, ind };
  const i = t.info;
  const L = i.length / 2;
  const W = i.width / 2;
  return {
    head: i.heads.map((v) => [v.x, v.y, v.z]),
    tail: i.tails.map((v) => [v.x, v.y, v.z]),
    ind: [
      [-W * 0.86, i.heads[0]!.y, L - 0.12],
      [W * 0.86, i.heads[0]!.y, L - 0.12],
      [-W * 0.88, i.tails[0]!.y, -L + 0.06],
      [W * 0.88, i.tails[0]!.y, -L + 0.06],
    ],
  };
}

/** Along-body offsets of a semi's tractor and trailer model centres (16.4 m overall, 13.6 m trailer). */
const SEMI_LAYOUT = { tractor: 16.4 / 2 - 3.0, trailer: -16.4 / 2 + 6.8 };

export class TrafficView {
  readonly group = new THREE.Group();
  private parts = new Map<string, PartModel>();
  private lampMesh: THREE.InstancedMesh;
  private lampCount = 0;
  private glow: THREE.Points;
  private glowPos: Float32Array;
  private glowCol: Float32Array;
  private glowCount = 0;
  private beams: THREE.InstancedMesh;
  private beamCount = 0;
  private night = 0;
  private time = 0;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly v = new THREE.Vector3();
  private readonly color = new THREE.Color();
  private readonly frustum = new THREE.Frustum();
  private readonly sphere = new THREE.Sphere();
  private readonly one = new THREE.Vector3(1, 1, 1);

  constructor() {
    this.group.name = 'traffic';
    // Capacity per part type from the (deterministic) line-up; models load in the background.
    const counts = new Map<string, number>();
    for (let id = 0; id < TRAFFIC_COUNT; id++) for (const key of this.keysOf(trafficSpec(id))) counts.set(key, (counts.get(key) ?? 0) + 1);
    for (const [key, n] of counts) {
      const car = key.startsWith('car:');
      const id = car ? key.slice(4) : key;
      // Cars are fitted to their catalogue length; heavy vehicles keep their modelled size.
      const length = car ? getModel(id).shape.length : 0;
      void Promise.all([vehicleTemplate(id, length), car ? vehicleTemplate(id, length, true) : Promise.resolve(null)])
        .then(([full, lod]) => {
          this.parts.set(key, {
            near: makeSet(bakedParts(full), n, this.group, true),
            far: lod ? makeSet(bakedParts(lod), n, this.group, false) : null,
            lamps: lampsOf(full),
          });
        })
        .catch((err) => console.warn(`traffic model ${key} failed to load`, err));
    }
    const lampCap = TRAFFIC_COUNT * 8;
    this.lampMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ toneMapped: false }), lampCap);
    this.lampMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(lampCap * 3), 3);
    this.lampMesh.count = 0;
    this.lampMesh.frustumCulled = false;
    this.glowPos = new Float32Array(lampCap * 3);
    this.glowCol = new Float32Array(lampCap * 3);
    const gg = new THREE.BufferGeometry();
    gg.setAttribute('position', new THREE.BufferAttribute(this.glowPos, 3));
    gg.setAttribute('color', new THREE.BufferAttribute(this.glowCol, 3));
    this.glow = new THREE.Points(
      gg,
      new THREE.PointsMaterial({ map: lightGlowTexture(), size: 2.4, sizeAttenuation: true, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 }),
    );
    this.glow.frustumCulled = false;
    this.beams = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: lightGlowTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0, color: '#fff1cc' }),
      TRAFFIC_COUNT,
    );
    this.beams.count = 0;
    this.beams.frustumCulled = false;
    this.group.add(this.lampMesh, this.glow, this.beams);
  }

  /** Instanced part types a traffic vehicle is made of. */
  private keysOf(spec: TrafficSpec): string[] {
    if (spec.kind === 'car') return [`car:${spec.modelId}`];
    if (spec.kind === 'semi') return ['semi_tractor', 'semi_trailer'];
    return [spec.kind];
  }

  setNight(f: number): void {
    this.night = f;
    (this.glow.material as THREE.PointsMaterial).opacity = f;
    (this.beams.material as THREE.MeshBasicMaterial).opacity = f * 0.45;
    this.glow.visible = f > 0.02;
    this.beams.visible = f > 0.02;
  }

  private place(set: InstancedSet, x: number, z: number, yaw: number, c1: THREE.Color, c2: THREE.Color): void {
    const i = set.n++;
    this.q.setFromAxisAngle(this.v.set(0, 1, 0), yaw);
    this.m.compose(this.v.set(x, 0, z), this.q, this.one);
    for (const { mesh, tint } of set.meshes) {
      mesh.setMatrixAt(i, this.m);
      if (tint === 1) mesh.setColorAt(i, c1);
      else if (tint === 2) mesh.setColorAt(i, c2);
    }
  }

  private lamp(x: number, z: number, yaw: number, lx: number, ly: number, lz: number, size: number, r: number, g: number, b: number, glow: boolean): void {
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    const wx = x + lx * c + lz * s;
    const wz = z - lx * s + lz * c;
    if (this.lampCount < this.lampMesh.instanceMatrix.count) {
      this.q.setFromAxisAngle(this.v.set(0, 1, 0), yaw);
      this.m.compose(this.v.set(wx, ly, wz), this.q, new THREE.Vector3(size, size * 0.55, 0.06));
      this.lampMesh.setMatrixAt(this.lampCount, this.m);
      this.lampMesh.setColorAt(this.lampCount, this.color.setRGB(r, g, b));
      this.lampCount++;
    }
    if (glow && this.night > 0.02 && this.glowCount * 3 < this.glowPos.length) {
      const k = this.glowCount * 3;
      this.glowPos[k] = wx;
      this.glowPos[k + 1] = ly;
      this.glowPos[k + 2] = wz;
      this.glowCol[k] = Math.min(1, r * 0.6);
      this.glowCol[k + 1] = Math.min(1, g * 0.6);
      this.glowCol[k + 2] = Math.min(1, b * 0.6);
      this.glowCount++;
    }
  }

  update(cars: Iterable<ClientTrafficCar>, camera: THREE.Camera, dt: number): void {
    this.time += dt;
    for (const p of this.parts.values()) {
      p.near.n = 0;
      if (p.far) p.far.n = 0;
    }
    this.lampCount = 0;
    this.glowCount = 0;
    this.beamCount = 0;
    camera.updateMatrixWorld();
    this.frustum.setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    const cam = camera.position;
    const blinkOn = this.time % 0.8 < 0.42;
    const c1 = new THREE.Color();
    const c2 = new THREE.Color();
    for (const car of cars) {
      const spec = car.spec;
      this.sphere.center.set(car.x, 1.5, car.z);
      this.sphere.radius = spec.length / 2 + 1;
      if (!this.frustum.intersectsSphere(this.sphere)) continue;
      const dist = Math.hypot(car.x - cam.x, car.z - cam.z);
      c1.set(spec.color);
      c2.set(spec.color2);
      const signal = car.flags & (TF.LEFT | TF.RIGHT);
      const braking = (car.flags & TF.BRAKE) !== 0;
      // Body parts (a semi's tractor and trailer follow the curve separately).
      const bodies: { key: string; x: number; z: number; yaw: number; front: boolean; rear: boolean }[] = [];
      if (spec.kind === 'semi') {
        const t = trafficPose(spec.cw, car.s + car.es, car.off + car.eo, SEMI_LAYOUT.tractor);
        const r = trafficPose(spec.cw, car.s + car.es, car.off + car.eo, SEMI_LAYOUT.trailer);
        bodies.push({ key: 'semi_tractor', x: t.x, z: t.z, yaw: t.yaw, front: true, rear: false });
        bodies.push({ key: 'semi_trailer', x: r.x, z: r.z, yaw: r.yaw, front: false, rear: true });
      } else bodies.push({ key: this.keysOf(spec)[0]!, x: car.x, z: car.z, yaw: car.yaw, front: true, rear: true });
      for (const b of bodies) {
        const part = this.parts.get(b.key);
        if (!part) continue;
        if (part.far && dist > NEAR_LOD) this.place(part.far, b.x, b.z, b.yaw, c1, c2);
        else this.place(part.near, b.x, b.z, b.yaw, c1, c2);
        if (dist > 260) continue;
        const L = part.lamps;
        const night = this.night;
        for (const h of L.head) this.lamp(b.x, b.z, b.yaw, h[0], h[1], h[2], 0.32, 1.6 + night, 1.5 + night, 1.2 + night * 0.6, true);
        for (const t of L.tail) this.lamp(b.x, b.z, b.yaw, t[0], t[1], t[2], braking ? 0.36 : 0.28, braking ? 3.2 : 0.9 + night * 1.2, 0.05, 0.04, braking || night > 0.02);
        if (signal && blinkOn) {
          // Facing +z, local +x is the vehicle's left side.
          for (const p of L.ind) if (signal === TF.LEFT === p[0] > 0) this.lamp(b.x, b.z, b.yaw, p[0] * 1.02, p[1], p[2], 0.2, 3.0, 1.5, 0.1, true);
        }
        if (b.front && this.night > 0.02 && this.beamCount < this.beams.instanceMatrix.count && dist < 180) {
          const c = Math.cos(b.yaw);
          const s = Math.sin(b.yaw);
          const ahead = (spec.kind === 'semi' ? 3 : spec.length / 2) + 6;
          this.q.setFromAxisAngle(this.v.set(0, 1, 0), b.yaw);
          this.m.compose(this.v.set(b.x + s * ahead, 0.05, b.z + c * ahead), this.q, new THREE.Vector3(6, 1, 13));
          this.beams.setMatrixAt(this.beamCount++, this.m);
        }
      }
    }
    for (const p of this.parts.values()) {
      for (const set of p.far ? [p.near, p.far] : [p.near]) {
        for (const { mesh } of set.meshes) {
          mesh.count = set.n;
          mesh.instanceMatrix.needsUpdate = true;
          if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        }
      }
    }
    this.lampMesh.count = this.lampCount;
    this.lampMesh.instanceMatrix.needsUpdate = true;
    if (this.lampMesh.instanceColor) this.lampMesh.instanceColor.needsUpdate = true;
    this.glow.geometry.setDrawRange(0, this.glowCount);
    (this.glow.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.glow.geometry.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
    this.beams.count = this.beamCount;
    this.beams.instanceMatrix.needsUpdate = true;
  }
}
