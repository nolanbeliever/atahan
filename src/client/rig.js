// Procedural skinned humanoid: geometry is generated in code and rigidly skinned to a
// 16-bone skeleton, so each character is ONE draw call. Animation is procedural
// (gait cycles, lunges, hit reactions, ragdoll-style falls) driven by AI/player state.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const BONES = ['root', 'hips', 'spine', 'chest', 'neck', 'head', 'armL', 'foreL', 'handL', 'armR', 'foreR', 'handR', 'thighL', 'shinL', 'footL', 'thighR', 'shinR', 'footR'];
const BI = Object.fromEntries(BONES.map((b, i) => [b, i]));
// bind-pose offsets relative to parent
const BIND = {
  root: [null, 0, 0, 0], hips: ['root', 0, 0.95, 0], spine: ['hips', 0, 0.12, 0], chest: ['spine', 0, 0.2, 0], neck: ['chest', 0, 0.25, 0], head: ['neck', 0, 0.08, 0],
  armL: ['chest', 0.2, 0.17, 0], foreL: ['armL', 0, -0.29, 0], handL: ['foreL', 0, -0.26, 0],
  armR: ['chest', -0.2, 0.17, 0], foreR: ['armR', 0, -0.29, 0], handR: ['foreR', 0, -0.26, 0],
  thighL: ['hips', 0.1, -0.05, 0], shinL: ['thighL', 0, -0.43, 0], footL: ['shinL', 0, -0.42, 0],
  thighR: ['hips', -0.1, -0.05, 0], shinR: ['thighR', 0, -0.43, 0], footR: ['shinR', 0, -0.42, 0],
};
const worldBind = {};
for (const b of BONES) { const [p, x, y, z] = BIND[b]; const pw = p ? worldBind[p] : [0, 0, 0]; worldBind[b] = [pw[0] + x, pw[1] + y, pw[2] + z]; }

function skinPart(g, bone, col) {
  g = g.index ? g.toNonIndexed() : g;
  const n = g.attributes.position.count;
  const c = new THREE.Color(col);
  const ca = new Float32Array(n * 3), si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) { ca[i * 3] = c.r; ca[i * 3 + 1] = c.g; ca[i * 3 + 2] = c.b; si[i * 4] = BI[bone]; sw[i * 4] = 1; }
  g.setAttribute('color', new THREE.BufferAttribute(ca, 3));
  g.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
  g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
  if (g.attributes.uv) g.deleteAttribute('uv');
  return g;
}
// limb segment from bone origin downwards along -y
function limb(bone, len, r0, r1, col, seg = 7, off = [0, 0, 0]) {
  const g = new THREE.CylinderGeometry(r0, r1, len, seg, 1);
  const w = worldBind[bone];
  g.translate(w[0] + off[0], w[1] - len / 2 + off[1], w[2] + off[2]);
  return skinPart(g, bone, col);
}
function blob(bone, sx, sy, sz, x, y, z, col, detail = 1) {
  const g = new THREE.IcosahedronGeometry(1, detail);
  g.scale(sx, sy, sz);
  const w = worldBind[bone];
  g.translate(w[0] + x, w[1] + y, w[2] + z);
  return skinPart(g, bone, col);
}
function cube(bone, sx, sy, sz, x, y, z, col) {
  const g = new THREE.BoxGeometry(sx, sy, sz);
  const w = worldBind[bone];
  g.translate(w[0] + x, w[1] + y, w[2] + z);
  return skinPart(g, bone, col);
}

export const SKIN = { pale: 0xb8b0a0, grey: 0x9a9a88, green: 0x8a9a7a, dark: 0x7a6a5a, tan: 0xc8a888, human: 0xd8b494, humanDark: 0x8a6448 };

