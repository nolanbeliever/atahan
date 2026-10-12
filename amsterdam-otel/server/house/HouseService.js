import { EVT, START_WALLET, NIGHT, possessive } from '../../shared/constants.js';
import {
  HOUSES, PLAYER_HOUSES, HOUSE_BY_ID, SHARED_HOUSE_ID, houseAt, isInsideHouseDef,
} from '../../shared/layout.js';
import {
  FURNITURE_BY_ID, HOUSE_RULES, validatePlacement, blocksPlayer, parseYouTubeId, isYouTubeId, itemBox, PLANT_BY_ID,
} from '../../shared/house.js';

const round2 = (v) => Math.round(v * 100) / 100;
// İstemci sayıları sayı olarak gönderir; başka her şey (nesne, dizi…) geçersiz sayılır.
// Number()/String() ile ÇEVRİLMEZ ({ toString: 1 } gibi bir nesne çevrilirken TypeError fırlatır).
const num = (v) => (typeof v === 'number' ? v : NaN);
const SAVE_DELAY_MS = 1500;
const SAVE_MAX_WAIT_MS = 10_000;
const DAY_MS = 86_400_000;
const EDGE_TOL = 0.3; // "evin içinde mi" için ağ gecikmesi toleransı (m)
const HASH_RE = /^[0-9a-f]{64}$/; // sha256 hex (kayıttaki sahip / cüzdan anahtarları)
const MAX_WALLETS = 2000; // kayıtlı cüzdan sayısı sınırı (en uzun süredir dokunulmayan silinir)
const SHARED = HOUSE_BY_ID[SHARED_HOUSE_ID];
const SAVE_VERSION = 2;

/** İstemciden gelen ev kimliği: yalnızca string ve bilinen bir ev ise */
const houseDef = (id) => (typeof id === 'string' ? HOUSE_BY_ID[id] : undefined);

/**
 * Tolerans bölgesi: Bizim Ev'de batı duvarı ve kapı (sokak) tarafı 0.3 m (doğusu otelin
 * duvarı — lobi sayılmasın); oyuncu evlerinde yalnızca kapı (Achterstraat) tarafı, çünkü
 * yan duvarlar komşu evlerle ortak.
 */
function nearInside(def, x, z) {
  const b = def.bounds;
  if (def.id === SHARED_HOUSE_ID) return x > b.minX - EDGE_TOL && x < b.maxX && z > b.minZ - EDGE_TOL && z < b.maxZ;
  return x > b.minX && x < b.maxX && z > b.minZ - EDGE_TOL && z < b.maxZ;
}

/**
 * Evler — Bizim Ev (ortak, herkes dekore eder) + Achterstraat'taki 8 oyuncu evi.
 * Yetkili: yerleşim kuralları, fiyat/iade, sahiplik, kapı zili, TV videosu ve ışık durumu
 * burada doğrulanır ve oyunculara yayınlanır. Kalıcı oyuncu anahtarının özetiyle (keyHash)
 * ev sahipliği ve cüzdanlar da aynı kayıtta tutulur. İsteğe bağlı `store` ile dosyaya kaydedilir.
 *
 * Kayıt biçimi (v2):
 *   { version: 2, items: [{ id, houseId, type, x, z, rot, color, by, video }], lightsOn,
 *     owners: { [houseId]: { hash, name, seenAt } }, wallets: { [hash]: number } }
 * v1 kayıtları (houseId'siz eşyalar, owners/wallets yok) Bizim Ev'e yüklenir.
 */
