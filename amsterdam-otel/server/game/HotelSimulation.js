import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import {
  EVT, DAY_NAMES, ROOM_STATUS, INTERACT_RANGE, TRASH_SPOT_COUNT, PLAYER_KEY_RE, DAY_START_MIN, DAY_END_MIN, MINUTES_PER_DAY,
  NIGHT, formatMoney,
} from '../../shared/constants.js';
import { POINTS, ROOM_BY_ID, WORLD_BOUNDS, pointInBounds } from '../../shared/layout.js';
import { GameClock } from './GameClock.js';
import { RoomManager } from './RoomManager.js';
import { GuestManager } from './GuestManager.js';
import { CoffeeShopService } from './CoffeeShopService.js';
import { HouseService } from '../house/HouseService.js';
import { BarService } from './BarService.js';
import { GardenService } from '../house/GardenService.js';
import { RelationshipService } from './RelationshipService.js';
import { VehicleService } from './VehicleService.js';
import { HotelGrowthService } from './HotelGrowthService.js';
import { BoostService } from './BoostService.js';
import { CounterfeitService } from '../house/CounterfeitService.js';
import { TeleportService } from './TeleportService.js';
import { WorkerService } from './WorkerService.js';
import { RestaurantService } from './RestaurantService.js';
import { KitchenStaffService } from './KitchenStaffService.js';
import { StreetMonopolyService } from './StreetMonopolyService.js';
import { REPUTATION } from '../../shared/hotel.js';
import { ExteriorService } from '../house/ExteriorService.js';
import { CasinoService } from './CasinoService.js';
import { StageService } from './StageService.js';
import { MarketingService } from './MarketingService.js';
import { ArchitectureService } from './ArchitectureService.js';
import { GarageService } from './GarageService.js';
import { DragRaceService } from './DragRaceService.js';
import { ValetService } from './ValetService.js';
import { BasementService } from './BasementService.js';
import { ISSUE_BY_ID, MAINT_RULES, issueSpots } from '../../shared/maintenance.js';
import { CHAT_RULES, cleanChat } from '../../shared/chat.js';

const PLAYER_COLORS = ['#e4572e', '#29a3a3', '#f3a712', '#6a4c93', '#3a86ff', '#8ac926', '#ff595e', '#c77dff'];

const round2 = (v) => Math.round(v * 100) / 100;

/**
 * Kalıcı oyuncu anahtarının özeti (sha256 hex). Anahtarın kendisi hiçbir yerde
 * saklanmaz / yayınlanmaz / loglanmaz; geçersiz anahtar → null (kalıcılık yok).
 */
export function hashKey(key) {
  if (typeof key !== 'string' || !PLAYER_KEY_RE.test(key)) return null;
  return createHash('sha256').update(key).digest('hex');
}

function sanitizeName(raw) {
  if (typeof raw !== 'string') return '';
  // Kontrol karakterlerini ve açılı parantezleri at, boşlukları sadeleştir
  return raw.replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 16);
}

/**
 * Otelin yetkili (authoritative) simülasyonu.
 * Ağdan bağımsızdır: dışarıya yalnızca `out` olayı yayar, böylece
 * Socket.io olmadan da test edilebilir.
 *
 * Pil/CPU dostu tasarım:
 *  - Oyuncu yokken zamanlayıcı tamamen durur.
 *  - Misafir hareketleri istemcide rota + başlangıç zamanından hesaplanır;
 *    sunucu yalnızca faz değişimlerinde mesaj gönderir.
 *  - Oyuncu konumları sadece değiştiğinde, toplu halde yayınlanır.
 */