// Build humanoid geometry. o: {skin, shirt, pants, shoes, hair, zombie, bulk, rng}
export function humanGeometry(o) {
  const r = o.rand || Math.random;
  const bulk = o.bulk || 1;
  const P = [];
  const skin = o.skin, shirt = o.shirt, pants = o.pants;
  const blood = 0x4a0e0a;
  // torso
  P.push(blob('hips', 0.17 * bulk, 0.12, 0.11 * bulk, 0, 0.0, 0, pants));
  P.push(blob('spine', 0.16 * bulk, 0.14, 0.1 * bulk, 0, 0.08, 0, shirt));
  P.push(blob('chest', 0.2 * bulk, 0.17, 0.12 * bulk, 0, 0.06, 0, shirt));
  P.push(blob('chest', 0.12 * bulk, 0.06, 0.08, 0.13, 0.16, 0, shirt));
  P.push(blob('chest', 0.12 * bulk, 0.06, 0.08, -0.13, 0.16, 0, shirt));
  P.push(limb('neck', 0.1, 0.05, 0.055, skin, 6, [0, 0.07, 0]));
  // head
  P.push(blob('head', 0.105, 0.125, 0.115, 0, 0.12, 0.005, skin, 2));
  P.push(cube('head', 0.12, 0.05, 0.06, 0, 0.03, 0.06, skin)); // jaw
  P.push(cube('head', 0.03, 0.04, 0.04, 0, 0.11, 0.12, skin)); // nose
  const eye = o.zombie ? 0xd8d4b8 : 0x1a1a1a;
  P.push(cube('head', 0.03, 0.018, 0.01, 0.04, 0.14, 0.11, eye));
  P.push(cube('head', 0.03, 0.018, 0.01, -0.04, 0.14, 0.11, eye));
  if (o.hair !== undefined && o.hair !== null) P.push(blob('head', 0.112, 0.08, 0.12, 0, 0.18, -0.01, o.hair));
  if (o.cap) P.push(cube('head', 0.24, 0.06, 0.26, 0, 0.23, 0.02, o.cap));
  // arms (sleeves may be torn on zombies)
  for (const s of ['L', 'R']) {
    const bare = o.zombie && r() < 0.35;
    P.push(blob('arm' + s, 0.07 * bulk, 0.07, 0.07, 0, -0.01, 0, shirt));
    P.push(limb('arm' + s, 0.29, 0.06 * bulk, 0.048 * bulk, bare ? skin : shirt));
    P.push(limb('fore' + s, 0.26, 0.047 * bulk, 0.036 * bulk, o.longSleeve && !bare ? shirt : skin));
    P.push(cube('hand' + s, 0.07, 0.1, 0.035, 0, -0.05, 0.005, skin));
    P.push(limb('thigh' + s, 0.43, 0.085 * bulk, 0.064 * bulk, pants, 8));
    P.push(limb('shin' + s, 0.42, 0.062 * bulk, 0.045, o.zombie && r() < 0.25 ? skin : pants, 7));
    P.push(cube('foot' + s, 0.1, 0.075, 0.25, 0, -0.04, 0.06, o.shoes));
  }
  if (o.zombie) {
    // blood stains and wounds
    for (let i = 0; i < 5; i++) {
      const bone = ['chest', 'spine', 'chest', 'hips', 'head'][i];
      P.push(blob(bone, r() * 0.06 + 0.04, r() * 0.06 + 0.03, 0.02, (r() - 0.5) * 0.2, (r() - 0.3) * 0.15, bone === 'head' ? 0.1 : 0.115 * bulk, blood, 0));
    }
    P.push(cube('head', 0.06, 0.02, 0.01, 0, 0.05, 0.115, blood));
  }
  if (o.vest) { P.push(blob('chest', 0.21 * bulk, 0.16, 0.13 * bulk, 0, 0.05, 0, o.vest)); }
  if (o.backpack) P.push(cube('chest', 0.3, 0.38, 0.16, 0, 0.0, -0.2, o.backpack));
  const g = mergeGeometries(P);
  g.computeVertexNormals();
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.9, 0), 2.2);
  return g;
}

