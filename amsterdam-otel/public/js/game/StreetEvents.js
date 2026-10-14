import * as THREE from 'three';
import { ALLEY } from '/shared/layout.js';
import { STAGE } from '/shared/stage.js';

// ---- Kollar (kalabalık ve müzisyenler için) ---------------------------------------------
// Characters.js'teki kapsül karakterlerin kolu yok; dans / alkış / enstrüman çalmak için
// omuzdan dönen iki basit kol eklenir. Geometri tüm karakterler arasında paylaşılır.
let ARM = null;
const armMats = new Map();
function armMat(color) {
  let m = armMats.get(color);
  if (!m) {
    m = new THREE.MeshLambertMaterial({ color });
    armMats.set(color, m);
  }
  return m;
}

/**
 * Karakterin `inner` grubuna iki kol ekler (omuz pivotu y 1.1). Kolun dinlenme hâli aşağı sarkar;
 * pivot.rotation.x < 0 → öne kalkar, |rotation.z| → yana açılır. Karakterin önü +Z, sağ eli −X.
 * @returns {{ l: THREE.Group, r: THREE.Group }}
 */
export function addArms(obj, sleeve, skin) {
  if (!ARM) {
    ARM = {
      arm: new THREE.CapsuleGeometry(0.052, 0.34, 2, 6).translate(0, -0.22, 0),
      hand: new THREE.SphereGeometry(0.055, 8, 6).translate(0, -0.45, 0),
    };
  }
  const inner = obj.userData.inner;
  const mk = (side) => {
    const pivot = new THREE.Group();
    pivot.position.set(side * 0.255, 1.1, 0.0);
    pivot.add(new THREE.Mesh(ARM.arm, armMat(sleeve)), new THREE.Mesh(ARM.hand, armMat(skin)));
    pivot.rotation.z = side * 0.08;
    inner.add(pivot);
    return pivot;
  };
  const arms = { l: mk(1), r: mk(-1) };
  obj.userData.arms = arms;
  return arms;
}

const _frustum = new THREE.Frustum();
const _pv = new THREE.Matrix4();
const _sphere = new THREE.Sphere(new THREE.Vector3(STAGE.front[0], 1.2, STAGE.front[1] + 1.2), 5.2);
const BACK = [(ALLEY.backDoor.from + ALLEY.backDoor.to) / 2, 26];

