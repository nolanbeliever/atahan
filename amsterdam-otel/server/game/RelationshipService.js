import { EVT, DRINK_BY_ID } from '../../shared/constants.js';
import { BAR, HOUSE_BY_ID, isInsideHouseDef } from '../../shared/layout.js';
import { FURNITURE_BY_ID, itemBox, doorZone } from '../../shared/house.js';
import {
  REGULAR_BY_NAME, TOPIC_BY_ID, JOKES, FRIEND_RULES as F, topicFit, clampLevel,
} from '../../shared/friends.js';

const HASH_RE = /^[0-9a-f]{64}$/;
const MAX_SAVED = 2000; // kayıtlı oyuncu sayısı sınırı (en eski silinir)
const SEATS = new Set(['sofa', 'cornerSofa', 'armchair', 'beanbag']);
const r2 = (v) => Math.round(v * 100) / 100;

const REPLY = Object.freeze({
  love: (n, t) => `${n}: "${t} mı? En sevdiğim konu! Saatlerce konuşabilirim." 🤩`,
  like: (n, t) => `${n}: "${t} güzel konu, ben de severim." 🙂`,
  neutral: (n) => `${n}: "Hmm, olabilir… Pek bilmiyorum açıkçası."`,
  dislike: (n, t) => `${n}: "${t} bana hiç hitap etmiyor, başka bir şey konuşalım mı?" 😕`,
});

/**
 * Bar De Tulp müdavimleriyle arkadaşlık (sunucu yetkili).
 *  - Barda oturan müşteriye: sohbet (konu seçimi), espri, içecek ısmarlama — müşterinin
 *    her ziyaretinde her eylem bir kez (spam yok). Doğru seçimler seviyeyi artırır.
 *  - Seviye kişi başına %0–100; anahtarlı oyuncularda kalıcıdır (evler kaydıyla birlikte).
 *  - %80'de eve davet: müşteri bardan kalkar, oyuncunun Achterstraat'taki evinde belirir.
 *    Evde sohbet edilir, TV'de birlikte video izlenir. Ziyaret 23:00'te (otel kapanınca),
 *    ev sahibi uğurlayınca ya da oyundan çıkınca biter. Keyifli geçen ziyaret ertesi gün
 *    oda bahşişlerine +%20 moral bonusu verir.
 */
export class RelationshipService {
  constructor(sim) {
    this.sim = sim;
    this.saved = new Map(); // keyHash → { levels: { [ad]: seviye }, moodDay }
    this.visits = new Map(); // ownerId → ziyaret
    this.restore(sim.house.friendsData);
  }

  get rng() { return this.sim.rng; }

  // ---- Kalıcılık ---------------------------------------------------------------

