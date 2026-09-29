import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { highDetailVehicles } from '../../client/src/data/highDetailVehicles';
import { fitModel, hqEntryFor } from '../../client/src/render/HqModels';
import { VEHICLE_MODELS } from '../../shared/vehicles';

describe('high-detail vehicle models', () => {
  it('every entry points at a catalogue vehicle and a .glb under assets/models', () => {
    const ids = new Set(VEHICLE_MODELS.map((m) => m.id));
    const seen = new Set<string>();
    for (const e of highDetailVehicles) {
      expect(ids.has(e.vehicleId), e.id).toBe(true);
      expect(e.modelUrl).toMatch(/^\.\/assets\/models\/[\w-]+\.glb$/);
      expect(seen.has(e.id)).toBe(false);
      seen.add(e.id);
    }
    expect(highDetailVehicles.find((e) => e.id === 'm3_g80_hq')).toMatchObject({ vehicleId: 'bmw_m3_g80', scale: 1, rotationOffset: { x: 0, y: Math.PI, z: 0 }, castShadow: true, receiveShadow: true });
  });

  it('only uses models whose file exists (keeps the built-in body otherwise)', () => {
    // No model files are committed, so every vehicle falls back to its procedural body.
    for (const e of highDetailVehicles) expect(hqEntryFor(e.vehicleId)).toBeNull();
  });

  it('fits a model to the vehicle: facing, real length, centred, on the ground, paint found by name', () => {
    // A "downloaded" model in centimetres, facing -z and off-centre.
    const scene = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(190, 140, 470), new THREE.MeshStandardMaterial({ name: 'M_CarPaint_Red' }));
    body.position.set(40, 90, -30);
    const glass = new THREE.Mesh(new THREE.BoxGeometry(150, 40, 200), new THREE.MeshStandardMaterial({ name: 'Glass' }));
    glass.position.set(40, 170, -30);
    scene.add(body, glass);
    const entry = { ...highDetailVehicles[0]!, paintMaterials: ['paint'] };
    const paint = fitModel(scene, entry, 4.79);
    const box = new THREE.Box3().setFromObject(scene);
    const size = box.getSize(new THREE.Vector3());
    expect(size.z).toBeCloseTo(4.79, 4);
    expect(box.min.y).toBeCloseTo(0, 6);
    const c = box.getCenter(new THREE.Vector3());
    expect(c.x).toBeCloseTo(0, 6);
    expect(c.z).toBeCloseTo(0, 6);
    expect([...paint].map((m) => m.name)).toEqual(['M_CarPaint_Red']);
    expect(body.castShadow).toBe(true);
  });
});