export class HotelSimulation extends EventEmitter {
  /**
   * @param house { store, fetchVideoInfo } — evler + cüzdanlar için kalıcılık ve YouTube bilgisi (isteğe bağlı)
   */
  constructor({ config, rng = Math.random, now = Date.now, house = {} }) {
    super();
    this.config = config;
    this.rng = rng;
    this.now = now;
    this.clock = new GameClock({
      dayLengthSec: config.dayLengthSec,
      weekendSpeed: config.weekendSpeed,
      nightLengthSec: config.nightLengthSec ?? 0,
      startDay: config.startDay ?? 0,
      startMinute: (config.startHour ?? 7) * 60,
    });
    this.rooms = new RoomManager(rng);
    this.guests = new GuestManager(this);
    this.shop = new CoffeeShopService(this);
    this.house = new HouseService(this, house);
    this.bar = new BarService(this);
    this.garden = new GardenService(this, this.house);
    this.relations = new RelationshipService(this);
    this.vehicles = new VehicleService(this);
    this.counterfeit = new CounterfeitService(this); // ev matbaası + polis baskını
    this.teleport = new TeleportService(this); // hızlı ışınlanma
    this.boosts = new BoostService(this); // geçici bonuslar (konser kalabalığı, reklam kampanyası)
    this.growth = new HotelGrowthService(this); // yıldız / itibar, üst katlar, asansör
    this.arch = new ArchitectureService(this); // lüks paketler: 8 / 12 kat, lounge barlar, çatı, VIP suitleri
    this.workers = new WorkerService(this); // temizlikçi NPC'ler
    this.restaurant = new RestaurantService(this); // Gurme Restoran: masalar, müşteriler, oyuncunun mutfak adımları
    this.kitchen = new KitchenStaffService(this); // restoran personeli: aşçı ve garson NPC'leri
    this.street = new StreetMonopolyService(this); // Achterstraat Cadde İmparatorluğu: dükkânlar, kira, King unvanı
    this.exterior = new ExteriorService(this); // ev dış cepheleri (kayıt: this.house.exteriorData)
    this.casino = new CasinoService(this); // Yeraltı Kart Kulübü
    this.stage = new StageService(this); // Achterstraat canlı müzik sahnesi + kalabalık
    this.marketing = new MarketingService(this); // InstaHotel: gönderiler, reklam kampanyası → turist akını
    this.garage = new GarageService(this); // yeraltı garajı, AutoGalerie, arabalar (VehicleService'te 'car')
    this.drag = new DragRaceService(this); // drag pisti: zamanlama, düello, liderlik tablosu
    this.valet = new ValetService(this); // VIP vale + garajdaki oto yıkama
    this.basement = new BasementService(this); // −1. Kat VIP Eğlence Katı: bilardo, langırt, masa tenisi, atari, bowling
    this.players = new Map();
    this.nextPlayerNo = 1;
    this.money = 0;
    this.today = { earned: 0, guests: 0, cleaned: 0, served: 0, meals: 0 };
    this.restoreHotel(this.house.hotelData);
    this.timer = null;
    this.lastTick = 0;
    this.pausedAt = null;
    this.lastClockBroadcast = 0;
    this.lastCheckinOpen = this.clock.checkinOpen;
    this.lastNight = this.clock.night;
    this.dirtyPlayers = new Set();
    this.chatLog = []; // son sohbet mesajları (yeni bağlanana gönderilir; kaydedilmez)
  }

  // ---- Çıkış (yayın) yardımcıları --------------------------------------

  out(event, payload) { this.emit('out', event, payload); }

  /** Yalnızca tek bir oyuncuya giden mesaj (cüzdan, kişisel bildirim) */
  toPlayer(id, event, payload) { this.emit('to', id, event, payload); }

  notify(text, kind = 'info') { this.out(EVT.NOTIFY, { text, kind }); }

  // Kapalı katların odaları hep boş/temiz: yalnızca açık katlar yayınlanır (12 katta daha küçük mesaj)
  roomsChanged() { this.out(EVT.ROOMS, this.rooms.serialize(this.growth.floors)); }

  economy(delta = 0, reason = '') {
    return { money: this.money, delta, reason, today: { ...this.today } };
  }

  /** @param guest false ise günün misafir sayısı artmaz (bar satışları gibi) */
  earn(amount, reason, { guest = true } = {}) {
    this.money += amount;
    this.today.earned += amount;
    if (guest) this.today.guests += 1;
    this.out(EVT.ECONOMY, this.economy(amount, reason));
    this.house.scheduleSave(); // kasa kalıcı
  }

  /** Kasadan harcama (kat, temizlikçi, ceza); kasa eksiye düşmez */
  spend(amount, reason) {
    const v = Math.min(amount, this.money);
    this.money -= v;
    this.out(EVT.ECONOMY, this.economy(-v, reason));
    this.house.scheduleSave();
  }

  /** Otelin büyüme durumu (Resepsiyon PC, HUD yıldızları) */
  hotelPublic() {
    return {
      growth: this.growth.serialize(), workers: this.workers.serialize(), arch: this.arch.serialize(),
      kitchen: this.kitchen.serialize(), // restoran personeli (Çalışanlar sekmesi)
    };
  }

  hotelChanged() { this.out(EVT.HOTEL_STATE, this.hotelPublic()); }

  /** Kalıcı kayda giden otel durumu: kasa, bugünün özeti, oyun günü ve saati, büyüme */
  hotelState() {
    return {
      money: this.money,
      today: { ...this.today },
      day: this.clock.dayCount,
      minute: Math.round(this.clock.minute),
      growth: this.growth.persisted(),
      workers: this.workers.persisted(),
      boosts: this.boosts.persisted(),
      stage: this.stage.persisted(),
      insta: this.marketing.persisted(),
      counterfeit: this.counterfeit.persisted(),
      arch: this.arch.persisted(),
      garage: this.garage.persisted(),
      drag: this.drag.persisted(),
      valet: this.valet.persisted(),
      restaurant: { ...this.restaurant.persisted(), staff: this.kitchen.persisted() },
      street: this.street.persisted(),
      basement: this.basement.persisted(),
    };
  }

