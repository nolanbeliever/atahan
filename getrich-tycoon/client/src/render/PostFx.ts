// Post-processing (medium and high graphics): the world is drawn into an HDR target, then
//  - wet-road reflections: screen-space reflections on every flat, wet surface (high only, in the
//    rain): the street lights, neon and headlights shimmer in the puddles,
//  - the first-person car interior on top (its own depth),
//  - bloom: neon, headlights, the sun's glints glow (much more at night),
//  - speed blur: from about 90 km/h the edges of the picture streak outwards (the centre stays sharp),
//  - tone mapping and sRGB last (OutputPass).
// Low graphics draw straight to the screen as before.

import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { FullScreenQuad, Pass } from 'three/examples/jsm/postprocessing/Pass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import type { GraphicsQuality } from '../../../shared/types';

/** Layer drawn after everything else with a fresh depth buffer (the first-person car interior). */
export const OVERLAY_LAYER = 1;

/** The world (layer 0) into the composer's buffer, keeping its depth for the reflections. */
class WorldPass extends Pass {
  constructor(
    private readonly scene: THREE.Scene,
    private readonly camera: THREE.Camera,
  ) {
    super();
    this.needsSwap = false;
  }

  override render(renderer: THREE.WebGLRenderer, _write: THREE.WebGLRenderTarget, read: THREE.WebGLRenderTarget): void {
    this.camera.layers.set(0);
    renderer.setRenderTarget(read);
    renderer.render(this.scene, this.camera);
  }
}

/** The car interior on top of the world (first person), with its own depth. */
class OverlayPass extends Pass {
  constructor(
    private readonly scene: THREE.Scene,
    private readonly camera: THREE.Camera,
  ) {
    super();
    this.needsSwap = false;
    this.enabled = false;
  }

  override render(renderer: THREE.WebGLRenderer, _write: THREE.WebGLRenderTarget, read: THREE.WebGLRenderTarget): void {
    const autoClear = renderer.autoClear;
    const shadows = renderer.shadowMap.autoUpdate;
    const bg = this.scene.background;
    renderer.autoClear = false;
    renderer.shadowMap.autoUpdate = false;
    this.scene.background = null;
    renderer.setRenderTarget(read);
    renderer.clearDepth();
    this.camera.layers.set(OVERLAY_LAYER);
    renderer.render(this.scene, this.camera);
    this.camera.layers.set(0);
    this.scene.background = bg;
    renderer.autoClear = autoClear;
    renderer.shadowMap.autoUpdate = shadows;
  }
}

/** Screen-space reflections on flat wet surfaces (roads, pavements, car roofs). */
class WetReflectionPass extends Pass {
  private readonly quad: FullScreenQuad;
  readonly material: THREE.ShaderMaterial;
  wet = 0;

  constructor(private readonly camera: THREE.PerspectiveCamera) {
    super();
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        tColor: { value: null },
        tDepth: { value: null },
        proj: { value: new THREE.Matrix4() },
        invProj: { value: new THREE.Matrix4() },
        viewToWorld: { value: new THREE.Matrix3() },
        texel: { value: new THREE.Vector2() },
        wet: { value: 0 },
        time: { value: 0 },
      },
      vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D tColor;
        uniform sampler2D tDepth;
        uniform mat4 proj;
        uniform mat4 invProj;
        uniform mat3 viewToWorld;
        uniform vec2 texel;
        uniform float wet;
        uniform float time;
        varying vec2 vUv;

        vec3 viewPos(vec2 uv) {
          float d = texture2D(tDepth, uv).x;
          vec4 v = invProj * vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
          return v.xyz / v.w;
        }
        vec2 toScreen(vec3 p) {
          vec4 c = proj * vec4(p, 1.0);
          return c.xy / c.w * 0.5 + 0.5;
        }
        float hash(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }

