import { EVT } from '../../shared/constants.js';
import { HOUSE_BY_ID } from '../../shared/layout.js';
import { PLANT_BY_ID, GARDEN_RULES, plantProgress, harvestValue } from '../../shared/house.js';

const num = (v) => (typeof v === 'number' ? v : NaN);

/**
 * Ev bahçesi (yetkili): kendi evindeki saksıya tohum ekme ve hasat.
 *  - Yalnızca oyuncu evlerinde ve yalnızca ev sahibi (misafir ve Bizim Ev'de bahçe yok;
 *    başkasının emeğini hasat etmek mümkün olmasın).
 *  - Bitki mutlak oyun dakikasıyla büyür (sim.clock.total): gece ve uyku da sayılır.
 *  - Saksının durumu eşyanın üstünde (item.plant = { kind, at }) tutulur; evlerle birlikte kaydedilir.
 */
export class GardenService {
  constructor(sim, house) {
    this.sim = sim;
    this.house = house;
  }

  /** @returns {{ ok: true, ... } | { ok: false, error }} */
  act(p, data) {
    const act = data?.act;
    if (act !== 'plant' && act !== 'harvest') return { ok: false, error: 'Geçersiz işlem.' };
    const it = this.house.find(data?.itemId);
    if (!it || it.type !== 'pot') return { ok: false, error: 'Saksı bulunamadı.' };
    const def = HOUSE_BY_ID[it.houseId];
    if (!def.owned) return { ok: false, error: 'Bahçe işleri yalnızca kendi evinde (Achterstraat).' };
    if (!this.house.isOwner(p, def.id)) return { ok: false, error: 'Bu saksı ev sahibinin — dokunamazsın.' };
    if (!this.house.inHouse(p, def) || Math.hypot(p.x - it.x, p.z - it.z) > GARDEN_RULES.RANGE + 1) {
      return { ok: false, error: 'Saksıya yaklaş.' };
    }
    return act === 'plant' ? this.plant(p, it, data.kind) : this.harvest(p, it);
  }

  plant(p, it, kind) {
    const pd = typeof kind === 'string' ? PLANT_BY_ID[kind] : undefined;
    if (!pd) return { ok: false, error: 'Böyle bir tohum yok.' };
    if (it.plant) return { ok: false, error: 'Bu saksıda zaten bir bitki var.' };
    if (!(p.wallet >= pd.seed)) return { ok: false, error: `${pd.name} tohumu için €${pd.seed} gerekli.` };
    p.wallet -= pd.seed;
    it.plant = { kind: pd.id, at: Math.round(this.sim.clock.total) };
    this.sim.shop.sendSelf(p);
    this.changed(it);
    return { ok: true, plant: it.plant };
  }

  harvest(p, it) {
    if (!it.plant) return { ok: false, error: 'Saksı boş — önce tohum ek.' };
    const pd = PLANT_BY_ID[it.plant.kind];
    // Tek tick'lik saat farkına tolerans (istemci "hazır" görür, sunucu bir an geriden gelir)
    if (plantProgress(it.plant, this.sim.clock.total + 1) < 1) return { ok: false, error: `${pd.name} henüz olgunlaşmadı.` };
    const value = harvestValue(pd.id);
    p.wallet += value;
    it.plant = null;
    this.sim.shop.sendSelf(p);
    this.changed(it);
    return { ok: true, kind: pd.id, count: pd.count, value };
  }

  changed(it) {
    this.sim.out(EVT.HOUSE_ITEM, { itemId: num(it.id), plant: it.plant ?? null });
    this.house.scheduleSave();
  }
}