function makeBones() {
  const bones = {};
  for (const b of BONES) {
    const bone = new THREE.Bone();
    bone.name = b;
    const [p, x, y, z] = BIND[b];
    bone.position.set(x, y, z);
    bones[b] = bone;
    if (p) bones[p].add(bone);
  }
  return bones;
}

// A character instance (zombie, remote player or the local player's body).
export class Character {
  constructor(geo, mat, scale = 1) {
    const bones = makeBones();
    this.b = bones;
    const list = BONES.map(n => bones[n]);
    this.mesh = new THREE.SkinnedMesh(geo, mat);
    this.mesh.add(bones.root);
    this.mesh.bind(new THREE.Skeleton(list));
    this.mesh.castShadow = true;
    this.mesh.frustumCulled = true;
    this.root = new THREE.Group();
    this.root.add(this.mesh);
    this.mesh.scale.setScalar(scale);
    this.phase = Math.random() * 6;
    this.t = Math.random() * 10;
    this.fall = 0; this.fallDir = 1;
    this.limp = Math.random() < 0.4 ? 0.5 + Math.random() * 0.4 : 1;
    this.headTilt = (Math.random() - 0.5) * 0.6;
    this.armOff = Math.random() * 0.4;
    this.hipsY = BIND.hips[2];
    this.swing = 0; this.swingT = 0;
  }

  // zombie animation. s: {state, speed, hitT, atk, dead, run}
  animZombie(dt, s) {
    const b = this.b;
    this.t += dt;
    const t = this.t;
    reset(b, this.hipsY);
    if (s.dead) {
      this.fall = Math.min(1, this.fall + dt * 1.8);
      const e = 1 - Math.pow(1 - this.fall, 3);
      b.root.rotation.x = -this.fallDir * e * Math.PI / 2;
      b.root.position.y = e * 0.1;
      b.armL.rotation.z = 0.9 * e; b.armR.rotation.z = -1.2 * e; b.armL.rotation.x = -0.6 * e;
      b.thighL.rotation.x = -0.3 * e; b.shinL.rotation.x = 0.6 * e; b.thighR.rotation.z = -0.2 * e;
      b.head.rotation.y = 0.8 * e; b.head.rotation.x = this.fallDir * 0.3 * e;
      return;
    }
    const sp = s.speed || 0;
    const running = sp > 2.4;
    this.phase += dt * (running ? sp * 2.4 : sp * 4.2 + 0.0001);
    const ph = this.phase;
    const amp = Math.min(1, sp / (running ? 4 : 1.2));
    const lean = running ? 0.42 : 0.2;
    b.spine.rotation.x = lean * amp + 0.12;
    b.chest.rotation.x = 0.08;
    b.head.rotation.z = this.headTilt + Math.sin(t * 0.9) * 0.08;
    b.head.rotation.x = -0.25 * amp + Math.sin(t * 1.3) * 0.05;
    // legs
    const sw = running ? 0.75 : 0.42;
    b.thighL.rotation.x = Math.sin(ph) * sw * amp;
    b.thighR.rotation.x = -Math.sin(ph) * sw * amp * this.limp;
    b.shinL.rotation.x = Math.max(0, -Math.cos(ph)) * (running ? 1.4 : 0.7) * amp + 0.05;
    b.shinR.rotation.x = Math.max(0, Math.cos(ph)) * (running ? 1.4 : 0.7) * amp * this.limp + 0.05;
    b.hips.position.y = this.hipsY - Math.abs(Math.sin(ph)) * 0.04 * amp;
    b.hips.rotation.y = Math.sin(ph) * 0.12 * amp;
    b.hips.rotation.z = Math.sin(ph) * 0.05 * amp * (2 - this.limp);
    // arms: reaching forward
    if (running) {
      b.armL.rotation.x = -0.9 - Math.sin(ph) * 0.6; b.armR.rotation.x = -0.9 + Math.sin(ph) * 0.6;
      b.foreL.rotation.x = -0.6; b.foreR.rotation.x = -0.6;
    } else {
      const reach = s.state === 'idle' ? 0.35 : 1.25;
      b.armL.rotation.x = -reach - this.armOff + Math.sin(t * 1.7 + 1) * 0.08;
      b.armR.rotation.x = -reach + Math.sin(t * 1.5) * 0.1;
      b.foreL.rotation.x = -0.25; b.foreR.rotation.x = -0.35;
      b.armL.rotation.z = 0.12; b.armR.rotation.z = -0.12;
    }
    if (s.state === 'idle') { b.spine.rotation.z = Math.sin(t * 0.6) * 0.07; b.spine.rotation.x = 0.18 + Math.sin(t * 0.4) * 0.05; }
    if (s.state === 'attack') {
      const a = s.atk || 0;
      const up = a < 0.4 ? a / 0.4 : Math.max(0, 1 - (a - 0.4) / 0.2);
      const strike = a > 0.4 ? Math.min(1, (a - 0.4) / 0.15) * Math.max(0, 1 - (a - 0.6) / 0.4) : 0;
      b.armL.rotation.x = -1.2 - up * 1.3 + strike * 1.6; b.armR.rotation.x = -1.4 - up * 1.1 + strike * 1.5;
      b.spine.rotation.x = 0.1 - up * 0.2 + strike * 0.6;
      b.head.rotation.x = strike * 0.4;
      b.thighR.rotation.x = -strike * 0.4;
    }
    if (s.state === 'stagger' || s.hitT > 0) {
      const k = s.state === 'stagger' ? 1 : (s.hitT / 0.3);
      b.spine.rotation.x -= 0.5 * k; b.head.rotation.x -= 0.5 * k; b.armL.rotation.x += 0.8 * k; b.armR.rotation.x += 0.6 * k; b.armL.rotation.z = 0.6 * k;
    }
  }