export class HouseService {
  /**
   * @param sim       HotelSimulation
   * @param store     { load(): object|null, save(data) } | null
   * @param fetchVideoInfo async (id) => { title?, notFound?, notEmbeddable? }  (YouTube oEmbed)
   */
  constructor(sim, { store = null, fetchVideoInfo = null } = {}) {
    this.sim = sim;
    this.store = store;
    this.fetchVideoInfo = fetchVideoInfo;
    this.items = []; // tüm evlerin eşyaları (her biri houseId taşır; kimlikler ortak sayaçtan)
    this.nextId = 1;
    this.lightsOn = true; // yalnızca Bizim Ev'de ışık anahtarı var
    // Oyuncu evlerinin sahipleri: houseId → { hash, name, seenAt } | null (prototipsiz)
    this.owners = Object.assign(Object.create(null), Object.fromEntries(PLAYER_HOUSES.map((h) => [h.id, null])));
    this.wallets = new Map(); // keyHash → cüzdan (ekleme sırası = son dokunma sırası)
    this.rings = new Map(); // ringId → { id, houseId, visitorId, ownerId, expiresAt }
    this.nextRingId = 1;
    this.saveTimer = null;
    const data = store?.load?.();
    if (data && typeof data === 'object') this.restore(data);
  }

  get startWallet() { return this.sim.config.startWallet ?? START_WALLET; }

  // ---- Kalıcılık ------------------------------------------------------------------

  /** Kayıttan yükle — her eşya kendi evinin kurallarıyla yeniden doğrulanır (bozuk/elle düzenlenmiş dosyaya karşı) */
  restore(data) {
    const items = Array.isArray(data.items) ? data.items : [];
    const counts = Object.create(null);
    for (const raw of items) {
      if (!raw || typeof raw !== 'object') continue;
      // v1: houseId yok → Bizim Ev
      const def = raw.houseId == null ? SHARED : houseDef(raw.houseId);
      if (!def) continue;
      if ((counts[def.id] ?? 0) >= def.maxItems) continue;
      // Elle düzenlenmiş dosyada { toString: 1 } gibi değerler olabilir: çevirme yok, tip denetimi var
      const it = {
        id: num(raw.id),
        houseId: def.id,
        type: typeof raw.type === 'string' ? raw.type : '',
        x: num(raw.x),
        z: num(raw.z),
        rot: num(raw.rot),
        color: num(raw.color),
        by: typeof raw.by === 'string' ? raw.by.slice(0, 16) : '',
        video: null,
      };
      if (raw.starter === true) it.starter = true; // eve hediye gelen yatak (iadesi yok)
      // Saksıdaki bitki: bilinen tür ve sonlu ekim zamanı (mutlak oyun dakikası)
      if (it.type === 'pot' && raw.plant && PLANT_BY_ID[raw.plant.kind] && Number.isFinite(raw.plant.at) && raw.plant.at >= 0) {
        it.plant = { kind: raw.plant.kind, at: raw.plant.at };
      }
      if (!Number.isInteger(it.id) || it.id < 1 || this.items.some((o) => o.id === it.id)) continue;
      if (!validatePlacement(this.itemsIn(def.id), it, def).ok) continue;
      if (it.type === 'tv' && raw.video && isYouTubeId(raw.video.id)) {
        it.video = {
          id: raw.video.id,
          title: typeof raw.video.title === 'string' ? raw.video.title.slice(0, 100) : null,
          by: typeof raw.video.by === 'string' ? raw.video.by.slice(0, 16) : '',
          startedAt: Number.isFinite(raw.video.startedAt) && raw.video.startedAt > 0 ? raw.video.startedAt : this.sim.now(),
        };
      }
      this.items.push(it);
      counts[def.id] = (counts[def.id] ?? 0) + 1;
      this.nextId = Math.max(this.nextId, it.id + 1);
    }
    this.lightsOn = data.lightsOn !== false;

    // Sahipler: yalnızca bilinen oyuncu evleri, geçerli özet; bir anahtar tek ev
    const owners = data.owners && typeof data.owners === 'object' ? data.owners : {};
    const seen = new Set();
    for (const h of PLAYER_HOUSES) {
      const o = owners[h.id];
      if (!o || typeof o !== 'object' || typeof o.hash !== 'string' || !HASH_RE.test(o.hash) || seen.has(o.hash)) continue;
      seen.add(o.hash);
      this.owners[h.id] = {
        hash: o.hash,
        name: typeof o.name === 'string' ? o.name.slice(0, 16) : '',
        seenAt: Number.isFinite(o.seenAt) ? o.seenAt : this.sim.now(),
      };
      if (o.bed === true) this.owners[h.id].bed = true; // hediye yatağı verildi
    }

    // Araçlar (sahip olunanlar + son park yerleri): VehicleService açılışta uygular
    this.vehiclesData = data.vehicles && typeof data.vehicles === 'object' && !Array.isArray(data.vehicles) ? data.vehicles : null;

    // Bar müdavimleriyle arkadaşlıklar: RelationshipService açılışta uygular
    this.friendsData = data.friends && typeof data.friends === 'object' && !Array.isArray(data.friends) ? data.friends : null;

    // Otel durumu (kasa, oyun günü/saati): HotelSimulation açılışta uygular
    this.hotelData = data.hotel && typeof data.hotel === 'object' && !Array.isArray(data.hotel) ? data.hotel : null;

    // Cüzdanlar: sonlu ve ≥ 0 olmayan kayıtlar yok sayılır
    const wallets = data.wallets && typeof data.wallets === 'object' && !Array.isArray(data.wallets) ? data.wallets : {};
    for (const [hash, w] of Object.entries(wallets)) {
      if (this.wallets.size >= MAX_WALLETS) break;
      if (HASH_RE.test(hash) && Number.isFinite(w) && w >= 0) this.wallets.set(hash, w);
    }
  }