        void main() {
          vec4 base = texture2D(tColor, vUv);
          gl_FragColor = base;
          float depth = texture2D(tDepth, vUv).x;
          if (wet < 0.01 || depth >= 0.9999) return;
          vec3 p = viewPos(vUv);
          // The surface normal from the depth (the neighbour on the nearer side, to stay off edges).
          vec3 pr = viewPos(vUv + vec2(texel.x, 0.0));
          vec3 pl = viewPos(vUv - vec2(texel.x, 0.0));
          vec3 pu = viewPos(vUv + vec2(0.0, texel.y));
          vec3 pd = viewPos(vUv - vec2(0.0, texel.y));
          vec3 dx = abs(pr.z - p.z) < abs(p.z - pl.z) ? pr - p : p - pl;
          vec3 dy = abs(pu.z - p.z) < abs(p.z - pd.z) ? pu - p : p - pd;
          vec3 n = normalize(cross(dx, dy));
          if (dot(n, p) > 0.0) n = -n;
          // Only flat ground-like surfaces get wet puddles.
          vec3 wn = viewToWorld * n;
          if (wn.y < 0.92) return;
          vec3 v = normalize(p);
          // A little ripple on the water.
          float j = hash(gl_FragCoord.xy + time * 60.0);
          vec3 r = normalize(reflect(v, n) + vec3((j - 0.5) * 0.02, 0.0, (hash(gl_FragCoord.yx) - 0.5) * 0.02));
          float maxDist = 45.0;
          float stepLen = 0.6 + j * 0.4;
          vec3 q = p;
          vec2 hit = vec2(-1.0);
          float travelled = 0.0;
          for (int i = 0; i < 28; i++) {
            q += r * stepLen;
            travelled += stepLen;
            stepLen *= 1.16;
            vec2 uv = toScreen(q);
            if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0 || travelled > maxDist) break;
            float sz = viewPos(uv).z;
            float diff = sz - q.z;
            if (diff > 0.0 && diff < 1.2 + travelled * 0.08) {
              // Refine between the last two points.
              vec3 a = q - r * stepLen / 1.16;
              vec3 b = q;
              for (int k = 0; k < 4; k++) {
                vec3 m = (a + b) * 0.5;
                vec2 muv = toScreen(m);
                if (viewPos(muv).z > m.z) b = m; else a = m;
              }
              hit = toScreen(b);
              break;
            }
          }
          if (hit.x < 0.0) return;
          vec2 edge = smoothstep(vec2(0.0), vec2(0.08), hit) * (1.0 - smoothstep(vec2(0.92), vec2(1.0), hit));
          float fade = edge.x * edge.y * (1.0 - travelled / maxDist);
          float fresnel = 0.25 + 0.75 * pow(1.0 - max(dot(-v, n), 0.0), 3.0);
          vec3 refl = texture2D(tColor, hit).rgb;
          float k = clamp(wet * fade * fresnel * 0.75, 0.0, 0.8);
          gl_FragColor = vec4(mix(base.rgb, refl, k) + refl * k * 0.15, base.a);
        }`,
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new FullScreenQuad(this.material);
  }

  override render(renderer: THREE.WebGLRenderer, write: THREE.WebGLRenderTarget, read: THREE.WebGLRenderTarget): void {
    const u = this.material.uniforms;
    u.tColor!.value = read.texture;
    u.tDepth!.value = read.depthTexture;
    (u.proj!.value as THREE.Matrix4).copy(this.camera.projectionMatrix);
    (u.invProj!.value as THREE.Matrix4).copy(this.camera.projectionMatrixInverse);
    (u.viewToWorld!.value as THREE.Matrix3).setFromMatrix4(this.camera.matrixWorld);
    (u.texel!.value as THREE.Vector2).set(1 / read.width, 1 / read.height);
    u.wet!.value = this.wet;
    u.time!.value = (performance.now() / 1000) % 1000;
    renderer.setRenderTarget(this.renderToScreen ? null : write);
    this.quad.render(renderer);
  }

  override dispose(): void {
    this.material.dispose();
    this.quad.dispose();
  }
}

/** Speed: the picture streaks out from the middle towards the edges. */
const SpeedBlurShader = {
  uniforms: { tDiffuse: { value: null }, amount: { value: 0 } },
  vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float amount;
    varying vec2 vUv;
    void main() {
      vec2 c = vec2(0.5, 0.52);
      vec2 d = vUv - c;
      float k = amount * smoothstep(0.16, 0.72, length(d * vec2(1.0, 0.8)));
      vec4 col = vec4(0.0);
      for (int i = 0; i < 8; i++) col += texture2D(tDiffuse, c + d * (1.0 - k * 0.11 * float(i) / 7.0));
      gl_FragColor = col / 8.0;
    }`,
};

export interface FxFrame {
  /** Driving speed (km/h; 0 on foot). */
  kmh: number;
  /** How wet the roads are (0-1). */
  wet: number;
  /** 0 by day, 1 at night. */
  night: number;
  /** First-person car interior on top. */
  overlay: boolean;
}

export class PostFx {
  private readonly composer: EffectComposer;
  private readonly world: WorldPass;
  private readonly wet: WetReflectionPass;
  private readonly overlay: OverlayPass;
  private readonly bloom: UnrealBloomPass;
  private readonly speed: ShaderPass;
  private quality: GraphicsQuality = 'high';
  private blur = 0;

  constructor(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
  ) {
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const target = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4, depthTexture: new THREE.DepthTexture(size.x, size.y) });
    this.composer = new EffectComposer(renderer, target);
    this.world = new WorldPass(scene, camera);
    this.wet = new WetReflectionPass(camera);
    this.overlay = new OverlayPass(scene, camera);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.3, 0.55, 1.2);
    this.speed = new ShaderPass(SpeedBlurShader);
    this.speed.enabled = false;
    for (const p of [this.world, this.wet, this.overlay, this.bloom, this.speed, new OutputPass()]) this.composer.addPass(p);
  }

  setQuality(q: GraphicsQuality): void {
    this.quality = q;
    // Antialiasing in the HDR target: 4x on high, 2x on medium.
    const samples = q === 'high' ? 4 : 2;
    for (const t of [this.composer.renderTarget1, this.composer.renderTarget2]) {
      if (t.samples !== samples) {
        t.samples = samples;
        t.dispose();
      }
    }
  }

  setSize(w: number, h: number, pixelRatio: number): void {
    this.composer.setPixelRatio(pixelRatio);
    this.composer.setSize(w, h);
  }

  render(f: FxFrame, dt: number): void {
    // Reflections only where it pays: high graphics, wet roads.
    this.wet.enabled = this.quality === 'high' && f.wet > 0.03;
    this.wet.wet = f.wet;
    this.overlay.enabled = f.overlay;
    // Bloom: a hint by day, the neon city at night.
    const n = f.night;
    this.bloom.strength = (this.quality === 'high' ? 1 : 0.75) * (0.22 + 0.55 * n);
    this.bloom.threshold = 1.35 - 0.6 * n;
    this.bloom.radius = 0.45 + 0.2 * n;
    // Speed blur eases in and out.
    const target = Math.max(0, Math.min(1, (f.kmh - 90) / 170));
    this.blur += (target - this.blur) * Math.min(1, dt * 3);
    this.speed.enabled = this.blur > 0.02;
    this.speed.uniforms.amount!.value = this.blur * (f.overlay ? 0.7 : 1);
    this.composer.render(dt);
  }

  dispose(): void {
    this.composer.dispose();
  }
}
