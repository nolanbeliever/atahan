// A themed showroom on the far shore (shared/showrooms.ts): its cars, the selected one spinning on
// the turntable in 3D, the factory colours, a test drive or buying it outright. The Black Market
// shows its used stock with the theft record and the restock clock.

import { ECONOMY } from '../../../../shared/economy.config';
import { isCategoryUnlocked } from '../../../../shared/progression';
import { TIER_COLORS, TIER_LABELS } from '../../../../shared/rareMarket';
import { findShowroom, type ShowroomInfo, type ShowroomOffer } from '../../../../shared/showrooms';
import { calculateVehicleStats } from '../../../../shared/tuningSystem';
import { formatKm, formatMoney } from '../../../../shared/util';
import { marketValue } from '../../../../shared/valuation';
import { getModel } from '../../../../shared/vehicles';
import { getStudio } from '../../render/Studio';
import { h, type Child } from '../dom';
import { ICONS } from '../icons';
import { Panel } from '../Panel';
import { mmss } from '../RewardsHud';
import { avgCond, conditionRows, dealBadge } from '../widgets';

const DRIVE_LABEL: Record<string, string> = { fwd: 'Önden çekiş', rwd: 'Arkadan itiş', awd: '4x4 / AWD' };

export class ShowroomPanel extends Panel {
  readonly name = 'showroom';
  override size = 'xl' as const;
  private readonly studio = getStudio();
  private readonly showroom = findShowroom(String(this.arg.showroomId ?? '')) ?? findShowroom('jdm')!;
  private info: ShowroomInfo | null = null;
  private selected: string | null = null;
  private color: string | null = null;
  private timer: HTMLElement | null = null;
  private clock = 0;

  title() {
    return this.showroom.name;
  }
  override subtitle() {
    return `${this.showroom.tagline} · Galeri Bulvarı`;
  }
  iconSvg() {
    return ICONS.store;
  }

  override init(): void {
    this.studio?.setTurntable(true, this.showroom.theme.accent);
    void this.load();
    this.listen(
      this.store.on('showroom', (d) => {
        if (d.showroomId !== this.showroom.id) return;
        this.info = d;
        this.refresh();
      }),
    );
    this.listen(this.store.on('self', () => this.refresh()));
    // Prices follow the market's demand: fetch them again when it moves.
    this.listen(this.store.on('trends', () => void this.load()));
    this.clock = window.setInterval(() => {
      if (this.timer && this.info?.restockAt) this.timer.textContent = `Yeni stok: ${mmss(Math.max(0, (this.info.restockAt - this.store.serverNow()) / 1000))}`;
    }, 500);
  }

  override dispose(): void {
    window.clearInterval(this.clock);
    this.studio?.setTurntable(false);
    this.studio?.setVehicle(null);
    super.dispose();
  }

  private async load(): Promise<void> {
    try {
      this.info = await this.net.rpc('showroom.info', { showroomId: this.showroom.id });
      if (!this.selected || !this.info.offers.some((o) => o.id === this.selected)) this.selected = this.info.offers.find((o) => !o.soldTo)?.id ?? this.info.offers[0]?.id ?? null;
    } catch (err) {
      this.ui.error(err);
    }
    this.refresh();
  }

  private offer(): ShowroomOffer | null {
    return this.info?.offers.find((o) => o.id === this.selected) ?? null;
  }

  /** The car on the turntable: the selected offer in the chosen colour. */
  private showOnTable(o: ShowroomOffer | null): void {
    if (!this.studio) return;
    if (!o) return this.studio.setVehicle(null);
    const color = o.hot ? o.vehicle.color : this.color ?? o.vehicle.color;
    this.studio.setVehicle({ id: `${this.showroom.id}-${o.modelId}`, modelId: o.modelId, color, mods: o.vehicle.mods, condition: o.vehicle.condition });
  }

