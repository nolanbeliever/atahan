import { EVT, possessive } from '../../shared/constants.js';
import { PLAYER_HOUSES, HOUSE_BY_ID } from '../../shared/layout.js';
import {
  GRAFFITI_BY_ID, NEON_SLOT_BY_ID, NEON_COLORS, BALCONY, BALCONY_ITEMS, BALCONY_ITEM_BY_ID,
  EXT_RULES, FACADE, cleanText, validateTag, validNeonText, frontOfHouse, emptyExterior, isEmptyExterior, roundPos,
} from '../../shared/exterior.js';

// İstemci sayıları sayı olarak gönderir; başka her şey (nesne, dizi, string…) geçersiz sayılır.
// Number()/String() ile ÇEVRİLMEZ ({ toString: 1 } gibi bir nesne çevrilirken TypeError fırlatır).
const num = (v) => (typeof v === 'number' ? v : NaN);
const isIndex = (v, n) => Number.isInteger(v) && v >= 0 && v < n;
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const MAX_TAG_ID = 1e9;

/**
 * Oyuncu evlerinin dış cephesi (sunucu yetkili): graffiti (sprey), neon tabela, balkon.
 *  - Yalnızca ev sahibi, Achterstraat'ta KENDİ evinin önünde dururken düzenler
 *    (HouseService.isOwner + shared/exterior.js frontOfHouse); kurallar shared/exterior.js'te.
 *  - Para kişisel cüzdandan (p.wallet) düşer, ardından sim.shop.sendSelf(p).
 *    Sprey kutusu: €3 → evin sprey stoğuna 4 sıkım; her graffiti 1 sıkım. Silmek, tabelayı
 *    kaldırmak ya da balkon eşyasını sökmek para iade etmez (ev para aktarma yolu olmasın).
 *  - Durum ev başına tutulur ve HouseService kaydının `exterior` alanına yazılır
 *    (persisted / restore — VehicleService ile aynı düzen). Ev boşaltılınca (evict) cephe temizlenir.
 *  - Her değişiklikte o evin tüm cephesi EVT.EXTERIOR_STATE ile herkese gider (küçük nesne,
 *    nadir olay); istemci yalnızca o evi yeniden kurar.
 *
 * Ev cephesi:
 *   { sprays, tags: [{ id, d, c, s, x, y, t? }], neon: { [slot]: { text, c } }, balcony: { c, items: [] } | null }
 */
export class ExteriorService {
  constructor(sim) {
    this.sim = sim;
    this.houses = Object.create(null); // houseId → cephe (yalnızca boş olmayanlar)
    this.nextTagId = Object.create(null); // houseId → sonraki graffiti kimliği
    this.restore(sim.house?.exteriorData);
  }

  // ---- Kalıcılık ---------------------------------------------------------------

  /** Kayıttan yükle: her alan yeniden doğrulanır (bozuk / elle düzenlenmiş dosyaya karşı) */
  restore(data) {
    if (!isObj(data)) return;
    for (const h of PLAYER_HOUSES) {
      if (!own(data, h.id) || !this.sim.house?.owners?.[h.id]) continue; // sahipsiz evin cephesi yok
      const ext = this.parse(data[h.id]);
      if (ext && !isEmptyExterior(ext)) this.houses[h.id] = ext;
    }
  }

