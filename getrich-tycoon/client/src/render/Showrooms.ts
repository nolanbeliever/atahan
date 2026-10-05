// The eight themed showrooms on the Galeri Bulvarı (shared/showrooms.ts): a glass-fronted building
// in each theme's colours with its name lit up over the glass, a polished floor and ceiling lights
// inside, a forecourt with a turntable and the marked test-drive bay, and cars from its stock
// spinning on the turntables (loaded once the player comes near). Each theme gets a few props of
// its own: neon for the JDM house, M stripes for the Germans, gold columns and a red carpet for the
// hypercars, a chequered floor for the classics, tyre stacks, boulders, EV chargers, and a roller
// shutter with a flickering bulb for the Black Market.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { DEFAULT_MODS } from '../../../shared/customization';
import { NEW_CONDITION, SHOWROOMS, type Showroom } from '../../../shared/showrooms';
import { getModel } from '../../../shared/vehicles';
import { Tex } from './Textures';
import { createVehicleView, type AnyVehicleView } from './VehicleMesh';

/** Cars on the turntables appear within this distance and hide beyond `HIDE`; a whole showroom beyond `FAR`. */
const SHOW = 170;
const HIDE = 230;
const FAR = 520;

function merge(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const clean = geos.map((g) => {
    const x = g.index ? g.toNonIndexed() : g;
    for (const name of Object.keys(x.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'uv') x.deleteAttribute(name);
    if (!x.attributes.uv) x.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(x.attributes.position!.count * 2), 2));
    return x;
  });
  const m = mergeGeometries(clean, false)!;
  for (const g of geos) g.dispose();
  return m;
}

/** Black and white squares (the classic garage's floor). */
function chequer(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
    g.fillStyle = (x + y) % 2 ? '#1c1c1c' : '#ece8de';
    g.fillRect(x * 32, y * 32, 32, 32);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(10, 5.5);
  return t;
}

interface Table {
  group: THREE.Group;
  x: number;
  z: number;
  modelId: string;
  color: string;
  dirty: boolean;
  view: AnyVehicleView | null;
  y: number;
}

export class ShowroomsView {
  readonly group = new THREE.Group();
  private readonly tables: Table[] = [];
  /** One group per showroom (hidden when far away). */
  private readonly parts: { group: THREE.Group; x: number; z: number }[] = [];
  /** Lit materials: neon and sign panels glow at night, the ceilings always. */
  private readonly neon: THREE.MeshStandardMaterial[] = [];
  private readonly signs: THREE.MeshStandardMaterial[] = [];
  private readonly ceiling = new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#fff8ec', emissiveIntensity: 1.2 });
  private readonly bulb = new THREE.MeshStandardMaterial({ color: '#ff5040', emissive: '#ff2a1a', emissiveIntensity: 1 });
  private time = 0;
  private night = 0;

  constructor() {
    this.group.name = 'showrooms';
    for (const s of SHOWROOMS) this.build(s);
  }

  /** Spin the turntables, flicker the Black Market's bulb, load or hide the cars by distance. */
  update(dt: number, camX: number, camZ: number): void {
    this.time += dt;
    for (const p of this.parts) p.group.visible = Math.hypot(p.x - camX, p.z - camZ) < FAR;
    for (const t of this.tables) {
      const d = Math.hypot(t.x - camX, t.z - camZ);
      if (d < SHOW && !t.view) {
        const look = { id: `display-${t.modelId}-${t.x}`, modelId: t.modelId, color: t.color, mods: { ...DEFAULT_MODS }, condition: t.dirty ? { ...NEW_CONDITION, body: 62, cleanliness: 18 } : NEW_CONDITION };
        const v = createVehicleView(look);
        v.root.position.y = t.y;
        v.root.traverse((o) => ((o as THREE.Mesh).isMesh ? ((o as THREE.Mesh).castShadow = true) : undefined));
        t.group.add(v.root);
        t.view = v;
      }
      t.group.visible = d < HIDE;
      if (t.group.visible) t.group.rotation.y += dt * 0.35;
    }
    const flicker = Math.sin(this.time * 23) + Math.sin(this.time * 7.3) > 1.2 ? 0.15 : 1;
    this.bulb.emissiveIntensity = (0.6 + this.night * 2.4) * flicker;
  }

