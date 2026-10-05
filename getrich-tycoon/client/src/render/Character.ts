// Original low-poly character with procedural animation (idle/walk/run/interact, riding; police at
// a crime scene: a torch out, down on one knee photographing the evidence) and poses for
// cutscenes: seated in a car, ducking through a door, hands up, handcuffed.

import * as THREE from 'three';
import { VISORS, helmet, visor, type VisorDef } from '../../../shared/helmets';
import { Anim, type Appearance } from '../../../shared/types';

const geo = new THREE.BoxGeometry(1, 1, 1);
const shoeMat = new THREE.MeshStandardMaterial({ color: '#222326', roughness: 0.8 });
const eyeMat = new THREE.MeshStandardMaterial({ color: '#15161a', roughness: 0.4 });

function part(mat: THREE.Material, sx: number, sy: number, sz: number, x: number, y: number, z: number): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.scale.set(sx, sy, sz);
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}

/** Police officer uniform. */
export const POLICE_OFFICER: Appearance = { skin: '#c68642', shirt: '#1d2b4f', pants: '#141b2e', hair: '#1b1b1b' };

/** SWAT: black fatigues and a black helmet. */
export const SWAT_OFFICER: Appearance = { skin: '#b9875a', shirt: '#15171b', pants: '#202329', hair: '#0e0f12' };

/** A police torch (beam along the arm, glowing at night) and a camera for the evidence photos. */
let propKit: { beamTex: THREE.Texture; body: THREE.BufferGeometry; lens: THREE.BufferGeometry; beam: THREE.BufferGeometry; dark: THREE.MeshStandardMaterial; lensMat: THREE.MeshBasicMaterial; cam: THREE.BufferGeometry; flash: THREE.SpriteMaterial } | null = null;
function props(): NonNullable<typeof propKit> {
  if (propKit) return propKit;
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(220,235,255,0.7)');
  grad.addColorStop(1, 'rgba(200,220,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  // The beam fades out along its length (bright at the lens, nothing at the far end).
  const bc = document.createElement('canvas');
  bc.width = 4;
  bc.height = 128;
  const bg = bc.getContext('2d')!;
  const fade = bg.createLinearGradient(0, 0, 0, 128);
  fade.addColorStop(0, 'rgb(255,255,255)');
  fade.addColorStop(0.25, 'rgb(120,120,120)');
  fade.addColorStop(1, 'rgb(0,0,0)');
  bg.fillStyle = fade;
  bg.fillRect(0, 0, 4, 128);
  const beamTex = new THREE.CanvasTexture(bc);
  propKit = {
    beamTex,
    body: new THREE.CylinderGeometry(0.022, 0.026, 0.2, 8),
    lens: new THREE.CylinderGeometry(0.032, 0.032, 0.02, 10),
    beam: new THREE.ConeGeometry(0.9, 6, 18, 1, true).translate(0, -3, 0),
    dark: new THREE.MeshStandardMaterial({ color: '#1a1b1f', metalness: 0.5, roughness: 0.4 }),
    lensMat: new THREE.MeshBasicMaterial({ color: '#fff6dd', toneMapped: false }),
    cam: new THREE.BoxGeometry(0.13, 0.085, 0.07),
    flash: new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), color: '#ffffff', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 }),
  };
  return propKit;
}

/** The hitman contact: dark coat, dark trousers, a shaved head. */
export const HITMAN_CONTACT: Appearance = { skin: '#b07a52', shirt: '#121214', pants: '#0b0b0d', hair: '#0b0b0d' };

export const NPC_PALETTE: Appearance[] = [
  { skin: '#f1c27d', shirt: '#6c757d', pants: '#343a40', hair: '#4a2c2a' },
  { skin: '#8d5524', shirt: '#e9c46a', pants: '#264653', hair: '#1b1b1b' },
  { skin: '#ffdbac', shirt: '#2a9d8f', pants: '#3d405b', hair: '#d4a373' },
  { skin: '#c68642', shirt: '#e76f51', pants: '#2b2d42', hair: '#1b1b1b' },
  { skin: '#e0ac69', shirt: '#f4f1de', pants: '#6c584c', hair: '#7f5539' },
  { skin: '#a5694f', shirt: '#118ab2', pants: '#1d3557', hair: '#1b1b1b' },
  { skin: '#f1c27d', shirt: '#b5838d', pants: '#495057', hair: '#e9c46a' },
  { skin: '#8d5524', shirt: '#06d6a0', pants: '#073b4c', hair: '#4a2c2a' },
];