  /** Kayıttaki tek bir evin cephesi → temiz nesne (geçersiz parçalar atılır) */
  parse(raw) {
    if (!isObj(raw)) return null;
    const ext = emptyExterior();
    const sprays = num(raw.sprays);
    if (Number.isInteger(sprays) && sprays > 0) ext.sprays = Math.min(sprays, EXT_RULES.MAX_SPRAYS);
    const ids = new Set();
    for (const t of Array.isArray(raw.tags) ? raw.tags.slice(0, EXT_RULES.MAX_TAGS * 2) : []) {
      if (!isObj(t)) continue;
      const id = num(t.id);
      if (!Number.isInteger(id) || id < 1 || id > MAX_TAG_ID || ids.has(id)) continue;
      const tag = this.makeTag(t, typeof t.t === 'string' ? t.t : '');
      if (!tag || !validateTag(ext.tags, tag).ok) continue;
      tag.id = id;
      ids.add(id);
      ext.tags.push(tag);
    }
    const b = raw.balcony;
    if (isObj(b) && isIndex(num(b.c), BALCONY.colors.length)) {
      const items = Array.isArray(b.items) ? b.items : [];
      ext.balcony = { c: b.c, items: BALCONY_ITEMS.filter((it) => items.includes(it.id)).map((it) => it.id) };
    }
    if (isObj(raw.neon)) {
      for (const [slot, n] of Object.entries(raw.neon)) {
        const def = NEON_SLOT_BY_ID[slot];
        if (!def || !isObj(n) || !validNeonText(n.text) || !isIndex(num(n.c), NEON_COLORS.length)) continue;
        if (def.balcony && !ext.balcony) continue;
        ext.neon[def.id] = { text: n.text, c: n.c };
      }
    }
    return ext;
  }

  /** Kayda giden hâl: yalnızca boş olmayan cepheler */
  persisted() {
    const out = {};
    for (const h of PLAYER_HOUSES) {
      const e = this.houses[h.id];
      if (e && !isEmptyExterior(e)) out[h.id] = this.publicState(h.id);
    }
    return out;
  }

  // ---- Durum -----------------------------------------------------------------------

  /** İstemciye giden tek ev cephesi (kopya) */
  publicState(houseId) {
    const e = this.houses[houseId] ?? emptyExterior();
    return {
      sprays: e.sprays,
      tags: e.tags.map((t) => ({ ...t })),
      neon: Object.fromEntries(Object.entries(e.neon).map(([k, v]) => [k, { ...v }])),
      balcony: e.balcony ? { c: e.balcony.c, items: [...e.balcony.items] } : null,
    };
  }

  /** WELCOME snapshot.exterior: { [houseId]: cephe } — yalnızca boş olmayanlar */
  serialize() {
    return this.persisted();
  }

  /** Düzenlemek için evin cephesi (yoksa oluşturulur) */
  ensure(houseId) {
    this.houses[houseId] ??= emptyExterior();
    return this.houses[houseId];
  }

  nextId(houseId) {
    const e = this.houses[houseId];
    const max = e ? e.tags.reduce((m, t) => Math.max(m, t.id), 0) : 0;
    const id = Math.max(this.nextTagId[houseId] ?? 1, max + 1);
    this.nextTagId[houseId] = id + 1;
    return id;
  }

  changed(houseId) {
    const e = this.houses[houseId];
    if (e && isEmptyExterior(e)) delete this.houses[houseId];
    this.sim.out(EVT.EXTERIOR_STATE, { houseId, exterior: this.publicState(houseId) });
    this.sim.house?.scheduleSave();
  }

  /** Ev boşaltıldı (HouseService.evict): cephe temizlenir */
  clear(houseId) {
    if (!this.houses[houseId]) return;
    delete this.houses[houseId];
    delete this.nextTagId[houseId];
    this.changed(houseId);
  }

  // ---- Doğrulama yardımcıları ---------------------------------------------------------

  /** İstemci verisinden graffiti adayı (yalnızca sayı / string tipleri; çevirme yok) */
  makeTag(data, text) {
    const d = typeof data?.d === 'string' ? GRAFFITI_BY_ID[data.d] : undefined;
    if (!d) return null;
    const tag = { d: d.id, c: num(data.c), s: num(data.s), x: roundPos(num(data.x)), y: roundPos(num(data.y)) };
    if (d.text) tag.t = cleanText(text, EXT_RULES.TAG_TEXT_MAX);
    return tag;
  }

  /**
   * Oyuncu düzenleyebilir mi: evi olmalı, Achterstraat'ta o evin önünde durmalı.
   * @returns {{ houseId } | { error }}
   */
  editable(p) {
    const def = frontOfHouse(p.x, p.z);
    const mine = this.sim.house.houseIdOf(p);
    if (def && mine !== def.id) {
      const o = this.sim.house.owners[def.id];
      return { error: o ? `Bu ev ${possessive(o.name)} — cepheyi yalnızca ev sahibi süsleyebilir.` : `${def.name} boş — cepheyi yalnızca ev sahibi süsleyebilir.` };
    }
    if (!mine) return { error: 'Cepheyi süslemek için bir evin olmalı.' };
    if (!def || !this.sim.house.isOwner(p, def.id)) return { error: 'Achterstraat\'ta kendi evinin önüne geç.' };
    return { houseId: def.id };
  }

