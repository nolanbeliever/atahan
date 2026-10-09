import * as THREE from 'three';
import { ROOM_STATUS } from '/shared/constants.js';
import { isInsideRoom } from '/shared/layout.js';
import { UV } from './Materials.js';
import { addWindow, addPainting, addSideTable } from './Props.js';

const STATUS_COLOR = {
  [ROOM_STATUS.EMPTY]: 0x3ecf6e,
  [ROOM_STATUS.OCCUPIED]: 0xe5534b,
  [ROOM_STATUS.DIRTY]: 0xe9a826,
};

export const TRASH_LABELS = ['Kâğıt topunu topla', 'Kutuyu topla', 'Pizza kutusunu topla', 'Şişeyi topla'];

let TRASH_GEO = null;
function trashGeometries() {
  if (!TRASH_GEO) {
    TRASH_GEO = [
      new THREE.SphereGeometry(0.09, 7, 5).scale(1, 0.8, 1).translate(0, 0.07, 0),
      new THREE.CylinderGeometry(0.035, 0.035, 0.12, 8).rotateZ(Math.PI / 2).translate(0, 0.035, 0),
      new THREE.BoxGeometry(0.36, 0.045, 0.36).translate(0, 0.023, 0),
      new THREE.CylinderGeometry(0.038, 0.038, 0.22, 8).rotateZ(Math.PI / 2).translate(0, 0.038, 0),
    ];
  }
  return TRASH_GEO;
}
const TRASH_MATS = ['paper', 'canRed', 'cardboard', 'bottle'];

const DOOR_OPEN = (Math.PI / 2) * 0.92;
const DOOR_SPEED = 3.2; // rad/sn
const BED_SPEED = 3.0; // geçiş/sn

/**
 * Tek bir müşteri odası: statik mobilyalar batcher'a eklenir; kapı, yatak
 * örtüsü/yastıklar, çöpler ve kapı yanındaki durum lambası dinamiktir.
 */