  setNight(f: number): void {
    this.night = f;
    for (const m of this.neon) m.emissiveIntensity = 0.5 + f * 3;
    for (const m of this.signs) m.emissiveIntensity = 0.3 + f * 1.4;
    this.ceiling.emissiveIntensity = 1 + f * 1.2;
  }

  private build(s: Showroom): void {
    const root = new THREE.Group();
    this.group.add(root);
    this.parts.push({ group: root, x: s.cx, z: s.frontZ });
    const north = s.side === 'north';
    // Local frame: x along the boulevard from the plot's centre, z out of the glass towards the road.
    const dir = north ? 1 : -1;
    const W = s.box.maxX - s.box.minX;
    const D = s.box.maxZ - s.box.minZ;
    const H = s.height;
    const bm = s.id === 'blackmarket';
    const at = (g: THREE.BufferGeometry, lx: number, y: number, lz: number) => g.translate(s.cx + lx, y, s.frontZ + dir * lz);
    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, cast = true): THREE.Mesh => {
      const m = new THREE.Mesh(geo, mat);
      m.castShadow = cast;
      m.receiveShadow = true;
      root.add(m);
      return m;
    };
    /** A plane facing the boulevard (or, with `back`, facing into the building). */
    const facing = (w: number, h: number, lx: number, y: number, lz: number, back = false) => {
      const g = new THREE.PlaneGeometry(w, h);
      if (north === back) g.rotateY(Math.PI);
      return at(g, lx, y, lz);
    };
    const theme = s.theme;
    const wall = new THREE.MeshStandardMaterial({ color: theme.main, roughness: bm ? 0.95 : 0.55, metalness: bm ? 0.05 : 0.25 });
    const trim = new THREE.MeshStandardMaterial({ color: '#1b1d22', metalness: 0.7, roughness: 0.35 });
    const neon = new THREE.MeshStandardMaterial({ color: theme.glow, emissive: theme.glow, emissiveIntensity: 0.5 });
    this.neon.push(neon);

    // Walls, roof with a canopy over the forecourt, the fascia over the glass.
    add(
      merge([
        at(new THREE.BoxGeometry(W, H, 0.4), 0, H / 2, -D + 0.2),
        at(new THREE.BoxGeometry(0.4, H, D), -W / 2 + 0.2, H / 2, -D / 2),
        at(new THREE.BoxGeometry(0.4, H, D), W / 2 - 0.2, H / 2, -D / 2),
        at(new THREE.BoxGeometry(W + 1, 0.5, D + 3), 0, H + 0.25, -D / 2 + 1.5),
        at(new THREE.BoxGeometry(W, 2.2, 0.5), 0, H - 1.1, 0),
      ]),
      wall,
    );
    // Floor inside (glossy, or chequered in the classic garage) and forecourt paving.
    const floorMat =
      s.id === 'classic'
        ? new THREE.MeshStandardMaterial({ map: chequer(), roughness: 0.25, metalness: 0.1 })
        : new THREE.MeshStandardMaterial({ color: theme.floor, roughness: bm ? 0.9 : 0.18, metalness: bm ? 0 : 0.35 });
    add(at(new THREE.PlaneGeometry(W - 0.8, D - 0.6).rotateX(-Math.PI / 2), 0, 0.03, -D / 2), floorMat, false);
    const pave = new THREE.MeshStandardMaterial({ map: Tex.concrete(), color: bm ? '#6d6862' : '#d9d6cf', roughness: 0.8 });
    add(at(new THREE.PlaneGeometry(W, 17).rotateX(-Math.PI / 2), 0, 0.025, 8.5), pave, false);
    // Ceiling light panels.
    const panels: THREE.BufferGeometry[] = [];
    for (let k = 0; k < 4; k++) panels.push(at(new THREE.BoxGeometry(W - 6, 0.08, 0.6), 0, H - 0.6, -3 - k * 5));
    add(merge(panels), bm ? this.bulb : this.ceiling, false);

