// Three.js renderer, lights, sky and quality settings.

import * as THREE from 'three';
import { nightFactor, sunsetFactor } from '../../../shared/environment';
import type { GraphicsQuality } from '../../../shared/types';

const DAY = { top: new THREE.Color('#3f86e8'), horizon: new THREE.Color('#cfe3f7'), sun: new THREE.Color('#fff3dc'), hemiSky: new THREE.Color('#dceeff'), hemiGround: new THREE.Color('#5b6b3a') };
const DUSK = { top: new THREE.Color('#3b4a86'), horizon: new THREE.Color('#ff8a3d'), sun: new THREE.Color('#ff9a4a') };
const RAIN = { top: new THREE.Color('#5d6673'), horizon: new THREE.Color('#9aa3ae') };
const NIGHT = { top: new THREE.Color('#050a1a'), horizon: new THREE.Color('#131c33'), sun: new THREE.Color('#9fb4ff'), hemiSky: new THREE.Color('#4b5c8c'), hemiGround: new THREE.Color('#1a1e16') };

/** Layer drawn after everything else with a fresh depth buffer (the first-person car interior). */
export const OVERLAY_LAYER = 1;

export class Renderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly sun: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  private quality: GraphicsQuality = 'high';
  private skyMat!: THREE.ShaderMaterial;
  private sky!: THREE.Mesh;
  /** Sun (or moon) direction, scaled: shadows are cast from player + this. */
  private sunOffset = new THREE.Vector3(60, 110, 40);
  /** 0 by day, 1 at night. */
  night = 0;
  private fogFar = 480;
  /** Draw the overlay layer (first-person interior) on top of the scene. */
  overlay = false;

  constructor(readonly container: HTMLElement) {
    const lowGfx = new URLSearchParams(location.search).get('gfx') === 'low';
    this.renderer = new THREE.WebGLRenderer({ antialias: !lowGfx, powerPreference: 'high-performance', preserveDrawingBuffer: false });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.92;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.domElement.tabIndex = 0;
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(62, 1, 0.1, 1300);
    this.camera.position.set(0, 12, 20);

    const horizon = new THREE.Color('#cfe3f7');
    this.scene.background = horizon;
    this.scene.fog = new THREE.Fog(horizon, 140, 480);

    this.hemi = new THREE.HemisphereLight('#dceeff', '#5b6b3a', 1.1);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight('#fff3dc', 2.3);
    this.sun.position.set(60, 110, 40);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const s = this.sun.shadow.camera;
    s.left = -70;
    s.right = 70;
    s.top = 70;
    s.bottom = -70;
    s.near = 10;
    s.far = 300;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.03;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);
    // Sun and sky light also light the overlay (cockpit) pass.
    this.sun.layers.enable(OVERLAY_LAYER);
    this.hemi.layers.enable(OVERLAY_LAYER);
    this.sky = this.buildSky();
    this.scene.add(this.sky);

    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  private buildSky(): THREE.Mesh {
    const geo = new THREE.SphereGeometry(800, 32, 16);
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        top: { value: new THREE.Color('#3f86e8') },
        horizon: { value: new THREE.Color('#cfe3f7') },
        sunDir: { value: new THREE.Vector3(60, 110, 40).normalize() },
        sunAmt: { value: 1 },
        night: { value: 0 },
      },
      vertexShader: `varying vec3 vDir; void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `uniform vec3 top; uniform vec3 horizon; uniform vec3 sunDir; uniform float sunAmt; uniform float night; varying vec3 vDir;
        // Cheap hash (no sin: software renderers are slow at it).
        float hash(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.yzx + 33.33); return fract((p.x + p.y) * p.z); }
        void main() {
          vec3 d = normalize(vDir);
          float h = clamp(d.y, 0.0, 1.0);
          vec3 col = mix(horizon, top, pow(h, 0.55));
          if (sunAmt > 0.001) {
            float s = max(dot(d, sunDir), 0.0);
            col += vec3(1.0, 0.92, 0.75) * (pow(s, 350.0) * 2.0 + pow(s, 8.0) * 0.25) * sunAmt;
          }
          // Stars and a moon at night.
          if (night > 0.001) {
            float star = step(0.9965, hash(floor(d * 420.0))) * smoothstep(0.05, 0.3, d.y);
            float moon = smoothstep(0.9994, 0.9997, dot(d, vec3(-0.3505, 0.621, -0.7011)));
            col += vec3(0.9, 0.93, 1.0) * star * night + vec3(0.85, 0.88, 0.95) * moon * night;
          }
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    this.skyMat = mat;
    // The dome moves with the camera (render()), so it surrounds the view anywhere in the world.
    const sky = new THREE.Mesh(geo, mat);
    sky.renderOrder = -1;
    sky.frustumCulled = false;
    return sky;
  }

  setQuality(q: GraphicsQuality): void {
    this.quality = q;
    const dpr = window.devicePixelRatio || 1;
    // Tablets have very dense screens but mobile GPUs: cap the render resolution a little lower there.
    const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false;
    this.renderer.setPixelRatio(q === 'high' ? Math.min(dpr, coarse ? 1.5 : 1.75) : q === 'medium' ? Math.min(dpr, 1.25) : 0.85);
    this.renderer.shadowMap.enabled = q !== 'low';
    this.sun.castShadow = q !== 'low';
    const size = q === 'high' ? 2048 : 1024;
    if (this.sun.shadow.mapSize.x !== size) {
      this.sun.shadow.mapSize.set(size, size);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }
    this.scene.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
      if (m) (Array.isArray(m) ? m : [m]).forEach((mm) => (mm.needsUpdate = true));
    });
    this.fogFar = q === 'low' ? 300 : 480;
    (this.scene.fog as THREE.Fog).far = this.fogFar;
    this.resize();
  }

  get graphics(): GraphicsQuality {
    return this.quality;
  }

  resize(): void {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** Keep the shadow frustum centred on the player. */
  followShadows(x: number, z: number): void {
    const snap = 4;
    const sx = Math.round(x / snap) * snap;
    const sz = Math.round(z / snap) * snap;
    this.sun.position.set(sx + this.sunOffset.x, this.sunOffset.y, sz + this.sunOffset.z);
    this.sun.target.position.set(sx, 0, sz);
    this.sun.target.updateMatrixWorld();
  }

  /**
   * Time of day (0-24 h) and rain (0-1): sun or moon, sky (orange at sunset, grey in the rain), fog
   * and ambient light. Returns the night factor (0 day, 1 night) for street lights and headlights.
   */
  setTime(hour: number, rain = 0): number {
    const night = nightFactor(hour);
    this.night = night;
    const dusk = sunsetFactor(hour) * (1 - rain * 0.7);
    const angle = ((hour - 6) / 12) * Math.PI;
    const elev = Math.sin(angle);
    const dir = new THREE.Vector3(Math.cos(angle) * 0.85, Math.max(0.18, elev), 0.45).normalize();
    const moon = new THREE.Vector3(-0.35, 0.62, -0.7).normalize();
    if (night > 0.5) dir.copy(moon);
    this.sunOffset.copy(dir).multiplyScalar(130);
    const mixC = (a: THREE.Color, b: THREE.Color, c: THREE.Color) => new THREE.Color().copy(a).lerp(c, Math.min(1, dusk) * (1 - night)).lerp(b, night);
    const overcast = rain * 0.75 * (1 - night * 0.6);
    const top = mixC(DAY.top, NIGHT.top, DUSK.top).lerp(RAIN.top.clone().multiplyScalar(1 - night * 0.85), overcast);
    const horizon = mixC(DAY.horizon, NIGHT.horizon, DUSK.horizon).lerp(RAIN.horizon.clone().multiplyScalar(1 - night * 0.85), overcast);
    this.sun.color.copy(mixC(DAY.sun, NIGHT.sun, DUSK.sun));
    this.sun.intensity = (night > 0.5 ? 0.3 + (1 - night) * 0.6 : 2.3 * (0.3 + 0.7 * Math.max(0, elev)) * (1 - night) + 0.3 * night) * (1 - 0.6 * rain);
    this.hemi.color.copy(DAY.hemiSky).lerp(NIGHT.hemiSky, night);
    this.hemi.groundColor.copy(DAY.hemiGround).lerp(NIGHT.hemiGround, night);
    this.hemi.intensity = 1.1 - 0.72 * night;
    const u = this.skyMat.uniforms;
    (u.top!.value as THREE.Color).copy(top);
    (u.horizon!.value as THREE.Color).copy(horizon);
    (u.sunDir!.value as THREE.Vector3).copy(dir);
    u.sunAmt!.value = (1 - night) * (1 - rain);
    u.night!.value = night;
    (this.scene.background as THREE.Color).copy(horizon);
    const fog = this.scene.fog as THREE.Fog;
    fog.color.copy(horizon);
    fog.far = this.fogFar * (1 - 0.25 * night) * (1 - 0.45 * rain);
    fog.near = 140 * (1 - 0.6 * rain);
    this.renderer.toneMappingExposure = 0.92 + 0.1 * night;
    // The image-based ambient light dims at night and under rain clouds.
    this.scene.environmentIntensity = (1 - 0.82 * night) * (1 - 0.3 * rain);
    return night;
  }

  render(): void {
    const r = this.renderer;
    this.sky.position.set(this.camera.position.x, 0, this.camera.position.z);
    if (!this.overlay) {
      r.render(this.scene, this.camera);
      return;
    }
    // Two passes: the world, then the car's interior over it (so the outside body shell never hides
    // the dashboard or steering wheel). Shadows are not re-rendered for the second pass.
    this.camera.layers.set(0);
    r.render(this.scene, this.camera);
    const autoClear = r.autoClear;
    const shadows = r.shadowMap.autoUpdate;
    const bg = this.scene.background;
    r.autoClear = false;
    r.shadowMap.autoUpdate = false;
    this.scene.background = null;
    r.clearDepth();
    this.camera.layers.set(OVERLAY_LAYER);
    r.render(this.scene, this.camera);
    this.camera.layers.set(0);
    this.scene.background = bg;
    r.autoClear = autoClear;
    r.shadowMap.autoUpdate = shadows;
  }
}