  restore(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) return;
    for (const [hash, rec] of Object.entries(data)) {
      if (this.saved.size >= MAX_SAVED) break;
      if (!HASH_RE.test(hash) || !rec || typeof rec !== 'object') continue;
      const levels = Object.create(null);
      const src = rec.levels && typeof rec.levels === 'object' ? rec.levels : {};
      for (const [name, lv] of Object.entries(src)) {
        if (REGULAR_BY_NAME[name] && Number.isFinite(lv)) levels[name] = clampLevel(lv);
      }
      const moodDay = Number.isInteger(rec.moodDay) && rec.moodDay >= 0 ? rec.moodDay : null;
      this.saved.set(hash, { levels, moodDay });
    }
  }

  persisted() {
    const out = {};
    for (const [hash, rec] of this.saved) out[hash] = { levels: { ...rec.levels }, moodDay: rec.moodDay };
    return out;
  }

  // ---- Oyuncular ---------------------------------------------------------------

  initPlayer(p) {
    const rec = p.keyHash ? this.saved.get(p.keyHash) : null;
    p.friends = Object.assign(Object.create(null), rec?.levels ?? {});
    p.moodDay = rec?.moodDay ?? null;
  }

  /** Oyuncu ayrılırken: ev sahibiyse misafiri gider */
  removePlayer(p) {
    const v = this.visits.get(p.id);
    if (v) this.endVisit(v, 'left');
  }

  store(p) {
    if (!p.keyHash) return;
    this.saved.delete(p.keyHash); // sona taşı (son dokunma sırası)
    this.saved.set(p.keyHash, { levels: { ...p.friends }, moodDay: p.moodDay });
    if (this.saved.size > MAX_SAVED) this.saved.delete(this.saved.keys().next().value);
    this.sim.house.scheduleSave();
  }

  privateState(p) {
    return { levels: { ...p.friends }, mood: this.hasMood(p) };
  }

  hasMood(p) {
    return p.moodDay === this.sim.clock.dayCount;
  }

  /** CoffeeShopService.tip: keyifli bir akşamın ertesi günü bahşiş çarpanı */
  tipMultiplier(p) {
    return this.hasMood(p) ? F.MOOD_TIP : 1;
  }

  gain(p, name, delta) {
    const before = p.friends[name] ?? 0;
    const after = clampLevel(before + delta);
    p.friends[name] = after;
    this.store(p);
    return { before, after };
  }

  // ---- Barda ------------------------------------------------------------------

  /** Oyuncunun konuşabileceği, taburesinde oturan müşteri */
  seatedCustomer(p, id) {
    if (!Number.isInteger(id)) return { error: 'Müşteri bulunamadı.' };
    const c = this.sim.bar.customers.get(id);
    if (!c || c.stool < 0 || !c.sit) return { error: 'Bu müşteri artık oturmuyor.' };
    const reg = REGULAR_BY_NAME[c.name];
    if (!reg) return { error: 'Müşteri bulunamadı.' };
    const [sx, sz] = BAR.stools[c.stool].seat;
    if (Math.hypot(p.x - sx, p.z - sz) > F.RANGE + 1) return { error: `${c.name} ile konuşmak için yanına git.` };
    return { c, reg };
  }

  /** Bu müşteri ziyaretinde bu eylem yapıldı mı (her eylem ziyaret başına bir kez) */
  once(c, p, act) {
    c.talks ??= new Map();
    let set = c.talks.get(p.id);
    if (!set) {
      set = new Set();
      c.talks.set(p.id, set);
    }
    if (set.has(act)) return false;
    set.add(act);
    return true;
  }

  /**
   * @returns {{ ok: true, name, level, delta, reply, ... } | { ok: false, error }}
   */
  act(p, data, now) {
    const act = typeof data?.act === 'string' ? data.act : '';
    if (act === 'homeChat' || act === 'tv' || act === 'bye') return this.homeAct(p, act, now);
    if (act !== 'chat' && act !== 'joke' && act !== 'treat' && act !== 'invite') return { ok: false, error: 'Geçersiz işlem.' };
    const { c, reg, error } = this.seatedCustomer(p, data.customer);
    if (error) return { ok: false, error };
    const name = reg.name;

    if (act === 'chat') {
      const topic = typeof data.topic === 'string' ? TOPIC_BY_ID[data.topic] : undefined;
      if (!topic) return { ok: false, error: 'Böyle bir konu yok.' };
      if (!this.once(c, p, 'chat')) return { ok: false, error: `${name} ile bu akşam zaten sohbet ettin — bir dahaki gelişinde.` };
      const fit = topicFit(reg, topic.id);
      const { after } = this.gain(p, name, F.CHAT[fit]);
      return { ok: true, name, level: after, delta: F.CHAT[fit], fit, reply: REPLY[fit](name, topic.label) };
    }
    if (act === 'joke') {
      if (!this.once(c, p, 'joke')) return { ok: false, error: `${name} esprini bu akşam zaten duydu.` };
      const joke = JOKES[Math.floor(this.rng() * JOKES.length)];
      let delta = F.JOKE[reg.humor];
      let reply;
      if (reg.humor === 'love') reply = `${name}: "Hahaha! Bunu arkadaşlarıma da anlatacağım!" 😂`;
      else if (reg.humor === 'meh') reply = `${name}: "…Anladım. Espri, değil mi?" 😐`;
      else if (this.rng() < 0.5) reply = `${name}: "Heh, fena değil." 😄`;
      else {
        delta = 0;
        reply = `${name}: "Hmm… Bunu daha önce duymuştum." 🙃`;
      }
      const { after } = this.gain(p, name, delta);
      return { ok: true, name, level: after, delta, joke, reply };
    }
    if (act === 'treat') {
      const drink = typeof data.drink === 'string' ? DRINK_BY_ID[data.drink] : undefined;
      if (!drink) return { ok: false, error: 'Böyle bir içecek yok.' };
      if (!(p.wallet >= drink.price)) return { ok: false, error: `${drink.name} için €${drink.price} gerekli.` };
      if (!this.once(c, p, 'treat')) return { ok: false, error: `${name} bu akşam zaten bir şey içti, teşekkür ediyor.` };
      p.wallet -= drink.price;
      this.sim.shop.sendSelf(p);
      const fav = drink.id === reg.drink;
      const delta = fav ? F.TREAT_FAV : F.TREAT_OTHER;
      const { after } = this.gain(p, name, delta);
      const reply = fav
        ? `${name}: "${drink.icon} ${drink.name}! En sevdiğim — nereden bildin?" 🤩`
        : `${name}: "Çok naziksin, teşekkürler! ${drink.icon}" 🙂`;
      return { ok: true, name, level: after, delta, reply, price: drink.price };
    }
    return this.invite(p, c, reg, now);
  }

  invite(p, c, reg) {
    const name = reg.name;
    const level = p.friends[name] ?? 0;
    if (level < F.INVITE_AT) return { ok: false, error: `${name} seni henüz yeterince tanımıyor (%${level} — %${F.INVITE_AT} gerekli).` };
    const houseId = this.sim.house.houseIdOf(p);
    if (!houseId) return { ok: false, error: 'Davet için Achterstraat\'ta bir evin olmalı.' };
    if (this.sim.clock.night) return { ok: false, error: 'Çok geç oldu — yarın davet et.' };
    if (this.visits.has(p.id)) return { ok: false, error: 'Evinde zaten bir misafirin var.' };
    for (const v of this.visits.values()) if (v.name === name) return { ok: false, error: `${name} bu akşam başka birine misafir.` };
    const spot = this.visitSpot(houseId);
    const v = {
      ownerId: p.id, ownerName: p.name, name, look: c.look, houseId, ...spot,
      homeChatAt: 0, tv: false, fun: false,
    };
    this.visits.set(p.id, v);
    // Bardan kalkar (tabure boşalır; önündeki bardak tezgâhta kalır)
    this.sim.bar.leave(c, this.sim.now());
    this.sim.bar.barChanged();
    this.broadcastVisits();
    return {
      ok: true, name, level, houseId,
      reply: `${name}: "Çok isterim! Evinde görüşürüz — Achterstraat'taki ${HOUSE_BY_ID[houseId].name}, değil mi?" 😊`,
    };
  }

  // ---- Evde -------------------------------------------------------------------

  homeAct(p, act, now) {
    const v = this.visits.get(p.id);
    if (!v) return { ok: false, error: 'Evinde misafirin yok.' };
    const def = HOUSE_BY_ID[v.houseId];
    if (!isInsideHouseDef(def, p.x, p.z) || Math.hypot(p.x - v.x, p.z - v.z) > F.RANGE + 1) {
      return { ok: false, error: `${v.name} evinde seni bekliyor — yanına git.` };
    }
    if (act === 'bye') {
      this.endVisit(v, 'bye');
      return { ok: true, name: v.name, reply: `${v.name}: "Çok güzel bir akşamdı, görüşürüz!" 👋` };
    }
    if (act === 'homeChat') {
      if (now - v.homeChatAt < F.HOME_CHAT_COOLDOWN_MS) return { ok: false, error: `${v.name} biraz soluklanıyor, birazdan tekrar konuşun.` };
      v.homeChatAt = now;
      v.fun = true;
      const { after } = this.gain(p, v.name, F.HOME_CHAT);
      return { ok: true, name: v.name, level: after, delta: F.HOME_CHAT, reply: `${v.name} ile uzun uzun sohbet ettiniz. ☕` };
    }
    // tv: evde açık bir TV olmalı
    const tv = this.sim.house.itemsIn(v.houseId).find((it) => it.type === 'tv' && it.video);
    if (!tv) return { ok: false, error: 'Önce TV\'de bir video ya da şarkı aç.' };
    if (v.tv) return { ok: true, name: v.name, level: p.friends[v.name] ?? 0, delta: 0, reply: `${v.name} keyifle izlemeye devam ediyor. 📺` };
    v.tv = true;
    v.fun = true;
    const { after } = this.gain(p, v.name, F.TV_TOGETHER);
    const title = tv.video.title || 'videoyu';
    return { ok: true, name: v.name, level: after, delta: F.TV_TOGETHER, reply: `${v.name} ile "${title}" izliyorsunuz. 📺🍿` };
  }

  /** Misafirin evde duracağı yer: bir oturma eşyasının önü, yoksa evin ortasına en yakın boş nokta */
  visitSpot(houseId) {
    const def = HOUSE_BY_ID[houseId];
    const I = def.inner;
    const items = this.sim.house.itemsIn(houseId);
    const solid = items
      .filter((it) => FURNITURE_BY_ID[it.type]?.layer === 'floor')
      .map((it) => itemBox(FURNITURE_BY_ID[it.type], it));
    const door = doorZone(def);
    const free = (x, z) => x > I.minX + 0.4 && x < I.maxX - 0.4 && z > I.minZ + 0.4 && z < I.maxZ - 0.4
      && !(x > door.minX && x < door.maxX && z > door.minZ && z < door.maxZ)
      && solid.every((b) => x < b.minX - 0.35 || x > b.maxX + 0.35 || z < b.minZ - 0.35 || z > b.maxZ + 0.35);
    const tv = items.find((it) => it.type === 'tv');
    const faceTo = (x, z, tx, tz) => Math.atan2(tx - x, tz - z);
    const cx = (I.minX + I.maxX) / 2;
    const cz = (I.minZ + I.maxZ) / 2;
    // Oturma eşyasının önü (yerel +Z ön yüz)
    for (const it of items) {
      if (!SEATS.has(it.type)) continue;
      const def2 = FURNITURE_BY_ID[it.type];
      const ry = it.rot * (Math.PI / 2);
      const d = (it.rot % 2 ? def2.w : def2.d) / 2 + 0.45;
      const x = it.x + Math.sin(ry) * d;
      const z = it.z + Math.cos(ry) * d;
      if (free(x, z)) return { x: r2(x), z: r2(z), face: tv ? faceTo(x, z, tv.x, tv.z) : ry };
    }
    // Ortaya en yakın boş nokta (0.25 m ızgara)
    let best = null;
    let bestD = Infinity;
    for (let x = I.minX + 0.5; x <= I.maxX - 0.5; x += 0.25) {
      for (let z = I.minZ + 0.5; z <= I.maxZ - 0.5; z += 0.25) {
        if (!free(x, z)) continue;
        const d = Math.hypot(x - cx, z - cz);
        if (d < bestD) {
          bestD = d;
          best = { x, z };
        }
      }
    }
    const pt = best ?? { x: cx, z: cz };
    return { x: r2(pt.x), z: r2(pt.z), face: tv ? faceTo(pt.x, pt.z, tv.x, tv.z) : Math.PI };
  }

  /**
   * Ziyareti bitir. Keyifli geçtiyse (sohbet / TV) arkadaşlık artar ve ertesi gün moral bonusu.
   * @param reason 'night' | 'bye' | 'left'
   */
  endVisit(v, reason) {
    this.visits.delete(v.ownerId);
    const p = this.sim.players.get(v.ownerId);
    if (p && v.fun) {
      this.gain(p, v.name, F.VISIT_DONE);
      p.moodDay = this.sim.clock.dayCount + (reason === 'night' || this.sim.clock.night ? 1 : 0);
      this.store(p);
      this.sim.shop.sendSelf(p);
    }
    if (p && reason === 'night') {
      const bonus = v.fun ? ' Yarın moralin yüksek: oda bahşişleri +%20! 😊' : '';
      this.sim.toPlayer(p.id, EVT.NOTIFY, { text: `🌙 ${v.name}: "Harika bir akşamdı, iyi geceler!"${bonus}`, kind: 'clean' });
    } else if (p && reason === 'bye' && v.fun) {
      this.sim.toPlayer(p.id, EVT.NOTIFY, { text: `😊 ${v.name} ile güzel vakit geçirdin — moral bonusu: bugün oda bahşişleri +%20!`, kind: 'clean' });
    }
    this.broadcastVisits();
  }

  /** 23:00: tüm misafirler evlerine döner */
  onNightStart() {
    for (const v of [...this.visits.values()]) this.endVisit(v, 'night');
  }

  /** Yeni gün: moral bonusu olanlara haber ver */
  onNewDay() {
    for (const p of this.sim.players.values()) {
      if (!this.hasMood(p)) continue;
      this.sim.toPlayer(p.id, EVT.NOTIFY, { text: '☀️ Dün akşam çok eğlendin — bugün moralin yüksek: oda bahşişleri +%20!', kind: 'clean' });
      this.sim.shop.sendSelf(p);
    }
  }

  serializeVisits() {
    return [...this.visits.values()].map((v) => ({
      ownerId: v.ownerId, ownerName: v.ownerName, name: v.name, look: v.look, houseId: v.houseId, x: v.x, z: v.z, face: v.face,
    }));
  }

  broadcastVisits() {
    this.sim.out(EVT.FRIEND_VISITS, this.serializeVisits());
  }
}