    // The front: glass with mullions and a door frame, or the Black Market's roller shutter.
    const glassH = H - 2.2;
    if (bm) {
      const shutter = new THREE.MeshStandardMaterial({ map: Tex.rollerDoor(), color: '#8a8580', metalness: 0.5, roughness: 0.6 });
      // Half-open: you see the cars in the dim red light underneath.
      add(at(new THREE.BoxGeometry(W - 0.8, glassH - 2.8, 0.15), 0, 2.8 + (glassH - 2.8) / 2, 0), shutter);
      add(at(new THREE.SphereGeometry(0.18, 10, 8), 0, glassH + 0.4, 0.6), this.bulb, false);
    } else {
      const glass = new THREE.MeshStandardMaterial({ color: '#bcd7e6', metalness: 0.9, roughness: 0.04, transparent: true, opacity: 0.22, depthWrite: false });
      const pane = add(facing(W - 0.8, glassH, 0, glassH / 2, 0), glass, false);
      pane.renderOrder = 3;
      const bars: THREE.BufferGeometry[] = [];
      for (let x = -W / 2 + 0.4; x <= W / 2 - 0.3; x += 5) bars.push(at(new THREE.BoxGeometry(0.16, glassH, 0.22), x, glassH / 2, 0));
      bars.push(at(new THREE.BoxGeometry(W, 0.16, 0.22), 0, 0.08, 0));
      bars.push(at(new THREE.BoxGeometry(4.4, 0.18, 0.26), 0, 3.1, 0.02));
      bars.push(at(new THREE.BoxGeometry(0.18, 3.1, 0.26), -2.2, 1.55, 0.02), at(new THREE.BoxGeometry(0.18, 3.1, 0.26), 2.2, 1.55, 0.02));
      add(merge(bars), trim);
    }
    // The name over the glass, a neon line under it and along the roof edge.
    // Dark lettering on a light building (the hypercar pavilion, the EV house), white otherwise.
    const light = new THREE.Color(theme.main).getHSL({ h: 0, s: 0, l: 0 }).l > 0.6;
    const signTex = Tex.sign(s.name.toUpperCase(), { bg: theme.main, fg: light ? '#15171c' : '#ffffff', accent: theme.accent, w: 1024, h: 160, sub: s.tagline });
    const signMat = new THREE.MeshStandardMaterial({ map: signTex, emissive: '#ffffff', emissiveMap: signTex, emissiveIntensity: 0.3 });
    this.signs.push(signMat);
    add(facing(Math.min(W - 4, 30), 2, 0, H - 1.1, 0.27), signMat, false);
    add(merge([at(new THREE.BoxGeometry(W, 0.12, 0.14), 0, H - 2.25, 0.3), at(new THREE.BoxGeometry(W + 1, 0.12, 0.14), 0, H + 0.5, 1.5 + 1.5)]), neon, false);
    // The name again on the back wall inside, seen through the glass.
    add(facing(14, 2.2, 0, H * 0.55, -D + 0.45), signMat, false);

    // Turntables: one on the forecourt, two inside.
    this.turntable(root, s, s.podium.x, s.podium.z, 0.25, s.podium.r, neon, 0);
    s.displays.forEach((p, i) => this.turntable(root, s, p.x, p.z, 0.04, 2.9, neon, i + 1));

