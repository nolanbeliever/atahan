// Vehicle 3D models: every vehicle is a GLB file (no built-in shapes). Checks the registry, reads
// each shipped .glb's JSON chunk (node names, materials, accessor bounds - no Draco decoding
// needed) and exercises the loader's fitting on a synthetic "downloaded" model.

import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { LEGACY_HQ_FILES, PART_MODELS, highDetailVehicles } from '../../client/src/data/highDetailVehicles';
import { fitTemplate } from '../../client/src/render/ModelLibrary';
import { TRAFFIC_KINDS } from '../../shared/traffic';
import { POLICE_MODEL, VEHICLE_MODELS, getModel } from '../../shared/vehicles';

const PUBLIC = path.resolve(__dirname, '../../client/public');

interface GltfNode {
  name?: string;
  children?: number[];
  mesh?: number;
  translation?: [number, number, number];
  rotation?: [number, number, number, number];
  scale?: [number, number, number];
}

interface Gltf {
  nodes: GltfNode[];
  meshes: { primitives: { attributes: Record<string, number>; material?: number }[] }[];
  materials: { name?: string }[];
  accessors: { min?: number[]; max?: number[] }[];
  scenes: { nodes: number[] }[];
  extensionsUsed?: string[];
}

function readGlb(url: string): Gltf {
  const file = path.join(PUBLIC, url.replace(/^\.\//, ''));
  const buf = fs.readFileSync(file);
  expect(buf.readUInt32LE(0)).toBe(0x46546c67); // 'glTF'
  const len = buf.readUInt32LE(12);
  return JSON.parse(buf.subarray(20, 20 + len).toString('utf8')) as Gltf;
}

/** World-space bounds of every mesh under the scene, skipping kit parts and helper nodes. */
function bounds(g: Gltf): { min: THREE.Vector3; max: THREE.Vector3; names: Set<string>; materials: Set<string>; wheelY: number[] } {
  const box = new THREE.Box3();
  const names = new Set<string>();
  const materials = new Set<string>();
  const wheelY: number[] = [];
  const visit = (i: number, parent: THREE.Matrix4, skip: boolean) => {
    const n = g.nodes[i]!;
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(...(n.translation ?? [0, 0, 0])),
      new THREE.Quaternion(...(n.rotation ?? [0, 0, 0, 1])),
      new THREE.Vector3(...(n.scale ?? [1, 1, 1])),
    );
    const world = parent.clone().multiply(m);
    if (n.name) names.add(n.name);
    const hidden = skip || n.name === 'kits' || n.name === 'door_fl_cavity';
    if (/^wheel_(fl|fr|rl|rr|front|rear)$/.test(n.name ?? '')) wheelY.push(new THREE.Vector3().setFromMatrixPosition(world).y);
    if (n.mesh !== undefined) {
      for (const p of g.meshes[n.mesh]!.primitives) {
        if (p.material !== undefined) materials.add(g.materials[p.material]!.name ?? '');
        if (hidden) continue;
        const a = g.accessors[p.attributes.POSITION!]!;
        const b = new THREE.Box3(new THREE.Vector3(...(a.min as [number, number, number])), new THREE.Vector3(...(a.max as [number, number, number]))).applyMatrix4(world);
        box.union(b);
      }
    }
    for (const c of n.children ?? []) visit(c, world, hidden);
  };
  for (const root of g.scenes[0]!.nodes) visit(root, new THREE.Matrix4(), false);
  return { min: box.min, max: box.max, names, materials, wheelY };
}

describe('vehicle model registry', () => {
  it('has a model for every vehicle, traffic kind and the police car', () => {
    const ids = new Set(highDetailVehicles.map((e) => e.vehicleId));
    for (const m of VEHICLE_MODELS) expect(ids.has(m.id), m.id).toBe(true);
    for (const k of ['truck', 'bus', 'semi_tractor', 'semi_trailer', 'police']) expect(ids.has(k), k).toBe(true);
    expect(Object.keys(TRAFFIC_KINDS)).toEqual(expect.arrayContaining(['car', 'truck', 'bus', 'semi']));
    const seen = new Set<string>();
    for (const e of highDetailVehicles) {
      expect(seen.has(e.id), e.id).toBe(false);
      seen.add(e.id);
      expect(e.modelUrl).toMatch(/\.(glb|gltf)$/);
      expect(e.scale).toBeGreaterThan(0);
    }
    for (const legacy of Object.values(LEGACY_HQ_FILES)) expect(ids.has(legacy.vehicleId)).toBe(true);
  });

  it('every default model file exists and is Draco-compressed', () => {
    for (const e of highDetailVehicles) {
      for (const url of [e.modelUrl, e.lodUrl].filter((u): u is string => !!u)) {
        const g = readGlb(url);
        expect(g.extensionsUsed ?? [], url).toContain('KHR_draco_mesh_compression');
      }
    }
    expect(readGlb(PART_MODELS.rims).nodes.some((n) => n.name === 'rim_mesh')).toBe(true);
  });
});

describe('default car models', () => {
  for (const m of VEHICLE_MODELS) {
    it(`${m.id}: real size, tyres on the road, named parts`, () => {
      const g = readGlb(highDetailVehicles.find((e) => e.vehicleId === m.id)!.modelUrl);
      const b = bounds(g);
      const size = b.max.clone().sub(b.min);
      // Matches the catalogue (and the collision box) within a few centimetres (a spare wheel on
      // the tailgate may stick out a little further).
      expect(size.z, `${m.id} length`).toBeGreaterThan(m.shape.length - 0.12);
      expect(size.z, `${m.id} length`).toBeLessThan(m.shape.length + 0.36);
      expect(size.x, `${m.id} width`).toBeLessThanOrEqual(m.shape.width + 0.3);
      expect(size.x, `${m.id} width`).toBeGreaterThan(m.shape.width * 0.8);
      expect(b.min.y).toBeGreaterThanOrEqual(-0.02);
      expect(size.y).toBeGreaterThan(m.specs.kind === 'bike' ? 0.8 : 1);
      if (m.specs.kind === 'bike') {
        for (const n of ['fork', 'wheel_front', 'wheel_rear', 'seat_rider']) expect(b.names.has(n), `${m.id} ${n}`).toBe(true);
      } else {
        for (const n of ['wheel_fl', 'wheel_fr', 'wheel_rl', 'wheel_rr', 'seat_driver', 'headlights', 'taillights', 'kits', 'kit_wing_gt']) expect(b.names.has(n), `${m.id} ${n}`).toBe(true);
        // Combustion cars have exhaust tips (for backfire flames); electric cars don't.
        expect(b.names.has('exhaust_0'), `${m.id} exhaust`).toBe(m.specs.aspiration !== 'electric');
        // Wheel centres sit one wheel radius above the road.
        for (const y of b.wheelY) expect(Math.abs(y - m.shape.wheelRadius), `${m.id} wheel height`).toBeLessThan(0.08);
        for (const mat of ['paint', 'glass', 'headlight', 'taillight', 'tire', 'rim']) expect(b.materials.has(mat), `${m.id} ${mat}`).toBe(true);
      }
    });
  }

  it('most cars have an opening driver door', () => {
    const withDoor = VEHICLE_MODELS.filter((m) => m.specs.kind === 'car' && bounds(readGlb(`./assets/models/vehicles/${m.id}.glb`)).names.has('door_fl'));
    expect(withDoor.length).toBeGreaterThan(VEHICLE_MODELS.length * 0.7);
  });

  it('the police car has siren lamps and the cockpit has animated gauges', () => {
    const p = bounds(readGlb('./assets/models/vehicles/police.glb'));
    expect(p.materials.has('siren_red')).toBe(true);
    expect(p.materials.has('siren_blue')).toBe(true);
    expect(getModel('police')).toBe(POLICE_MODEL);
    const c = bounds(readGlb(PART_MODELS.cockpit));
    for (const n of ['steering_wheel', 'needle_rpm', 'needle_speed', 'shifter', 'pedal_throttle', 'pedal_brake', 'eye']) expect(c.names.has(n), n).toBe(true);
  });
});

describe('fitting a downloaded model', () => {
  it('turns, scales, centres and grounds any model; wheels found by common names', () => {
    // A "downloaded" model in centimetres, facing -z, off-centre, with oddly named wheels.
    const scene = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(190, 120, 470), new THREE.MeshStandardMaterial({ name: 'M_CarPaint_Red' }));
    body.position.set(40, 95, -30);
    scene.add(body);
    for (const [name, x, z] of [
      ['Wheel_FL', 120, -190],
      ['Wheel_FR', -40, -190],
      ['Wheel_RL', 120, 130],
      ['Wheel_RR', -40, 130],
    ] as const) {
      const w = new THREE.Mesh(new THREE.CylinderGeometry(35, 35, 25, 16).rotateZ(Math.PI / 2), new THREE.MeshStandardMaterial({ name: 'Tyre' }));
      w.name = name;
      w.position.set(x, 35, z);
      scene.add(w);
    }
    const entry = { ...highDetailVehicles[0]!, autoFit: true, rotationOffset: { x: 0, y: Math.PI, z: 0 } };
    const t = fitTemplate(scene, entry, 4.79);
    const box = new THREE.Box3().setFromObject(t.scene);
    expect(box.getSize(new THREE.Vector3()).z).toBeCloseTo(4.79, 2);
    expect(box.min.y).toBeCloseTo(0, 4);
    const c = box.getCenter(new THREE.Vector3());
    expect(Math.abs(c.x)).toBeLessThan(0.01);
    expect(Math.abs(c.z)).toBeLessThan(0.01);
    // Wheels got pivots at their centres (so they can spin and steer).
    for (const k of ['fl', 'fr', 'rl', 'rr']) expect(t.scene.getObjectByName(`wheel_${k}_spin`), k).toBeDefined();
    // Facing +z after the rotation offset: the front wheels are at +z.
    const fl = new THREE.Vector3();
    t.scene.getObjectByName('wheel_fl')!.getWorldPosition(fl);
    expect(fl.z).toBeGreaterThan(0);
    expect(t.info.wheelR).toBeCloseTo(0.35 * (4.79 / 4.7), 1);
  });
});
