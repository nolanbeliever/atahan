// Sky dome, sun/moon lighting, fog and the day/night palette.
import * as THREE from 'three';

const KEYS = [ // hour, skyTop, horizon, fog, light color, light intensity, hemi intensity, fogDensity
  [0, 0x05070d, 0x0f131c, 0x0a0d13, 0x6878a0, 0.22, 0.32, 0.016],
  [4.5, 0x070a12, 0x161a24, 0x10131a, 0x7080a8, 0.22, 0.32, 0.016],
  [6, 0x2a3450, 0xa86a4a, 0x5a4a44, 0xffa070, 0.9, 0.55, 0.014],
  [8, 0x5a6c84, 0xb8b0a0, 0x8a8a84, 0xfff0d8, 2.0, 0.85, 0.009],
  [16, 0x5a6c84, 0xb4b0a6, 0x8a8a84, 0xfff4e0, 2.2, 0.9, 0.009],
  [18.3, 0x3a4260, 0xc87a4a, 0x7a5e50, 0xffa060, 1.3, 0.6, 0.011],
  [19.6, 0x1a1e30, 0x6a3e34, 0x2e2a2e, 0xc07050, 0.45, 0.42, 0.013],
  [21, 0x05070d, 0x111520, 0x0b0e14, 0x6878a0, 0.22, 0.32, 0.016],
  [24, 0x05070d, 0x0f131c, 0x0a0d13, 0x6878a0, 0.22, 0.32, 0.016],
];

const c1 = new THREE.Color(), c2 = new THREE.Color();
function lerpKey(h, idx) {
  let a = KEYS[0], b = KEYS[1];
  for (let i = 0; i < KEYS.length - 1; i++) if (h >= KEYS[i][0] && h <= KEYS[i + 1][0]) { a = KEYS[i]; b = KEYS[i + 1]; break; }
  const t = (h - a[0]) / Math.max(0.0001, b[0] - a[0]);
  if (typeof a[idx] === 'number' && idx >= 5) return a[idx] + (b[idx] - a[idx]) * t;
  return c1.setHex(a[idx]).lerp(c2.setHex(b[idx]), t).clone();
}