  restoreHotel(h) {
    if (!h) return;
    // Lüks paket önce: kat ve temizlikçi sınırları ona bağlı
    this.arch.restore(h.arch);
    this.growth.restore(h.growth);
    if (this.arch.level) this.growth.floors = Math.max(this.growth.floors, this.arch.maxFloor);
    this.workers.restore(h.workers);
    this.boosts.restore(h.boosts);
    this.counterfeit.restore(h.counterfeit);
    this.stage.restore(h.stage);
    this.marketing.restore(h.insta);
    this.garage.restore(h.garage);
    this.drag.restore(h.drag);
    this.valet.restore(h.valet);
    this.restaurant.restore(h.restaurant);
    this.kitchen.restore(h.restaurant?.staff);
    this.street.restore(h.street);
    this.basement.restore(h.basement);
    if (Number.isFinite(h.money) && h.money >= 0) this.money = h.money;
    const t = h.today;
    if (t && typeof t === 'object') {
      for (const k of Object.keys(this.today)) if (Number.isFinite(t[k]) && t[k] >= 0) this.today[k] = t[k];
    }
    if (Number.isInteger(h.day) && h.day >= 0 && h.day < 1e6 && Number.isFinite(h.minute)) {
      this.clock.dayCount = h.day;
      // Gece kaydedildiyse gece sürer (gece kapalıysa gün sonuna sıkıştırılır)
      const max = this.clock.nightLengthSec > 0 ? MINUTES_PER_DAY + DAY_START_MIN - 1 : DAY_END_MIN - 1;
      this.clock.minute = Math.min(Math.max(h.minute, DAY_START_MIN), max);
    }
  }

  broadcastClock(now) {
    this.lastClockBroadcast = now;
    this.out(EVT.CLOCK, this.clock.snapshot(now));
  }

  // ---- Döngü -----------------------------------------------------------

  get running() { return this.timer !== null; }

  start() {
    if (this.timer) return;
    const now = this.now();
    if (this.pausedAt !== null) {
      // Duraklama süresince yürüyen misafirlerin zaman damgalarını kaydır
      this.guests.shiftTime(now - this.pausedAt);
      this.bar.shiftTime(now - this.pausedAt);
      this.workers.shiftTime(now - this.pausedAt);
      this.stage.shiftTime(now - this.pausedAt);
      this.valet.shiftTime(now - this.pausedAt);
      this.restaurant.shiftTime(now - this.pausedAt);
      this.kitchen.shiftTime(now - this.pausedAt);
      this.basement.shiftTime(now - this.pausedAt);
      this.pausedAt = null;
    }
    this.lastTick = now;
    this.timer = setInterval(() => this.tick(this.now()), this.config.tickMs);
    this.timer.unref?.();
  }

  stop() {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
    this.pausedAt = this.now();
  }

  tick(now) {
    const dt = Math.min(Math.max((now - this.lastTick) / 1000, 0), 1);
    this.lastTick = now;

    const prevDay = this.clock.dayOfWeek;
    if (this.clock.advance(dt)) this.onNewDay(prevDay, now);

    if (this.clock.night !== this.lastNight) {
      this.lastNight = this.clock.night;
      if (this.lastNight) this.onNightStart(now);
    }

    const open = this.clock.checkinOpen;
    if (open !== this.lastCheckinOpen) {
      this.lastCheckinOpen = open;
      if (!this.clock.weekend) {
        this.notify(open ? 'Resepsiyon açıldı — misafir kabulü başladı.' : 'Resepsiyon kapandı (19:00).', 'info');
      }
      this.broadcastClock(now);
    }

    this.boosts.update();
    this.counterfeit.update(now);
    this.guests.update(now);
    this.workers.update(now);
    this.restaurant.update(now);
    this.kitchen.update(now);
    this.arch.update(now);
    this.shop.update(now);
    this.bar.update(now);
    this.casino.update(now);
    this.stage.update(now);
    this.marketing.update(now);
    this.drag.update(now);
    this.valet.update(now);
    this.basement.update(now);
    this.house.update(now);

    if (now - this.lastClockBroadcast >= this.config.clockBroadcastMs) this.broadcastClock(now);
    this.flushPlayers();
  }

  /** 23:00: otel kapanır, gece başlar */
  onNightStart(now) {
    this.relations.onNightStart();
    this.notify('🌙 Saat 23:00 — otel kapandı! Achterstraat\'taki evine git ve yatağında uyu (E). Herkes uyuyunca sabah olur.', 'day');
    this.broadcastClock(now);
    this.house.scheduleSave();
  }

