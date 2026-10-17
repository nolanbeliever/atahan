import { formatMoney, ROOM_STATUS, roomFloor } from '../../shared/constants.js';
import { STAFF_ROOM, FLOOR_DZ } from '../../shared/layout.js';
import {
  ARCH_PACKAGE_BY_ID, ARCH_PACKAGES, ARCH_MAX_LEVEL, ARCH_FLOORS, ARCH_MAX_WORKERS, VIP, LOUNGE_RULES,
  loungeOccupancy, loungeHourly,
} from '../../shared/architecture.js';
import { WORKER_RULES } from '../../shared/hotel.js';

/**
 * Otelin mimari lüks paketleri (Resepsiyon PC → 🏗️ Yükseltmeler → Lüks paketler).
 *  - Satın alma: sıradaki paket, oyuncu PC'nin başında, kasada yeterli para, yeterli yıldız ve kat.
 *    "Lüks Otel" (€50.000): 4 kat açık + 4★ → 8 kat, lounge barlar, 15 temizlikçi.
 *    "Ultra Lüks Gökdelen" (€100.000): Lüks Otel + 5★ → 12 kat, çatı Aqua Park, VIP suitleri, 30 temizlikçi.
 *    Açık kat sayısı HotelGrowthService.floors'a yazılır (asansör, misafir, temizlikçi, denetim aynı alanı okur).
 *  - Lounge barlar (alkolsüz): açıkken (10:00–23:00) her oyun saati kasaya küçük bir pasif gelir yazar;
 *    birikir ve 3 saatte bir tek ECONOMY bildirimiyle ödenir (shared/architecture.js LOUNGE_RULES).
 *  - VIP misafir: Gökdelen varken ve boş VIP suiti varken yeni misafir %35 olasılıkla VIP gelir (GuestManager).
 *  - Kalıcı: HotelSimulation.hotelState().arch = { level }; yayın: hotelPublic().arch.
 * Pil/CPU: tick başına yalnızca bir tamsayı karşılaştırması (saat değişti mi).
 */
export class ArchitectureService {
  constructor(sim) {
    this.sim = sim;
    this.level = 0;
    this.loungeHour = null; // son işlenen mutlak oyun saati
    this.loungePending = 0; // ödenmemiş lounge geliri (€, ondalıklı)
    this.loungeHours = 0; // birikmiş açık saat
  }

  get maxFloor() { return ARCH_FLOORS[this.level]; }

  get maxWorkers() { return ARCH_MAX_WORKERS[this.level] ?? WORKER_RULES.MAX; }

  get roofOpen() { return this.level >= 2; }

  get vipOpen() { return this.level >= 2; }

  /** Açık lounge sayısı (1. paketle iki lounge birden açılır) */
  get lounges() { return this.level >= 1 ? 2 : 0; }

  // ---- Kalıcılık ---------------------------------------------------------------

  restore(a) {
    if (!a || typeof a !== 'object') return;
    if (Number.isInteger(a.level)) this.level = Math.min(Math.max(a.level, 0), ARCH_MAX_LEVEL);
  }

  persisted() { return { level: this.level }; }

  serialize() {
    return {
      level: this.level,
      maxFloor: this.maxFloor,
      maxWorkers: this.maxWorkers,
      roof: this.roofOpen,
      vip: this.vipOpen,
      lounges: this.lounges,
    };
  }

  // ---- Satın alma (Resepsiyon PC) ------------------------------------------------------