/** A gun in the hand, built from boxes (barrel along +z before it is turned into the hand). */
const gunMats = new Map<string, THREE.MeshStandardMaterial>();
function gunMat(color: string, metal = 0.5): THREE.MeshStandardMaterial {
  let m = gunMats.get(color);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, metalness: metal, roughness: 0.38 });
    gunMats.set(color, m);
  }
  return m;
}

function gunModel(slot: number): THREE.Group {
  const g = new THREE.Group();
  const add = (mat: THREE.Material, sx: number, sy: number, sz: number, x: number, y: number, z: number) => g.add(part(mat, sx, sy, sz, x, y, z));
  const dark = gunMat('#26282c');
  switch (slot) {
    case 1: // pistol
      add(dark, 0.05, 0.07, 0.22, 0, 0.02, 0.06);
      add(dark, 0.045, 0.12, 0.06, 0, -0.06, -0.02);
      break;
    case 2: // shotgun
      add(dark, 0.05, 0.05, 0.75, 0, 0.03, 0.28);
      add(gunMat('#6b4426', 0.1), 0.06, 0.08, 0.3, 0, 0.0, -0.18);
      add(gunMat('#6b4426', 0.1), 0.06, 0.05, 0.16, 0, -0.01, 0.3);
      break;
    case 3: // rifle
      add(gunMat('#3a3326'), 0.06, 0.08, 0.55, 0, 0.02, 0.12);
      add(dark, 0.03, 0.03, 0.32, 0, 0.04, 0.52);
      add(dark, 0.045, 0.16, 0.06, 0, -0.08, 0.14);
      add(gunMat('#5a4630', 0.1), 0.05, 0.08, 0.22, 0, -0.01, -0.22);
      break;
    case 4: // golden desert eagle
      add(gunMat('#d4af37', 0.95), 0.06, 0.09, 0.28, 0, 0.03, 0.08);
      add(gunMat('#b8962e', 0.9), 0.05, 0.14, 0.07, 0, -0.07, -0.03);
      break;
    case 5: {
      // laser RPG on the shoulder
      const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 1.05, 12), gunMat('#4a5a3a', 0.2));
      tube.rotation.x = Math.PI / 2;
      tube.position.set(0, 0.06, 0.2);
      tube.castShadow = true;
      g.add(tube);
      add(dark, 0.05, 0.12, 0.06, 0, -0.06, 0.05);
      add(gunMat('#ff2a3a', 0), 0.03, 0.03, 0.06, 0.06, 0.1, 0.5);
      break;
    }
    case 6: {
      // minigun: six barrels round a hub
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        add(gunMat('#555b63', 0.8), 0.022, 0.022, 0.62, Math.cos(a) * 0.045, 0.04 + Math.sin(a) * 0.045, 0.4);
      }
      add(dark, 0.14, 0.14, 0.3, 0, 0.04, 0.0);
      break;
    }
    case 7:
      // Micro-Uzi: a short boxy body, the magazine down through the grip.
      add(gunMat('#26282d', 0.4), 0.05, 0.07, 0.24, 0, 0.02, 0.08);
      add(dark, 0.025, 0.025, 0.08, 0, 0.03, 0.24);
      add(gunMat('#1b1c20', 0.3), 0.035, 0.16, 0.04, 0, -0.08, 0.04);
      break;
    case 8:
      // Sniper rifle: a long barrel, a scope on top, a stock.
      add(gunMat('#2f3a2c', 0.2), 0.055, 0.075, 0.6, 0, 0.02, 0.1);
      add(dark, 0.025, 0.025, 0.5, 0, 0.04, 0.62);
      add(dark, 0.045, 0.045, 0.26, 0, 0.1, 0.1);
      add(gunMat('#2f3a2c', 0.2), 0.05, 0.1, 0.24, 0, -0.02, -0.28);
      break;
    default:
      break;
  }
  return g;
}

