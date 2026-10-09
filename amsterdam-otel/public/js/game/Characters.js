import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { makeBlobTexture } from '../world/Textures.js';

// Basit, düşük poligonlu karakterler (misafirler, resepsiyonist, diğer oyuncular).
// Geometriler ve malzemeler TÜM karakterler arasında paylaşılır.

export const BODY_COLORS = ['#e36f1e', '#2d4f7c', '#9c2f2f', '#3f7d3a', '#6a4c93', '#d9a441', '#3a3a3a', '#2b8a8a'];
export const SKIN_COLORS = ['#f1c7a5', '#e0ac83', '#c68c62', '#8d5a3b', '#5c3a24'];
export const HAIR_COLORS = ['#2b1d14', '#5a3a22', '#c9a063', '#8a8a8a', '#b5462f'];

let G = null;
let blobMat = null;
const mats = new Map();

function mat(color) {
  let m = mats.get(color);
  if (!m) {
    m = new THREE.MeshLambertMaterial({ color });
    mats.set(color, m);
  }
  return m;
}

function geos() {
  if (G) return G;
  const eyeL = new THREE.SphereGeometry(0.022, 6, 4).translate(-0.055, 1.39, 0.132);
  const eyeR = new THREE.SphereGeometry(0.022, 6, 4).translate(0.055, 1.39, 0.132);
  const hatTop = new THREE.CylinderGeometry(0.16, 0.17, 0.13, 12).translate(0, 1.56, 0);
  const hatBrim = new THREE.CylinderGeometry(0.26, 0.26, 0.02, 14).translate(0, 1.5, 0);
  const bag = new THREE.BoxGeometry(0.34, 0.44, 0.15).translate(0.36, 0.27, -0.02);
  const handle = new THREE.BoxGeometry(0.03, 0.42, 0.03).translate(0.36, 0.68, -0.02);
  G = {
    body: new THREE.CapsuleGeometry(0.22, 0.72, 3, 10).translate(0, 0.6, 0),
    head: new THREE.SphereGeometry(0.15, 12, 8).translate(0, 1.36, 0),
    hair: new THREE.SphereGeometry(0.158, 12, 5, 0, Math.PI * 2, 0, Math.PI * 0.5).translate(0, 1.375, -0.012),
    eyes: mergeGeometries([eyeL, eyeR]),
    hat: mergeGeometries([hatTop, hatBrim]),
    bag: mergeGeometries([bag, handle]),
    apron: new THREE.BoxGeometry(0.3, 0.5, 0.03).translate(0, 0.72, 0.205),
    blob: new THREE.PlaneGeometry(0.95, 0.95).rotateX(-Math.PI / 2).translate(0, 0.012, 0),
  };
  return G;
}

function blobMaterial() {
  if (!blobMat) {
    blobMat = new THREE.MeshBasicMaterial({ map: makeBlobTexture(), transparent: true, depthWrite: false });
  }
  return blobMat;
}

/**
 * @param look  { body, skin, hair, hat, bag } (indeksler) — misafirler için
 * @param opts  { color: gövde rengi (oyuncular), staff: önlük, bag: false }
 * Karakterin önü +Z yönüdür.
 */
export function makeCharacter(look = {}, opts = {}) {
  const g = geos();
  const group = new THREE.Group();
  const bodyColor = opts.color || BODY_COLORS[(look.body ?? 0) % BODY_COLORS.length];
  const skin = SKIN_COLORS[(look.skin ?? 0) % SKIN_COLORS.length];
  const hair = HAIR_COLORS[(look.hair ?? 0) % HAIR_COLORS.length];

  const inner = new THREE.Group(); // yürürken hafif zıplama için
  inner.add(new THREE.Mesh(g.body, mat(bodyColor)));
  inner.add(new THREE.Mesh(g.head, mat(skin)));
  inner.add(new THREE.Mesh(g.eyes, mat('#1a1a1a')));
  if (look.hat) inner.add(new THREE.Mesh(g.hat, mat('#2a2a2e')));
  else inner.add(new THREE.Mesh(g.hair, mat(hair)));
  if (opts.staff) inner.add(new THREE.Mesh(g.apron, mat('#f4f1ea')));
  group.add(inner);

  let bag = null;
  if (look.bag && opts.bag !== false) {
    bag = new THREE.Mesh(g.bag, mat('#7a5230'));
    group.add(bag);
  }

  const blob = new THREE.Mesh(g.blob, blobMaterial());
  blob.renderOrder = 1;
  group.add(blob);

  group.userData = { inner, bag, blob };
  return group;
}