  /** İstemciye giden hâl (WELCOME snapshot.house) */
  serialize() {
    return { items: this.items.map((it) => ({ ...it })), lightsOn: this.lightsOn, owners: this.ownersList() };
  }

  /** Dosyaya yazılan hâl: oturumluk alıcı kimliği (byId) kaydedilmez; çevrimiçi sahiplerin seenAt'i şimdi */
  persisted() {
    const now = this.sim.now();
    const owners = {};
    for (const h of PLAYER_HOUSES) {
      const o = this.owners[h.id];
      if (o) owners[h.id] = { hash: o.hash, name: o.name, seenAt: this.onlineOwner(h.id) ? now : o.seenAt, ...(o.bed ? { bed: true } : {}) };
    }
    return {
      version: SAVE_VERSION,
      items: this.items.map(({ byId, ...it }) => it),
      lightsOn: this.lightsOn,
      owners,
      wallets: Object.fromEntries(this.wallets),
      hotel: this.sim.hotelState?.(),
      friends: this.sim.relations?.persisted(),
      vehicles: this.sim.vehicles?.persisted(),
    };
  }

  /** Değişiklikten SAVE_DELAY_MS sonra kaydet; sürekli değişiklikte de en geç SAVE_MAX_WAIT_MS'de bir */
  scheduleSave() {
    if (!this.store) return;
    const now = Date.now();
    this.saveSince ??= now;
    clearTimeout(this.saveTimer);
    const wait = Math.min(SAVE_DELAY_MS, Math.max(0, this.saveSince + SAVE_MAX_WAIT_MS - now));
    this.saveTimer = setTimeout(() => this.flush(), wait);
    this.saveTimer.unref?.();
  }

  flush() {
    clearTimeout(this.saveTimer);
    this.saveTimer = null;
    this.saveSince = null;
    this.store?.save(this.persisted());
  }

  // ---- Oyuncular, sahiplik, cüzdan --------------------------------------------------

  /** HotelSimulation.addPlayer'dan (shop.initPlayer'dan sonra): oturumluk erişim + kayıtlı cüzdan */
  initPlayer(p) {
    p.houseAccess = new Set(); // zili çalıp içeri alındığı evler (yalnızca bu oturum)
    p.ringAt = new Map(); // houseId → son zil zamanı (bekleme süresi)
    if (p.keyHash && this.wallets.has(p.keyHash)) p.wallet = this.wallets.get(p.keyHash);
  }

  /** Oyuncunun sahibi olduğu ev (yoksa null) */
  houseIdOf(p) {
    if (!p?.keyHash) return null;
    for (const h of PLAYER_HOUSES) if (this.owners[h.id]?.hash === p.keyHash) return h.id;
    return null;
  }

