import { EVT, MINUTES_PER_DAY, formatMoney, possessive } from '/shared/constants.js';
import { HOUSE_BY_ID, houseAt } from '/shared/layout.js';
import { PLANTS, PLANT_BY_ID, GARDEN_RULES, plantProgress, plantStage, harvestValue } from '/shared/house.js';

/**
 * Ev bahçesi (istemci): kendi evindeki saksıya tohum ek, büyümesini izle, hasat et.
 *  - Bitkiler oyun saatiyle büyür (gece ve uyku dahil); evre (tohum → filiz → büyüyor →
 *    hazır) değişince yalnızca o evin mobilya geometrisi yeniden birleştirilir.
 *  - Evre kontrolü saniyede bir saat güncellemesinde yapılır; karede ek iş yoktur.
 *  - Ekim / hasat sunucuda doğrulanır (yalnızca ev sahibi, yakından, yeterli para).
 */
export class HerbalBotanySystem {
  constructor({ engine, net, hud, interaction, house, state, modal, device, sfx, settings, vm }) {
    this.engine = engine;
    this.net = net;
    this.hud = hud;
    this.interaction = interaction;
    this.house = house;
    this.state = state;
    this.modal = modal;
    this.device = device;
    this.sfx = sfx;
    this.settings = settings;
    this.vm = vm;
    this.stages = new Map(); // itemId → son çizilen evre
    this.pot = null; // tohum paneli açıkken hangi saksı
    this.pending = false;

    const $ = (id) => document.getElementById(id);
    this.el = { panel: $('garden-panel'), list: $('garden-list'), wallet: $('garden-wallet'), msg: $('garden-msg') };
    $('garden-close').addEventListener('click', () => this.modal.close(this.el.panel));

    house.plantView = (it) => {
      if (!it.plant) return null;
      const stage = plantStage(it.plant, this.total());
      this.stages.set(it.id, stage);
      return { kind: it.plant.kind, stage };
    };
    interaction.addProvider({ find: (px, pz, f) => this.findTarget(px, pz, f) });
  }

  /** Mutlak oyun dakikası (sunucu saatinden ileri hesaplanır) */
  total() {
    const c = this.state.clock;
    if (!c || !Number.isFinite(c.days)) return 0;
    return c.days * MINUTES_PER_DAY + this.state.minuteAt(this.net.serverNow());
  }

  // ---- Durum ---------------------------------------------------------------------------

  /** EVT.HOUSE_ITEM */
  onItemState(s) {
    const it = this.house.onItemState(s);
    if (it) this.stages.delete(it.id);
    this.interaction.invalidate();
    if (this.pot && this.pot.id === s.itemId) this.modal.close(this.el.panel);
  }

  /** Saniyede bir: evresi değişen saksıların evini yeniden çiz */
  onClock() {
    const total = this.total();
    const dirty = new Set();
    for (const it of this.house.items.values()) {
      if (it.type !== 'pot' || !it.plant) continue;
      const st = plantStage(it.plant, total);
      if (this.stages.get(it.id) !== st) dirty.add(it.houseId);
    }
    for (const id of dirty) this.house.rebuild(id);
    // Etiketteki yüzde / kalan süre güncel kalsın (yalnızca bir saksının yanındayken)
    if (dirty.size || this.nearPot) this.interaction.invalidate();
    if (dirty.size || this.nearPot) this.engine.requestRender();
  }

  // ---- Etkileşim ---------------------------------------------------------------------