    // The test-drive bay: painted box and its name on the ground.
    const lineMat = new THREE.MeshStandardMaterial({ color: '#f4f4ef', roughness: 0.6 });
    const bay = s.testDrive;
    const bx = bay.x - s.cx;
    const bz = (bay.z - s.frontZ) * dir;
    add(
      merge([
        at(new THREE.PlaneGeometry(3.6, 0.14).rotateX(-Math.PI / 2), bx, 0.04, bz - 3.2),
        at(new THREE.PlaneGeometry(0.14, 6.4).rotateX(-Math.PI / 2), bx - 1.8, 0.04, bz),
        at(new THREE.PlaneGeometry(0.14, 6.4).rotateX(-Math.PI / 2), bx + 1.8, 0.04, bz),
      ]),
      lineMat,
      false,
    );
    const label = Tex.sign('TEST SÜRÜŞÜ', { bg: bm ? '#3a3633' : '#c9c5bc', fg: bm ? '#ff6b5e' : '#1b1d22', w: 512, h: 96 });
    const labelGeo = new THREE.PlaneGeometry(3.4, 0.64).rotateX(-Math.PI / 2);
    if (!north) labelGeo.rotateY(Math.PI);
    add(at(labelGeo, bx, 0.045, bz + 3.8), new THREE.MeshStandardMaterial({ map: label, roughness: 0.7 }), false);