  isOwner(p, houseId) {
    return !!p.keyHash && this.owners[houseId]?.hash === p.keyHash;
  }

  /** Evin çevrimiçi sahibi (oyuncu nesnesi) — `exclude` ayrılmakta olan oyuncu */
  onlineOwner(houseId, exclude = null) {
    const o = this.owners[houseId];
    if (!o) return null;
    for (const p of this.sim.players.values()) if (p !== exclude && p.keyHash === o.hash) return p;
    return null;
  }

  /** HOUSE_OWNERS / snapshot.house.owners: [{ houseId, owner: { name, online, playerId } | null }] */
  ownersList(exclude = null) {
    return PLAYER_HOUSES.map((h) => {
      const o = this.owners[h.id];
      if (!o) return { houseId: h.id, owner: null };
      const p = this.onlineOwner(h.id, exclude);
      return { houseId: h.id, owner: { name: o.name, online: !!p, playerId: p ? p.id : null } };
    });
  }

  broadcastOwners(exclude = null) {
    this.sim.out(EVT.HOUSE_OWNERS, this.ownersList(exclude));
  }

  /**
   * Anahtarlı oyuncu katılınca ev ataması (oyuncu sim.players'a eklendikten sonra):
   * sahibi olduğu ev → adı/seenAt güncellenir; yoksa ilk boş ev; o da yoksa sahibi
   * OWNER_EVICT_DAYS günden uzun süredir gelmeyen (en eski) ev boşaltılıp verilir; yoksa evsiz.
   * @returns houseId | null
   */
  assignHouse(p) {
    if (!p.keyHash) return null;
    const now = this.sim.now();
    let id = this.houseIdOf(p);
    if (!id) id = PLAYER_HOUSES.find((h) => !this.owners[h.id])?.id ?? null;
    if (!id) {
      let oldest = null;
      for (const h of PLAYER_HOUSES) {
        const o = this.owners[h.id];
        if (now - o.seenAt <= HOUSE_RULES.OWNER_EVICT_DAYS * DAY_MS || this.onlineOwner(h.id)) continue;
        if (!oldest || o.seenAt < this.owners[oldest].seenAt) oldest = h.id;
      }
      if (oldest) this.evict(oldest);
      id = oldest;
    }
    if (!id) return null;
    const prev = this.owners[id];
    this.owners[id] = { hash: p.keyHash, name: p.name, seenAt: now };
    if (prev?.hash === p.keyHash && prev.bed) this.owners[id].bed = true;
    this.giveStarterBed(id);
    this.broadcastOwners();
    this.scheduleSave();
    return id;
  }

  /**
   * Yeni ev sahibine bir kez hediye yatak (gece uyuyabilsin). Yatak satılırsa yenisi
   * verilmez; hediye yatağın iadesi de yoktur (para basma döngüsü olmasın).
   */
  giveStarterBed(houseId) {
    const o = this.owners[houseId];
    if (!o || o.bed || this.sim.config.starterBed === false) return;
    const def = HOUSE_BY_ID[houseId];
    const items = this.itemsIn(houseId);
    o.bed = true;
    if (items.some((it) => it.type === 'bed') || items.length >= def.maxItems) return;
    const I = def.inner;
    const bed = FURNITURE_BY_ID.bed;
    // Arka duvar köşeleri (başucu duvarda), sonra yan duvar boyunca
    const spots = [
      { x: I.maxX - bed.w / 2, z: I.maxZ - bed.d / 2, rot: 2 },
      { x: I.minX + bed.w / 2, z: I.maxZ - bed.d / 2, rot: 2 },
      { x: I.maxX - bed.d / 2, z: (I.minZ + I.maxZ) / 2, rot: 3 },
    ];
    for (const sp of spots) {
      const c = { type: 'bed', x: round2(sp.x), z: round2(sp.z), rot: sp.rot, color: 0 };
      if (!validatePlacement(items, c, def).ok) continue;
      const item = { id: this.nextId++, houseId, ...c, by: o.name, video: null, starter: true };
      this.items.push(item);
      this.sim.out(EVT.HOUSE_ADDED, item);
      return;
    }
  }

