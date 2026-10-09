import { EVT } from '../../shared/constants.js';
import { HOUSE, isInsideHouse } from '../../shared/layout.js';
import {
  FURNITURE_BY_ID, HOUSE_RULES, validatePlacement, parseYouTubeId, isYouTubeId,
} from '../../shared/house.js';

const round2 = (v) => Math.round(v * 100) / 100;
const SAVE_DELAY_MS = 1500;

/**
 * "Bizim Ev" — sunucudaki herkesin paylaştığı, dekore edilebilen ev.
 * Yetkili: yerleşim kuralları, fiyat/iade, TV videosu ve ışık durumu burada
 * doğrulanır ve tüm oyunculara yayınlanır. İsteğe bağlı `store` ile dosyaya kaydedilir.
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
    this.items = [];
    this.nextId = 1;
    this.lightsOn = true;
    this.saveTimer = null;
    const data = store?.load?.();
    if (data) this.restore(data);
  }

  /** Kayıttan yükle — her eşya yeniden doğrulanır (bozuk/elle düzenlenmiş dosyaya karşı) */
  restore(data) {
    const items = Array.isArray(data.items) ? data.items : [];
    for (const raw of items.slice(0, HOUSE_RULES.MAX_ITEMS)) {
      const it = {
        id: Number(raw.id),
        type: String(raw.type),
        x: Number(raw.x),
        z: Number(raw.z),
        rot: Number(raw.rot),
        color: Number(raw.color),
        by: typeof raw.by === 'string' ? raw.by.slice(0, 16) : '',
        video: null,
      };
      if (!Number.isInteger(it.id) || it.id < 1 || this.items.some((o) => o.id === it.id)) continue;
      if (!validatePlacement(this.items, it).ok) continue;
      if (it.type === 'tv' && raw.video && isYouTubeId(raw.video.id)) {
        it.video = {
          id: raw.video.id,
          title: typeof raw.video.title === 'string' ? raw.video.title.slice(0, 100) : null,
          by: typeof raw.video.by === 'string' ? raw.video.by.slice(0, 16) : '',
          startedAt: Number(raw.video.startedAt) || this.sim.now(),
        };
      }
      this.items.push(it);
      this.nextId = Math.max(this.nextId, it.id + 1);
    }
    this.lightsOn = data.lightsOn !== false;
  }

  serialize() {
    return { items: this.items.map((it) => ({ ...it })), lightsOn: this.lightsOn };
  }

  scheduleSave() {
    if (!this.store) return;
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.flush(), SAVE_DELAY_MS);
    this.saveTimer.unref?.();
  }

  flush() {
    clearTimeout(this.saveTimer);
    this.saveTimer = null;
    this.store?.save(this.serialize());
  }

  /** Oyuncu evin içinde mi (ağ gecikmesi için küçük tolerans) */
  inside(p) {
    return isInsideHouse(p.x, p.z)
      || (p.x > HOUSE.bounds.minX - 0.3 && p.x < HOUSE.bounds.maxX && p.z > -0.3 && p.z < HOUSE.bounds.maxZ);
  }

  find(id) {
    return this.items.find((it) => it.id === Number(id));
  }

  // ---- Dekorasyon -------------------------------------------------------------

  place(p, data) {
    if (!this.inside(p)) return { ok: false, error: 'Dekorasyon için evin içinde olmalısın.' };
    if (this.items.length >= HOUSE_RULES.MAX_ITEMS) return { ok: false, error: `Evde en fazla ${HOUSE_RULES.MAX_ITEMS} eşya olabilir.` };
    const c = {
      type: String(data?.type ?? ''),
      x: round2(Number(data?.x)),
      z: round2(Number(data?.z)),
      rot: Number(data?.rot),
      color: Number(data?.color),
    };
    const v = validatePlacement(this.items, c);
    if (!v.ok) return v;
    if (Math.hypot(p.x - c.x, p.z - c.z) > HOUSE_RULES.REACH) return { ok: false, error: 'Bu kadar uzağa yerleştiremezsin.' };
    const def = FURNITURE_BY_ID[c.type];
    if (p.wallet < def.price) return { ok: false, error: `${def.name} için €${def.price} gerekli.` };

    p.wallet -= def.price;
    const item = { id: this.nextId++, ...c, by: p.name, video: null };
    this.items.push(item);
    this.sim.shop.sendSelf(p);
    this.sim.out(EVT.HOUSE_ADDED, item);
    this.scheduleSave();
    return { ok: true, item };
  }

  remove(p, id) {
    if (!this.inside(p)) return { ok: false, error: 'Evin içinde olmalısın.' };
    const it = this.find(id);
    if (!it) return { ok: false, error: 'Eşya bulunamadı.' };
    if (Math.hypot(p.x - it.x, p.z - it.z) > HOUSE_RULES.REACH) return { ok: false, error: 'Eşyaya yaklaş.' };
    const def = FURNITURE_BY_ID[it.type];
    const refund = Math.floor(def.price * HOUSE_RULES.REFUND);
    this.items.splice(this.items.indexOf(it), 1);
    p.wallet += refund;
    this.sim.shop.sendSelf(p);
    this.sim.out(EVT.HOUSE_REMOVED, it.id);
    this.scheduleSave();
    return { ok: true, refund };
  }

  toggleLights(p) {
    if (!this.inside(p)) return { ok: false, error: 'Evin içinde olmalısın.' };
    const [sx, sz] = HOUSE.lightSwitch;
    if (Math.hypot(p.x - sx, p.z - sz) > HOUSE_RULES.SWITCH_RANGE + 1) return { ok: false, error: 'Anahtara yaklaş.' };
    this.lightsOn = !this.lightsOn;
    this.sim.out(EVT.HOUSE_LIGHTS_STATE, this.lightsOn);
    this.scheduleSave();
    return { ok: true, lightsOn: this.lightsOn };
  }

  // ---- Televizyon ---------------------------------------------------------------

  tvFor(p, itemId) {
    if (!this.inside(p)) return { error: 'Evin içinde olmalısın.' };
    const it = this.find(itemId);
    if (!it || it.type !== 'tv') return { error: 'Televizyon bulunamadı.' };
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
    // Beklerken eşya kaldırılmış olabilir
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
}
