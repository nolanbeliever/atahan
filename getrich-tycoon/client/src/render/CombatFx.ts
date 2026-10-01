// Gunfire and explosions: muzzle flashes, tracers, bullet holes, sparks / dust / blood, fireballs and
// smoke, falling car parts, and the smoke (and fire) of badly damaged cars.

import * as THREE from 'three';

interface Particle {
  sprite: THREE.Sprite;
  vel: THREE.Vector3;
  life: number;
  max: number;
  grow: number;
  fade: number;
  gravity: number;
}

interface Tracer {
  line: THREE.Line;
  life: number;
}

interface Debris {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  spin: THREE.Vector3;
  life: number;
}

function softTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 2, 32, 32, 31);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.45, 'rgba(255,255,255,0.55)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

function holeTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 32;
  c.height = 32;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(16, 16, 1, 16, 16, 15);
  grad.addColorStop(0, 'rgba(10,10,10,1)');
  grad.addColorStop(0.35, 'rgba(25,22,20,0.95)');
  grad.addColorStop(0.6, 'rgba(60,55,50,0.5)');
  grad.addColorStop(1, 'rgba(60,55,50,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 32, 32);
  return new THREE.CanvasTexture(c);
}

const MAX_HOLES = 140;

export class CombatFx {
  readonly group = new THREE.Group();
  private soft = softTexture();
  private holeMat: THREE.MeshBasicMaterial;
  private holeGeo = new THREE.PlaneGeometry(0.13, 0.13);
  private particles: Particle[] = [];
  private tracers: Tracer[] = [];
  private debris: Debris[] = [];
  private holes: THREE.Mesh[] = [];
  private flash: THREE.PointLight;
  private flashLife = 0;
  private laser: THREE.Line;
  private laserDot: THREE.Sprite;
  /** Camera shake (0-1), read by the game. */
  shake = 0;