export class Sky {
  constructor(scene, settings) {
    this.scene = scene;
    this.settings = settings;
    const geo = new THREE.SphereGeometry(800, 32, 16);
    this.uni = {
      top: { value: new THREE.Color() }, horizon: { value: new THREE.Color() }, sunDir: { value: new THREE.Vector3(0, 1, 0) },
      sunCol: { value: new THREE.Color() }, stars: { value: 0 }, moonDir: { value: new THREE.Vector3() }, cloud: { value: 0.5 }, time: { value: 0 },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uni, side: THREE.BackSide, depthWrite: false, fog: false,
      vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * p; gl_Position.z = gl_Position.w; }`,
      fragmentShader: `uniform vec3 top; uniform vec3 horizon; uniform vec3 sunDir; uniform vec3 sunCol; uniform float stars; uniform vec3 moonDir; uniform float cloud; uniform float time; varying vec3 vDir;
        float h(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,45.164)))*43758.5453); }
        float n3(vec3 p){ vec3 i=floor(p); vec3 f=fract(p); f=f*f*(3.0-2.0*f);
          return mix(mix(mix(h(i),h(i+vec3(1,0,0)),f.x),mix(h(i+vec3(0,1,0)),h(i+vec3(1,1,0)),f.x),f.y),mix(mix(h(i+vec3(0,0,1)),h(i+vec3(1,0,1)),f.x),mix(h(i+vec3(0,1,1)),h(i+vec3(1,1,1)),f.x),f.y),f.z); }
        void main(){ vec3 d = normalize(vDir); float y = max(d.y, 0.0);
          vec3 col = mix(horizon, top, pow(y, 0.55));
          if (d.y < 0.0) col = horizon * 0.6;
          float s = max(dot(d, sunDir), 0.0);
          col += sunCol * (pow(s, 600.0) * 4.0 + pow(s, 12.0) * 0.25) * step(-0.05, sunDir.y);
          float m = max(dot(d, moonDir), 0.0);
          col += vec3(0.75,0.8,0.9) * smoothstep(0.9993, 0.9996, m) * stars + vec3(0.1,0.12,0.16) * pow(m, 30.0) * stars;
          vec3 sp = floor(d * 380.0);
          float st = step(0.9975, h(sp)) * stars * smoothstep(0.0, 0.25, d.y);
          col += vec3(st) * (0.6 + 0.4 * sin(time * 2.0 + h(sp) * 30.0));
          // clouds
          vec2 uv = d.xz / (d.y + 0.15) * 1.4 + vec2(time * 0.004, time * 0.002);
          float c = n3(vec3(uv * 2.0, 1.0)) * 0.6 + n3(vec3(uv * 5.0, 2.0)) * 0.3 + n3(vec3(uv * 11.0, 3.0)) * 0.1;
          c = smoothstep(0.45 - cloud * 0.3, 0.85, c) * smoothstep(0.0, 0.2, d.y);
          vec3 cc = mix(horizon * 0.9, top * 1.4 + sunCol * 0.08, 0.5);
          col = mix(col, cc, c * (0.55 + cloud * 0.4));
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.dome = new THREE.Mesh(geo, mat);
    this.dome.frustumCulled = false;
    this.dome.renderOrder = -10;
    scene.add(this.dome);

    this.sun = new THREE.DirectionalLight(0xffffff, 1);
    this.sun.castShadow = settings.gfx.shadows;
    this.applyShadowSize();
    scene.add(this.sun); scene.add(this.sun.target);
    this.hemi = new THREE.HemisphereLight(0x8a9ab0, 0x3a342c, 0.5);
    scene.add(this.hemi);
    this.amb = new THREE.AmbientLight(0x404858, 0.15);
    scene.add(this.amb);
    scene.fog = new THREE.FogExp2(0x0b0e14, 0.012);
    this.flash = 0;
  }
  applyShadowSize() {
    const g = this.settings.gfx;
    this.sun.castShadow = g.shadows;
    const sz = g.shadowSize;
    this.sun.shadow.mapSize.set(sz, sz);
    const r = this.settings.preset === 'low' ? 30 : 42;
    const cam = this.sun.shadow.camera;
    cam.left = -r; cam.right = r; cam.top = r; cam.bottom = -r; cam.near = 1; cam.far = 260;
    cam.updateProjectionMatrix();
    this.sun.shadow.bias = -0.0004; this.sun.shadow.normalBias = 0.04;
    if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null; }
  }

  update(dt, hour, rain, center, camPos, brightness, indoor) {
    const top = lerpKey(hour, 1), hor = lerpKey(hour, 2), fog = lerpKey(hour, 3), lc = lerpKey(hour, 4);
    let li = lerpKey(hour, 5), hi = lerpKey(hour, 6), fd = lerpKey(hour, 7);
    // rain darkens and thickens the air
    const grey = new THREE.Color(0x5a5e64);
    top.lerp(grey.clone().multiplyScalar(li > 1 ? 1 : 0.3), rain * 0.5);
    hor.lerp(grey.clone().multiplyScalar(li > 1 ? 1.1 : 0.35), rain * 0.45);
    fog.lerp(grey.clone().multiplyScalar(li > 1 ? 0.9 : 0.25), rain * 0.5);
    li *= 1 - rain * 0.45;
    fd *= 1 + rain * 0.7;
    const gfx = this.settings.gfx;
    fd *= 150 / gfx.drawDist;
    if (this.flash > 0) { this.flash -= dt; const f = Math.max(0, this.flash) * 3; top.addScalar(f * 0.3); hor.addScalar(f * 0.3); li += f * 2; }
    this.uni.top.value.copy(top); this.uni.horizon.value.copy(hor);
    this.uni.time.value += dt;
    this.uni.cloud.value = 0.35 + rain * 0.6;
    // sun path
    const dayT = (hour - 6) / 13.5;
    const el = Math.sin(Math.min(Math.max(dayT, 0), 1) * Math.PI);
    const az = dayT * Math.PI;
    const sunDir = new THREE.Vector3(Math.cos(az) * 0.8, Math.max(el, -0.2), 0.45 + Math.sin(az) * 0.3).normalize();
    if (dayT < 0 || dayT > 1) sunDir.set(-0.3, -0.3, 0.5).normalize();
    this.uni.sunDir.value.copy(sunDir);
    this.uni.sunCol.value.copy(lc).multiplyScalar(dayT > 0 && dayT < 1 ? 1 : 0);
    const night = dayT < -0.02 || dayT > 1.02;
    const moon = new THREE.Vector3(0.4, 0.75, -0.5).normalize();
    this.uni.moonDir.value.copy(moon);
    this.uni.stars.value = night ? 1 - rain : Math.max(0, 1 - Math.min(Math.abs(dayT + 0.02), Math.abs(dayT - 1.02)) * 20) * 0;
    const ld = night ? moon : sunDir.y > 0.08 ? sunDir : new THREE.Vector3(sunDir.x, 0.08, sunDir.z).normalize();
    // follow the player with the shadow camera, snapped to texels to avoid shimmer
    const snap = (this.sun.shadow.camera.right * 2) / this.sun.shadow.mapSize.x;
    const cx = Math.round(center.x / snap) * snap, cz = Math.round(center.z / snap) * snap;
    this.sun.position.set(cx + ld.x * 120, center.y + ld.y * 120, cz + ld.z * 120);
    this.sun.target.position.set(cx, center.y, cz);
    this.sun.color.copy(lc);
    this.sun.intensity = li * brightness;
    this.hemi.color.copy(top).lerp(new THREE.Color(0x9aa8c0), 0.5);
    this.hemi.groundColor.copy(fog).multiplyScalar(0.6);
    this.hemi.intensity = hi * 1.6 * brightness * (indoor ? 0.8 : 1);
    this.amb.intensity = (0.22 + (night ? 0.1 : 0)) * brightness;
    this.scene.fog.color.copy(fog);
    this.scene.fog.density = fd;
    this.dome.position.copy(camPos);
    this.darkness = night ? 1 : Math.max(0, 1 - li / 1.2);
    return { sky: hor, fog };
  }
  lightning() { this.flash = 0.35; }
}
