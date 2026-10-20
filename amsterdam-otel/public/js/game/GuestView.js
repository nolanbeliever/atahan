import * as THREE from 'three';
import { GUEST_PHASE } from '/shared/constants.js';
import { pathLength, samplePath } from '/shared/path.js';
import { makeCharacter } from './Characters.js';
import { makeLabel } from './RemotePlayers.js';

// Otel / restoran personeli görünümü (misafirlerle aynı ağ biçimi, kind ile ayrılır)
const KIND_OPTS = {
  worker: { color: '#2b6d8a', staff: true, bag: false },
  chef: { color: '#f3f1ea', bag: false }, // beyaz aşçı ceketi (şapka: GourmetRestaurant)
  waiter: { color: '#23262d', staff: true, bag: false }, // siyah yelek + önlük
  barman: { color: '#1b1c20', staff: true, bag: false }, // barmen: siyah gömlek + önlük (Personel 2.0)
  bouncer: { color: '#111214', bag: false }, // bouncer: siyah takım (VIP Bouncer)
};
const LABEL_COLOR = { worker: '#3ecf6e', chef: '#ffcf6b', waiter: '#9fd3ff', barman: '#ff9be8', bouncer: '#c9b8ff' };

// Turist (InstaHotel kampanyası kafilesi): sırt çantası, boyunda fotoğraf makinesi, renkli güneş şapkası.
// Geometri / malzemeler tüm turistlerde paylaşılır (ilk turistte bir kez üretilir).
const HAT_COLORS = ['#f2c14e', '#e85d75', '#4fb3bf', '#f08a24', '#8bc34a'];
let touristKit = null;
function addTouristProps(obj, id) {
  if (!touristKit) {
    const lambert = (color) => new THREE.MeshLambertMaterial({ color });
    touristKit = {
      pack: new THREE.BoxGeometry(0.34, 0.42, 0.18).translate(0, 0.98, -0.3),
      strap: new THREE.TorusGeometry(0.11, 0.012, 4, 12).translate(0, 1.18, 0.13),
      cam: new THREE.BoxGeometry(0.16, 0.1, 0.07).translate(0, 1.03, 0.25),
      lens: new THREE.CylinderGeometry(0.035, 0.035, 0.05, 10).rotateX(Math.PI / 2).translate(0, 1.03, 0.3),
      hat: new THREE.CylinderGeometry(0.14, 0.24, 0.12, 14).translate(0, 1.53, 0),
      packMat: lambert('#3d6b4f'),
      camMat: lambert('#1c1c1f'),
      hatMats: HAT_COLORS.map(lambert),
    };
  }
  const k = touristKit;
  const inner = obj.userData.inner;
  inner.add(new THREE.Mesh(k.pack, k.packMat));
  inner.add(new THREE.Mesh(k.strap, k.camMat));
  inner.add(new THREE.Mesh(k.cam, k.camMat));
  inner.add(new THREE.Mesh(k.lens, k.camMat));
  inner.add(new THREE.Mesh(k.hat, k.hatMats[id % k.hatMats.length]));
}

// VIP misafir (Ultra Lüks Gökdelen): altın şapka bandı + altın kuşak, valizde altın şerit
let vipKit = null;
function addVipProps(obj) {
  if (!vipKit) {
    const gold = new THREE.MeshLambertMaterial({ color: '#d9b24a' });
    vipKit = {
      sash: new THREE.TorusGeometry(0.225, 0.025, 4, 16).rotateX(Math.PI / 2).rotateZ(0.5).translate(0, 0.85, 0),
      crown: new THREE.CylinderGeometry(0.16, 0.17, 0.05, 12).translate(0, 1.5, 0),
      glasses: new THREE.BoxGeometry(0.2, 0.04, 0.02).translate(0, 1.39, 0.15),
      gold,
      dark: new THREE.MeshLambertMaterial({ color: '#111' }),
    };
  }
  const inner = obj.userData.inner;
  inner.add(new THREE.Mesh(vipKit.sash, vipKit.gold), new THREE.Mesh(vipKit.crown, vipKit.gold), new THREE.Mesh(vipKit.glasses, vipKit.dark));
}

const SIT_DROP = 0.4; // kanepe; bar taburesi kendi yüksekliğini (sitY) gönderir
const _frustum = new THREE.Frustum();
const _pv = new THREE.Matrix4();
const _sphere = new THREE.Sphere(new THREE.Vector3(), 1.1);