  onNewDay(prevDay, now, { slept = false } = {}) {
    this.wakeAll();
    const t = this.today;
    const drinks = (t.served ? ` · ${t.served} içecek` : '') + (t.meals ? ` · ${t.meals} restoran tabağı` : '');
    let text = `${DAY_NAMES[prevDay]} bitti: ${t.guests} misafir, ${formatMoney(t.earned)} gelir, ${t.cleaned} oda temizlendi${drinks}.`;
    this.today = { earned: 0, guests: 0, cleaned: 0, served: 0, meals: 0 };
    const day = this.clock.dayOfWeek;
    if (day === 5) text += ' Hafta sonu başladı — otel kapalı. 🏠 Bizim Ev\'de takılma zamanı!';
    else if (day === 0) text += ' Yeni hafta! Otel misafirlere açık.';
    else text += ` ${DAY_NAMES[day]} başladı.`;
    if (slept) text = `☀️ Günaydın! Herkes uyudu, sabah oldu. ${text}`;
    this.notify(text, 'day');
    this.relations.onNewDay();
    this.street.onNewDay(); // Achterstraat dükkânlarının kirası kasaya, komisyon cüzdanlara
    this.out(EVT.ECONOMY, this.economy());
    this.broadcastClock(now);
    this.house.scheduleSave(); // yeni gün kayda geçsin
  }

  // ---- Oyuncular -------------------------------------------------------

  /** Aynı kalıcı anahtarla bağlı oyuncu (yoksa undefined) */
  playerByKey(key) {
    const hash = hashKey(key);
    if (!hash) return undefined;
    for (const p of this.players.values()) if (p.keyHash === hash) return p;
    return undefined;
  }

  /**
   * @param key tarayıcıda saklanan gizli anahtar (PLAYER_KEY_RE) — ev ve cüzdan kalıcılığı için;
   *            geçersizse yok sayılır. Aynı anahtarla açık eski oturum kapatılır ('kick' olayı).
   */
  addPlayer(rawName, key = null) {
    const keyHash = hashKey(key);
    if (keyHash) {
      for (const old of [...this.players.values()]) {
        if (old.keyHash !== keyHash) continue;
        this.toPlayer(old.id, EVT.NOTIFY, { text: 'Oyun başka bir sekmede açıldı.', kind: 'warn' });
        this.removePlayer(old.id); // cüzdanı kaydedilir, evi yeni oturuma geçer
        this.emit('kick', old.id); // ağ katmanı eski soketi kapatır
      }
    }
    const no = this.nextPlayerNo++;
    const p = {
      id: no,
      name: sanitizeName(rawName) || `Görevli ${no}`,
      color: PLAYER_COLORS[(no - 1) % PLAYER_COLORS.length],
      x: POINTS.playerSpawn[0] + (this.rng() - 0.5) * 2,
      z: POINTS.playerSpawn[1] + (this.rng() - 0.5),
      yaw: Math.PI,
      keyHash, // yalnızca sunucuda; hiçbir yayına girmez
      sleeping: null, // { x, z } yatağa yattığı yer (uyanıkken null)
    };
    this.shop.initPlayer(p);
    this.bar.initPlayer(p);
    this.restaurant.initPlayer(p);
    this.valet.initPlayer(p);
    this.house.initPlayer(p); // oturumluk ev erişimi + kayıtlı cüzdan
    this.relations.initPlayer(p); // kayıtlı arkadaşlık seviyeleri
    this.vehicles.initPlayer(p); // sahip olduğu araçlar son park yerinde belirir
    const hasCars = this.garage.initPlayer(p); // arabaları garajdaki / son park yerinde
    p.maint = null; // süren tamirat mini oyunu { roomId, issue, at }
    this.players.set(p.id, p);
    if (this.players.size === 1) this.start();
    this.out(EVT.PLAYER_JOIN, this.publicPlayer(p));
    this.street.onJoin(p); // biriken kira (anahtarsız sahip), sahiplik / taç etiketleri
    this.house.assignHouse(p); // değişirse HOUSE_OWNERS yayınlanır
    if (p.ownedVehicles.size || hasCars) this.vehicles.broadcast();
    return p;
  }

