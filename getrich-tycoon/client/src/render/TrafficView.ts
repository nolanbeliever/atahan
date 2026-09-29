// Draws the highway traffic with instancing: one set of instanced meshes per vehicle type, so a
// hundred cars, trucks, coaches and semis cost a few dozen draw calls. Cars close to the camera use
// the full procedural body, distant ones a light hull. Lamps (brake lights, blinking indicators,
// head / tail lights) and night glows are instanced too.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { DEFAULT_MODS } from '../../../shared/customization';
import { TF, TRAFFIC_COUNT, trafficPose, trafficSpec, type TrafficSpec } from '../../../shared/traffic';
import { getModel } from '../../../shared/vehicles';
import type { ClientTrafficCar } from '../game/Traffic';
import { heavyPart, SEMI_LAYOUT, type HeavyKey, type LampSpots } from './heavyBody';
import { lightGlowTexture } from './Highway';
import { VehicleView } from './VehicleMesh';

const NEAR_LOD = 120;
const PERFECT = { engine: 100, transmission: 100, brakes: 100, tires: 100, body: 100, interior: 100, cleanliness: 100 };

interface InstancedSet {
  meshes: { mesh: THREE.InstancedMesh; tint: 0 | 1 | 2 }[];
  n: number;
}

interface PartModel {
  near: InstancedSet;
  far: InstancedSet | null;
  lamps: LampSpots;
  /** Hull scale for the far LOD (cars). */
  size: [number, number, number];
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

/** A low-detail car: body, glasshouse and wheels (unit length/width, scaled per model). */
function hull(): { paint: THREE.BufferGeometry; fixed: THREE.BufferGeometry } {
  const colored = (g: THREE.BufferGeometry, c: string) => {
    const x = g.toNonIndexed();
    x.deleteAttribute('uv');
    const col = new THREE.Color(c);
    const n = x.getAttribute('position').count;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) arr.set([col.r, col.g, col.b], i * 3);
    x.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    return x;
  };
  const body = new THREE.BoxGeometry(1, 0.62, 1).translate(0, 0.62, 0);
  const roof = new THREE.BoxGeometry(0.78, 0.08, 0.42).translate(0, 1.4, -0.05);
  const glass = new THREE.BoxGeometry(0.82, 0.46, 0.5).translate(0, 1.15, -0.05);
  const wheels: THREE.BufferGeometry[] = [];
  for (const z of [0.32, -0.32]) for (const x of [-0.46, 0.46]) wheels.push(new THREE.BoxGeometry(0.1, 0.6, 0.14).translate(x, 0.3, z));
  return {
    paint: mergeGeometries([colored(body, '#ffffff'), colored(roof, '#ffffff')], false)!,
    fixed: mergeGeometries([colored(glass, '#1a2230'), ...wheels.map((w) => colored(w, '#141518'))], false)!,
  };
}

/** Where a car model's lamps are (approximate, from its size). */
function carLamps(modelId: string): LampSpots {
  const m = getModel(modelId);
  const L = m.shape.length / 2;
  const W = m.shape.width / 2;
  return {
    head: [
      [-W * 0.68, 0.72, L - 0.05],
      [W * 0.68, 0.72, L - 0.05],
    ],
    tail: [
      [-W * 0.72, 0.85, -L + 0.03],
      [W * 0.72, 0.85, -L + 0.03],
    ],
    ind: [
      [-W * 0.86, 0.72, L - 0.12],
      [W * 0.86, 0.72, L - 0.12],
      [-W * 0.88, 0.85, -L + 0.06],
      [W * 0.88, 0.85, -L + 0.06],
    ],
  };
}

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

  constructor() {
    this.group.name = 'traffic';
    // Capacity per part type from the (deterministic) line-up.
    const counts = new Map<string, number>();
    for (let id = 0; id < TRAFFIC_COUNT; id++) for (const key of this.keysOf(trafficSpec(id))) counts.set(key, (counts.get(key) ?? 0) + 1);
    const hullGeo = hull();
    for (const [key, n] of counts) {
      if (key.startsWith('car:')) {
        const modelId = key.slice(4);
        const view = new VehicleView({ modelId, color: '#ffffff', mods: { ...DEFAULT_MODS }, condition: PERFECT }, { hq: false });
        const baked = view.bake();
        view.dispose();
        const shape = getModel(modelId).shape;
        this.parts.set(key, {
          near: makeSet(
            [
              { geo: baked.paint, tint: 1 },
              { geo: baked.fixed, tint: 0 },
            ],
            n,
            this.group,
            true,
          ),
          far: makeSet(
            [
              { geo: hullGeo.paint, tint: 1 },
              { geo: hullGeo.fixed, tint: 0 },
            ],
            n,
            this.group,
            false,
          ),
          lamps: carLamps(modelId),
          size: [shape.width, 1, shape.length],
        });
      } else {
        const hp = heavyPart(key as HeavyKey);
        const list: { geo: THREE.BufferGeometry; tint: 0 | 1 | 2 }[] = [
          { geo: hp.paint, tint: 1 },
          { geo: hp.fixed, tint: 0 },
        ];
        if (hp.paint2) list.push({ geo: hp.paint2, tint: 2 });
        this.parts.set(key, { near: makeSet(list, n, this.group, true), far: null, lamps: hp.lamps, size: [1, 1, 1] });
      }
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

  private place(set: InstancedSet, x: number, z: number, yaw: number, scale: [number, number, number], c1: THREE.Color, c2: THREE.Color): void {
    const i = set.n++;
    this.q.setFromAxisAngle(this.v.set(0, 1, 0), yaw);
    this.m.compose(this.v.set(x, 0, z), this.q, new THREE.Vector3(...scale));
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
        if (part.far && dist > NEAR_LOD) this.place(part.far, b.x, b.z, b.yaw, part.size, c1, c2);
        else this.place(part.near, b.x, b.z, b.yaw, [1, 1, 1], c1, c2);
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