  findTarget(px, pz, f) {
    this.nearPot = false;
    const h = houseAt(px, pz);
    if (!h || this.house.build.active) return null;
    let best = null;
    let bestD = Infinity;
    for (const it of this.house.itemsOf(h.id)) {
      if (it.type !== 'pot') continue;
      const dx = it.x - px;
      const dz = it.z - pz;
      const d = Math.hypot(dx, dz);
      if (d > GARDEN_RULES.RANGE) continue;
      const dot = d > 1e-3 ? (dx * f.x + dz * f.z) / d : 1;
      if (d > 0.6 && dot < 0.4) continue;
      if (d < bestD) {
        bestD = d;
        best = it;
      }
    }
    if (!best) return null;
    this.nearPot = true;
    const it = best;
    const at = { x: it.x, z: it.z, marker: true };
    const mine = HOUSE_BY_ID[h.id].owned && h.id === this.house.ownedHouseId;
    const pd = it.plant ? PLANT_BY_ID[it.plant.kind] : null;
    const total = this.total();
    if (!pd) {
      if (!mine) return { ...at, short: 'Saksı', label: '🪴 Boş saksı', use: () => this.notMine(h) };
      return { ...at, short: 'Ek', label: '🌱 Saksıya tohum ek (nane / çilek / lale)', use: () => this.openPanel(it) };
    }
    const t = plantProgress(it.plant, total);
    if (t >= 1) {
      if (!mine) return { ...at, short: pd.icon, label: `${pd.icon} ${pd.name} hasada hazır`, use: () => this.notMine(h) };
      return {
        ...at, short: 'Hasat',
        label: `🧺 Hasat et: ${pd.count} ${pd.unit} ${pd.name.toLocaleLowerCase('tr-TR')} (+${formatMoney(harvestValue(pd.id))})`,
        use: () => this.harvest(it),
      };
    }
    const left = this.formatLeft((1 - t) * pd.days * MINUTES_PER_DAY);
    const label = `${pd.icon} ${pd.name} · %${Math.floor(t * 100)} büyüdü · ${left} kaldı`;
    return { ...at, short: `%${Math.floor(t * 100)}`, label, use: () => this.hud.toast(`${label}. Bitkiler gece ve uyurken de büyür.`, 'info') };
  }

  formatLeft(min) {
    const hours = Math.max(1, Math.ceil(min / 60));
    const d = Math.floor(hours / 24);
    const h = hours % 24;
    if (d > 0) return h > 0 ? `${d} gün ${h} saat` : `${d} gün`;
    return `${h} saat`;
  }

  notMine(h) {
    const name = this.house.ownerName(h.id);
    this.hud.toast(h.owned ? `Bu saksı ${name ? possessive(name) : 'ev sahibinin'} — dokunamazsın.` : 'Bahçe işleri yalnızca kendi evinde (Achterstraat).', 'info');
  }

  // ---- Tohum paneli ------------------------------------------------------------------

  openPanel(it) {
    this.pot = it;
    this.el.msg.textContent = '';
    this.render();
    this.modal.open(this.el.panel, () => { this.pot = null; });
  }

  render() {
    const wallet = this.house.getWallet();
    this.el.wallet.textContent = formatMoney(wallet);
    this.el.list.replaceChildren();
    for (const p of PLANTS) {
      const row = document.createElement('div');
      row.className = 'product';
      const icon = document.createElement('div');
      icon.className = 'icon';
      icon.textContent = p.icon;
      const info = document.createElement('div');
      const name = document.createElement('div');
      name.className = 'name';
      name.textContent = `${p.name} tohumu`;
      const desc = document.createElement('div');
      desc.className = 'desc';
      desc.textContent = `${p.days} oyun gününde olgunlaşır · hasat: ${p.count} ${p.unit} → Bloemenmarkt'ta ${formatMoney(harvestValue(p.id))}`;
      info.append(name, desc);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = `Ek · €${p.seed}`;
      btn.disabled = wallet < p.seed;
      btn.addEventListener('click', () => this.plant(p.id));
      row.append(icon, info, btn);
      this.el.list.append(row);
    }
  }

  async plant(kind) {
    const it = this.pot;
    if (!it || this.pending) return;
    this.pending = true;
    const res = await this.net.request(EVT.GARDEN, { act: 'plant', itemId: it.id, kind });
    this.pending = false;
    if (!res.ok) {
      this.el.msg.textContent = res.error || 'Ekilemedi.';
      return;
    }
    const pd = PLANT_BY_ID[kind];
    this.modal.close(this.el.panel);
    this.vm?.play?.('pickup', 650, { item: 'paper' });
    this.hud.toast(`🌱 ${pd.name} ekildi (−€${pd.seed}). ${pd.days} oyun günü sonra hasat!`, 'money');
  }

  async harvest(it) {
    if (this.pending) return;
    this.pending = true;
    const res = await this.net.request(EVT.GARDEN, { act: 'harvest', itemId: it.id });
    this.pending = false;
    if (!res.ok) {
      this.hud.toast(res.error || 'Hasat edilemedi.', 'warn');
      return;
    }
    const pd = PLANT_BY_ID[res.kind];
    this.vm?.play?.('pickup', 650, { item: 'paper' });
    if (this.settings?.sound) this.sfx?.clink?.();
    this.hud.toast(`🧺 ${res.count} ${pd.unit} ${pd.name.toLocaleLowerCase('tr-TR')} hasat ettin ve Bloemenmarkt'a sattın: +${formatMoney(res.value)}`, 'money');
  }
}