  renderBody(): Child {
    const s = this.showroom;
    const theme = s.theme;
    const bm = s.id === 'blackmarket';
    const banner = h(
      'div',
      { class: 'sr-banner', style: { background: `linear-gradient(100deg, #11141b 35%, ${theme.accent}40)`, borderColor: theme.accent } },
      h('div', null, h('div', { class: 'sr-name', style: { color: theme.accent } }, s.name.toUpperCase()), h('div', { class: 'tiny', style: { color: '#e9edf3' } }, s.tagline)),
      bm ? (this.timer = h('div', { class: 'sr-timer mono', 'data-testid': 'bm-restock' }, 'Yeni stok: --:--')) : h('div', { class: 'tiny muted' }, 'Sıfır araç · fabrika renkleri · test sürüşü ücretsiz'),
    );
    if (!this.info) return h('div', { 'data-testid': 'showroom', 'data-showroom': s.id }, banner, h('div', { class: 'empty' }, 'Galeri yükleniyor...'));

    const me = this.store.me;
    const level = me?.level ?? 1;
    const list = h(
      'div',
      { class: 'sr-list' },
      this.info.offers.map((o) => {
        const m = getModel(o.modelId);
        const st = calculateVehicleStats(m, null);
        const locked = !isCategoryUnlocked(m.category, level);
        return h(
          'button',
          {
            class: `sr-item${o.id === this.selected ? ' active' : ''}${o.soldTo ? ' sold' : ''}`,
            style: o.id === this.selected ? { borderColor: theme.accent } : {},
            'data-testid': 'showroom-offer',
            'data-offer': o.id,
            'data-model': o.modelId,
            onclick: () => {
              this.selected = o.id;
              this.color = null;
              this.refresh();
            },
          },
          h('div', { class: 'sr-item-top' }, h('span', { class: 'vname' }, `${m.brand} ${m.name}`), h('span', { class: 'sr-tier', style: { background: TIER_COLORS[m.tier] } }, TIER_LABELS[m.tier])),
          h('div', { class: 'tiny muted' }, `${m.year} · ${st.hp} hp · 0-100 ${st.accel}s${o.hot ? ` · ${formatKm(o.vehicle.mileage)}` : ''}`),
          h('div', { class: 'row between' }, h('span', { class: 'price' }, formatMoney(o.price)), o.soldTo ? h('span', { class: 'pill red' }, `Satıldı: ${o.soldTo}`) : locked ? h('span', { class: 'pill red' }, `Seviye ${ECONOMY.categoryUnlockLevel[m.category]}`) : null),
        );
      }),
    );

    const o = this.offer();
    this.showOnTable(o);
    const stage = h('div', { class: 'sr-stage', style: { boxShadow: `inset 0 -40px 80px ${theme.glow}22` } }, this.studio ? this.studio.canvas : h('div', { class: 'empty' }, '3D önizleme yok'), h('div', { class: 'sr-stage-tag tiny' }, 'Showroom Rotator · sürükleyerek çevir'));
    this.studio?.start();
    return h('div', { 'data-testid': 'showroom', 'data-showroom': s.id }, banner, h('div', { class: 'sr-layout' }, list, h('div', { class: 'sr-main' }, stage, o ? this.details(o) : h('div', { class: 'empty' }, 'Bir araç seç.'))));
  }

