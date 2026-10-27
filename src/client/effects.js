// Particles (blood, sparks, dust, glass), tracers, muzzle light, blood decals,
// rain streaks and floating ash. All pooled to avoid garbage on mobile.
import * as THREE from 'three';

function dotTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 32;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.4, 'rgba(255,255,255,0.6)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 32, 32);
  const t = new THREE.CanvasTexture(c); return t;
}

class Pool {
  constructor(scene, n, mat) {
    this.n = n;
    this.pos = new Float32Array(n * 3); this.col = new Float32Array(n * 3);
    this.vel = new Float32Array(n * 3); this.life = new Float32Array(n); this.grav = new Float32Array(n);
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    this.pts = new THREE.Points(this.geo, mat);
    this.pts.frustumCulled = false;
    scene.add(this.pts);
    this.i = 0;
    for (let k = 0; k < n; k++) this.pos[k * 3 + 1] = -1000;
  }
  emit(x, y, z, vx, vy, vz, life, r, g, b, grav = 9.8) {
    const k = this.i; this.i = (this.i + 1) % this.n;
    this.pos[k * 3] = x; this.pos[k * 3 + 1] = y; this.pos[k * 3 + 2] = z;
    this.vel[k * 3] = vx; this.vel[k * 3 + 1] = vy; this.vel[k * 3 + 2] = vz;
    this.col[k * 3] = r; this.col[k * 3 + 1] = g; this.col[k * 3 + 2] = b;
    this.life[k] = life; this.grav[k] = grav;
  }
  update(dt) {
    let any = false;
    for (let k = 0; k < this.n; k++) {
      if (this.life[k] <= 0) continue;
      any = true;
      this.life[k] -= dt;
      if (this.life[k] <= 0) { this.pos[k * 3 + 1] = -1000; continue; }
      this.vel[k * 3 + 1] -= this.grav[k] * dt;
      this.pos[k * 3] += this.vel[k * 3] * dt; this.pos[k * 3 + 1] += this.vel[k * 3 + 1] * dt; this.pos[k * 3 + 2] += this.vel[k * 3 + 2] * dt;
      if (this.pos[k * 3 + 1] < 0.02 && this.grav[k] > 0) { this.pos[k * 3 + 1] = 0.02; this.vel[k * 3] *= 0.3; this.vel[k * 3 + 2] *= 0.3; this.vel[k * 3 + 1] = 0; }
    }
    if (any) { this.geo.attributes.position.needsUpdate = true; this.geo.attributes.color.needsUpdate = true; }
  }
}