  // ---- Yatak / uyku -------------------------------------------------------------

  /**
   * Oyuncu şu an yatabileceği bir yatağın yanında mı: kendi evi, Bizim Ev ya da içeri alındığı ev.
   * @returns {{ ok: true, item } | { ok: false, error }}
   */
  bedFor(p) {
    const def = this.houseFor(p.x, p.z);
    if (!def) return { ok: false, error: 'Uyumak için evine git (Achterstraat).' };
    if (def.owned && !this.isOwner(p, def.id) && !p.houseAccess?.has(def.id)) {
      return { ok: false, error: 'Burası senin evin değil.' };
    }
    let best = null;
    let bestD = Infinity;
    for (const it of this.itemsIn(def.id)) {
      if (it.type !== 'bed') continue;
      const b = itemBox(FURNITURE_BY_ID.bed, it);
      const d = Math.hypot(p.x - Math.min(Math.max(p.x, b.minX), b.maxX), p.z - Math.min(Math.max(p.z, b.minZ), b.maxZ));
      if (d < bestD) {
        bestD = d;
        best = it;
      }
    }
    if (!best) return { ok: false, error: 'Bu evde yatak yok — dekor modundan bir yatak al.' };
    if (bestD > NIGHT.BED_RANGE + 0.5) return { ok: false, error: 'Yatağa yaklaş.' };
    return { ok: true, item: best };
  }

  /** Evi boşalt: eşyalar silinir (her biri yayınlanır), eski sahibin verdiği misafir erişimleri düşer */
  evict(houseId) {
    for (const it of this.itemsIn(houseId)) {
      this.items.splice(this.items.indexOf(it), 1);
      this.sim.out(EVT.HOUSE_REMOVED, it.id);
    }
    for (const o of this.sim.players.values()) o.houseAccess?.delete(houseId);
    this.owners[houseId] = null;
  }

  /** Cüzdanı kaydet (CoffeeShopService.sendSelf ve oyuncu çıkışı çağırır); bozuk değer yazılmaz */
  saveWallet(p) {
    if (!p.keyHash) return;
    const w = p.wallet;
    if (!Number.isFinite(w) || w < 0) return;
    const had = this.wallets.has(p.keyHash);
    if (w === this.startWallet) {
      // Başlangıç cüzdanı varsayılan zaten: kayıt tutmaya gerek yok
      if (!had) return;
      this.wallets.delete(p.keyHash);
    } else {
      if (had && this.wallets.get(p.keyHash) === w) return;
      this.wallets.delete(p.keyHash); // sona taşı (son dokunma sırası)
      this.wallets.set(p.keyHash, w);
      if (this.wallets.size > MAX_WALLETS) this.wallets.delete(this.wallets.keys().next().value);
    }
    this.scheduleSave();
  }

  /**
   * Oyuncu ayrılırken (sim.players'tan silinmeden ÖNCE): bekleyen ziller iptal
   * (ziyaretçiyse sessizce; ev sahibiyse ziyaretçilere 'owner-left'), cüzdan ve seenAt kaydı.
   */
  removePlayer(p) {
    for (const r of [...this.rings.values()]) {
      if (r.visitorId === p.id) {
        this.rings.delete(r.id);
      } else if (r.ownerId === p.id) {
        this.rings.delete(r.id);
        this.sim.toPlayer(r.visitorId, EVT.HOUSE_ACCESS, { houseId: r.houseId, granted: false, by: p.name, reason: 'owner-left' });
      }
    }
    this.saveWallet(p);
    const id = this.houseIdOf(p);
    if (id) {
      this.owners[id].seenAt = this.sim.now();
      this.broadcastOwners(p);
      this.scheduleSave();
    }
  }

  // ---- Konum yardımcıları -----------------------------------------------------------

  itemsIn(houseId) {
    return this.items.filter((it) => it.houseId === houseId);
  }

