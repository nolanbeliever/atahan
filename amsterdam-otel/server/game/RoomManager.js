import { ROOM_IDS, ROOM_STATUS, TRASH_SPOT_COUNT } from '../../shared/constants.js';
import { ISSUE_IDS, MAINT_RULES } from '../../shared/maintenance.js';

const noIssues = () => Object.fromEntries(ISSUE_IDS.map((id) => [id, false]));

/**
 * 4 odanın durumunu tutar: Boş / Dolu / Kirli.
 * Kirli bir oda; dağınık yatak, birkaç çöp ve 1–2 arızadan (leke, ampul, musluk,
 * sigorta — shared/maintenance.js) oluşan işler içerir.
 * Tüm işler bitince oda yeniden "Boş" (temiz) olur.
 */
export class RoomManager {
  constructor(rng) {
    this.rng = rng;
    this.rooms = new Map(
      ROOM_IDS.map((id) => [id, {
        id,
        status: ROOM_STATUS.EMPTY,
        bedMade: true,
        trash: new Array(TRASH_SPOT_COUNT).fill(false),
        issues: noIssues(),
        guestId: null,
        startedAt: null, // ilk temizlik / tamirat işinin zamanı (hız bonusu)
        repairs: 0, // bu kirlilikte tamir edilen arıza sayısı
      }]),
    );
  }

  get(id) { return this.rooms.get(id); }

  emptyRooms() {
    return [...this.rooms.values()].filter((r) => r.status === ROOM_STATUS.EMPTY);
  }

  occupy(room, guestId) {
    room.status = ROOM_STATUS.OCCUPIED;
    room.guestId = guestId;
  }

  /** Misafir çıkışında odayı kirletir: yatak dağınık + 2-3 çöp */
  makeDirty(room) {
    room.status = ROOM_STATUS.DIRTY;
    room.guestId = null;
    room.bedMade = false;
    room.trash.fill(false);
    const count = 2 + Math.floor(this.rng() * 2);
    const spots = [...room.trash.keys()];
    for (let i = 0; i < count; i++) {
      const pick = Math.floor(this.rng() * spots.length);
      room.trash[spots.splice(pick, 1)[0]] = true;
    }
    // Arızalar: iki leke birden çıkmaz
    room.issues = noIssues();
    const n = MAINT_RULES.MIN_ISSUES + Math.floor(this.rng() * (MAINT_RULES.MAX_ISSUES - MAINT_RULES.MIN_ISSUES + 1));
    const pool = ['stain', 'bulb', 'faucet', 'fuse'];
    for (let i = 0; i < n && pool.length; i++) {
      const kind = pool.splice(Math.floor(this.rng() * pool.length), 1)[0];
      const id = kind === 'stain' ? (this.rng() < 0.6 ? 'stainFloor' : 'stainWall') : kind;
      room.issues[id] = true;
    }
    room.startedAt = null;
    room.repairs = 0;
  }

  remainingTasks(room) {
    return (room.bedMade ? 0 : 1) + room.trash.filter(Boolean).length
      + ISSUE_IDS.filter((id) => room.issues[id]).length;
  }

  /**
   * Arıza giderildi (süre ve konum HotelSimulation'da doğrulanır).
   * @returns {{ok: boolean, finished?: boolean}}
   */
  repair(room, issue) {
    if (room.status !== ROOM_STATUS.DIRTY || !room.issues[issue]) return { ok: false };
    room.issues[issue] = false;
    room.repairs += 1;
    const finished = this.remainingTasks(room) === 0;
    if (finished) room.status = ROOM_STATUS.EMPTY;
    return { ok: true, finished };
  }

  /**
   * Temizlik işi uygular.
   * @param {'bed'|number} target  'bed' ya da çöp noktası indeksi
   * @returns {{ok: boolean, finished?: boolean}}
   */
  clean(room, target) {
    if (room.status !== ROOM_STATUS.DIRTY) return { ok: false };
    if (target === 'bed') {
      if (room.bedMade) return { ok: false };
      room.bedMade = true;
    } else {
      if (!Number.isInteger(target) || !room.trash[target]) return { ok: false };
      room.trash[target] = false;
    }
    const finished = this.remainingTasks(room) === 0;
    if (finished) room.status = ROOM_STATUS.EMPTY;
    return { ok: true, finished };
  }

  serialize() {
    return [...this.rooms.values()].map((r) => ({
      id: r.id, status: r.status, bedMade: r.bedMade, trash: [...r.trash], issues: { ...r.issues },
    }));
  }
}