export class Effects {
  constructor(scene, mats, settings) {
    this.scene = scene; this.settings = settings;
    const tex = dotTexture();
    const q = settings.gfx.particles;
    this.blood = new Pool(scene, Math.round(300 * q) + 50, new THREE.PointsMaterial({ size: 0.09, map: tex, vertexColors: true, transparent: true, depthWrite: false }));
    this.sparks = new Pool(scene, Math.round(200 * q) + 40, new THREE.PointsMaterial({ size: 0.06, map: tex, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.dust = new Pool(scene, Math.round(200 * q) + 40, new THREE.PointsMaterial({ size: 0.25, map: tex, vertexColors: true, transparent: true, opacity: 0.45, depthWrite: false }));
    // muzzle flash light (one, reused)
    this.muzzle = new THREE.PointLight(0xffb060, 0, 9, 2);
    scene.add(this.muzzle);
    this.muzzleT = 0;
    // tracers
    this.tracers = [];
    const tg = new THREE.BufferGeometry();
    this.tracerPos = new Float32Array(16 * 6);
    tg.setAttribute('position', new THREE.BufferAttribute(this.tracerPos, 3).setUsage(THREE.DynamicDrawUsage));
    this.tracerLines = new THREE.LineSegments(tg, new THREE.LineBasicMaterial({ color: 0xffe0a0, transparent: true, opacity: 0.7 }));
    this.tracerLines.frustumCulled = false;
    scene.add(this.tracerLines);
    this.tracerI = 0; this.tracerLife = new Float32Array(16);
    // blood decals (pooled quads)
    const dm = mats.get('blood');
    this.decals = [];
    const dg = new THREE.PlaneGeometry(1, 1); dg.rotateX(-Math.PI / 2);
    const n = new Float32Array(dg.attributes.position.count * 3).fill(1); dg.setAttribute('color', new THREE.BufferAttribute(n, 3));
    for (let i = 0; i < 40; i++) { const m = new THREE.Mesh(dg, dm); m.visible = false; m.renderOrder = 1; scene.add(m); this.decals.push(m); }
    this.decalI = 0;
    // rain
    const rn = settings.gfx.rain;
    const rg = new THREE.BufferGeometry();
    this.rainPos = new Float32Array(rn * 6);
    this.rainN = rn;
    for (let i = 0; i < rn; i++) { const x = (Math.random() - 0.5) * 50, y = Math.random() * 25, z = (Math.random() - 0.5) * 50; this.rainPos.set([x, y, z, x + 0.03, y + 0.5, z + 0.02], i * 6); }
    rg.setAttribute('position', new THREE.BufferAttribute(this.rainPos, 3).setUsage(THREE.DynamicDrawUsage));
    this.rain = new THREE.LineSegments(rg, new THREE.LineBasicMaterial({ color: 0xa0b0c0, transparent: true, opacity: 0.0, depthWrite: false }));
    this.rain.frustumCulled = false;
    scene.add(this.rain);
    // floating ash / dust motes
    const an = Math.round(250 * q);
    const ag = new THREE.BufferGeometry();
    this.ashPos = new Float32Array(an * 3);
    for (let i = 0; i < an; i++) this.ashPos.set([(Math.random() - 0.5) * 40, Math.random() * 12, (Math.random() - 0.5) * 40], i * 3);
    ag.setAttribute('position', new THREE.BufferAttribute(this.ashPos, 3).setUsage(THREE.DynamicDrawUsage));
    this.ash = new THREE.Points(ag, new THREE.PointsMaterial({ size: 0.05, map: tex, color: 0xb8b0a8, transparent: true, opacity: 0.5, depthWrite: false }));
    this.ash.frustumCulled = false;
    scene.add(this.ash);
    this.ashN = an;
  }

  bloodSpray(x, y, z, dx, dz, n = 14) {
    n = Math.ceil(n * (0.4 + 0.6 * this.settings.gfx.particles));
    for (let i = 0; i < n; i++) this.blood.emit(x, y, z, dx * 2 + (Math.random() - 0.5) * 3, Math.random() * 2.5, dz * 2 + (Math.random() - 0.5) * 3, 0.6 + Math.random() * 0.6, 0.35 + Math.random() * 0.15, 0.02, 0.02);
  }
  impact(x, y, z, glass) {
    for (let i = 0; i < 8; i++) this.sparks.emit(x, y, z, (Math.random() - 0.5) * 5, Math.random() * 4, (Math.random() - 0.5) * 5, 0.25 + Math.random() * 0.2, 1, 0.75, 0.35, 12);
    for (let i = 0; i < 5; i++) this.dust.emit(x, y, z, (Math.random() - 0.5) * 1, Math.random() * 0.8, (Math.random() - 0.5) * 1, 0.8 + Math.random() * 0.6, glass ? 0.7 : 0.5, glass ? 0.8 : 0.48, glass ? 0.85 : 0.45, 0.5);
  }
  splat(x, y, z, s = 1) {
    const m = this.decals[this.decalI]; this.decalI = (this.decalI + 1) % this.decals.length;
    m.position.set(x, y + 0.025 + this.decalI * 0.0004, z); m.scale.setScalar(s * (0.8 + Math.random() * 0.8)); m.rotation.y = Math.random() * 6.28; m.visible = true;
  }
  flash(x, y, z) { this.muzzle.position.set(x, y, z); this.muzzle.intensity = 6; this.muzzleT = 0.06; }
  tracer(ax, ay, az, bx, by, bz) {
    const k = this.tracerI; this.tracerI = (this.tracerI + 1) % 16;
    this.tracerPos.set([ax, ay, az, bx, by, bz], k * 6);
    this.tracerLife[k] = 0.06;
    this.tracerLines.geometry.attributes.position.needsUpdate = true;
  }

  update(dt, cam, rain) {
    this.blood.update(dt); this.sparks.update(dt); this.dust.update(dt);
    if (this.muzzleT > 0) { this.muzzleT -= dt; if (this.muzzleT <= 0) this.muzzle.intensity = 0; }
    let changed = false;
    for (let k = 0; k < 16; k++) if (this.tracerLife[k] > 0) { this.tracerLife[k] -= dt; if (this.tracerLife[k] <= 0) { this.tracerPos.fill(0, k * 6, k * 6 + 6); changed = true; } }
    if (changed) this.tracerLines.geometry.attributes.position.needsUpdate = true;
    // rain follows the camera
    const p = cam.position;
    this.rain.material.opacity = Math.min(0.55, rain * 0.6);
    this.rain.visible = rain > 0.02;
    if (this.rain.visible) {
      const a = this.rainPos, fall = 22 * dt;
      for (let i = 0; i < this.rainN; i++) {
        const o = i * 6;
        a[o + 1] -= fall; a[o + 4] -= fall;
        let x = a[o], z = a[o + 2];
        if (a[o + 1] < p.y - 8 || Math.abs(x - p.x) > 25 || Math.abs(z - p.z) > 25) {
          x = p.x + (Math.random() - 0.5) * 50; z = p.z + (Math.random() - 0.5) * 50;
          const y = p.y + 4 + Math.random() * 18;
          a[o] = x; a[o + 1] = y; a[o + 2] = z; a[o + 3] = x + 0.03; a[o + 4] = y + 0.55; a[o + 5] = z + 0.02;
        }
      }
      this.rain.geometry.attributes.position.needsUpdate = true;
    }
    // ash drifts
    const s = this.ashPos, t = performance.now() * 0.0003;
    for (let i = 0; i < this.ashN; i++) {
      const o = i * 3;
      s[o] += Math.sin(t + i) * 0.2 * dt + 0.15 * dt; s[o + 1] -= 0.12 * dt; s[o + 2] += Math.cos(t * 1.3 + i) * 0.2 * dt;
      if (s[o + 1] < p.y - 3 || Math.abs(s[o] - p.x) > 20 || Math.abs(s[o + 2] - p.z) > 20) { s[o] = p.x + (Math.random() - 0.5) * 40; s[o + 1] = p.y + Math.random() * 10; s[o + 2] = p.z + (Math.random() - 0.5) * 40; }
    }
    this.ash.geometry.attributes.position.needsUpdate = true;
    this.ash.visible = rain < 0.3;
  }
}