  removePlayer(id) {
    const p = this.players.get(id);
    if (!p) return;
    this.bar.removePlayer(p); // elindeki bardaklar rafa döner
    this.restaurant.removePlayer(p); // elindeki tepsi / tabak bırakılır
    this.counterfeit.removePlayer(p); // saklanma biter; sahibi çıkarsa süren baskı iptal
    this.casino.removePlayer(p); // masadan kalkar: fişleri bozdurulur (cüzdan kaydından önce)
    this.relations.removePlayer(p); // evdeki misafiri gider
    this.drag.removePlayer(p); // drag yarışındaysa DNF
    this.valet.removePlayer(p); // VIP aracının anahtarı sendeyse müşteri arabasını geri alır
    this.basement.removePlayer(p); // Eğlence Katı: masadan / kulvardan / makineden kalkar
    this.vehicles.removePlayer(p); // sürüyorsa park eder; araçları kayda geçer
    this.house.removePlayer(p); // bekleyen ziller, cüzdan ve ev sahibi kaydı
    this.players.delete(id);
    this.dirtyPlayers.delete(id);
    this.out(EVT.PLAYER_LEAVE, id);
    this.street.onLeave();
    if (this.players.size === 0) {
      this.stop();
      return;
    }
    if (p.sleeping) this.sleepChanged();
    else this.checkAllAsleep(); // kalanların hepsi uyuyorsa sabah olur
  }

  // ---- Gece / uyku -----------------------------------------------------------

  /**
   * Yatağa yat / kalk. Yatmak için akşam (21:00+) ya da gece olmalı ve oyuncu yatabileceği
   * bir evde yatağın yanında olmalı. Çevrimiçi herkes uyuyunca sabah olur.
   */
  sleep(playerId, on) {
    const p = this.players.get(playerId);
    if (!p) return { ok: false };
    if (typeof on !== 'boolean') return { ok: false, error: 'Geçersiz istek.' };
    if (!on) {
      if (p.sleeping) {
        p.sleeping = null;
        this.sleepChanged();
      }
      return { ok: true };
    }
    if (!this.clock.night && this.clock.minute < NIGHT.SLEEP_FROM_MIN) {
      return { ok: false, error: 'Henüz uykun yok — 21:00\'den sonra yatabilirsin.' };
    }
    const bed = this.house.bedFor(p);
    if (!bed.ok) return bed;
    if (!p.sleeping) {
      p.sleeping = { x: p.x, z: p.z };
      this.sleepChanged();
      this.checkAllAsleep();
    }
    return { ok: true };
  }

  sleepState() {
    const ids = [];
    for (const p of this.players.values()) if (p.sleeping) ids.push(p.id);
    return { ids, total: this.players.size };
  }

  sleepChanged() {
    this.out(EVT.SLEEP_STATE, this.sleepState());
  }

  checkAllAsleep() {
    if (!this.players.size) return;
    for (const p of this.players.values()) if (!p.sleeping) return;
    const prevDay = this.clock.dayOfWeek;
    this.clock.sleepThrough();
    this.lastNight = false;
    this.onNewDay(prevDay, this.now(), { slept: true });
  }

  wakeAll() {
    let any = false;
    for (const p of this.players.values()) {
      if (!p.sleeping) continue;
      p.sleeping = null;
      any = true;
    }
    if (any) this.sleepChanged();
  }

  publicPlayer(p) {
    return {
      id: p.id, name: p.name, color: p.color, x: round2(p.x), z: round2(p.z), yaw: round2(p.yaw),
      trip: this.shop.publicTrip(p),
      bar: this.bar.publicState(p),
      kitchen: this.restaurant.publicState(p),
    };
  }

  movePlayer(id, x, z, yaw) {
    const p = this.players.get(id);
    if (!p || !Number.isFinite(x) || !Number.isFinite(z) || !Number.isFinite(yaw)) return;
    // Araba hız denetimi + ışınlanma sonrası gecikmiş paketler (GarageService)
    const fm = this.garage.filterMove(p, x, z);
    if (!fm) return;
    [x, z] = fm;
    // Araçta yolcuysa konumu sürücü belirler (yalnızca bakış yönü alınır)
    if (!this.vehicles.onMove(p, x, z, Math.atan2(Math.sin(yaw), Math.cos(yaw)))) return;
    const b = WORLD_BOUNDS;
    p.x = Math.min(Math.max(x, b.minX), b.maxX);
    p.z = Math.min(Math.max(z, b.minZ), b.maxZ);
    p.yaw = Math.atan2(Math.sin(yaw), Math.cos(yaw));
    this.dirtyPlayers.add(id);
    this.vehicles.afterMove(p);
    this.counterfeit.onMove(p); // gizli bölmeden yürüyerek çıkış
    this.drag.onMove(p, this.now()); // drag yarışı zaman örnekleri
    // Yataktan kalkıp yürüyen oyuncu uyanır
    if (p.sleeping && Math.hypot(p.x - p.sleeping.x, p.z - p.sleeping.z) > NIGHT.WAKE_MOVE) {
      p.sleeping = null;
      this.sleepChanged();
    }
  }

