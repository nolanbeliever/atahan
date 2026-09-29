// Three.js renderer, lights, sky and quality settings.

import * as THREE from 'three';
import type { GraphicsQuality } from '../../../shared/types';

export class Renderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly sun: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  private quality: GraphicsQuality = 'high';

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

    this.camera = new THREE.PerspectiveCamera(62, 1, 0.1, 900);
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
    this.scene.add(this.buildSky());

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
      },
      vertexShader: `varying vec3 vDir; void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `uniform vec3 top; uniform vec3 horizon; uniform vec3 sunDir; varying vec3 vDir;
        void main() {
          float h = clamp(vDir.y, 0.0, 1.0);
          vec3 col = mix(horizon, top, pow(h, 0.55));
          float sun = pow(max(dot(normalize(vDir), sunDir), 0.0), 350.0);
          float glow = pow(max(dot(normalize(vDir), sunDir), 0.0), 8.0) * 0.25;
          col += vec3(1.0, 0.92, 0.75) * (sun * 2.0 + glow);
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
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
    (this.scene.fog as THREE.Fog).far = q === 'low' ? 300 : 480;
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
    this.sun.position.set(sx + 60, 110, sz + 40);
    this.sun.target.position.set(sx, 0, sz);
    this.sun.target.updateMatrixWorld();
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }
}