/** A motorcycle helmet over the head (shared/helmets.ts ids), the visor in front of the eyes. */
function helmetModel(id: string, v: VisorDef, paint: string): THREE.Group {
  const g = new THREE.Group();
  const shell = new THREE.MeshStandardMaterial({ color: paint, metalness: 0.3, roughness: 0.28 });
  const dark = new THREE.MeshStandardMaterial({ color: '#141518', roughness: 0.6 });
  const visorMat = new THREE.MeshStandardMaterial({ color: v.color, transparent: v.opacity < 1, opacity: v.opacity, metalness: v.metal, roughness: 0.08 });
  if (v.id === 'iridium') {
    visorMat.emissive = new THREE.Color('#1a5f7a');
    visorMat.emissiveIntensity = 0.35;
  }
  const add = (geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1, rx = 0) => {
    const o = new THREE.Mesh(geo, m);
    o.position.set(x, y, z);
    o.scale.set(sx, sy, sz);
    o.rotation.x = rx;
    o.castShadow = true;
    g.add(o);
    return o;
  };
  const ball = new THREE.SphereGeometry(1, 18, 12);
  const big = id === 'premium' ? 1.06 : 1;
  add(ball, shell, 0, 1.78, -0.01, 0.205 * big, 0.215 * big, 0.225 * big);
  if (id === 'cross') {
    // Long chin bar, a peak and goggles.
    add(geo, shell, 0, 1.64, 0.16, 0.2, 0.1, 0.12, 0.35);
    add(geo, shell, 0, 1.97, 0.12, 0.3, 0.025, 0.24, -0.25);
    add(geo, dark, 0, 1.78, 0.19, 0.27, 0.1, 0.05);
    add(geo, visorMat, 0, 1.78, 0.215, 0.22, 0.07, 0.01);
  } else {
    // Full face: chin bar and the visor across the eye port.
    add(geo, shell, 0, 1.63, 0.12, 0.3, 0.12, 0.16, 0.2);
    const bubble = id === 'custom';
    add(ball, visorMat, 0, 1.77, 0.07, 0.17, bubble ? 0.12 : 0.085, bubble ? 0.17 : 0.16);
    if (id === 'sport') add(geo, shell, 0, 1.93, -0.17, 0.14, 0.03, 0.12, 0.35);
    if (id === 'custom') for (const x of [-0.04, 0.04]) add(geo, dark, x, 1.95, -0.02, 0.025, 0.06, 0.4);
    if (id === 'premium') for (const x of [-0.06, 0.06]) add(geo, dark, x, 1.98, 0.06, 0.03, 0.02, 0.06);
  }
  return g;
}

/** Poses that override the arm / leg animation. */
export type Pose = 'none' | 'sit' | 'duck' | 'handsUp' | 'cuffed';

export class CharacterView {
  /** How dark it is (0 day - 1 night): torch beams show up at night. */
  static night = 0;
  /** Current pose (set every frame by whoever animates the character). */
  pose: Pose = 'none';
  private prop: 'torch' | 'camera' | null = null;
  private propObj: THREE.Group | null = null;
  private beamMat: THREE.MeshBasicMaterial | null = null;
  private flash: THREE.Sprite | null = null;
  readonly root = new THREE.Group();
  private readonly rig = new THREE.Group();
  private hipL = new THREE.Group();
  private hipR = new THREE.Group();
  private shL = new THREE.Group();
  private shR = new THREE.Group();
  private torso!: THREE.Mesh;
  private mats: THREE.MeshStandardMaterial[] = [];
  private phase = Math.random() * 10;
  private time = Math.random() * 10;
  private appearanceKey = '';
  private gun: THREE.Group | null = null;
  private gunSlot = 0;
  private helmet: THREE.Group | null = null;
  private helmetKey = '';
  private helmetOn = false;

  constructor(appearance: Appearance) {
    this.root.add(this.rig);
    this.setAppearance(appearance);
  }

