// CCTV cameras on poles at the junctions: the camera head turns back and forth (shared/cctv.ts, from
// the server clock) and throws a red cone of light onto the road showing what it watches. The cone
// flares up when it catches the local player in a stolen car.

import * as THREE from 'three';
import { CCTV_CAMERAS, cameraYaw, type Cctv } from '../../../shared/cctv';
import { groundHeight } from './City';

interface CamView {
  cam: Cctv;
  pivot: THREE.Group;
  cone: THREE.MeshBasicMaterial;
  beam: THREE.MeshBasicMaterial;
  led: THREE.MeshBasicMaterial;
}

/** The lit sector on the ground (flat, in the pivot's frame: +z is where the camera looks). */
function sectorGeometry(range: number, fov: number): THREE.BufferGeometry {
  const g = new THREE.CircleGeometry(range, 24, Math.PI / 2 - fov, fov * 2);
  // CircleGeometry lies in XY with angle from +x (the arc's middle is +y); laid flat facing up that
  // is -z, and half a turn brings it to +z.
  g.rotateX(-Math.PI / 2);
  g.rotateY(Math.PI);
  // Fade towards the far edge: alpha in the vertex colour.
  const pos = g.getAttribute('position');
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const d = Math.hypot(pos.getX(i), pos.getZ(i)) / range;
    const k = 1 - d * 0.75;
    colors.set([k, k, k], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return g;
}

/** The faint beam from the lens down to the sector's edge (an open pyramid). */
function beamGeometry(height: number, range: number, fov: number): THREE.BufferGeometry {
  const pts: number[] = [];
  const steps = 10;
  const apex = [0, height - 0.3, 0.3];
  for (let i = 0; i < steps; i++) {
    const a0 = -fov + (2 * fov * i) / steps;
    const a1 = -fov + (2 * fov * (i + 1)) / steps;
    pts.push(...apex, Math.sin(a0) * range, 0.05, Math.cos(a0) * range, Math.sin(a1) * range, 0.05, Math.cos(a1) * range);
  }
  // The two flat sides.
  pts.push(...apex, 0, 0.05, 0.6, Math.sin(-fov) * range, 0.05, Math.cos(-fov) * range);
  pts.push(...apex, Math.sin(fov) * range, 0.05, Math.cos(fov) * range, 0, 0.05, 0.6);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  g.computeVertexNormals();
  return g;
}

export class CctvView {
  readonly group = new THREE.Group();
  private views: CamView[] = [];
  private blink = 0;

  constructor() {
    this.group.name = 'cctv';
    const poleMat = new THREE.MeshStandardMaterial({ color: '#2f343b', metalness: 0.6, roughness: 0.45 });
    const bodyMat = new THREE.MeshStandardMaterial({ color: '#e9ecef', metalness: 0.2, roughness: 0.4 });
    const lensMat = new THREE.MeshStandardMaterial({ color: '#0d1014', metalness: 0.4, roughness: 0.2 });
    const poleGeo = new THREE.CylinderGeometry(0.09, 0.12, 1, 8);
    const headGeo = new THREE.BoxGeometry(0.34, 0.3, 0.7);
    const lensGeo = new THREE.CylinderGeometry(0.11, 0.11, 0.12, 12);
    lensGeo.rotateX(Math.PI / 2);
    const ledGeo = new THREE.SphereGeometry(0.05, 8, 6);
    for (const cam of CCTV_CAMERAS) {
      const base = new THREE.Group();
      base.position.set(cam.x, groundHeight(cam.x, cam.z), cam.z);
      const pole = new THREE.Mesh(poleGeo, poleMat);
      pole.scale.y = cam.height;
      pole.position.y = cam.height / 2;
      pole.castShadow = true;
      base.add(pole);
      // Everything that turns with the camera.
      const pivot = new THREE.Group();
      base.add(pivot);
      const head = new THREE.Mesh(headGeo, bodyMat);
      head.position.set(0, cam.height + 0.1, 0.25);
      head.rotation.x = 0.35;
      head.castShadow = true;
      const lens = new THREE.Mesh(lensGeo, lensMat);
      lens.position.set(0, -0.02, 0.38);
      head.add(lens);
      const led = new THREE.MeshBasicMaterial({ color: '#ff2a2a', toneMapped: false });
      const dot = new THREE.Mesh(ledGeo, led);
      dot.position.set(0.12, 0.12, 0.3);
      head.add(dot);
      pivot.add(head);
      const cone = new THREE.MeshBasicMaterial({ color: '#ff2a2a', transparent: true, opacity: 0.24, depthWrite: false, vertexColors: true, blending: THREE.AdditiveBlending, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2 });
      const sector = new THREE.Mesh(sectorGeometry(cam.range, cam.fov), cone);
      sector.position.y = 0.06;
      sector.renderOrder = 2;
      pivot.add(sector);
      const beam = new THREE.MeshBasicMaterial({ color: '#ff3b3b', transparent: true, opacity: 0.06, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, toneMapped: false });
      const vol = new THREE.Mesh(beamGeometry(cam.height, cam.range, cam.fov), beam);
      vol.renderOrder = 3;
      pivot.add(vol);
      this.group.add(base);
      this.views.push({ cam, pivot, cone, beam, led });
    }
  }

  /** Turn the cameras (server clock, ms); `watched` is the camera that has the player in view. */
  update(dt: number, serverNow: number, watched: string | null, night: number): void {
    this.blink += dt;
    const on = Math.floor(this.blink * 2) % 2 === 0;
    for (const v of this.views) {
      v.pivot.rotation.y = cameraYaw(v.cam, serverNow);
      const hit = v.cam.id === watched;
      // Brighter at night; flaring and flickering while it has you.
      v.cone.opacity = hit ? 0.3 + 0.12 * Math.sin(this.blink * 18) : 0.15 + 0.1 * night;
      v.beam.opacity = hit ? 0.14 : 0.04 + 0.04 * night;
      v.led.color.set(hit || on ? '#ff2a2a' : '#4a0a0a');
    }
  }
}