/**
 * Misafirlerin görsel temsili. Konumlar sunucudan gelen rota + başlangıç
 * zamanından deterministik olarak hesaplanır (karede ağ trafiği yok).
 * Render döngüsünü yalnızca KAMERANIN GÖRDÜĞÜ yürüyen misafir varken aktif tutar
 * (bar müşterileri sürekli gelip gittiği için; görünmeyenin konumu zaten zamandan
 * hesaplanır, kamera dönünce doğru yerde çizilir).
 */
export class GuestView {
  constructor(scene) {
    this.scene = scene;
    this.items = new Map();
    this._s = { x: 0, z: 0, dirX: 0, dirZ: 1, done: false };
  }

  upsert(data) {
    let it = this.items.get(data.id);
    if (!it) {
      const obj = makeCharacter(data.look, KIND_OPTS[data.kind] ?? {});
      if (data.tourist === true) addTouristProps(obj, data.id | 0);
      if (data.vip === true) addVipProps(obj);
      this.scene.add(obj);
      it = { obj, data: null, len: 0, label: null, labelText: null };
      this.items.set(data.id, it);
    }
    // İsim etiketi (temizlikçi "🧹 Fatma · Sv.2"): yalnızca metin değişince yeniden çizilir
    if ((data.label ?? null) !== it.labelText) {
      this.dropLabel(it);
      it.labelText = data.label ?? null;
      if (it.labelText) {
        it.label = makeLabel(it.labelText, LABEL_COLOR[data.kind] ?? '#ffd27a');
        it.label.scale.set(1.3, 0.33, 1);
        it.label.position.y = 2.0;
        it.obj.add(it.label);
      }
    }
    it.data = data;
    it.len = pathLength(data.path);
    it.obj.visible = data.phase !== GUEST_PHASE.IN_ROOM;
    const u = it.obj.userData;
    const y = data.sit ? (data.sitY ?? -SIT_DROP) : 0;
    it.obj.position.y = y;
    if (u.bag) u.bag.position.y = -y; // çanta yerde kalsın
    u.blob.visible = !data.sit;
    u.inner.position.y = 0;
    if (data.path.length === 1) {
      it.obj.position.x = data.path[0][0];
      it.obj.position.z = data.path[0][1];
      it.obj.rotation.y = data.face || 0;
    }
  }

  dropLabel(it) {
    if (!it.label) return;
    it.obj.remove(it.label);
    it.label.material.map.dispose();
    it.label.material.dispose();
    it.label = null;
  }

  remove(id) {
    const it = this.items.get(id);
    if (!it) return;
    this.dropLabel(it);
    this.scene.remove(it.obj);
    this.items.delete(id);
  }

  clear() {
    for (const id of [...this.items.keys()]) this.remove(id);
  }

  /** @returns {boolean} görünür yürüyen misafir var mı */
  update(dt, serverNow, camera = null) {
    let active = false;
    const s = this._s;
    if (camera) {
      camera.updateMatrixWorld();
      _pv.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      _frustum.setFromProjectionMatrix(_pv);
    }
    for (const it of this.items.values()) {
      const d = it.data;
      if (!it.obj.visible || d.path.length < 2) continue;
      const dist = Math.max(0, ((serverNow - d.t0) / 1000) * d.speed);
      samplePath(d.path, dist, s);
      it.obj.position.x = s.x;
      it.obj.position.z = s.z;
      it.obj.rotation.y = Math.atan2(s.dirX, s.dirZ);
      const walking = dist < it.len;
      it.obj.userData.inner.position.y = walking ? Math.abs(Math.sin(dist * 4.2)) * 0.035 : 0;
      // Yürüyorsa ya da bu karede vardıysa (son pozu çizmek için) ve görüş alanındaysa
      if (walking || it.walking) {
        _sphere.center.set(s.x, 0.8, s.z);
        if (!camera || _frustum.intersectsSphere(_sphere)) active = true;
      }
      it.walking = walking;
    }
    return active;
  }

  /** (x,z) noktasına r metreden yakın görünür misafir var mı (kapılar için) */
  near(x, z, r) {
    const r2 = r * r;
    for (const it of this.items.values()) {
      if (!it.obj.visible) continue;
      const dx = it.obj.position.x - x;
      const dz = it.obj.position.z - z;
      if (dx * dx + dz * dz < r2) return true;
    }
    return false;
  }
}