export class RoomView {
  constructor({ layout, batcher: b, scene, mats, collision, blanketMat, plateMat }) {
    this.layout = layout;
    this.id = layout.id;
    this.state = { status: ROOM_STATUS.EMPTY, bedMade: true, trash: [false, false, false, false] };
    const s = layout.side;
    const z0 = layout.bounds.minZ;
    const bed = layout.bed;

    // ---- Yatak (statik gövde) --------------------------------------
    const bx0 = bed.x - bed.len / 2;
    const bx1 = bed.x + bed.len / 2;
    const bz0 = bed.z - bed.wid / 2;
    const bz1 = bed.z + bed.wid / 2;
    const headX = s > 0 ? bx1 : bx0; // baş ucu dış duvarda
    b.box('wood', bx0, bx1, 0, 0.32, bz0, bz1, { uvScale: UV.wood });
    b.box('wood', Math.min(headX, headX - s * 0.09), Math.max(headX, headX - s * 0.09), 0, 1.15, bz0 - 0.03, bz1 + 0.03, { uvScale: UV.wood });
    // Şilte: baş tahtası tarafında 0.09 m boşluk
    const mx0 = s > 0 ? bx0 + 0.04 : bx0 + 0.09;
    const mx1 = s > 0 ? bx1 - 0.09 : bx1 - 0.04;
    b.box('linen', mx0, mx1, 0.32, 0.52, bz0 + 0.04, bz1 - 0.04, { cast: false });
    collision.add(bx0, bx1, bz0 - 0.03, bz1 + 0.03);

    // Komodinler + abajur
    const nsA = s > 0 ? bx1 - 0.5 : bx0;
    const nsB = s > 0 ? bx1 : bx0 + 0.5;
    for (const nz of [bz0 - 0.58, bz1 + 0.08]) {
      b.box('wood', nsA, nsB, 0, 0.55, nz, nz + 0.5, { uvScale: UV.wood });
      collision.add(nsA, nsB, nz, nz + 0.5);
    }
    const lampX = (nsA + nsB) / 2;
    b.add('brass', new THREE.CylinderGeometry(0.03, 0.07, 0.26, 8), { position: [lampX, 0.68, bz1 + 0.33] });
    b.add('lamp', new THREE.CylinderGeometry(0.09, 0.15, 0.18, 10, 1, true), { position: [lampX, 0.88, bz1 + 0.33], cast: false });

    // Gardırop (dış duvar + güney duvar köşesi)
    const wA = s > 0 ? 6.45 : -7.9;
    const wB = s > 0 ? 7.9 : -6.45;
    b.box('wood', wA, wB, 0, 2.1, z0 + 0.1, z0 + 0.72, { uvScale: UV.wood });
    b.box('brass', (wA + wB) / 2 - 0.08, (wA + wB) / 2 - 0.05, 1.0, 1.25, z0 + 0.72, z0 + 0.75, { cast: false });
    b.box('brass', (wA + wB) / 2 + 0.05, (wA + wB) / 2 + 0.08, 1.0, 1.25, z0 + 0.72, z0 + 0.75, { cast: false });
    collision.add(wA, wB, z0 + 0.1, z0 + 0.72);

    // Pencere (dış duvarda, kanal evleri manzarası) + yatak üstünde tablo
    const inner = s * 7.9;
    const face = s > 0 ? 'x-' : 'x+';
    addWindow(b, { x: inner, y: 1.7, z: layout.windowZ, w: 1.3, h: 1.4, facing: face, glass: 'skyline', uOffset: (Number(layout.id) % 4) * 0.23 });
    addPainting(b, { x: inner, y: 1.75, z: bed.z, w: 1.0, h: 0.73, facing: face });

    // Halı, çöp kovası, tavan lambası, koltuk + sehpa
    b.floor('rugBlue', Math.min(s * 4.3, s * 5.75), Math.max(s * 4.3, s * 5.75), bed.z - 0.95, bed.z + 0.95, 0.006, { cast: false });
    b.add('metal', new THREE.CylinderGeometry(0.15, 0.12, 0.36, 10, 1, true), { position: [s * 1.85, 0.18, z0 + 0.45] });
    collision.addAround(s * 1.85, z0 + 0.45, 0.16);
    b.add('lamp', new THREE.CylinderGeometry(0.22, 0.22, 0.03, 14), { position: [s * 4.75, 3.18, z0 + 3.5], cast: false });
    addSideTable(b, collision, s * 6.9, z0 + 6.45, false);

    // ---- Kapı (dinamik) ---------------------------------------------
    const door = layout.door;
    this.doorPivot = new THREE.Group();
    this.doorPivot.position.set(door.x, 0, door.z - 0.55);
    const leaf = new THREE.Mesh(new THREE.BoxGeometry(0.05, 2.18, 1.08), mats.roomDoor);
    leaf.position.set(0, 1.09, 0.54);
    const knob = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.05, 0.05), mats.brass);
    knob.position.set(0, 1.0, 0.95);
    this.doorPivot.add(leaf, knob);
    scene.add(this.doorPivot);
    this.doorAngle = DOOR_OPEN * s; // başlangıçta açık (oda boş)
    this.doorPivot.rotation.y = this.doorAngle;
    this.doorCollider = collision.add(door.x - 0.1, door.x + 0.1, door.z - 0.55, door.z + 0.55, false);

    // Koridor tarafı: oda numarası plakası + durum lambası
    const corridorFace = s * 1.385;
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.52, 0.24), plateMat);
    plate.position.set(corridorFace, 1.78, door.z + 0.82);
    plate.rotation.y = s > 0 ? -Math.PI / 2 : Math.PI / 2;
    this.statusMat = new THREE.MeshBasicMaterial({ color: STATUS_COLOR[ROOM_STATUS.EMPTY] });
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.13, 0.13), this.statusMat);
    lamp.position.set(corridorFace, 1.5, door.z + 0.82);
    for (const m of [plate, lamp]) {
      m.matrixAutoUpdate = false;
      m.updateMatrix();
      scene.add(m);
    }

    // ---- Yatak örtüsü ve yastıklar (dinamik) -------------------------
    this.blanket = new THREE.Mesh(new THREE.BoxGeometry(bed.len * 0.72, 0.07, bed.wid * 1.04), blanketMat);
    const pillowGeo = new THREE.BoxGeometry(0.42, 0.12, 0.62);
    this.pillows = [new THREE.Mesh(pillowGeo, mats.linen), new THREE.Mesh(pillowGeo, mats.linen)];
    scene.add(this.blanket, ...this.pillows);

    // Düzgün (made) ve dağınık (messy) pozlar
    this.poses = {
      blanket: [
        { p: [bed.x - s * bed.len * 0.14, 0.555, bed.z], r: [0, 0, 0], s: [1, 1, 1] },
        { p: [bed.x - s * bed.len * 0.33, 0.6, bed.z + 0.22], r: [0, 0.45, s * 0.1], s: [0.78, 2.3, 0.82] },
      ],
      pillow0: [
        { p: [bed.x + s * (bed.len / 2 - 0.33), 0.58, bed.z - 0.37], r: [0, 0, 0], s: [1, 1, 1] },
        { p: [bed.x + s * 0.15, 0.6, bed.z - 0.1], r: [0.25, 0.75, 0.1], s: [1, 1, 1] },
      ],
      pillow1: [
        { p: [bed.x + s * (bed.len / 2 - 0.33), 0.58, bed.z + 0.37], r: [0, 0, 0], s: [1, 1, 1] },
        { p: [bed.x - s * (bed.len / 2 + 0.38), 0.07, bed.z + 0.35], r: [0, 1.1, 0], s: [1, 1, 1] },
      ],
    };
    this.messy = 0;
    this.messyTarget = 0;
    this.applyPose();

    // ---- Çöpler (dinamik) --------------------------------------------
    const tg = trashGeometries();
    this.trash = layout.trashSpots.map(([x, z], i) => {
      const m = new THREE.Mesh(tg[i], mats[TRASH_MATS[i]]);
      m.position.set(x, 0, z);
      m.rotation.y = (i * 1.7 + Number(layout.id)) % (Math.PI * 2);
      m.visible = false;
      m.matrixAutoUpdate = false;
      m.updateMatrix();
      scene.add(m);
      return m;
    });

    // Etkileşim hedefleri
    this.targets = [
      { kind: 'bed', target: 'bed', x: bed.x, z: bed.z, label: 'Yatağı düzelt' },
      ...layout.trashSpots.map(([x, z], i) => ({ kind: 'trash', target: i, x, z, label: TRASH_LABELS[i] })),
    ];
  }

  applyPose() {
    const t = this.messy;
    const set = (mesh, [a, b]) => {
      mesh.position.set(a.p[0] + (b.p[0] - a.p[0]) * t, a.p[1] + (b.p[1] - a.p[1]) * t, a.p[2] + (b.p[2] - a.p[2]) * t);
      mesh.rotation.set(a.r[0] + (b.r[0] - a.r[0]) * t, a.r[1] + (b.r[1] - a.r[1]) * t, a.r[2] + (b.r[2] - a.r[2]) * t);
      mesh.scale.set(a.s[0] + (b.s[0] - a.s[0]) * t, a.s[1] + (b.s[1] - a.s[1]) * t, a.s[2] + (b.s[2] - a.s[2]) * t);
    };
    set(this.blanket, this.poses.blanket);
    set(this.pillows[0], this.poses.pillow0);
    set(this.pillows[1], this.poses.pillow1);
  }

  applyState(st) {
    this.state = st;
    this.messyTarget = st.status === ROOM_STATUS.DIRTY && !st.bedMade ? 1 : 0;
    st.trash.forEach((on, i) => {
      this.trash[i].visible = st.status === ROOM_STATUS.DIRTY && on;
    });
    this.statusMat.color.setHex(STATUS_COLOR[st.status] ?? 0xffffff);
  }

  /** Hedef hâlâ yapılacak iş mi? */
  isTargetPending(target) {
    const st = this.state;
    if (st.status !== ROOM_STATUS.DIRTY) return false;
    return target === 'bed' ? !st.bedMade : !!st.trash[target];
  }

  /**
   * @param ctx { px, pz, guestNear(x,z,r) }
   * @returns {boolean} animasyon sürüyor mu
   */
  update(dt, ctx) {
    let active = false;
    const occupied = this.state.status === ROOM_STATUS.OCCUPIED;
    const inside = isInsideRoom(this.layout, ctx.px, ctx.pz);
    const d = this.layout.door;
    // Dolu oda kilitli: yalnızca misafir geçerken ya da oyuncu içerideyse açılır
    const wantOpen = !occupied || inside || ctx.guestNear(d.x, d.z, 1.8);
    const target = wantOpen ? DOOR_OPEN * this.layout.side : 0;
    if (this.doorAngle !== target) {
      const step = DOOR_SPEED * dt;
      const diff = target - this.doorAngle;
      this.doorAngle = Math.abs(diff) <= step ? target : this.doorAngle + Math.sign(diff) * step;
      this.doorPivot.rotation.y = this.doorAngle;
      active = true;
    }
    this.doorCollider.enabled = occupied && !inside;

    if (this.messy !== this.messyTarget) {
      const step = BED_SPEED * dt;
      const diff = this.messyTarget - this.messy;
      this.messy = Math.abs(diff) <= step ? this.messyTarget : this.messy + Math.sign(diff) * step;
      this.applyPose();
      active = true;
    }
    return active;
  }
}