  setAppearance(a: Appearance): void {
    const key = `${a.skin}${a.shirt}${a.pants}${a.hair}`;
    if (key === this.appearanceKey) return;
    this.appearanceKey = key;
    this.rig.clear();
    this.hipL.clear();
    this.hipR.clear();
    this.shL.clear();
    this.shR.clear();
    for (const m of this.mats) m.dispose();
    const skin = new THREE.MeshStandardMaterial({ color: a.skin, roughness: 0.7 });
    const shirt = new THREE.MeshStandardMaterial({ color: a.shirt, roughness: 0.75 });
    const pants = new THREE.MeshStandardMaterial({ color: a.pants, roughness: 0.8 });
    const hair = new THREE.MeshStandardMaterial({ color: a.hair, roughness: 0.9 });
    this.mats = [skin, shirt, pants, hair];

    for (const [hip, x] of [
      [this.hipL, 0.11],
      [this.hipR, -0.11],
    ] as const) {
      hip.position.set(x, 0.9, 0);
      hip.add(part(pants, 0.17, 0.82, 0.2, 0, -0.41, 0));
      hip.add(part(shoeMat, 0.18, 0.1, 0.3, 0, -0.85, 0.04));
      this.rig.add(hip);
    }
    this.torso = part(shirt, 0.46, 0.62, 0.26, 0, 1.22, 0);
    this.rig.add(this.torso);
    this.rig.add(part(pants, 0.44, 0.1, 0.25, 0, 0.93, 0));
    for (const [sh, x] of [
      [this.shL, 0.3],
      [this.shR, -0.3],
    ] as const) {
      sh.position.set(x, 1.48, 0);
      sh.add(part(shirt, 0.14, 0.34, 0.15, 0, -0.15, 0));
      sh.add(part(skin, 0.12, 0.3, 0.13, 0, -0.45, 0));
      this.rig.add(sh);
    }
    this.rig.add(part(skin, 0.12, 0.08, 0.12, 0, 1.56, 0));
    this.rig.add(part(skin, 0.3, 0.32, 0.3, 0, 1.74, 0));
    this.rig.add(part(hair, 0.32, 0.09, 0.32, 0, 1.92, 0));
    this.rig.add(part(hair, 0.32, 0.22, 0.08, 0, 1.8, -0.13));
    this.rig.add(part(eyeMat, 0.05, 0.05, 0.02, 0.07, 1.76, 0.151));
    this.rig.add(part(eyeMat, 0.05, 0.05, 0.02, -0.07, 1.76, 0.151));
    if (this.helmet) this.rig.add(this.helmet);
  }

  /** The player's helmet (worn on bikes and quads); null: none. */
  setHelmet(id: string | null | undefined, visorId: string | null | undefined, paint: string): void {
    const def = helmet(id);
    const key = def ? `${def.id}:${visorId}:${paint}` : '';
    if (key === this.helmetKey) return;
    this.helmetKey = key;
    this.helmet?.removeFromParent();
    this.helmet = def ? helmetModel(def.id, visor(visorId) ?? VISORS[0]!, paint) : null;
    if (this.helmet) {
      this.helmet.visible = this.helmetOn;
      this.rig.add(this.helmet);
    }
  }

  /** Helmet on (riding) or off (on foot). */
  wearHelmet(on: boolean): void {
    this.helmetOn = on;
    if (this.helmet) this.helmet.visible = on;
  }

  /** The gun in the right hand (shared/weapons.ts slot; 0: none). */
  setWeapon(slot: number): void {
    if (slot === this.gunSlot) return;
    this.gunSlot = slot;
    if (this.gun) {
      this.gun.removeFromParent();
      this.gun = null;
    }
    if (slot <= 0) return;
    this.gun = gunModel(slot);
    // In the hand, barrel along the arm (the arm points forward when aiming).
    this.gun.rotation.x = Math.PI / 2;
    this.gun.position.set(0, -0.62, 0.02);
    this.shR.add(this.gun);
  }