  private details(o: ShowroomOffer): HTMLElement {
    const m = getModel(o.modelId);
    const st = calculateVehicleStats(m, null);
    const me = this.store.me;
    const money = me?.money ?? 0;
    const locked = !isCategoryUnlocked(m.category, me?.level ?? 1);
    const value = marketValue(o.vehicle, this.store.trends);
    const color = o.hot ? o.vehicle.color : this.color ?? o.vehicle.color;
    const driving = !!this.game.driving || !!this.store.testDrive;
    const specs = h(
      'div',
      { class: 'sr-specs' },
      [
        ['Güç', `${st.hp} hp`],
        ['Tork', `${st.torque} Nm`],
        ['0-100', `${st.accel} s`],
        ['Azami hız', `${st.topSpeed} km/h`],
        ['Çekiş', DRIVE_LABEL[m.specs.drive] ?? m.specs.drive],
        ['Ağırlık', `${m.specs.weight} kg`],
      ].map(([k, v]) => h('div', { class: 'sr-spec' }, h('div', { class: 'tiny muted' }, k), h('div', { class: 'mono' }, v))),
    );
    const colors = o.hot
      ? null
      : h(
          'div',
          { class: 'row wrap', style: { gap: '6px' } },
          h('span', { class: 'tiny muted', style: { fontWeight: '800' } }, 'RENK'),
          m.colors.map((c) =>
            h('button', { class: `opt${c === color ? ' active' : ''}`, title: c, 'data-testid': 'showroom-color', onclick: () => ((this.color = c), this.refresh()) }, h('span', { class: 'sw', style: { background: c } })),
          ),
        );
    const buy = h(
      'button',
      {
        class: `btn ${m.tier === 'legendary' ? 'gold-btn' : 'primary'}`,
        'data-testid': 'showroom-buy',
        disabled: this.busy || !!o.soldTo || locked || money < o.price,
        title: locked ? `${m.category} unlocks at level ${ECONOMY.categoryUnlockLevel[m.category]}` : money < o.price ? 'Not enough cash' : '',
        onclick: () => void this.buy(o, color),
      },
      `Satın Al · ${formatMoney(o.price)}`,
    );
    const test = h(
      'button',
      {
        class: 'btn',
        'data-testid': 'showroom-testdrive',
        disabled: this.busy || !!o.soldTo || driving,
        title: driving ? 'Önce araçtan in' : '',
        onclick: () => void this.testDrive(o, color),
      },
      `Test Sürüşü · ${ECONOMY.showrooms.testDriveSec / 60} dk`,
    );
    return h(
      'div',
      { class: 'sr-details' },
      h('div', { class: 'row between' }, h('div', null, h('div', { class: 'sr-title' }, `${m.brand} ${m.name}`), h('div', { class: 'tiny muted' }, `${m.year} · ${m.description}`)), dealBadge(o.price, value)),
      specs,
      o.hot
        ? h(
            'div',
            { class: 'sr-hot' },
            h('div', null, h('b', null, '⚠ Çalıntı kaydı · plakası silinmiş'), h('div', { class: 'tiny' }, `${formatKm(o.vehicle.mileage)} · %${avgCond(o.vehicle)} durum · Sanayi toplaması. Ucuz ama plaka okuma (ANPR) kameraları seni yakalayabilir.`)),
            conditionRows(o.vehicle.condition, true),
          )
        : colors,
      h('div', { class: 'row between sr-actions' }, h('div', null, h('div', { class: 'tiny muted' }, `Piyasa değeri ${formatMoney(value)}`), h('div', { class: 'price big' }, formatMoney(o.price))), h('div', { class: 'row', style: { gap: '8px' } }, test, buy)),
      h('div', { class: 'tiny muted' }, `Test sürüşü ücretsiz; hasar olursa onarım bedeli kesilir (en çok %${Math.round(ECONOMY.showrooms.damageMax * 100)}). Arabadan inince araç galeriye döner.`),
    );
  }

  private async buy(o: ShowroomOffer, color: string): Promise<void> {
    await this.act(
      () => this.net.rpc('showroom.buy', { showroomId: this.showroom.id, offerId: o.id, color: o.hot ? undefined : color, expectedPrice: o.price }),
      (r) => {
        this.ui.toast({ kind: 'success', title: 'Hayırlı olsun!', text: `${getModel(r.vehicle.modelId).brand} ${getModel(r.vehicle.modelId).name}: ${formatMoney(r.price)}. Garajında seni bekliyor.` });
        this.game.audio.play('reward');
        void this.load();
      },
    );
  }

  private async testDrive(o: ShowroomOffer, color: string): Promise<void> {
    await this.act(
      () => this.net.rpc('showroom.testDrive', { showroomId: this.showroom.id, offerId: o.id, color: o.hot ? undefined : color }),
      (v) => {
        this.store.setTestDrive(v);
        this.ui.closeAll();
      },
    );
  }
}