  flushPlayers() {
    if (!this.dirtyPlayers.size) return;
    const batch = [];
    for (const id of this.dirtyPlayers) {
      const p = this.players.get(id);
      if (p) batch.push([p.id, round2(p.x), round2(p.z), round2(p.yaw)]);
    }
    this.dirtyPlayers.clear();
    if (batch.length) this.out(EVT.PLAYERS, batch);
  }

  /**
   * Temizlik etkileşimi. Oyuncunun gerçekten odada ve hedefin yakınında
   * olduğu sunucuda doğrulanır.
   * @returns {boolean}
   */
  interact(playerId, roomId, target) {
    const p = this.players.get(playerId);
    const layout = ROOM_BY_ID[roomId];
    const room = layout && this.rooms.get(layout.id);
    if (!p || !room) return false;
    if (!pointInBounds(p.x, p.z, layout.bounds, 0.3)) return false;

    let tx; let tz; let range;
    if (target === 'bed') {
      tx = layout.bed.x; tz = layout.bed.z; range = INTERACT_RANGE.bed;
    } else if (Number.isInteger(target) && target >= 0 && target < TRASH_SPOT_COUNT) {
      [tx, tz] = layout.trashSpots[target];
      range = INTERACT_RANGE.trash;
    } else {
      return false;
    }
    // Ağ gecikmesi için biraz tolerans
    if (Math.hypot(p.x - tx, p.z - tz) > range + 1.0) return false;

    const res = this.rooms.clean(room, target);
    if (!res.ok) return false;
    room.startedAt ??= this.now();
    this.roomsChanged();
    if (res.finished) this.finishRoom(room, p);
    return true;
  }

  /**
   * Oda tamamen temizlendi: misafirin bahşişi + her tamir için teşekkür + hızlı bitirme bonusu
   * (ilk işten itibaren MAINT_RULES.FAST_MS içinde). Hepsi işi bitiren oyuncunun cüzdanına.
   */
  finishRoom(room, p) {
    this.today.cleaned += 1;
    this.growth.addReputation(REPUTATION.ROOM_CLEANED);
    this.notify(`Oda ${room.id} temizlendi ✓ (${p.name})`, 'clean');
    const tip = this.shop.tip(p);
    const repair = room.repairs * MAINT_RULES.REPAIR_BONUS;
    const fast = room.startedAt != null && this.now() - room.startedAt <= MAINT_RULES.FAST_MS ? MAINT_RULES.FAST_BONUS : 0;
    if (repair + fast > 0) {
      p.wallet += repair + fast;
      this.shop.sendSelf(p);
    }
    let text = `Misafir odada €${tip.amount} bahşiş bırakmış!${tip.lucky ? ' 🍀 Şans bonusu +%20' : ''}`;
    if (repair) text += ` 🔧 Tamirat teşekkürü +€${repair}`;
    if (fast) text += ` ⚡ Hızlı ve eksiksiz +€${fast}`;
    this.toPlayer(p.id, EVT.NOTIFY, { text, kind: 'money' });
    room.startedAt = null;
    room.repairs = 0;
  }

  /**
   * Oda tamiratı (mini oyun): 'begin' arızanın yanında başlatır, 'finish' en az
   * ISSUE.minMs sonra arızayı giderir (mini oyunu atlayıp anında bitirme olmasın).
   */
  maint(playerId, data) {
    const p = this.players.get(playerId);
    if (!p) return { ok: false };
    const act = data?.act;
    const layout = typeof data?.roomId === 'string' ? ROOM_BY_ID[data.roomId] : undefined;
    const def = typeof data?.issue === 'string' ? ISSUE_BY_ID[data.issue] : undefined;
    if ((act !== 'begin' && act !== 'finish') || !layout || !def) return { ok: false, error: 'Geçersiz işlem.' };
    const room = this.rooms.get(layout.id);
    if (room.status !== ROOM_STATUS.DIRTY || !room.issues[def.id]) return { ok: false, error: 'Bu iş zaten yapılmış.' };
    if (!pointInBounds(p.x, p.z, layout.bounds, 0.3)) return { ok: false, error: 'Odanın içinde olmalısın.' };
    const spot = issueSpots(layout)[def.id];
    if (Math.hypot(p.x - spot.x, p.z - spot.z) > MAINT_RULES.RANGE + 1) return { ok: false, error: 'Biraz daha yaklaş.' };
    const now = this.now();
    if (act === 'begin') {
      p.maint = { roomId: layout.id, issue: def.id, at: now };
      room.startedAt ??= now;
      return { ok: true, game: def.game };
    }
    const m = p.maint;
    if (!m || m.roomId !== layout.id || m.issue !== def.id) return { ok: false, error: 'Önce işe başla.' };
    if (now - m.at < def.minMs - MAINT_RULES.SLACK_MS) return { ok: false, error: 'Bu kadar hızlı olmaz — işi düzgün yap!' };
    p.maint = null;
    const res = this.rooms.repair(room, def.id);
    if (!res.ok) return { ok: false, error: 'Bu iş zaten yapılmış.' };
    this.roomsChanged();
    if (res.finished) this.finishRoom(room, p);
    return { ok: true, finished: !!res.finished };
  }