  pay(p, price, what) {
    if (!(p.wallet >= price)) return `${what} için €${price} gerekli, cüzdanda €${Math.floor(p.wallet || 0)} var.`;
    p.wallet -= price;
    this.sim.shop.sendSelf(p);
    return null;
  }

  // ---- Eylemler -------------------------------------------------------------------

  /**
   * EVT.EXTERIOR_ACT: { act, ... }
   *   'buyCans'                         → sprey kutusu (€3, +4 sıkım)
   *   'tag'    { d, c, s, x, y, t? }    → graffiti (1 sıkım; x yerel, y yükseklik)
   *   'untag'  { id }                   → graffiti'yi sil (iade yok)
   *   'neon'   { slot, text, c }        → neon tabela (€12; aynı yuvadakini değiştirir)
   *   'unneon' { slot }                 → tabelayı kaldır (iade yok)
   *   'balcony' { c }                   → balkon (€25, bir kez)
   *   'item'   { item }                 → balkon eşyası
   *   'unitem' { item }                 → balkon eşyasını sök (iade yok)
   */
  act(p, data) {
    switch (typeof data?.act === 'string' ? data.act : '') {
      case 'buyCans': return this.buyCans(p);
      case 'tag': return this.tag(p, data);
      case 'untag': return this.untag(p, data);
      case 'neon': return this.neon(p, data);
      case 'unneon': return this.unneon(p, data);
      case 'balcony': return this.buyBalcony(p, data);
      case 'item': return this.buyItem(p, data);
      case 'unitem': return this.removeItem(p, data);
      default: return { ok: false, error: 'Geçersiz işlem.' };
    }
  }

  buyCans(p) {
    const { houseId, error } = this.editable(p);
    if (error) return { ok: false, error };
    const cur = this.houses[houseId]?.sprays ?? 0;
    if (cur + EXT_RULES.CAN_SPRAYS > EXT_RULES.MAX_SPRAYS) return { ok: false, error: `Yeterince spreyin var (${cur} sıkım).` };
    const err = this.pay(p, EXT_RULES.CAN_PRICE, 'Sprey kutusu');
    if (err) return { ok: false, error: err };
    const e = this.ensure(houseId);
    e.sprays += EXT_RULES.CAN_SPRAYS;
    this.changed(houseId);
    return { ok: true, sprays: e.sprays };
  }

  tag(p, data) {
    const { houseId, error } = this.editable(p);
    if (error) return { ok: false, error };
    const e = this.houses[houseId];
    if (!e || e.sprays < 1) return { ok: false, error: `Sprey kalmadı — sprey kutusu al (€${EXT_RULES.CAN_PRICE}).` };
    const now = this.sim.now();
    if (p.lastSprayAt !== undefined && now - p.lastSprayAt < EXT_RULES.SPRAY_GAP_MS) return { ok: false, error: 'Bu kadar hızlı olmaz — boya kurusun!' };
    // İsim etiketi: yazıyı istemci değil sunucu yazar (ev sahibinin adı)
    const d = typeof data?.d === 'string' ? GRAFFITI_BY_ID[data.d] : undefined;
    const text = d?.auto ? p.name : data?.t;
    const tag = this.makeTag(data, text);
    if (!tag) return { ok: false, error: 'Böyle bir şablon yok.' };
    const v = validateTag(e.tags, tag);
    if (!v.ok) return v;
    const wx = HOUSE_BY_ID[houseId].bounds.minX + tag.x;
    if (Math.hypot(p.x - wx, p.z - FACADE.OUT) > EXT_RULES.REACH + 1) return { ok: false, error: 'Duvara yaklaş.' };
    p.lastSprayAt = now;
    e.sprays -= 1;
    tag.id = this.nextId(houseId);
    e.tags.push(tag);
    this.changed(houseId);
    return { ok: true, tag: { ...tag }, sprays: e.sprays };
  }

