// A small photo studio: one extra WebGL renderer shared by the tuning garage's live 3D preview
// (turntable, drag to rotate, dyno rollers) and the Rare Dealer's vehicle pictures.

import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { createVehicleView, lookSignature, type AnyVehicleView, type VehicleLook } from './VehicleMesh';

class StudioScene {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(32, 16 / 9, 0.1, 100);
  private view: AnyVehicleView | null = null;
  private readonly rollers = new THREE.Group();
  private readonly thumbs = new Map<string, string>();
  yaw = 0.7;
  pitch = 0.18;
  private dist = 7;
  private spin = 0;
  private dragging = false;
  private lastX = 0;
  private lastY = 0;
  private raf = 0;
  private lastT = 0;
  /** Wheel speed (m/s) while the dyno runs. */
  dynoSpeed = 0;
  autoRotate = true;

  constructor() {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, matchMedia('(pointer: coarse)').matches ? 1.5 : 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.background = new THREE.Color('#1a1d24');
    const floor = new THREE.Mesh(new THREE.CircleGeometry(6, 48), new THREE.MeshStandardMaterial({ color: '#2a2e37', roughness: 0.55, metalness: 0.2 }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);
    const ring = new THREE.Mesh(new THREE.RingGeometry(3.3, 3.4, 64), new THREE.MeshBasicMaterial({ color: '#4f8cff', transparent: true, opacity: 0.35 }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.005;
    this.scene.add(ring);
    this.scene.add(new THREE.HemisphereLight('#dfe8ff', '#2a2320', 0.9));
    const key = new THREE.DirectionalLight('#ffffff', 2.2);
    key.position.set(4, 7, 5);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.left = -4;
    key.shadow.camera.right = 4;
    key.shadow.camera.top = 4;
    key.shadow.camera.bottom = -4;
    this.scene.add(key);
    const rim = new THREE.DirectionalLight('#9fb7ff', 0.8);
    rim.position.set(-5, 3, -4);
    this.scene.add(rim);
    // Dyno rollers under the driven wheels.
    const rollerMat = new THREE.MeshStandardMaterial({ color: '#8a8f99', metalness: 0.9, roughness: 0.3 });
    const rollerGeo = new THREE.CylinderGeometry(0.12, 0.12, 2.2, 20).rotateZ(Math.PI / 2);
    for (const z of [-0.2, 0.2]) {
      const r = new THREE.Mesh(rollerGeo, rollerMat);
      r.position.set(0, 0.02, z);
      this.rollers.add(r);
    }
    this.rollers.visible = false;
    this.scene.add(this.rollers);

    const el = this.renderer.domElement;
    el.style.touchAction = 'none';
    el.addEventListener('pointerdown', (e) => {
      this.dragging = true;
      this.autoRotate = false;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      el.setPointerCapture(e.pointerId);
    });
    el.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      this.yaw -= (e.clientX - this.lastX) * 0.01;
      this.pitch = Math.max(0.02, Math.min(0.9, this.pitch + (e.clientY - this.lastY) * 0.006));
      this.lastX = e.clientX;
      this.lastY = e.clientY;
    });
    const up = () => (this.dragging = false);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.dist = Math.max(4, Math.min(12, this.dist * (e.deltaY > 0 ? 1.08 : 0.93)));
    }, { passive: false });
  }

  get canvas(): HTMLCanvasElement {
    return this.renderer.domElement;
  }

  setVehicle(look: VehicleLook | null): void {
    if (!look) {
      if (this.view) {
        this.scene.remove(this.view.root);
        this.view.dispose();
        this.view = null;
      }
      return;
    }
    if (this.view && this.view.signature.split('|')[0] === look.modelId) {
      this.view.update(look);
    } else {
      if (this.view) {
        this.scene.remove(this.view.root);
        this.view.dispose();
      }
      this.view = createVehicleView(look);
      this.view.root.traverse((o) => ((o as THREE.Mesh).isMesh ? ((o as THREE.Mesh).castShadow = true) : undefined));
      this.scene.add(this.view.root);
      this.dist = Math.max(4.5, this.view.length * 1.45);
    }
  }

  setDynoRollers(on: boolean, rearZ = 0): void {
    this.rollers.visible = on;
    this.rollers.position.z = rearZ;
  }

  pop(strength: number): void {
    this.view?.pop(strength);
  }

  private place(): void {
    const h = this.view ? this.view.height * 0.42 : 0.6;
    const c = Math.cos(this.pitch);
    this.camera.position.set(Math.sin(this.yaw) * c * this.dist, h + Math.sin(this.pitch) * this.dist, Math.cos(this.yaw) * c * this.dist);
    this.camera.lookAt(0, h, 0);
  }

  resize(w: number, h: number): void {
    const cw = Math.max(1, Math.floor(w));
    const ch = Math.max(1, Math.floor(h));
    const size = this.renderer.getSize(new THREE.Vector2());
    if (size.x === cw && size.y === ch) return;
    this.renderer.setSize(cw, ch, false);
    this.camera.aspect = cw / ch;
    this.camera.updateProjectionMatrix();
  }

  /** Render continuously while the canvas is on the page. */
  start(): void {
    if (this.raf) return;
    this.lastT = performance.now();
    const loop = (t: number) => {
      if (!this.canvas.isConnected) {
        this.raf = 0;
        return;
      }
      const dt = Math.min(0.1, (t - this.lastT) / 1000);
      this.lastT = t;
      const parent = this.canvas.parentElement;
      if (parent) this.resize(parent.clientWidth, parent.clientHeight);
      if (this.autoRotate) this.yaw += dt * 0.25;
      this.spin -= (this.dynoSpeed / 0.12) * dt;
      for (const r of this.rollers.children) r.rotation.x = this.spin;
      this.view?.animate(this.dynoSpeed, 0, dt);
      this.place();
      this.renderer.render(this.scene, this.camera);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  /** A still picture of a vehicle (data URL), cached by its look. */
  snapshot(look: VehicleLook, w = 480, h = 270): string {
    const key = lookSignature(look);
    const hit = this.thumbs.get(key);
    if (hit) return hit;
    const prev = { look: this.view, yaw: this.yaw, pitch: this.pitch, dist: this.dist, size: this.renderer.getSize(new THREE.Vector2()), rollers: this.rollers.visible };
    const temp = createVehicleView(look);
    if (this.view) this.view.root.visible = false;
    this.scene.add(temp.root);
    this.rollers.visible = false;
    this.yaw = 0.75;
    this.pitch = 0.2;
    this.dist = Math.max(4.4, temp.length * 1.35);
    const saved = this.view;
    this.view = temp;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.place();
    this.renderer.render(this.scene, this.camera);
    const url = this.canvas.toDataURL('image/jpeg', 0.85);
    this.scene.remove(temp.root);
    temp.dispose();
    this.view = saved;
    if (this.view) this.view.root.visible = true;
    this.yaw = prev.yaw;
    this.pitch = prev.pitch;
    this.dist = prev.dist;
    this.rollers.visible = prev.rollers;
    this.renderer.setSize(prev.size.x || 1, prev.size.y || 1, false);
    this.camera.aspect = (prev.size.x || 16) / (prev.size.y || 9);
    this.camera.updateProjectionMatrix();
    if (this.thumbs.size > 80) this.thumbs.clear();
    this.thumbs.set(key, url);
    return url;
  }
}

let studio: StudioScene | null = null;

/** The shared studio (created on first use). Returns null if WebGL is unavailable. */
export function getStudio(): StudioScene | null {
  if (studio) return studio;
  try {
    studio = new StudioScene();
  } catch {
    return null;
  }
  return studio;
}

export type { StudioScene };