  // ---- Sohbet -------------------------------------------------------------------

  /**
   * Oyuncu mesajı: temizlenir, kaba kelimeler yıldızlanır, aynı mesajın art arda tekrarı
   * engellenir; herkese yayınlanır ve son CHAT_RULES.HISTORY mesaj saklanır.
   */
  chat(playerId, raw) {
    const p = this.players.get(playerId);
    if (!p) return { ok: false };
    const text = cleanChat(raw);
    if (!text) return { ok: false, error: 'Boş mesaj gönderilemez.' };
    const now = this.now();
    if (p.lastChat && p.lastChat.text === text && now - p.lastChat.t < CHAT_RULES.REPEAT_MS) {
      return { ok: false, error: 'Aynı mesajı tekrar tekrar gönderme.' };
    }
    p.lastChat = { text, t: now };
    const msg = { id: p.id, name: p.name, color: p.color, text, t: now };
    this.chatLog.push(msg);
    if (this.chatLog.length > CHAT_RULES.HISTORY) this.chatLog.shift();
    this.out(EVT.CHAT, msg);
    return { ok: true, text };
  }

  // ---- Ev matbaası + polis baskını, hızlı ışınlanma ------------------------------------

  counterfeitAct(playerId, data) { return this.withPlayer(playerId, (p) => this.counterfeit.act(p, data, this.now())); }

  teleportAct(playerId, data) { return this.withPlayer(playerId, (p) => this.teleport.go(p, data, this.now())); }

  // ---- Otelin büyümesi: Resepsiyon PC, asansör ------------------------------

  hotelAct(playerId, data) {
    return this.withPlayer(playerId, (p) => {
      switch (data?.act) {
        case 'buyFloor': return this.growth.buyFloor(p, data);
        case 'buyPackage': return this.arch.buy(p, data);
        case 'elevator': return this.growth.elevator(p, data);
        case 'hire': return this.workers.hire(p);
        case 'fire': return this.workers.fire(p, data);
        case 'hireStaff': return this.kitchen.hire(p, data); // restoran: aşçı / garson
        case 'fireStaff': return this.kitchen.fire(p, data);
        default: return { ok: false, error: 'Geçersiz işlem.' };
      }
    });
  }

  // ---- Şehir içi ulaşım ----------------------------------------------------------

  vehicleAct(playerId, data) { return this.withPlayer(playerId, (p) => this.vehicles.act(p, data)); }

  // ---- Yeraltı garajı, AutoGalerie ve drag pisti ---------------------------------------

  carAct(playerId, data) { return this.withPlayer(playerId, (p) => this.garage.act(p, data)); }

  dragAct(playerId, data) { return this.withPlayer(playerId, (p) => this.drag.act(p, data, this.now())); }

  // ---- VIP vale + oto yıkama ----------------------------------------------------------

  valetAct(playerId, data) { return this.withPlayer(playerId, (p) => this.valet.act(p, data, this.now())); }
  // ---- −1. Kat VIP Eğlence Katı ------------------------------------------------------------

  basementAct(playerId, data) { return this.withPlayer(playerId, (p) => this.basement.act(p, data, this.now())); }

  basementRt(playerId, data) {
    const p = this.players.get(playerId);
    return p ? this.basement.relay(p, data) : false;
  }

  // ---- Yeraltı Kart Kulübü ---------------------------------------------------------

  casinoAct(playerId, data) { return this.withPlayer(playerId, (p) => this.casino.act(p, data, this.now())); }

  // ---- Achterstraat canlı müzik sahnesi ------------------------------------------------

  stageAct(playerId, data) { return this.withPlayer(playerId, (p) => this.stage.act(p, data, this.now())); }
  // ---- Akıllı telefon: InstaHotel gönderileri ve reklam kampanyaları ---------------------

  instaAct(playerId, data) { return this.withPlayer(playerId, (p) => this.marketing.act(p, data, this.now())); }

  // ---- Coffee shop (kişisel cüzdan / envanter / trip) -------------------

  buy(playerId, productId) {
    const p = this.players.get(playerId);
    return p ? this.shop.buy(p, productId) : { ok: false };
  }

  consume(playerId, productId) {
    const p = this.players.get(playerId);
    return p ? this.shop.consume(p, productId, this.now()) : { ok: false };
  }

