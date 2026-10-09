import { ROOM_IDS, ROOM_STATUS, TRASH_SPOT_COUNT } from '../../shared/constants.js';

/**
 * 4 odanın durumunu tutar: Boş / Dolu / Kirli.
 * Kirli bir oda; dağınık yatak ve birkaç çöpten oluşan temizlik işleri içerir.
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
        guestId: null,
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
  }

  remainingTasks(room) {
    return (room.bedMade ? 0 : 1) + room.trash.filter(Boolean).length;
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
      id: r.id, status: r.status, bedMade: r.bedMade, trash: [...r.trash],
    }));
  }
}