  constructor(scene: THREE.Scene) {
    this.group.name = 'combatFx';
    scene.add(this.group);
    this.holeMat = new THREE.MeshBasicMaterial({ map: holeTexture(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 });
    this.flash = new THREE.PointLight('#ffb347', 0, 9, 2);
    this.group.add(this.flash);
    const lg = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, 1)]);
    this.laser = new THREE.Line(lg, new THREE.LineBasicMaterial({ color: '#ff2a3a', transparent: true, opacity: 0.85, toneMapped: false }));
    this.laser.visible = false;
    this.laser.frustumCulled = false;
    this.laserDot = this.sprite('#ff2a3a', 0.25, 1);
    this.laserDot.visible = false;
    this.group.add(this.laser, this.laserDot);
  }

  private sprite(color: string, size: number, opacity: number, blending: THREE.Blending = THREE.AdditiveBlending): THREE.Sprite {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.soft, color, transparent: true, opacity, depthWrite: false, blending, toneMapped: false }));
    s.scale.setScalar(size);
    this.group.add(s);
    return s;
  }

  private emit(pos: THREE.Vector3, color: string, n: number, opts: { speed: number; size: number; life: number; grow?: number; gravity?: number; up?: number; normal?: boolean; blending?: THREE.Blending; opacity?: number }): void {
    for (let i = 0; i < n; i++) {
      const s = this.sprite(color, opts.size * (0.7 + Math.random() * 0.6), opts.opacity ?? 1, opts.blending);
      s.position.copy(pos);
      const v = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.6 + (opts.up ?? 0), Math.random() - 0.5).normalize().multiplyScalar(opts.speed * (0.4 + Math.random() * 0.8));
      const max = opts.life * (0.7 + Math.random() * 0.6);
      this.particles.push({ sprite: s, vel: v, life: max, max, grow: opts.grow ?? 0, fade: opts.opacity ?? 1, gravity: opts.gravity ?? 0 });
    }
  }

  /** A shot: flash at the muzzle, a tracer, and what it hit. */
  shot(from: THREE.Vector3, to: THREE.Vector3, color: string, hit: string, normal: THREE.Vector3 | null, carRoot: THREE.Object3D | null, big = false): void {
    this.flash.position.copy(from);
    this.flash.intensity = big ? 9 : 5;
    this.flashLife = 0.05;
    this.emit(from, '#ffd27a', big ? 4 : 2, { speed: 1.5, size: big ? 0.55 : 0.32, life: 0.06 });
    const geo = new THREE.BufferGeometry().setFromPoints([from, to]);
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9, toneMapped: false, blending: THREE.AdditiveBlending }));
    line.frustumCulled = false;
    this.group.add(line);
    this.tracers.push({ line, life: 0.08 });
    if (hit === 'air') return;
    if (hit === 'person') {
      this.emit(to, '#a3121c', 6, { speed: 1.6, size: 0.16, life: 0.45, gravity: -6, blending: THREE.NormalBlending, opacity: 0.9 });
      return;
    }
    if (hit === 'car') this.emit(to, '#ffd35a', 7, { speed: 4.5, size: 0.08, life: 0.25, gravity: -9 });
    else this.emit(to, '#b9b2a6', 5, { speed: 1.4, size: 0.35, life: 0.6, grow: 0.8, blending: THREE.NormalBlending, opacity: 0.6, up: 0.4 });
    if (normal) this.hole(to, normal, carRoot);
  }

  /** A bullet hole on a wall, the ground or a car (kept on the car as it drives). */
  hole(at: THREE.Vector3, normal: THREE.Vector3, carRoot: THREE.Object3D | null): void {
    const m = new THREE.Mesh(this.holeGeo, this.holeMat);
    m.position.copy(at).addScaledVector(normal, 0.02);
    m.lookAt(at.clone().add(normal));
    m.rotateZ(Math.random() * Math.PI);
    if (carRoot) {
      carRoot.updateMatrixWorld(true);
      carRoot.attach(m);
    } else this.group.add(m);
    this.holes.push(m);
    if (this.holes.length > MAX_HOLES) this.holes.shift()!.removeFromParent();
  }

  /** A fireball, smoke and flying bits; the camera shakes when it's close. */
  explosion(at: THREE.Vector3, radius: number, camPos: THREE.Vector3): void {
    this.flash.position.copy(at).add(new THREE.Vector3(0, 1.5, 0));
    this.flash.intensity = 40;
    this.flash.distance = radius * 6;
    this.flashLife = 0.35;
    this.emit(at, '#ffb347', 14, { speed: radius * 1.1, size: radius * 0.55, life: 0.55, grow: 2.2, up: 0.6 });
    this.emit(at, '#ff5a1f', 10, { speed: radius * 0.8, size: radius * 0.45, life: 0.8, grow: 1.6, up: 0.8 });
    this.emit(at, '#222222', 10, { speed: radius * 0.45, size: radius * 0.42, life: 2.4, grow: 1.1, up: 1.6, blending: THREE.NormalBlending, opacity: 0.65 });
    this.emit(at, '#ffe08a', 18, { speed: radius * 3, size: 0.12, life: 0.7, gravity: -9, up: 0.8 });
    const d = camPos.distanceTo(at);
    this.shake = Math.max(this.shake, Math.max(0, 1 - d / (radius * 8)));
  }

  /** Smoke from a damaged engine (1 grey, 2 black) and fire on a wreck. */
  smoke(at: THREE.Vector3, level: number, fire: boolean, dt: number): void {
    if (level <= 0) return;
    const rate = (level === 2 ? 16 : 7) * dt;
    if (Math.random() < rate) this.emit(at, level === 2 ? '#1c1c1c' : '#8d8d8d', 1, { speed: 0.6, size: level === 2 ? 0.9 : 0.6, life: 2.2, grow: 1.3, up: 2.5, blending: THREE.NormalBlending, opacity: level === 2 ? 0.75 : 0.45 });
    if (fire && Math.random() < 14 * dt) this.emit(at, '#ff7a1f', 1, { speed: 0.8, size: 0.7, life: 0.5, grow: 0.6, up: 2 });
  }

  /** A car part knocked off (bumper, door): it falls and bounces, then goes. */
  part(at: THREE.Vector3, size: THREE.Vector3, color: string, push: THREE.Vector3): void {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y, size.z), new THREE.MeshStandardMaterial({ color, metalness: 0.4, roughness: 0.5 }));
    mesh.position.copy(at);
    mesh.castShadow = true;
    this.group.add(mesh);
    this.debris.push({ mesh, vel: push.clone().add(new THREE.Vector3(0, 2.5, 0)), spin: new THREE.Vector3(Math.random() * 6 - 3, Math.random() * 6 - 3, Math.random() * 6 - 3), life: 6 });
  }

  /** Glass shards. */
  shards(at: THREE.Vector3): void {
    this.emit(at, '#cfe8ff', 14, { speed: 2.5, size: 0.07, life: 0.6, gravity: -9, up: 0.4 });
  }

  /** The RPG's laser from the muzzle to where it would hit. */
  setLaser(from: THREE.Vector3 | null, to: THREE.Vector3 | null): void {
    const on = !!from && !!to;
    this.laser.visible = on;
    this.laserDot.visible = on;
    if (!on) return;
    const pos = this.laser.geometry.getAttribute('position') as THREE.BufferAttribute;
    pos.setXYZ(0, from!.x, from!.y, from!.z);
    pos.setXYZ(1, to!.x, to!.y, to!.z);
    pos.needsUpdate = true;
    this.laser.geometry.computeBoundingSphere();
    this.laserDot.position.copy(to!);
  }

  update(dt: number): void {
    if (this.flashLife > 0) {
      this.flashLife -= dt;
      if (this.flashLife <= 0) {
        this.flash.intensity = 0;
        this.flash.distance = 9;
      }
    }
    this.shake = Math.max(0, this.shake - dt * 1.8);
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i]!;
      p.life -= dt;
      if (p.life <= 0) {
        p.sprite.removeFromParent();
        p.sprite.material.dispose();
        this.particles.splice(i, 1);
        continue;
      }
      p.vel.y += p.gravity * dt;
      p.sprite.position.addScaledVector(p.vel, dt);
      p.vel.multiplyScalar(1 - Math.min(0.9, dt * 1.5));
      if (p.grow) p.sprite.scale.multiplyScalar(1 + p.grow * dt);
      p.sprite.material.opacity = p.fade * Math.min(1, (p.life / p.max) * 1.6);
    }
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const t = this.tracers[i]!;
      t.life -= dt;
      (t.line.material as THREE.LineBasicMaterial).opacity = Math.max(0, t.life / 0.08) * 0.9;
      if (t.life <= 0) {
        t.line.removeFromParent();
        t.line.geometry.dispose();
        (t.line.material as THREE.Material).dispose();
        this.tracers.splice(i, 1);
      }
    }
    for (let i = this.debris.length - 1; i >= 0; i--) {
      const d = this.debris[i]!;
      d.life -= dt;
      d.vel.y -= 9.8 * dt;
      d.mesh.position.addScaledVector(d.vel, dt);
      if (d.mesh.position.y < 0.08) {
        d.mesh.position.y = 0.08;
        d.vel.y = Math.abs(d.vel.y) * 0.3;
        d.vel.x *= 0.6;
        d.vel.z *= 0.6;
        d.spin.multiplyScalar(0.6);
      }
      d.mesh.rotation.x += d.spin.x * dt;
      d.mesh.rotation.y += d.spin.y * dt;
      d.mesh.rotation.z += d.spin.z * dt;
      if (d.life <= 0) {
        d.mesh.removeFromParent();
        d.mesh.geometry.dispose();
        (d.mesh.material as THREE.Material).dispose();
        this.debris.splice(i, 1);
      }
    }
  }
}