  // human animation for survivors. s: {speed, crouch, weapon kind ('gun','melee','none'), aim, swing 0..1, fire 0..1, air}
  animHuman(dt, s) {
    const b = this.b;
    this.t += dt;
    reset(b, this.hipsY);
    if (s.dead) { this.fall = Math.min(1, this.fall + dt * 1.8); const e = this.fall; b.root.rotation.x = -e * Math.PI / 2; return; }
    const sp = s.speed || 0;
    const run = sp > 4;
    this.phase += dt * (run ? sp * 2.0 : sp * 3.0);
    const ph = this.phase;
    const amp = Math.min(1, sp / 3);
    const sw = run ? 0.8 : 0.5;
    b.thighL.rotation.x = Math.sin(ph) * sw * amp; b.thighR.rotation.x = -Math.sin(ph) * sw * amp;
    b.shinL.rotation.x = Math.max(0, -Math.cos(ph)) * (run ? 1.3 : 0.7) * amp;
    b.shinR.rotation.x = Math.max(0, Math.cos(ph)) * (run ? 1.3 : 0.7) * amp;
    b.armL.rotation.x = -Math.sin(ph) * 0.5 * amp; b.armR.rotation.x = Math.sin(ph) * 0.5 * amp;
    b.foreL.rotation.x = -0.3 - (run ? 0.7 : 0); b.foreR.rotation.x = -0.3 - (run ? 0.7 : 0);
    b.spine.rotation.x = run ? 0.25 : 0.05;
    b.hips.position.y = this.hipsY - Math.abs(Math.sin(ph)) * 0.03 * amp;
    if (s.crouch) {
      b.hips.position.y = this.hipsY - 0.38;
      b.thighL.rotation.x += -1.25; b.thighR.rotation.x += -1.25;
      b.shinL.rotation.x += 1.9; b.shinR.rotation.x += 1.9;
      b.footL.rotation.x = -0.6; b.footR.rotation.x = -0.6;
      b.spine.rotation.x = 0.35;
    }
    if (s.air) { b.thighL.rotation.x = -0.6; b.shinL.rotation.x = 1.0; b.thighR.rotation.x = 0.2; b.shinR.rotation.x = 0.5; }
    // upper body weapon pose
    const pitch = s.pitch || 0;
    if (s.weapon === 'gun') {
      b.armR.rotation.x = -1.45 - pitch * 0.9 - (s.fire || 0) * 0.15; b.armR.rotation.z = 0.15;
      b.foreR.rotation.x = -0.1;
      b.armL.rotation.x = -1.3 - pitch * 0.9; b.armL.rotation.z = -0.55; b.foreL.rotation.x = -0.5;
      b.chest.rotation.y = 0.15;
    } else if (s.weapon === 'melee') {
      const k = s.swing || 0;
      const raise = k < 0.35 ? k / 0.35 : Math.max(0, 1 - (k - 0.35) / 0.3);
      b.armR.rotation.x = -0.7 - raise * 1.8 + (k > 0.35 ? (k - 0.35) * 2.5 : 0);
      b.armR.rotation.z = 0.25 + raise * 0.4;
      b.foreR.rotation.x = -0.9 + raise * 0.4;
      b.chest.rotation.y = -raise * 0.5 + (k > 0.35 ? Math.min(0.5, (k - 0.35) * 2) : 0);
    }
    b.head.rotation.x = pitch * 0.6;
  }
}