  buy(p, data) {
    const { growth } = this.sim;
    if (!growth.nearPc(p)) return { ok: false, error: 'Resepsiyon bilgisayarının başında olmalısın.' };
    const id = data?.pkg;
    const pkg = typeof id === 'string' ? ARCH_PACKAGE_BY_ID[id] : undefined;
    if (!pkg) return { ok: false, error: 'Geçersiz paket.' };
    if (this.level >= pkg.level) return { ok: false, error: 'Bu paket zaten alındı.' };
    if (pkg.level !== this.level + 1) return { ok: false, error: `Önce "${ARCH_PACKAGES[this.level].name}" paketini al.` };
    if (growth.floors < pkg.needFloors) return { ok: false, error: `Önce otelin ${pkg.needFloors} katının hepsi açılmalı.` };
    if (growth.stars < pkg.stars) return { ok: false, error: `Bu paket için en az ${pkg.stars} yıldız gerekiyor.` };
    if (this.sim.money < pkg.price) return { ok: false, error: `Kasada yeterli para yok (${formatMoney(pkg.price)} gerekiyor).` };
    this.level = pkg.level;
    growth.floors = Math.max(growth.floors, pkg.floors);
    this.sim.spend(pkg.price, `${pkg.icon} ${pkg.name} paketi`);
    const extra = pkg.level === 1
      ? '5–8. katlar açıldı, odalar lüks oldu; Library Lounge (5. kat) ve Sky Lounge (8. kat) misafir ağırlıyor.'
      : '9–12. katlar ve çatıdaki Aqua Park açıldı (asansör → Çatı); 12. kat VIP suitleri VIP misafirleri bekliyor!';
    this.sim.notify(`${pkg.icon} ${p.name} "${pkg.name}" paketini aldı! ${extra}`, 'day');
    this.sim.hotelChanged();
    this.sim.roomsChanged();
    this.sim.house.scheduleSave();
    return { ok: true, level: this.level, floors: growth.floors };
  }

  // ---- Personel odası (5. kat) ------------------------------------------------------------

  /** Temizlikçinin bekleme yeri: ilk 6'sı lobide (WorkerService), sonrakiler personel odasında */
  staffSpot(i) {
    const [x, z] = STAFF_ROOM.spots[i % STAFF_ROOM.spots.length];
    const dz = FLOOR_DZ[STAFF_ROOM.floor];
    return [x, z + dz];
  }

  /** Personel odasından sahanlığa (z'ler kata göre) */
  staffExit() {
    const dz = FLOOR_DZ[STAFF_ROOM.floor];
    return STAFF_ROOM.exit.map(([x, z]) => [x, z + dz]);
  }

  // ---- VIP misafirler ---------------------------------------------------------------------

  /** Yeni misafir VIP mi gelsin: Gökdelen + boş VIP suiti + (gelmekte olan VIP yok) + olasılık */
  rollVip() {
    if (!this.vipOpen) return false;
    const freeSuites = this.sim.rooms.emptyRooms(this.sim.growth.floors, true).length;
    if (!freeSuites) return false;
    for (const g of this.sim.guests.guests.values()) if (g.vip && !g.roomId) return false;
    return this.sim.rng() < VIP.CHANCE;
  }

  // ---- Lounge barlar: pasif gelir -----------------------------------------------------------

  /** Doluluk çarpanı: açık katlardaki dolu odalar / açık oda sayısı */
  occupancy() {
    const floors = this.sim.growth.floors;
    let open = 0;
    let occ = 0;
    for (const r of this.sim.rooms.rooms.values()) {
      if (roomFloor(r.id) > floors) continue;
      open++;
      if (r.status === ROOM_STATUS.OCCUPIED) occ++;
    }
    return loungeOccupancy(occ, open);
  }

  update() {
    const { clock } = this.sim;
    const hour = Math.floor(clock.total / 60);
    if (this.loungeHour === null || !this.lounges || hour < this.loungeHour) {
      this.loungeHour = hour; // ilk tick / paket yok / saat geri alındı
      return;
    }
    if (hour <= this.loungeHour) return;
    const steps = hour - this.loungeHour;
    const from = this.loungeHour;
    this.loungeHour = hour;
    if (steps > LOUNGE_RULES.MAX_CATCHUP_HOURS) return; // uyku / kayıttan dönüş: gelir yazılmaz
    for (let h = from; h < hour; h++) {
      // Biten saat [h, h+1): gün içi dakikası açık saatlerdeyse gelir
      const minute = clock.minute - (hour - h) * 60;
      if (minute < LOUNGE_RULES.OPEN_MIN || minute >= LOUNGE_RULES.CLOSE_MIN) continue;
      this.loungePending += loungeHourly(this.lounges, this.occupancy(), this.sim.boosts.barSpawn);
      this.loungeHours += 1;
    }
    const closing = clock.minute >= LOUNGE_RULES.CLOSE_MIN;
    if (this.loungeHours >= LOUNGE_RULES.PAYOUT_HOURS || (closing && this.loungeHours > 0)) this.payout();
  }

  payout() {
    const amount = Math.round(this.loungePending);
    const hours = this.loungeHours;
    this.loungePending = 0;
    this.loungeHours = 0;
    if (amount <= 0) return;
    this.sim.earn(amount, `🍹 Library + Sky Lounge (${hours} saat, alkolsüz)`, { guest: false });
  }
}
