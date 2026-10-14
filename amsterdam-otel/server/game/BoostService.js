import { EVT } from '../../shared/constants.js';

const MAX_BOOSTS = 8;
const KINDS = Object.freeze(['barSpawn', 'barTip', 'guestSpawn']);

/**
 * Geçici otel bonusları (konser kalabalığı, reklam kampanyası…). Süreler OYUN dakikasıyla
 * (clock.total) ölçülür; böylece duraklatma / gece atlama doğru işler. Aynı kaynaktan (source)
 * gelen yeni bonus eskisinin yerini alır; farklı kaynakların çarpanları çarpılır (üst sınırlı).
 *  - barSpawn:   bar müşterisi geliş SIKLIĞI çarpanı (2 → iki kat sık)
 *  - barTip:     bar bahşişi çarpanı (1.6 → +%60)
 *  - guestSpawn: otel misafiri geliş sıklığı çarpanı
 * Kalıcıdır (hotelState.boosts); değişince herkese EVT.BOOSTS yayınlanır.
 */
export class BoostService {
  constructor(sim) {
    this.sim = sim;
    this.list = []; // { source, label, icon, untilTotal, barSpawn, barTip, guestSpawn }
  }

  /** @param b { source, label, icon?, minutes, barSpawn?, barTip?, guestSpawn? } */
  add(b) {
    const until = this.sim.clock.total + b.minutes;
    this.list = this.list.filter((x) => x.source !== b.source);
    const boost = { source: b.source, label: b.label, icon: b.icon ?? '✨', untilTotal: until };
    for (const k of KINDS) boost[k] = Number.isFinite(b[k]) && b[k] > 0 ? Math.min(b[k], 5) : 1;
    this.list.push(boost);
    if (this.list.length > MAX_BOOSTS) this.list.shift();
    this.changed();
    return boost;
  }

  remove(source) {
    const n = this.list.length;
    this.list = this.list.filter((x) => x.source !== source);
    if (this.list.length !== n) this.changed();
  }

  has(source) { return this.list.some((x) => x.source === source); }

  /** Etkin çarpan (tüm bonusların çarpımı, en fazla 6) */
  factor(kind) {
    let f = 1;
    for (const b of this.list) f *= b[kind] ?? 1;
    return Math.min(f, 6);
  }

  get barSpawn() { return this.factor('barSpawn'); }

  get barTip() { return this.factor('barTip'); }

  get guestSpawn() { return this.factor('guestSpawn'); }

  update() {
    const t = this.sim.clock.total;
    const n = this.list.length;
    const ended = this.list.filter((b) => b.untilTotal <= t);
    if (!ended.length) return;
    this.list = this.list.filter((b) => b.untilTotal > t);
    for (const b of ended) this.sim.notify(`${b.icon} ${b.label} sona erdi.`, 'info');
    if (this.list.length !== n) this.changed();
  }

  changed() {
    this.sim.out(EVT.BOOSTS, this.serialize());
    this.sim.house.scheduleSave();
  }

  serialize() {
    return this.list.map((b) => ({ ...b }));
  }

  persisted() { return this.serialize(); }

  restore(list) {
    if (!Array.isArray(list)) return;
    for (const raw of list.slice(0, MAX_BOOSTS)) {
      if (!raw || typeof raw !== 'object') continue;
      if (typeof raw.source !== 'string' || typeof raw.label !== 'string' || !Number.isFinite(raw.untilTotal)) continue;
      const b = {
        source: raw.source.slice(0, 32),
        label: raw.label.slice(0, 80),
        icon: typeof raw.icon === 'string' ? raw.icon.slice(0, 8) : '✨',
        untilTotal: raw.untilTotal,
      };
      for (const k of KINDS) b[k] = Number.isFinite(raw[k]) && raw[k] > 0 ? Math.min(raw[k], 5) : 1;
      this.list.push(b);
    }
  }
}