  /** (x, z) hangi evde — önce kesin iç alan, sonra kapı tarafı toleransı */
  houseFor(x, z) {
    const h = houseAt(x, z);
    if (h) return h;
    for (const d of HOUSES) if (nearInside(d, x, z)) return d;
    return null;
  }

  /** Oyuncu bu evin içinde mi (ağ gecikmesi için küçük tolerans) */
  inHouse(p, def) {
    return isInsideHouseDef(def, p.x, p.z) || nearInside(def, p.x, p.z);
  }

  /** Eski API: oyuncu Bizim Ev'in içinde mi */
  inside(p) {
    return this.inHouse(p, SHARED);
  }

  find(id) {
    const n = num(id);
    return this.items.find((it) => it.id === n);
  }

  /** Oyuncu evinde düzenleme yetkisi yoksa hata metni */
  editError(p, def) {
    if (!def.owned || this.isOwner(p, def.id)) return null;
    const o = this.owners[def.id];
    return o
      ? `Bu ev ${possessive(o.name)} — yalnızca ev sahibi düzenleyebilir.`
      : `${def.name} şu an boş — yalnızca ev sahibi düzenleyebilir.`;
  }

  // ---- Dekorasyon -------------------------------------------------------------

  place(p, data) {
    // houseId istemciden ALINMAZ: oyuncunun durduğu ev
    const def = this.houseFor(p.x, p.z);
    if (!def) return { ok: false, error: 'Dekorasyon için evin içinde olmalısın.' };
    const denied = this.editError(p, def);
    if (denied) return { ok: false, error: denied };
    const items = this.itemsIn(def.id);
    if (items.length >= def.maxItems) return { ok: false, error: `Evde en fazla ${def.maxItems} eşya olabilir.` };
    const c = {
      type: typeof data?.type === 'string' ? data.type : '',
      x: round2(num(data?.x)),
      z: round2(num(data?.z)),
      rot: num(data?.rot),
      color: num(data?.color),
    };
    const v = validatePlacement(items, c, def);
    if (!v.ok) return v;
    if (Math.hypot(p.x - c.x, p.z - c.z) > HOUSE_RULES.REACH) return { ok: false, error: 'Bu kadar uzağa yerleştiremezsin.' };
    const fdef = FURNITURE_BY_ID[c.type];
    for (const o of this.sim.players.values()) {
      if (!blocksPlayer(fdef, c, o.x, o.z)) continue;
      return { ok: false, error: o === p ? 'Durduğun yere koyamazsın, biraz geri çekil.' : `${o.name} orada duruyor.` };
    }
    if (!(p.wallet >= fdef.price)) return { ok: false, error: `${fdef.name} için €${fdef.price} gerekli.` };

    p.wallet -= fdef.price;
    // byId: Bizim Ev'de iade yalnızca bu oturumda eşyayı alan oyuncuya (kayda yazılmaz;
    // yeniden başlatınca kimlikler sıfırlanır). Aksi halde ortak ev, anahtarsız oyuncunun her
    // girişte yenilenen cüzdanından sınırsız para aktarmanın yolu olurdu.
    const item = { id: this.nextId++, houseId: def.id, ...c, by: p.name, byId: p.id, video: null };
    this.items.push(item);
    this.sim.shop.sendSelf(p);
    this.sim.out(EVT.HOUSE_ADDED, item);
    this.scheduleSave();
    return { ok: true, item };
  }

  remove(p, id) {
    const it = this.find(id);
    if (!it) return { ok: false, error: 'Eşya bulunamadı.' };
    const def = HOUSE_BY_ID[it.houseId];
    if (!this.inHouse(p, def)) return { ok: false, error: 'Evin içinde olmalısın.' };
    const denied = this.editError(p, def);
    if (denied) return { ok: false, error: denied };
    if (Math.hypot(p.x - it.x, p.z - it.z) > HOUSE_RULES.REACH) return { ok: false, error: 'Eşyaya yaklaş.' };
    const fdef = FURNITURE_BY_ID[it.type];
    // Oyuncu evinde iade sahibine (cüzdanı kalıcı); Bizim Ev'de yalnızca bu oturumda alana
    const refund = !it.starter && (def.owned || it.byId === p.id) ? Math.floor(fdef.price * HOUSE_RULES.REFUND) : 0;
    this.items.splice(this.items.indexOf(it), 1);
    if (refund) {
      p.wallet += refund;
      this.sim.shop.sendSelf(p);
    }
    this.sim.out(EVT.HOUSE_REMOVED, it.id);
    this.scheduleSave();
    return { ok: true, refund };
  }

