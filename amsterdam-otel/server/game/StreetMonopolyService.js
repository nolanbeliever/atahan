import { EVT, formatMoney } from '../../shared/constants.js';
import { STREET_PROPS, STREET_PROP_BY_ID, STREET_RULES as R } from '../../shared/street.js';

const str = (v) => (typeof v === 'string' ? v : '');
const HASH_RE = /^[0-9a-f]{64}$/;
// Satın alma yolları: dükkân kapısı, Resepsiyon PC, akıllı telefon ("Achterstraat Real Estate")
const VIAS = Object.freeze(Object.assign(Object.create(null), { door: true, pc: true, phone: true }));

/** Mülk sahibinin kalıcı kimliği: anahtar özeti, anahtarsız oyuncuda 'ad:<isim>' */
const identity = (o) => o.key ?? `ad:${o.by}`;
const playerIdentity = (p) => p.keyHash ?? `ad:${p.name}`;

/**
 * Achterstraat Cadde İmparatorluğu — sunucu yetkili.
 *  - Caddedeki 10 mülk (shared/street.js) oyuncunun KİŞİSEL CÜZDANINDAN satın alınır: dükkân kapısının önünde,
 *    Resepsiyon PC'nin başında ya da telefondaki "Achterstraat Real Estate" uygulamasıyla (her yerden). Mülk o
 *    oyuncunundur; tabelası otelin markasına geçer ("… · by Hotel De Tulp").
 *  - Her oyun günü başında (uyuyarak gün atlama dahil) her dükkânın kirası SAHİBİNİN cüzdanına: çevrimiçiyse
 *    hemen, çevrimdışı anahtarlı oyuncunun kayıtlı cüzdanına; anahtarsız (kalıcı kimliği olmayan) oyuncunun
 *    kirası birikir ve aynı adla döndüğünde ödenir.
 *  - Bütün caddeye TEK oyuncu sahip olunca "Achterstraat King 👑" unvanı onun olur; otel tek seferlik itibar ve
 *    kalıcı prestij (oda ücretleri +%10) kazanır, herkese duyurulur.
 *  - Kalıcı: hotelState.street = { owned: { id: { by, key } }, king: { name, key } | null, pending: { ad:isim: € } }.
 *    Anahtar özetleri hiçbir yayına girmez.
 */
export class StreetMonopolyService {
  constructor(sim) {
    this.sim = sim;
    this.owned = new Map(); // mülk id → { by: sahibin adı, key: anahtar özeti | null }
    this.king = null; // { name, key }
    this.pending = new Map(); // 'ad:<isim>' → anahtarsız çevrimdışı sahibin biriken kirası
  }

  /** Kalıcı prestij: oda ücreti çarpanı (GuestManager) */
  get priceFactor() { return this.king ? R.KING_ROOM_PRICE : 1; }

  /** Bu kimliğin sahip olduğu mülkler */
  propsOf(id) {
    const out = [];
    for (const [pid, o] of this.owned) if (identity(o) === id) out.push(STREET_PROP_BY_ID[pid]);
    return out;
  }

  // ---- Kalıcılık -------------------------------------------------------------------------

  persisted() {
    const owned = {};
    for (const [id, o] of this.owned) owned[id] = { by: o.by, key: o.key };
    return {
      owned,
      king: this.king ? { name: this.king.name, key: this.king.key } : null,
      pending: Object.fromEntries(this.pending),
    };
  }

  restore(s) {
    if (!s || typeof s !== 'object') return;
    const cleanKey = (k) => (typeof k === 'string' && HASH_RE.test(k) ? k : null);
    const owned = s.owned && typeof s.owned === 'object' && !Array.isArray(s.owned) ? s.owned : {};
    for (const [id, o] of Object.entries(owned)) {
      if (!STREET_PROP_BY_ID[id] || !o || typeof o !== 'object') continue;
      this.owned.set(id, { by: cleanName(o.by), key: cleanKey(o.key) });
    }
    const pending = s.pending && typeof s.pending === 'object' && !Array.isArray(s.pending) ? s.pending : {};
    for (const [k, v] of Object.entries(pending)) {
      if (k.startsWith('ad:') && k.length <= 19 && Number.isFinite(v) && v > 0) this.pending.set(k, Math.min(Math.floor(v), 1e7));
    }
    // Unvan yalnızca bütün cadde gerçekten aynı sahibinse geri gelir
    const k = s.king;
    if (k && typeof k === 'object') {
      const king = { name: cleanName(k.name), key: cleanKey(k.key) };
      if (this.propsOf(identity({ by: king.name, key: king.key })).length === STREET_PROPS.length) this.king = king;
    }
  }

  // ---- Durum -----------------------------------------------------------------------------

  /** Kimliği çevrimiçi bir oyuncuya ait mi (oyuncu kimliği) */
  onlineId(id) {
    for (const p of this.sim.players.values()) if (playerIdentity(p) === id) return p.id;
    return null;
  }

  serialize() {
    const owned = {};
    for (const [id, o] of this.owned) owned[id] = { by: o.by, pid: this.onlineId(identity(o)) };
    return {
      owned, // { id: { by: sahibin adı, pid: çevrimiçiyse oyuncu kimliği } }
      king: this.king ? this.king.name : null,
      kingId: this.king ? this.onlineId(identity(this.king)) : null,
    };
  }

  changed() { this.sim.out(EVT.STREET_STATE, this.serialize()); }