  spin(playerId) {
    const p = this.players.get(playerId);
    return p ? this.shop.spin(p) : { ok: false };
  }

  // ---- Evler (Bizim Ev + oyuncu evleri) ---------------------------------------

  withPlayer(playerId, fn) {
    const p = this.players.get(playerId);
    return p ? fn(p) : { ok: false };
  }

  housePlace(playerId, data) { return this.withPlayer(playerId, (p) => this.house.place(p, data)); }

  houseRemove(playerId, itemId) { return this.withPlayer(playerId, (p) => this.house.remove(p, itemId)); }

  houseLights(playerId) { return this.withPlayer(playerId, (p) => this.house.toggleLights(p)); }

  async houseTvSet(playerId, itemId, link) {
    const p = this.players.get(playerId);
    return p ? this.house.setTv(p, itemId, link) : { ok: false };
  }

  houseTvStop(playerId, itemId) { return this.withPlayer(playerId, (p) => this.house.stopTv(p, itemId)); }

  houseRing(playerId, houseId) { return this.withPlayer(playerId, (p) => this.house.ring(p, houseId)); }

  houseRingAnswer(playerId, ringId, accept) {
    return this.withPlayer(playerId, (p) => this.house.answer(p, ringId, accept));
  }

  // ---- Bar De Tulp -----------------------------------------------------------

  barAct(playerId, data) { return this.withPlayer(playerId, (p) => this.bar.act(p, data, this.now())); }

  // ---- Gurme Restoran & mutfak ----------------------------------------------------

  kitchenAct(playerId, data) { return this.withPlayer(playerId, (p) => this.restaurant.act(p, data, this.now())); }

  // ---- Achterstraat Cadde İmparatorluğu ------------------------------------------------

  streetAct(playerId, data) { return this.withPlayer(playerId, (p) => this.street.act(p, data)); }

  // ---- Ev bahçesi --------------------------------------------------------------

  gardenAct(playerId, data) { return this.withPlayer(playerId, (p) => this.garden.act(p, data)); }

  // ---- Bar müdavimleriyle arkadaşlık --------------------------------------------

  friendAct(playerId, data) { return this.withPlayer(playerId, (p) => this.relations.act(p, data, this.now())); }

  // ---- Ev dış cephesi (graffiti, neon tabela, balkon) ---------------------------------

  exteriorAct(playerId, data) { return this.withPlayer(playerId, (p) => this.exterior.act(p, data)); }

  emote(playerId, type) {
    const p = this.players.get(playerId);
    return p ? this.shop.emote(p, type, this.now()) : false;
  }

  snapshot(selfId) {
    const now = this.now();
    return {
      selfId,
      build: this.config.build ?? null, // sunucu sürümü: değişirse açık sayfalar kendini yeniler
      serverTime: now,
      clock: this.clock.snapshot(now),
      rooms: this.rooms.serialize(),
      guests: [
        ...this.guests.serialize(), ...this.bar.serializeCustomers(), ...this.workers.serializeWires(),
        ...this.stage.serializeWires(), ...this.restaurant.serializeDiners(), ...this.kitchen.serializeWires(), ...this.valet.serializeWires(),
        ...this.basement.serializeWires(),
      ],
      players: [...this.players.values()].map((p) => this.publicPlayer(p)),
      economy: this.economy(),
      self: this.players.has(selfId) ? this.shop.privateState(this.players.get(selfId)) : null,
      house: this.house.serialize(),
      bar: this.bar.serialize(),
      restaurant: this.restaurant.serialize(), // masalar, siparişler, pass, büfe, memnuniyet
      street: this.street.serialize(), // Achterstraat dükkânları: sahiplik, King unvanı, günlük kira
      sleep: this.sleepState(),
      visits: this.relations.serializeVisits(),
      vehicles: this.vehicles.serialize(),
      chat: this.chatLog.slice(),
      hotel: this.hotelPublic(),
      boosts: this.boosts.serialize(),
      counterfeit: this.counterfeit.serialize(),
      exterior: this.exterior.serialize(), // { [houseId]: { sprays, tags, neon, balcony } } (boş cepheler yok)
      casino: this.casino.serialize(selfId),
      stage: this.stage.serialize(), // canlı müzik sahnesi: { owned, booking, phase, setAt… }
      insta: this.marketing.serialize(this.players.get(selfId)), // InstaHotel akışı (fotoğraf yalnızca en yeni 4'te)
      drag: this.drag.serialize(), // drag pisti: faz, ışık ağacı zamanları, son sonuçlar, liderlik tablosu
      valet: this.valet.serialize(), // VIP vale işleri: anahtar, çamur noktaları, hasar
      basement: this.basement.serialize(), // Eğlence Katı: masalar, kulvarlar, atari makineleri, rekorlar
    };
  }
}