  /** Işık anahtarı yalnızca Bizim Ev'de */
  toggleLights(p) {
    if (!this.inHouse(p, SHARED)) return { ok: false, error: 'Evin içinde olmalısın.' };
    const [sx, sz] = SHARED.lightSwitch;
    if (Math.hypot(p.x - sx, p.z - sz) > HOUSE_RULES.SWITCH_RANGE + 1) return { ok: false, error: 'Anahtara yaklaş.' };
    this.lightsOn = !this.lightsOn;
    this.sim.out(EVT.HOUSE_LIGHTS_STATE, this.lightsOn);
    this.scheduleSave();
    return { ok: true, lightsOn: this.lightsOn };
  }

  // ---- Televizyon ---------------------------------------------------------------

  /** TV kumandası: TV'nin evinde ve yakınında; oyuncu evinde sahibi ya da içeri alınmış misafir */
  tvFor(p, itemId) {
    const it = this.find(itemId);
    if (!it || it.type !== 'tv') return { error: 'Televizyon bulunamadı.' };
    const def = HOUSE_BY_ID[it.houseId];
    if (!this.inHouse(p, def)) return { error: 'Evin içinde olmalısın.' };
    if (def.owned && !this.isOwner(p, def.id) && !p.houseAccess?.has(def.id)) {
      return { error: 'Bu televizyonu yalnızca ev sahibi ve içeri aldığı misafirler kullanabilir.' };
    }
    if (Math.hypot(p.x - it.x, p.z - it.z) > HOUSE_RULES.TV_RANGE + 1) return { error: 'Televizyona yaklaş.' };
    return { it };
  }

  async setTv(p, itemId, link) {
    const { it, error } = this.tvFor(p, itemId);
    if (error) return { ok: false, error };
    const id = parseYouTubeId(link);
    if (!id) return { ok: false, error: 'Geçerli bir YouTube linki değil.' };

    let title = null;
    if (this.fetchVideoInfo) {
      try {
        const info = await this.fetchVideoInfo(id);
        if (info?.notFound) return { ok: false, error: 'Bu video bulunamadı.' };
        if (info?.notEmbeddable) return { ok: false, error: 'Bu video başka sitelerde oynatılmaya izin vermiyor.' };
        title = typeof info?.title === 'string' ? info.title.slice(0, 100) : null;
      } catch {
        title = null; // YouTube'a ulaşılamazsa yine de oynatmayı dene
      }
    }
    // Beklerken eşya kaldırılmış (ya da ev boşaltılmış) olabilir
    if (!this.items.includes(it)) return { ok: false, error: 'Televizyon kaldırılmış.' };
    it.video = { id, title, by: p.name, startedAt: this.sim.now() };
    this.sim.out(EVT.HOUSE_TV_STATE, { itemId: it.id, video: it.video });
    this.scheduleSave();
    return { ok: true, video: it.video };
  }

  stopTv(p, itemId) {
    const { it, error } = this.tvFor(p, itemId);
    if (error) return { ok: false, error };
    it.video = null;
    this.sim.out(EVT.HOUSE_TV_STATE, { itemId: it.id, video: null });
    this.scheduleSave();
    return { ok: true };
  }

  // ---- Kapı zili ----------------------------------------------------------------