  /** The torch in the left hand, or the camera held up in both. */
  private setProp(kind: 'torch' | 'camera' | null): void {
    if (kind === this.prop) return;
    this.prop = kind;
    this.propObj?.removeFromParent();
    this.propObj = null;
    this.beamMat?.dispose();
    this.beamMat = null;
    this.flash?.material.dispose();
    this.flash = null;
    if (!kind) return;
    const k = props();
    const g = new THREE.Group();
    if (kind === 'torch') {
      const body = new THREE.Mesh(k.body, k.dark);
      body.position.y = -0.04;
      const lens = new THREE.Mesh(k.lens, k.lensMat);
      lens.position.y = -0.15;
      this.beamMat = new THREE.MeshBasicMaterial({ color: '#fff3d6', map: k.beamTex, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.FrontSide });
      const beam = new THREE.Mesh(k.beam, this.beamMat);
      beam.position.y = -0.16;
      g.add(body, lens, beam);
      g.position.set(0, -0.6, 0.03);
      this.shL.add(g);
    } else {
      const cam = new THREE.Mesh(k.cam, k.dark);
      cam.castShadow = true;
      const lens = new THREE.Mesh(k.lens, k.dark);
      lens.rotation.x = Math.PI / 2;
      lens.position.set(0, -0.02, 0.05);
      this.flash = new THREE.Sprite(k.flash.clone());
      this.flash.position.set(0, 0.02, 0.1);
      this.flash.scale.setScalar(0.9);
      g.add(cam, lens, this.flash);
      // Held in front of the face (in the rig, not an arm: both hands are on it).
      g.position.set(0, 1.62, 0.3);
      this.rig.add(g);
    }
    this.propObj = g;
  }

  animate(anim: number, dt: number): void {
    this.time += dt;
    this.setProp(anim === Anim.TorchWalk || anim === Anim.TorchIdle ? 'torch' : anim === Anim.Kneel ? 'camera' : null);
    if (anim === Anim.TorchWalk || anim === Anim.TorchIdle || anim === Anim.Kneel) {
      this.policeWork(anim, dt);
      return;
    }
    const moving = anim === Anim.Walk || anim === Anim.Run;
    const running = anim === Anim.Run;
    if (moving) this.phase += dt * (running ? 11 : 7.5);
    const swing = moving ? Math.sin(this.phase) * (running ? 0.95 : 0.55) : 0;
    const k = Math.min(1, dt * 12);
    const lerp = (obj: THREE.Object3D, target: number) => (obj.rotation.x += (target - obj.rotation.x) * k);
    const lerpZ = (obj: THREE.Object3D, target: number) => (obj.rotation.z += (target - obj.rotation.z) * k);
    const pose = this.pose;
    // Down on the ground (shot): fall back and lie still.
    if (anim === Anim.Dead) {
      this.rig.rotation.x += (-1.5 - this.rig.rotation.x) * Math.min(1, dt * 6);
      this.rig.position.y += (0.16 - this.rig.position.y) * k;
      lerp(this.shL, -2.6);
      lerp(this.shR, -2.4);
      lerp(this.hipL, 0.15);
      lerp(this.hipR, -0.1);
      return;
    }
    lerpZ(this.shL, pose === 'cuffed' ? -0.32 : pose === 'handsUp' ? 0.18 : anim === Anim.Aim ? -0.55 : 0);
    lerpZ(this.shR, pose === 'cuffed' ? 0.32 : pose === 'handsUp' ? -0.18 : 0);
    if (pose === 'sit' || pose === 'duck') {
      // Seated (hands on the wheel) or bending in through a door.
      const sit = pose === 'sit';
      lerp(this.hipL, sit ? -1.45 : -0.8);
      lerp(this.hipR, sit ? -1.45 : -0.6);
      lerp(this.shL, sit ? -1.15 : -0.7);
      lerp(this.shR, sit ? -1.15 : -0.5);
      this.rig.position.y += ((sit ? 0 : -0.18) - this.rig.position.y) * k;
      this.rig.rotation.x += ((sit ? 0.05 : 0.55) - this.rig.rotation.x) * k;
      return;
    }
    if (pose === 'handsUp' || pose === 'cuffed') {
      lerp(this.hipL, 0);
      lerp(this.hipR, 0);
      lerp(this.shL, pose === 'handsUp' ? -2.85 + Math.sin(this.time * 3) * 0.04 : 0.42);
      lerp(this.shR, pose === 'handsUp' ? -2.85 - Math.sin(this.time * 3) * 0.04 : 0.42);
      this.rig.position.y += (0 - this.rig.position.y) * k;
      this.rig.rotation.x += ((pose === 'cuffed' ? 0.12 : 0) - this.rig.rotation.x) * k;
      return;
    }
    if (anim === Anim.Drive) {
      // Seated on a motorcycle: thighs forward, hands on the bars, leaning in a little.
      lerp(this.hipL, -0.9);
      lerp(this.hipR, -0.9);
      lerp(this.shL, -1.0);
      lerp(this.shR, -1.0);
      this.rig.position.y = 0;
      this.rig.rotation.x += (0.28 - this.rig.rotation.x) * k;
      return;
    }
    lerp(this.hipL, swing);
    lerp(this.hipR, -swing);
    if (anim === Anim.Aim || (this.gunSlot > 0 && anim !== Anim.Run)) {
      // Both arms up, gun pointing forward (a big gun sits lower, at the hip).
      const heavy = this.gunSlot === 5 || this.gunSlot === 6 || this.gunSlot === 2 || this.gunSlot === 3;
      lerp(this.shR, heavy ? -1.25 : -1.52);
      lerp(this.shL, heavy ? -1.1 : -1.38);
      this.rig.position.y = moving ? Math.abs(Math.sin(this.phase)) * 0.03 : 0;
      this.rig.rotation.x += (0 - this.rig.rotation.x) * k;
      return;
    }
    if (anim === Anim.Interact) {
      lerp(this.shR, -1.35 + Math.sin(this.time * 9) * 0.15);
      lerp(this.shL, 0.1);
    } else {
      const idleSway = moving ? 0 : Math.sin(this.time * 1.6) * 0.04;
      lerp(this.shL, -swing * 0.85 + idleSway);
      lerp(this.shR, swing * 0.85 - idleSway);
    }
    this.rig.position.y = moving ? Math.abs(Math.sin(this.phase)) * (running ? 0.09 : 0.04) : 0;
    this.rig.rotation.x += ((running ? 0.14 : 0) - this.rig.rotation.x) * k;
    if (this.torso) this.torso.scale.y = 0.62 * (1 + (moving ? 0 : Math.sin(this.time * 2.2) * 0.012));
  }

