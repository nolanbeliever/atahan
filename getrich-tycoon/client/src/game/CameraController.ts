// Smooth third-person orbit camera with simple building occlusion handling.

import { terrainHeight } from '../../../shared/farShore';
import * as THREE from 'three';
import type { AABB } from '../../../shared/world';
import { angleDiff, clamp } from '../../../shared/util';

export class CameraController {
  yaw = 0;
  pitch = 0.32;
  distance = 6.5;
  sensitivity = 1;
  invertY = false;
  private current = new THREE.Vector3();
  private look = new THREE.Vector3();
  private initialized = false;

  constructor(private readonly camera: THREE.PerspectiveCamera) {}

  applyMouse(dx: number, dy: number): void {
    const s = 0.0025 * this.sensitivity;
    this.yaw -= dx * s;
    this.pitch = clamp(this.pitch + dy * s * (this.invertY ? -1 : 1), -0.25, 1.25);
  }

  /** Gently rotate behind a heading (used while driving when the mouse is idle). */
  follow(heading: number, dt: number, strength = 2.5): void {
    this.yaw += angleDiff(this.yaw, heading) * Math.min(1, dt * strength);
  }

  /** `ceiling`: indoors, the camera stays below this height (m). */
  update(target: THREE.Vector3, dt: number, driving: boolean, speed: number, boxes: readonly AABB[], ceiling: number | null = null): void {
    const wantDist = driving ? 8.5 + Math.min(4, Math.abs(speed) * 0.12) : this.distance;
    const height = driving ? 2.2 : 1.6;
    const focus = new THREE.Vector3(target.x, target.y + height, target.z);
    const fx = Math.sin(this.yaw);
    const fz = Math.cos(this.yaw);
    let dist = wantDist;
    // Pull the camera in if a building is in the way (2D ray march).
    for (let t = 1; t <= wantDist; t += 0.5) {
      const px = focus.x - fx * t * Math.cos(this.pitch);
      const pz = focus.z - fz * t * Math.cos(this.pitch);
      const py = focus.y + Math.sin(this.pitch) * t;
      const hit = boxes.some((b) => px > b.minX - 0.3 && px < b.maxX + 0.3 && pz > b.minZ - 0.3 && pz < b.maxZ + 0.3 && py < 14);
      if (hit || (ceiling !== null && py > ceiling)) {
        dist = Math.max(1.5, t - 0.6);
        break;
      }
    }
    if (ceiling !== null) dist = Math.max(1.2, dist);
    const desired = new THREE.Vector3(
      focus.x - fx * dist * Math.cos(this.pitch),
      // Never below the ground there (the far shore's hill) or the target's own level.
      Math.max(0.6, focus.y - 1.2, terrainHeight(focus.x - fx * dist * Math.cos(this.pitch), focus.z - fz * dist * Math.cos(this.pitch)) + 1.2, focus.y + Math.sin(this.pitch) * dist),
      focus.z - fz * dist * Math.cos(this.pitch),
    );
    if (ceiling !== null) desired.y = Math.min(desired.y, ceiling);
    if (!this.initialized) {
      this.current.copy(desired);
      this.look.copy(focus);
      this.initialized = true;
    }
    const k = 1 - Math.exp(-dt * (driving ? 10 : 14));
    this.current.lerp(desired, k);
    this.look.lerp(focus, 1 - Math.exp(-dt * 20));
    this.camera.position.copy(this.current);
    this.camera.lookAt(this.look);
  }

  snap(): void {
    this.initialized = false;
  }
}
