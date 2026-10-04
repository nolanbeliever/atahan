// The police helicopter: a light twin-blade chopper in police livery with a nose searchlight that
// sweeps onto whoever it is tracking (a visible beam and a pool of light), wig-wag beacons, spinning
// main and tail rotors, a health bar when it has been hit, and smoke / a spin when it goes down.

import * as THREE from 'three';

const geo = new THREE.BoxGeometry(1, 1, 1);

function mesh(g: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1): THREE.Mesh {
  const o = new THREE.Mesh(g, m);
  o.position.set(x, y, z);
  o.scale.set(sx, sy, sz);
  o.castShadow = true;
  return o;
}

function liveryTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = '#f2f2ee';
  g.fillRect(0, 0, 256, 64);
  g.fillStyle = '#1d3f8f';
  g.fillRect(0, 40, 256, 14);
  g.fillStyle = '#1d3f8f';
  g.font = '900 34px Arial, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('POLICE', 128, 22);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class HelicopterView {
  readonly root = new THREE.Group();
  private readonly body = new THREE.Group();
  private readonly rotor = new THREE.Group();
  private readonly tailRotor = new THREE.Group();
  private readonly beam: THREE.Mesh;
  private readonly pool: THREE.Mesh;
  private readonly light: THREE.SpotLight;
  private readonly beacons: THREE.Mesh[] = [];
  private readonly hpBar: THREE.Sprite;
  private readonly hpCtx: CanvasRenderingContext2D;
  private readonly hpTex: THREE.CanvasTexture;
  private t = Math.random() * 10;
  private lastHp = -1;
  /** 0-1 health; 0 = going down. */
  hp = 1;

  constructor() {
    const white = new THREE.MeshStandardMaterial({ color: '#f2f2ee', metalness: 0.3, roughness: 0.4 });
    const blue = new THREE.MeshStandardMaterial({ color: '#1d3f8f', metalness: 0.3, roughness: 0.45 });
    const dark = new THREE.MeshStandardMaterial({ color: '#1a1c20', metalness: 0.5, roughness: 0.5 });
    const glass = new THREE.MeshStandardMaterial({ color: '#2b3a4c', metalness: 0.8, roughness: 0.08, transparent: true, opacity: 0.75 });
    const livery = new THREE.MeshStandardMaterial({ map: liveryTexture(), metalness: 0.2, roughness: 0.5 });
    const ball = new THREE.SphereGeometry(1, 18, 12);
    // Fuselage: a rounded cabin, the canopy, the engine hump, the tail boom and fin.
    this.body.add(mesh(ball, white, 0, 0, 0.3, 1.25, 1.15, 2.1));
    this.body.add(mesh(ball, glass, 0, 0.15, 1.45, 1.0, 0.9, 1.05));
    this.body.add(mesh(geo, livery, 1.21, -0.05, 0.1, 0.02, 0.8, 2.4));
    const side2 = mesh(geo, livery, -1.21, -0.05, 0.1, 0.02, 0.8, 2.4);
    side2.rotation.y = Math.PI;
    this.body.add(side2);
    this.body.add(mesh(geo, blue, 0, 1.0, -0.2, 0.9, 0.45, 1.8));
    this.body.add(mesh(geo, white, 0, 0.35, -3.6, 0.35, 0.4, 4.6));
    this.body.add(mesh(geo, blue, 0, 1.05, -5.7, 0.12, 1.3, 0.9));
    this.body.add(mesh(geo, blue, 0, 0.45, -5.6, 1.6, 0.08, 0.5));
    // Skids.
    for (const x of [-0.95, 0.95]) {
      this.body.add(mesh(geo, dark, x, -1.35, 0.3, 0.1, 0.1, 3.6));
      for (const z of [-0.7, 1.2]) this.body.add(mesh(geo, dark, x * 0.85, -1.05, z, 0.07, 0.6, 0.07));
    }
    // Beacons (red / blue) under the belly and on the tail.
    for (const [x, c] of [
      [-0.5, '#ff2a3a'],
      [0.5, '#2a6bff'],
    ] as const) {
      const b = mesh(geo, new THREE.MeshBasicMaterial({ color: c, toneMapped: false }), x, -1.12, 0.6, 0.25, 0.12, 0.25);
      this.beacons.push(b);
      this.body.add(b);
    }
    // Main rotor (two long blades and the mast) and the tail rotor.
    this.rotor.position.set(0, 1.45, -0.2);
    this.rotor.add(mesh(geo, dark, 0, -0.15, 0, 0.18, 0.4, 0.18));
    for (const r of [0, Math.PI]) {
      const blade = mesh(geo, dark, 0, 0, 0, 0.32, 0.05, 5.4);
      blade.position.set(Math.sin(r) * 2.7, 0, Math.cos(r) * 2.7);
      blade.rotation.y = r;
      this.rotor.add(blade);
    }
    this.body.add(this.rotor);
    this.tailRotor.position.set(0.2, 1.2, -5.8);
    for (const r of [0, Math.PI / 2]) {
      const b = mesh(geo, dark, 0, 0, 0, 0.04, 1.4, 0.16);
      b.rotation.x = r;
      this.tailRotor.add(b);
    }
    this.body.add(this.tailRotor);
    // The searchlight under the nose, its beam (a long faint cone) and the pool it throws.
    this.body.add(mesh(ball, dark, 0, -0.85, 1.6, 0.22, 0.22, 0.22));
    const cone = new THREE.ConeGeometry(1, 1, 24, 1, true);
    cone.translate(0, -0.5, 0);
    cone.rotateX(-Math.PI / 2);
    this.beam = new THREE.Mesh(
      cone,
      new THREE.MeshBasicMaterial({ color: '#fff6d6', transparent: true, opacity: 0.12, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }),
    );
    this.beam.position.set(0, -0.85, 1.6);
    this.body.add(this.beam);
    const disc = new THREE.CircleGeometry(1, 32);
    disc.rotateX(-Math.PI / 2);
    this.pool = new THREE.Mesh(disc, new THREE.MeshBasicMaterial({ color: '#fff3c8', transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.pool.renderOrder = 3;
    this.light = new THREE.SpotLight('#fff3d0', 60, 120, 0.16, 0.5, 1.2);
    this.light.castShadow = false;
    this.body.add(this.light);
    this.light.position.set(0, -0.85, 1.6);
    this.root.add(this.body, this.pool, this.light.target);
    // Health bar over it (only once it has been hit).
    const c = document.createElement('canvas');
    c.width = 128;
    c.height = 16;
    this.hpCtx = c.getContext('2d')!;
    this.hpTex = new THREE.CanvasTexture(c);
    this.hpBar = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.hpTex, depthTest: false, transparent: true }));
    this.hpBar.scale.set(4, 0.5, 1);
    this.hpBar.position.set(0, 3, 0);
    this.hpBar.visible = false;
    this.root.add(this.hpBar);
  }

  /** Place it (world), aim the searchlight at a ground point (null: light off), set its health. */
  update(dt: number, x: number, y: number, z: number, yaw: number, aim: { x: number; z: number } | null, hp: number, night: number): void {
    this.t += dt;
    this.hp = hp;
    const down = hp <= 0;
    this.root.position.set(x, y, z);
    this.body.rotation.set(0.08 + Math.sin(this.t * 0.9) * 0.02, yaw + (down ? this.t * 6 : 0), Math.sin(this.t * 0.7) * 0.03);
    this.rotor.rotation.y += dt * (down ? 12 : 38);
    this.tailRotor.rotation.x += dt * 60;
    const blink = Math.sin(this.t * 9) > 0;
    this.beacons[0]!.visible = blink;
    this.beacons[1]!.visible = !blink;
    // Searchlight onto the target.
    const on = !!aim && !down;
    this.beam.visible = on;
    this.pool.visible = on;
    this.light.visible = on;
    if (aim && on) {
      const from = this.body.localToWorld(new THREE.Vector3(0, -0.85, 1.6));
      const to = new THREE.Vector3(aim.x, 0.05, aim.z);
      const len = from.distanceTo(to);
      this.beam.lookAt(to);
      this.beam.quaternion.premultiply(this.body.getWorldQuaternion(new THREE.Quaternion()).invert());
      this.beam.scale.set(len * 0.14, len * 0.14, len);
      this.pool.position.set(aim.x - x, 0.06 - y, aim.z - z);
      this.pool.scale.setScalar(Math.max(3, len * 0.14));
      (this.pool.material as THREE.MeshBasicMaterial).opacity = 0.18 + 0.3 * night;
      (this.beam.material as THREE.MeshBasicMaterial).opacity = 0.05 + 0.13 * night;
      this.light.target.position.set(aim.x - x, 0, aim.z - z);
      this.light.intensity = 20 + 80 * night;
    }
    // Health bar.
    const shown = hp < 0.999;
    this.hpBar.visible = shown;
    if (shown && Math.abs(hp - this.lastHp) > 0.005) {
      this.lastHp = hp;
      const g = this.hpCtx;
      g.clearRect(0, 0, 128, 16);
      g.fillStyle = 'rgba(10,12,18,0.85)';
      g.fillRect(0, 0, 128, 16);
      g.fillStyle = hp < 0.3 ? '#ff3b47' : hp < 0.6 ? '#ffb547' : '#2ee59d';
      g.fillRect(2, 2, Math.max(0, 124 * hp), 12);
      this.hpTex.needsUpdate = true;
    }
  }

  dispose(): void {
    this.root.removeFromParent();
    this.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && m.geometry !== geo) m.geometry.dispose();
    });
    this.hpTex.dispose();
  }
}