    this.props(s, at, add, neon);
  }

  private turntable(root: THREE.Group, s: Showroom, x: number, z: number, base: number, r: number, neon: THREE.Material, slot: number): void {
    const plinth = new THREE.Mesh(new THREE.CylinderGeometry(r + 0.15, r + 0.25, base, 48).translate(x, base / 2, z), new THREE.MeshStandardMaterial({ color: '#2a2d33', metalness: 0.6, roughness: 0.4 }));
    plinth.receiveShadow = true;
    root.add(plinth);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(r + 0.05, 0.05, 6, 64).rotateX(Math.PI / 2).translate(x, base + 0.02, z), neon);
    root.add(ring);
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(r - 0.1, r - 0.1, 0.08, 48), new THREE.MeshStandardMaterial({ color: '#3a3e46', metalness: 0.85, roughness: 0.25 }));
    disc.position.y = base + 0.04;
    disc.receiveShadow = true;
    g.add(disc);
    g.rotation.y = slot * 1.9;
    root.add(g);
    // Black Market: tired used cars; elsewhere the stock in factory colours.
    const pool = s.id === 'blackmarket' ? ['norda_arlo', 'apexon_strix', 'granforge_ridgeback'] : s.models;
    const modelId = pool[slot % pool.length]!;
    const colors = getModel(modelId).colors;
    this.tables.push({ group: g, x, z, modelId, color: colors[slot % colors.length]!, dirty: s.id === 'blackmarket', view: null, y: base + 0.08 });
  }

  /** A few props in each showroom's theme. */
  private props(
    s: Showroom,
    at: (g: THREE.BufferGeometry, lx: number, y: number, lz: number) => THREE.BufferGeometry,
    add: (geo: THREE.BufferGeometry, mat: THREE.Material, cast?: boolean) => THREE.Mesh,
    neon: THREE.Material,
  ): void {
    const W = s.box.maxX - s.box.minX;
    const H = s.height;
    const flat = (color: string, rough = 0.6, metal = 0.1) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });
    switch (s.id) {
      case 'jdm':
        // Neon lines along the forecourt and a tall vertical banner.
        add(merge([at(new THREE.BoxGeometry(0.12, 0.06, 16), -W / 2 + 0.3, 0.06, 8.5), at(new THREE.BoxGeometry(0.12, 0.06, 16), W / 2 - 0.3, 0.06, 8.5)]), neon, false);
        add(at(new THREE.BoxGeometry(1.4, 7, 0.2), W / 2 - 1.6, 3.5, 15.5), flat('#ff2d55', 0.5));
        break;
      case 'german': {
        // The three motorsport stripes at both ends of the fascia.
        const cols = ['#5bc2f5', '#1d3c8f', '#e2231a'];
        cols.forEach((c, i) => {
          const m = flat(c, 0.4, 0.2);
          add(merge([at(new THREE.BoxGeometry(0.5, 2.2, 0.1), -W / 2 + 1 + i * 0.55, H - 1.1, 0.3), at(new THREE.BoxGeometry(0.5, 2.2, 0.1), W / 2 - 2.1 + i * 0.55, H - 1.1, 0.3)]), m, false);
        });
        break;
      }
      case 'hyper':
        // Gold columns holding the canopy and a red carpet to the door.
        add(merge([at(new THREE.CylinderGeometry(0.35, 0.35, H, 16), -W / 2 + 1, H / 2, 2.6), at(new THREE.CylinderGeometry(0.35, 0.35, H, 16), W / 2 - 1, H / 2, 2.6)]), flat('#c9a227', 0.25, 0.9));
        add(at(new THREE.PlaneGeometry(3, 16.5).rotateX(-Math.PI / 2), 0, 0.035, 8.6), flat('#9e1020', 0.9), false);
        break;
      case 'classic': {
        // A round enamel sign on a post and an old fuel pump.
        const disc = new THREE.CylinderGeometry(1.1, 1.1, 0.12, 32).rotateX(Math.PI / 2);
        add(at(disc, -W / 2 + 2, 5.2, 16), flat('#f4c430', 0.4, 0.2));
        add(at(new THREE.CylinderGeometry(0.09, 0.09, 5, 8), -W / 2 + 2, 2.5, 16), flat('#2b2b2b', 0.5, 0.6));
        add(at(new THREE.BoxGeometry(0.8, 1.9, 0.6), W / 2 - 2, 0.95, 15), flat('#c1121f', 0.5, 0.2));
        add(at(new THREE.SphereGeometry(0.32, 12, 10), W / 2 - 2, 2.1, 15), flat('#fff3d6', 0.3), false);
        break;
      }
      case 'moto': {
        // Stacks of tyres by the forecourt.
        const tyres: THREE.BufferGeometry[] = [];
        for (const lx of [W / 2 - 1.5, W / 2 - 3.2]) for (let k = 0; k < 4; k++) tyres.push(at(new THREE.TorusGeometry(0.42, 0.17, 8, 20).rotateX(Math.PI / 2), lx, 0.17 + k * 0.32, 15.5));
        add(merge(tyres), flat('#1a1a1a', 0.9));
        break;
      }
      case 'offroad': {
        // Boulders and a log around the forecourt turntable.
        const rocks: THREE.BufferGeometry[] = [];
        [
          [-W / 2 + 1.5, 15.5, 1.1],
          [-W / 2 + 3.3, 16, 0.7],
          [W / 2 - 2, 15.6, 0.9],
        ].forEach(([x, z, r]) => rocks.push(at(new THREE.DodecahedronGeometry(r!, 0), x!, r! * 0.6, z!)));
        add(merge(rocks), flat('#7a7262', 0.95));
        add(at(new THREE.CylinderGeometry(0.3, 0.3, 4, 10).rotateZ(Math.PI / 2), W / 2 - 3.5, 0.3, 14), flat('#6b4a2b', 0.9));
        break;
      }
      case 'ev': {
        // Three chargers with glowing tops.
        const posts: THREE.BufferGeometry[] = [];
        const tops: THREE.BufferGeometry[] = [];
        for (let k = 0; k < 3; k++) {
          posts.push(at(new THREE.BoxGeometry(0.5, 1.6, 0.35), -W / 2 + 1.5 + k * 1.6, 0.8, 16));
          tops.push(at(new THREE.BoxGeometry(0.52, 0.12, 0.37), -W / 2 + 1.5 + k * 1.6, 1.4, 16));
        }
        add(merge(posts), flat('#f2f6fa', 0.3, 0.2));
        add(merge(tops), neon, false);
        break;
      }
      case 'blackmarket': {
        // Wire fence posts down both sides of the yard.
        const posts: THREE.BufferGeometry[] = [];
        for (let z = 1; z <= 16.5; z += 2.5) for (const x of [-W / 2 + 0.2, W / 2 - 0.2]) posts.push(at(new THREE.CylinderGeometry(0.05, 0.05, 2.4, 6), x, 1.2, z));
        for (const x of [-W / 2 + 0.2, W / 2 - 0.2]) posts.push(at(new THREE.BoxGeometry(0.04, 0.04, 16), x, 2.35, 8.75), at(new THREE.BoxGeometry(0.04, 0.04, 16), x, 1.2, 8.75));
        add(merge(posts), flat('#7d7d7d', 0.5, 0.7));
        break;
      }
      default:
        break;
    }
  }
}