/** id'den deterministik [0,1) (her istemcide aynı dans varyasyonu) */
function rnd(id, k) {
  let x = Math.imul((id + 1) * 2654435761 + k * 40503, 0x85ebca6b);
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

/**
 * Sokak etkinlikleri — konser kalabalığı (istemci).
 *  - Sunucu kalabalık NPC'lerini misafirlerle aynı biçimde yayınlar (GUEST_UPSERT, kind: 'crowd');
 *    GuestView yürüyüşü oynatır (rota + zaman damgası). Bu sistem her birine kol ekler ve
 *    yerine varanları (faz 'c-dance' / 'c-clap') müziğin vuruşuna göre dans ettirir / alkışlatır:
 *    zıplama, kalça sallama, el kaldırma, alkış. Varyasyon id'den deterministiktir.
 *  - Kalabalık otelin arka kapısından geçerken kapı açılır (PlayerHouses.updateBackDoor sarılır).
 * Pil: animasyon YALNIZCA set çalarken, oyuncu sahneye ANIM_RANGE (30 m) içindeyken ve kalabalık
 * kameranın görüş alanındayken; aksi halde update false döner ve motor uyuyabilir.
 */
export class StreetEvents {
  constructor({ guests, world, player, camera, stage, settings }) {
    this.guests = guests;
    this.player = player;
    this.camera = camera;
    this.stage = stage; // LiveStageSystem: beatAt(), playing
    this.settings = settings;
    this.crowd = new Map(); // id → GuestView öğesi
    this.animating = false;

    const orig = guests.upsert.bind(guests);
    guests.upsert = (data) => {
      orig(data);
      if (data.kind !== 'crowd') return;
      const it = guests.items.get(data.id);
      if (!it) return;
      if (!it.obj.userData.arms) {
        const u = it.obj.userData;
        const sleeve = u.inner.children[0].material.color.getStyle();
        const skin = u.inner.children[1].material.color.getStyle();
        addArms(it.obj, sleeve, skin);
      }
      this.crowd.set(data.id, it);
      this.resetPose(it);
    };
    const origRemove = guests.remove.bind(guests);
    guests.remove = (id) => {
      this.crowd.delete(id);
      origRemove(id);
    };
    const origClear = guests.clear.bind(guests);
    guests.clear = () => {
      this.crowd.clear();
      origClear();
    };

    // Kalabalık arka kapıdan geçerken kapı açılsın (oyuncu yakında değilken de)
    const ph = world.playerHouses;
    const origDoor = ph.updateBackDoor.bind(ph);
    ph.updateBackDoor = (dt, px, pz) => (this.nearBackDoor() ? origDoor(dt, BACK[0], BACK[1]) : origDoor(dt, px, pz));
  }

  nearBackDoor() {
    for (const it of this.crowd.values()) {
      const p = it.obj.position;
      if (Math.abs(p.x - BACK[0]) < 1.2 && Math.abs(p.z - BACK[1]) < 2.0) return true;
    }
    return false;
  }

  resetPose(it) {
    const { arms, inner } = it.obj.userData;
    inner.rotation.set(0, 0, 0);
    arms.l.rotation.set(0, 0, 0.08);
    arms.r.rotation.set(0, 0, -0.08);
  }

  get count() { return this.crowd.size; }

  /** @returns {boolean} bu karede dans animasyonu çizildi mi */
  update() {
    this.animating = false;
    if (!this.crowd.size) return false;
    const beat = this.stage.beatAt();
    if (beat === null) return false;
    const p = this.player.pos;
    if (Math.hypot(p.x - STAGE.front[0], p.z - STAGE.front[1]) > STAGE.ANIM_RANGE) return false;
    const cam = this.camera;
    cam.updateMatrixWorld();
    _pv.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    _frustum.setFromProjectionMatrix(_pv);
    if (!_frustum.intersectsSphere(_sphere)) return false;
    const amp = this.settings?.reduceMotion ? 0.5 : 1;
    for (const it of this.crowd.values()) {
      const d = it.data;
      if (d.phase !== 'c-dance' && d.phase !== 'c-clap') continue;
      this.animate(it, d, beat, amp);
      this.animating = true;
    }
    return this.animating;
  }

  animate(it, d, beat, amp) {
    const { inner, arms } = it.obj.userData;
    const id = d.id;
    const ph = rnd(id, 1) * 0.5; // vuruşa göre küçük faz kayması (herkes aynı anda zıplamasın)
    const b = beat + ph;
    const bounce = Math.abs(Math.sin(Math.PI * b));
    const sway = Math.sin((Math.PI * b) / 2);
    if (d.phase === 'c-clap') {
      // Alkış: eller önde, her vuruşta birleşir; hafif sallanma
      inner.position.y = 0.012 * bounce * amp;
      inner.rotation.z = 0.05 * sway * amp;
      it.obj.rotation.y = d.face + 0.08 * sway * amp;
      const clap = Math.pow(Math.max(0, Math.cos(Math.PI * 2 * b)), 3);
      arms.l.rotation.set(-1.15, 0, 0.42 - 0.38 * clap);
      arms.r.rotation.set(-1.15, 0, -0.42 + 0.38 * clap);
      return;
    }
    // Dans: zıplama + kalça sallama; kimi kollarını havaya kaldırır, kimi önde sallar
    const style = Math.floor(rnd(id, 2) * 3);
    inner.position.y = 0.06 * bounce * amp;
    inner.rotation.z = 0.09 * sway * amp;
    inner.rotation.x = -0.05 * bounce * amp;
    it.obj.rotation.y = d.face + 0.25 * Math.sin((Math.PI * b) / 4 + rnd(id, 3) * 6) * amp;
    if (style === 0) {
      // Eller havada, vuruşla iki yana
      arms.l.rotation.set(-2.7 + 0.2 * bounce, 0, 0.3 + 0.25 * sway * amp);
      arms.r.rotation.set(-2.7 + 0.2 * bounce, 0, -0.3 + 0.25 * sway * amp);
    } else if (style === 1) {
      // Kollar önde, sırayla (koşar gibi)
      arms.l.rotation.set(-0.9 - 0.5 * Math.sin(Math.PI * b) * amp, 0, 0.2);
      arms.r.rotation.set(-0.9 + 0.5 * Math.sin(Math.PI * b) * amp, 0, -0.2);
    } else {
      // Tek el havada (yumruk pompalama), diğeri belde
      arms.r.rotation.set(-2.5 + 0.45 * bounce * amp, 0, -0.15);
      arms.l.rotation.set(-0.35, 0, 0.55);
    }
  }
}