  /** Combing a crime scene: walking with the torch out in front, or down on one knee taking
   *  photos (a flash now and then). */
  private policeWork(anim: number, dt: number): void {
    const k = Math.min(1, dt * 10);
    const lerp = (obj: THREE.Object3D, target: number) => (obj.rotation.x += (target - obj.rotation.x) * k);
    const lerpZ = (obj: THREE.Object3D, target: number) => (obj.rotation.z += (target - obj.rotation.z) * k);
    if (anim === Anim.Kneel) {
      // Down on one knee, leaning in, both hands up holding the camera.
      lerp(this.hipL, -0.78);
      lerp(this.hipR, 0.62);
      lerp(this.shL, -1.75);
      lerp(this.shR, -1.75);
      lerpZ(this.shL, -0.42);
      lerpZ(this.shR, 0.42);
      this.rig.position.y += (-0.26 - this.rig.position.y) * k;
      this.rig.rotation.x += (0.12 - this.rig.rotation.x) * k;
      if (this.flash) {
        const p = (this.time + this.phase) % 2.3;
        (this.flash.material as THREE.SpriteMaterial).opacity = p < 0.09 ? 1 : 0;
        this.flash.scale.setScalar(p < 0.09 ? 1.6 : 0.5);
      }
      return;
    }
    const walking = anim === Anim.TorchWalk;
    if (walking) this.phase += dt * 6.5;
    const swing = walking ? Math.sin(this.phase) * 0.5 : 0;
    lerp(this.hipL, swing);
    lerp(this.hipR, -swing);
    // The torch held out ahead, sweeping a little; the other arm low.
    lerp(this.shL, -1.32 + Math.sin(this.time * 1.3) * 0.08);
    lerpZ(this.shL, -0.08 + Math.sin(this.time * 0.9) * 0.1);
    lerp(this.shR, walking ? swing * 0.6 : -0.15);
    lerpZ(this.shR, 0);
    this.rig.position.y = walking ? Math.abs(Math.sin(this.phase)) * 0.035 : 0;
    this.rig.rotation.x += (0 - this.rig.rotation.x) * k;
    if (this.beamMat) this.beamMat.opacity = 0.03 + CharacterView.night * 0.32;
  }

  dispose(): void {
    this.setProp(null);
    for (const m of this.mats) m.dispose();
  }
}
