import {
  ROOM_IDS, ROOM_STATUS, DAY_START_MIN, DAY_END_MIN, CHECKIN_OPEN_MIN, CHECKIN_CLOSE_MIN, MINUTES_PER_DAY,
} from '/shared/constants.js';

/** Sunucu durumunun istemcideki aynası (odalar, saat, kasa) */
export class GameState {
  constructor() {
    this.selfId = null;
    this.rooms = new Map(ROOM_IDS.map((id) => [id, {
      id, status: ROOM_STATUS.EMPTY, bedMade: true, trash: [false, false, false, false],
    }]));
    this.clock = null;
    this.economy = { money: 0, today: { earned: 0, guests: 0, cleaned: 0 } };
    this.version = 0; // oda durumu her değiştiğinde artar
  }

  setRooms(list) {
    for (const r of list) this.rooms.set(r.id, r);
    this.version++;
  }

  setClock(c) { this.clock = c; }

  get weekend() { return !!this.clock?.weekend; }

  /** Sunucu saatinden ileri hesaplanan güncel oyun dakikası */
  minuteAt(serverNow) {
    const c = this.clock;
    if (!c) return DAY_START_MIN;
    const m = c.minute + ((serverNow - c.st) / 1000) * c.rate;
    // Gece başlangıcı ve gün değişimi sunucudan gelir; o zamana kadar sınırda bekle
    // (gece dakikası 23:00'ten 31:00'e — ertesi 07:00 — kadar sayar)
    return Math.min(m, c.night ? MINUTES_PER_DAY + DAY_START_MIN - 1 : DAY_END_MIN - 1);
  }

  isOpenAt(minute) {
    return !this.weekend && minute >= CHECKIN_OPEN_MIN && minute < CHECKIN_CLOSE_MIN;
  }
}