function reset(b, hy) {
  for (const k in b) { b[k].rotation.set(0, 0, 0); }
  b.hips.position.y = hy;
  b.root.position.y = 0;
}

export const ZOMBIE_LOOKS = [
  { skin: SKIN.pale, shirt: 0x5a6a7a, pants: 0x2e3440, shoes: 0x2a2420, hair: 0x2a2018 },
  { skin: SKIN.grey, shirt: 0x8a3a2a, pants: 0x3a3a3a, shoes: 0x1a1a1a, hair: null },
  { skin: SKIN.green, shirt: 0xb8b0a0, pants: 0x4a5a6a, shoes: 0x3a2a20, hair: 0x5a4a30, longSleeve: true },
  { skin: SKIN.dark, shirt: 0x2a4a3a, pants: 0x6a5a4a, shoes: 0x2a2a2a, hair: 0x101010 },
  { skin: SKIN.pale, shirt: 0xc8c8d0, pants: 0x8aa0b8, shoes: 0xd8d8d8, hair: 0x8a6a40, longSleeve: true }, // hospital gown-ish
  { skin: SKIN.grey, shirt: 0x2a2a4a, pants: 0x2a2a4a, shoes: 0x101010, hair: 0x3a3028, cap: 0x1a1a3a, vest: 0x3a3a3a }, // cop
  { skin: SKIN.tan, shirt: 0xc8a020, pants: 0x3a4a5a, shoes: 0x3a2a1a, hair: null, cap: 0xc8a020 }, // worker
];

export const SURVIVOR_LOOKS = [
  { skin: SKIN.human, shirt: 0x4a5a3a, pants: 0x2e3a4a, shoes: 0x3a2a1a, hair: 0x3a2818, longSleeve: true, backpack: 0x3a3428 },
  { skin: SKIN.humanDark, shirt: 0x8a3a2a, pants: 0x3a3a3a, shoes: 0x1a1a1a, hair: 0x101010, longSleeve: true, backpack: 0x2a3a4a },
  { skin: SKIN.human, shirt: 0x2a4a7a, pants: 0x4a4038, shoes: 0x2a2a2a, hair: 0x8a6a30, longSleeve: true, backpack: 0x4a3a2a, cap: 0x2a2a2a },
  { skin: SKIN.tan, shirt: 0x6a6a6a, pants: 0x2a3a2a, shoes: 0x3a2a1a, hair: 0x2a1a10, longSleeve: true, backpack: 0x5a4a3a, vest: 0x3a4a3a },
];