  /**
   * Ziyaretçi bir oyuncu evinin zilini çalar (kapının önünde, evin dışında).
   * @returns {{ ok: true, owner: true } | { ok: true, granted: true } | { ok: true, pending: true, expiresAt }
   *          | { ok: false, error }}
   */
  ring(p, houseId) {
    const def = houseDef(houseId);
    if (!def) return { ok: false, error: 'Böyle bir ev yok.' };
    if (!def.owned) return { ok: false, error: 'Bizim Ev herkese açık — zil çalmana gerek yok.' };
    const [dx, dz] = def.doorPoint;
    if (isInsideHouseDef(def, p.x, p.z) || Math.hypot(p.x - dx, p.z - dz) > HOUSE_RULES.DOOR_RANGE + 1) {
      return { ok: false, error: 'Zili çalmak için kapının önüne gel.' };
    }
    const o = this.owners[def.id];
    if (!o) return { ok: false, error: `${def.name} şu an boş — kimse oturmuyor.` };
    if (o.hash === p.keyHash) return { ok: true, owner: true };
    const owner = this.onlineOwner(def.id);
    if (!owner) return { ok: false, error: `${o.name} şu an çevrimiçi değil.` };
    if (p.houseAccess.has(def.id)) return { ok: true, granted: true };
    const now = this.sim.now();
    // Ziyaretçi başına ev başına tek bekleyen zil
    for (const r of this.rings.values()) {
      if (r.visitorId === p.id && r.houseId === def.id) return { ok: true, pending: true, expiresAt: r.expiresAt };
    }
    const last = p.ringAt.get(def.id);
    if (last !== undefined && now - last < HOUSE_RULES.RING_COOLDOWN_MS) {
      const s = Math.ceil((HOUSE_RULES.RING_COOLDOWN_MS - (now - last)) / 1000);
      return { ok: false, error: `Zili bu kadar sık çalamazsın — ${s} sn bekle.` };
    }
    p.ringAt.set(def.id, now);
    const r = { id: this.nextRingId++, houseId: def.id, visitorId: p.id, ownerId: owner.id, expiresAt: now + HOUSE_RULES.RING_TIMEOUT_MS };
    this.rings.set(r.id, r);
    this.sim.toPlayer(owner.id, EVT.HOUSE_RING_REQ, {
      ringId: r.id, houseId: r.houseId, visitorId: p.id, visitorName: p.name, expiresAt: r.expiresAt,
    });
    return { ok: true, pending: true, expiresAt: r.expiresAt };
  }

  /**
   * Ev sahibi zile yanıt verir. Kabulde misafir bu oturum boyunca eve girebilir
   * (p.houseAccess) ve TV'yi kullanabilir; eşyalara dokunamaz.
   * @returns {{ ok: true, granted: boolean } | { ok: false, error }}
   */
  answer(owner, ringId, accept) {
    if (typeof ringId !== 'number' || typeof accept !== 'boolean') return { ok: false, error: 'Geçersiz yanıt.' };
    const r = this.rings.get(ringId);
    if (!r || r.ownerId !== owner.id) return { ok: false, error: 'Bu zil artık geçerli değil.' };
    this.rings.delete(r.id);
    const visitor = this.sim.players.get(r.visitorId);
    if (!visitor) return { ok: false, error: 'Ziyaretçi gitmiş.' };
    if (accept) {
      visitor.houseAccess.add(r.houseId);
      this.sim.toPlayer(visitor.id, EVT.HOUSE_ACCESS, { houseId: r.houseId, granted: true, by: owner.name });
    } else {
      this.sim.toPlayer(visitor.id, EVT.HOUSE_ACCESS, { houseId: r.houseId, granted: false, by: owner.name, reason: 'declined' });
    }
    return { ok: true, granted: accept };
  }

  /** Yanıtlanmayan zillerin süresi dolar (HotelSimulation.tick) */
  update(now) {
    if (!this.rings.size) return;
    for (const r of [...this.rings.values()]) {
      if (now < r.expiresAt) continue;
      this.rings.delete(r.id);
      const owner = this.sim.players.get(r.ownerId);
      this.sim.toPlayer(r.visitorId, EVT.HOUSE_ACCESS, {
        houseId: r.houseId, granted: false, by: owner?.name ?? null, reason: 'timeout',
      });
    }
  }
}