  /** Oyuncu bağlanınca: biriken kirası (anahtarsız) ödenir; sahiplik / taç etiketleri tazelenir */
  onJoin(p) {
    const id = playerIdentity(p);
    const due = this.pending.get(id);
    if (due) {
      this.pending.delete(id);
      p.wallet += due;
      this.sim.shop.sendSelf(p);
      this.sim.toPlayer(p.id, EVT.NOTIFY, { text: `🏘️ Yokken biriken Achterstraat kiran cüzdanına geçti: +${formatMoney(due)}`, kind: 'money' });
      this.sim.house.scheduleSave();
    }
    if (this.owned.size) this.changed();
  }

  onLeave() {
    if (this.owned.size && this.sim.players.size) this.changed();
  }

  // ---- Satın alma ------------------------------------------------------------------------

  act(p, data) {
    if (str(data?.act) !== 'buy') return { ok: false, error: 'Geçersiz işlem.' };
    const prop = STREET_PROP_BY_ID[str(data?.id)];
    if (!prop) return { ok: false, error: 'Böyle bir mülk yok.' };
    const via = str(data?.via);
    if (!VIAS[via]) return { ok: false, error: 'Geçersiz işlem.' };
    if (via === 'door' && Math.hypot(p.x - prop.point[0], p.z - prop.point[1]) > R.RANGE + 1) {
      return { ok: false, error: 'Dükkânın kapısına yaklaş.' };
    }
    if (via === 'pc' && !this.sim.growth.nearPc(p)) return { ok: false, error: 'Resepsiyon bilgisayarının başında olmalısın.' };
    if (p.sleeping) return { ok: false, error: 'Uyurken emlak alınmaz.' };
    const o = this.owned.get(prop.id);
    if (o) return { ok: false, error: identity(o) === playerIdentity(p) ? `${prop.name} zaten senin.` : `${prop.name} ${o.by} adına kayıtlı — satılık değil.` };
    if (!(p.wallet >= prop.price)) return { ok: false, error: `Cüzdanında yeterli para yok (${formatMoney(prop.price)} gerekiyor).` };

    p.wallet -= prop.price;
    this.owned.set(prop.id, { by: p.name, key: p.keyHash ?? null });
    this.sim.shop.sendSelf(p); // cüzdan (anahtarlıysa kalıcı)
    this.sim.notify(`🏘️ ${prop.icon} ${prop.name} artık ${p.name} adına kayıtlı — "by ${R.BRAND}" tabelası asıldı, sahibine her gün ${formatMoney(prop.rent)} kira.`, 'day');
    const mine = this.propsOf(playerIdentity(p)).length;
    if (mine === STREET_PROPS.length && !this.king) this.crown(p);
    this.changed();
    this.sim.house.scheduleSave();
    return { ok: true, id: prop.id, wallet: p.wallet, owned: mine, king: !!this.king };
  }

  /** Bütün cadde tek oyuncunun: unvan + otel prestiji */
  crown(p) {
    this.king = { name: p.name, key: p.keyHash ?? null };
    this.sim.growth.addReputation(R.KING_REPUTATION);
    this.sim.notify(`👑 ${p.name} artık "${R.KING_TITLE}"! Achterstraat'ın bütün dükkânlarının sahibi o, hepsi Hotel De Tulp tabelalı — otelin prestiji yükseldi: +${R.KING_REPUTATION} itibar, oda ücretleri kalıcı olarak +%${Math.round((R.KING_ROOM_PRICE - 1) * 100)}.`, 'day');
    this.sim.hotelChanged();
  }

  // ---- Günlük kira -------------------------------------------------------------------------

  /** Her oyun günü başında (HotelSimulation.onNewDay): her sahibin kirası kendi cüzdanına */
  onNewDay() {
    if (!this.owned.size) return;
    const byOwner = new Map(); // kimlik → { amount, n }
    for (const [id, o] of this.owned) {
      const k = identity(o);
      const cur = byOwner.get(k) ?? { amount: 0, n: 0 };
      cur.amount += STREET_PROP_BY_ID[id].rent;
      cur.n += 1;
      byOwner.set(k, cur);
    }
    for (const [k, { amount, n }] of byOwner) this.payRent(k, amount, n);
    this.sim.house.scheduleSave();
  }

  payRent(k, amount, n) {
    for (const p of this.sim.players.values()) {
      if (playerIdentity(p) !== k) continue;
      p.wallet += amount;
      this.sim.shop.sendSelf(p); // anahtarlıysa cüzdan kaydedilir
      this.sim.toPlayer(p.id, EVT.NOTIFY, { text: `🏘️ Achterstraat kira gelirin: +${formatMoney(amount)} (${n} dükkân) cüzdanına`, kind: 'money' });
      return;
    }
    if (k.startsWith('ad:')) {
      // Kalıcı kimliği olmayan çevrimdışı sahip: aynı adla dönünce ödenir
      this.pending.set(k, Math.min((this.pending.get(k) ?? 0) + amount, 1e7));
      return;
    }
    // Çevrimdışı anahtarlı sahip: kayıtlı cüzdanına yaz (bağlanınca yüklenir)
    const house = this.sim.house;
    if (!house?.wallets) return;
    const w = house.wallets.has(k) ? house.wallets.get(k) : house.startWallet;
    if (!Number.isFinite(w)) return;
    house.wallets.delete(k); // sona taşı (son dokunma sırası)
    house.wallets.set(k, w + amount);
  }
}

function cleanName(v) {
  if (typeof v !== 'string') return 'Görevli';
  return v.replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, 16) || 'Görevli';
}