  untag(p, data) {
    const { houseId, error } = this.editable(p);
    if (error) return { ok: false, error };
    const e = this.houses[houseId];
    const id = num(data?.id);
    const i = e && Number.isInteger(id) ? e.tags.findIndex((t) => t.id === id) : -1;
    if (i < 0) return { ok: false, error: 'Graffiti bulunamadı.' };
    e.tags.splice(i, 1);
    this.changed(houseId);
    return { ok: true };
  }

  neon(p, data) {
    const { houseId, error } = this.editable(p);
    if (error) return { ok: false, error };
    const slot = typeof data?.slot === 'string' ? NEON_SLOT_BY_ID[data.slot] : undefined;
    if (!slot) return { ok: false, error: 'Böyle bir tabela yeri yok.' };
    const text = cleanText(data?.text, EXT_RULES.NEON_TEXT_MAX);
    if (!text) return { ok: false, error: 'Önce tabelanın yazısını yaz (T / ✏️).' };
    const c = num(data?.c);
    if (!isIndex(c, NEON_COLORS.length)) return { ok: false, error: 'Geçersiz renk.' };
    const e0 = this.houses[houseId];
    if (slot.balcony && !e0?.balcony) return { ok: false, error: 'Korkuluğa tabela için önce balkon al.' };
    const cur = e0?.neon[slot.id];
    if (cur && cur.text === text && cur.c === c) return { ok: false, error: 'Bu tabela zaten orada.' };
    const err = this.pay(p, EXT_RULES.NEON_PRICE, 'Neon tabela');
    if (err) return { ok: false, error: err };
    this.ensure(houseId).neon[slot.id] = { text, c };
    this.changed(houseId);
    return { ok: true, text };
  }

  unneon(p, data) {
    const { houseId, error } = this.editable(p);
    if (error) return { ok: false, error };
    const slot = typeof data?.slot === 'string' ? NEON_SLOT_BY_ID[data.slot] : undefined;
    const e = this.houses[houseId];
    if (!slot || !e?.neon[slot.id]) return { ok: false, error: 'Orada tabela yok.' };
    delete e.neon[slot.id];
    this.changed(houseId);
    return { ok: true };
  }

  buyBalcony(p, data) {
    const { houseId, error } = this.editable(p);
    if (error) return { ok: false, error };
    const c = num(data?.c);
    if (!isIndex(c, BALCONY.colors.length)) return { ok: false, error: 'Geçersiz renk.' };
    if (this.houses[houseId]?.balcony) return { ok: false, error: 'Evinin zaten bir balkonu var.' };
    const err = this.pay(p, BALCONY.price, 'Balkon');
    if (err) return { ok: false, error: err };
    this.ensure(houseId).balcony = { c, items: [] };
    this.changed(houseId);
    return { ok: true };
  }

  buyItem(p, data) {
    const { houseId, error } = this.editable(p);
    if (error) return { ok: false, error };
    const item = typeof data?.item === 'string' ? BALCONY_ITEM_BY_ID[data.item] : undefined;
    if (!item) return { ok: false, error: 'Böyle bir balkon eşyası yok.' };
    const b = this.houses[houseId]?.balcony;
    if (!b) return { ok: false, error: `Önce balkon al (€${BALCONY.price}).` };
    if (b.items.includes(item.id)) return { ok: false, error: `${item.name} zaten balkonda.` };
    const err = this.pay(p, item.price, item.name);
    if (err) return { ok: false, error: err };
    b.items = BALCONY_ITEMS.filter((it) => it.id === item.id || b.items.includes(it.id)).map((it) => it.id);
    this.changed(houseId);
    return { ok: true };
  }

  removeItem(p, data) {
    const { houseId, error } = this.editable(p);
    if (error) return { ok: false, error };
    const item = typeof data?.item === 'string' ? BALCONY_ITEM_BY_ID[data.item] : undefined;
    const b = this.houses[houseId]?.balcony;
    if (!item || !b?.items.includes(item.id)) return { ok: false, error: 'Balkonda böyle bir eşya yok.' };
    b.items = b.items.filter((id) => id !== item.id);
    this.changed(houseId);
    return { ok: true };
  }
}

