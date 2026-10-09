import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();

/**
 * Statik geometri birleştirici.
 * Aynı malzemeyi kullanan TÜM statik parçalar (duvarlar, zeminler, mobilyalar)
 * tek bir geometride birleştirilir → yüzlerce mesh yerine malzeme başına
 * bir draw call. Mobil GPU/CPU yükünü en çok düşüren tek optimizasyon budur.
 */
export class StaticBatcher {
  constructor() {
    this.groups = new Map();
  }

  /**
   * Geometriyi dönüştürüp gruba ekler. Geometrinin sahipliği batcher'a geçer.
   * @param {object} o  position, rotation, scale, uvScale (dünya-ölçekli UV), cast, receive
   */
  add(matKey, geometry, o = {}) {
    const { position = [0, 0, 0], rotation = [0, 0, 0], scale = [1, 1, 1], uvScale = 0, cast = true, receive = true } = o;
    _m.compose(_p.fromArray(position), _q.setFromEuler(_e.set(rotation[0], rotation[1], rotation[2])), _s.fromArray(scale));
    geometry.applyMatrix4(_m);
    if (uvScale) worldUV(geometry, uvScale);
    const key = `${matKey}|${cast ? 1 : 0}|${receive ? 1 : 0}`;
    let g = this.groups.get(key);
    if (!g) {
      g = { matKey, cast, receive, list: [] };
      this.groups.set(key, g);
    }
    g.list.push(geometry);
  }

  /** Eksene hizalı kutu (min/max koordinatlarla) */
  box(matKey, minX, maxX, minY, maxY, minZ, maxZ, o = {}) {
    const geo = new THREE.BoxGeometry(maxX - minX, maxY - minY, maxZ - minZ);
    this.add(matKey, geo, { ...o, position: [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2] });
  }

  /** Yatay düzlem (zemin: yukarı bakar, tavan: aşağı bakar) */
  floor(matKey, minX, maxX, minZ, maxZ, y, o = {}) {
    const geo = new THREE.PlaneGeometry(maxX - minX, maxZ - minZ);
    const down = o.facingDown === true;
    this.add(matKey, geo, {
      cast: false,
      ...o,
      position: [(minX + maxX) / 2, y, (minZ + maxZ) / 2],
      rotation: [down ? Math.PI / 2 : -Math.PI / 2, 0, 0],
    });
  }

  build(materials, parent) {
    const meshes = [];
    for (const g of this.groups.values()) {
      let list = g.list;
      // Karışık indeksli/indekssiz geometriler birleştirilemez → hepsini indekssiz yap
      if (list.some((x) => x.index) && list.some((x) => !x.index)) {
        list = list.map((x) => (x.index ? x.toNonIndexed() : x));
      }
      const merged = mergeGeometries(list, false);
      for (const x of g.list) x.dispose();
      if (!merged) {
        console.warn('Birleştirme başarısız:', g.matKey);
        continue;
      }
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, materials[g.matKey]);
      mesh.castShadow = g.cast;
      mesh.receiveShadow = g.receive;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      mesh.name = `static:${g.matKey}`;
      parent.add(mesh);
      meshes.push(mesh);
    }
    this.groups.clear();
    return meshes;
  }
}

/**
 * Dünya koordinatlarından UV üretir (kutu izdüşümü). Böylece bitişik
 * duvarlar/zeminler birleştirildiğinde dokular dikişsiz ve doğru ölçekte döşenir.
 */
function worldUV(geo, scale) {
  const pos = geo.attributes.position;
  const nor = geo.attributes.normal;
  const uv = geo.attributes.uv;
  if (!uv) return;
  for (let i = 0; i < pos.count; i++) {
    const nx = Math.abs(nor.getX(i));
    const ny = Math.abs(nor.getY(i));
    const nz = Math.abs(nor.getZ(i));
    let u;
    let v;
    if (ny >= nx && ny >= nz) {
      u = pos.getX(i); v = pos.getZ(i);
    } else if (nx >= nz) {
      u = pos.getZ(i); v = pos.getY(i);
    } else {
      u = pos.getX(i); v = pos.getY(i);
    }
    uv.setXY(i, u * scale, v * scale);
  }
  uv.needsUpdate = true;
}
