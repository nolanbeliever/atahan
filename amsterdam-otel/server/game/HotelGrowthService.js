import { EVT, formatMoney } from '../../shared/constants.js';
import {
  ELEVATOR, RECEPTION_PC, FLOOR_DZ, TOP_FLOOR, ROOF_FLOOR,
} from '../../shared/layout.js';
import {
  REPUTATION, FLOOR_UPGRADES, MAX_FLOOR, STAR_THRESHOLDS, starsFor,
} from '../../shared/hotel.js';

const UPGRADE_BY_FLOOR = Object.freeze(Object.assign(Object.create(null), Object.fromEntries(FLOOR_UPGRADES.map((u) => [u.floor, u]))));

/**
 * Otelin büyümesi: itibar → yıldız, kasa parasıyla açılan üst katlar ve asansör. Hepsi kalıcı (HotelSimulation.hotelState içinde `growth`).
 *  - İtibar: temizlenen oda +2, yerleşen misafir +1, odasız kalan misafir −2.
 *  - Kat satın alma: sıradaki kat, yeterli yıldız + kasa; oyuncu resepsiyon bilgisayarının başında.
 *  - Asansör: oyuncu bir asansör kapısının önündeyse açık bir kata ışınlanır (konum sunucuda yazılır).
 *  - Lüks paketler (ArchitectureService) `floors`'u 8 / 12'ye çıkarır; Gökdelen'de asansörün "Çatı" durağı
 *    (ROOF_FLOOR) Aqua Park'a gider.
 */
export class HotelGrowthService {
  constructor(sim) {
    this.sim = sim;
    this.reputation = 0;
    this.floors = 1;
  }

  get stars() { return starsFor(this.reputation); }

  isFloorOpen(f) { return Number.isInteger(f) && f >= 1 && f <= this.floors; }

  restore(g) {
    if (!g || typeof g !== 'object') return;
    if (Number.isFinite(g.reputation)) this.reputation = Math.min(Math.max(Math.floor(g.reputation), 0), REPUTATION.MAX);
    // Kat satın almayla en fazla 4; lüks paket (önce yüklenir) sınırı 8 / 12'ye çıkarır
    const max = Math.max(MAX_FLOOR, this.sim.arch?.maxFloor ?? MAX_FLOOR);
    if (Number.isInteger(g.floors)) this.floors = Math.min(Math.max(g.floors, 1), max);
  }

  persisted() {
    return { reputation: this.reputation, floors: this.floors };
  }

  serialize() {
    const stars = this.stars;
    return {
      reputation: this.reputation,
      stars,
      next: STAR_THRESHOLDS[stars] ?? null, // sonraki yıldızın eşiği (5★'de null)
      floors: this.floors,
    };
  }

  /** İtibar değişimi; yıldız değişirse herkese duyurulur. */
  addReputation(delta) {
    if (!delta) return;
    const before = this.stars;
    this.reputation = Math.min(Math.max(this.reputation + delta, 0), REPUTATION.MAX);
    const after = this.stars;
    if (after > before) this.sim.notify(`⭐ Otelin itibarı yükseldi: artık ${'★'.repeat(after)} (${after} yıldız)! Oda ücretleri arttı.`, 'day');
    else if (after < before) this.sim.notify(`Otel bir yıldız kaybetti: ${'★'.repeat(after)}`, 'warn');
    this.sim.hotelChanged();
  }

  // ---- Resepsiyon PC: kat satın alma --------------------------------------------

  nearPc(p) {
    const [x, z] = RECEPTION_PC.point;
    return Math.hypot(p.x - x, p.z - z) <= RECEPTION_PC.range + 1;
  }

  buyFloor(p, data) {
    if (!this.nearPc(p)) return { ok: false, error: 'Resepsiyon bilgisayarının başında olmalısın.' };
    const floor = data?.floor;
    if (!Number.isInteger(floor)) return { ok: false, error: 'Geçersiz kat.' };
    const up = UPGRADE_BY_FLOOR[floor];
    if (!up) return { ok: false, error: 'Geçersiz kat.' };
    if (floor <= this.floors) return { ok: false, error: 'Bu kat zaten açık.' };
    if (floor !== this.floors + 1) return { ok: false, error: 'Önce bir alttaki katı aç.' };
    if (this.stars < up.stars) return { ok: false, error: `Bu kat için en az ${up.stars} yıldız gerekiyor.` };
    if (this.sim.money < up.price) return { ok: false, error: `Kasada yeterli para yok (${formatMoney(up.price)} gerekiyor).` };
    this.floors = floor;
    this.sim.spend(up.price, `${floor}. kat inşa edildi`);
    this.sim.notify(`🏗️ ${p.name} otele ${floor}. katı ekledi! ${floor}01–${floor}04 odaları misafirlere açık. Lobideki asansörle çık.`, 'day');
    this.sim.hotelChanged();
    this.sim.roomsChanged();
    return { ok: true, floors: this.floors };
  }

  // ---- Asansör ----------------------------------------------------------------

  /** Oyuncunun önünde durduğu asansör kapısının katı (yoksa 0) */
  elevatorAt(p) {
    const near = (pt) => Math.hypot(p.x - pt[0], p.z - pt[1]) <= ELEVATOR.range + 1;
    if (near(ELEVATOR.lobby.point)) return 1;
    for (let f = 2; f <= TOP_FLOOR; f++) if (FLOOR_DZ[f] !== undefined && near(ELEVATOR.floor(f).point)) return f;
    if (near(ELEVATOR.floor(ROOF_FLOOR).point)) return ROOF_FLOOR;
    return 0;
  }

  /** Asansör durağı açık mı (kat ya da çatı) */
  isStopOpen(f) {
    if (f === ROOF_FLOOR) return !!this.sim.arch?.roofOpen;
    return this.isFloorOpen(f);
  }

  elevator(p, data) {
    const floor = data?.floor;
    if (!Number.isInteger(floor) || floor < 1 || floor > ROOF_FLOOR) return { ok: false, error: 'Geçersiz kat.' };
    const from = this.elevatorAt(p);
    if (!from) return { ok: false, error: 'Asansörün önünde olmalısın.' };
    if (!this.isStopOpen(floor)) {
      return { ok: false, error: floor === ROOF_FLOOR ? 'Çatı henüz kapalı — "Ultra Lüks Gökdelen" paketiyle açılır.' : `${floor}. kat henüz yok — Resepsiyon PC'den satın alınabilir.` };
    }
    if (floor === from) return { ok: false, error: 'Zaten bu kattasın.' };
    if (p.sleeping || p.vehicle) return { ok: false, error: 'Şu an asansöre binemezsin.' };
    const dest = floor === 1 ? ELEVATOR.lobby : ELEVATOR.floor(floor);
    p.x = dest.spawn[0];
    p.z = dest.spawn[1];
    p.yaw = dest.yaw;
    this.sim.dirtyPlayers.add(p.id);
    return { ok: true, x: p.x, z: p.z, yaw: p.yaw, floor };
  }
}
