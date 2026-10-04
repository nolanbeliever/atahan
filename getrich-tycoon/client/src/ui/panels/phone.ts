// The phone (Y): Telegram. The supplier's chat (order 10 g for $500, get a location and a picture of
// the car with its sticker) and your channel (customers' orders: take one by hand, through a dead
// drop, or turn it down).

import { ECONOMY } from '../../../../shared/economy.config';
import { DEALS, dropPrice, findDrop, type DealOrder, type TgMessage } from '../../../../shared/telegram';
import { formatMoney } from '../../../../shared/util';
import { getModel } from '../../../../shared/vehicles';
import { h, type Child } from '../dom';
import { ICONS } from '../icons';
import { Panel } from '../Panel';
import { mmss } from '../RewardsHud';

/** A little "photo" of the deal car: its side, in its colour, the sticker in the rear window. */
function carPicture(color: string, sticker: string): string {
  const c = document.createElement('canvas');
  c.width = 280;
  c.height = 150;
  const g = c.getContext('2d')!;
  const sky = g.createLinearGradient(0, 0, 0, 150);
  sky.addColorStop(0, '#2b3240');
  sky.addColorStop(1, '#151820');
  g.fillStyle = sky;
  g.fillRect(0, 0, 280, 150);
  g.fillStyle = '#3a3f49';
  g.fillRect(0, 112, 280, 38);
  // Body and cabin.
  g.fillStyle = color;
  g.beginPath();
  g.moveTo(22, 104);
  g.lineTo(30, 80);
  g.lineTo(78, 74);
  g.lineTo(106, 48);
  g.lineTo(186, 46);
  g.lineTo(218, 74);
  g.lineTo(258, 80);
  g.lineTo(262, 104);
  g.closePath();
  g.fill();
  g.strokeStyle = 'rgba(255,255,255,0.25)';
  g.lineWidth = 2;
  g.stroke();
  // Windows.
  g.fillStyle = 'rgba(20,28,40,0.85)';
  g.beginPath();
  g.moveTo(112, 54);
  g.lineTo(144, 53);
  g.lineTo(144, 74);
  g.lineTo(92, 74);
  g.closePath();
  g.fill();
  g.beginPath();
  g.moveTo(150, 53);
  g.lineTo(182, 52);
  g.lineTo(208, 74);
  g.lineTo(150, 74);
  g.closePath();
  g.fill();
  // Wheels.
  g.fillStyle = '#0d0e10';
  for (const x of [72, 212]) {
    g.beginPath();
    g.arc(x, 106, 17, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#8d939c';
    g.beginPath();
    g.arc(x, 106, 7, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#0d0e10';
  }
  // The sticker in the rear window.
  g.font = "22px 'Apple Color Emoji', 'Segoe UI Emoji', 'Noto Color Emoji', sans-serif";
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(sticker, 186, 64);
  return c.toDataURL('image/png');
}

const pics = new Map<string, string>();
const picture = (color: string, sticker: string) => {
  const key = color + sticker;
  if (!pics.has(key)) pics.set(key, carPicture(color, sticker));
  return pics.get(key)!;
};

export class PhonePanel extends Panel {
  readonly name = 'phone';
  override size = 'medium' as const;
  private tab: 'supplier' | 'channel' = 'supplier';
  private timer: number | null = null;

  title() {
    return 'Telefon · Telegram';
  }
  override subtitle() {
    const goods = this.store.tg?.goods ?? 0;
    return goods > 0 ? `📦 Üzerinde ${goods} gr mal` : 'Üzerinde mal yok';
  }
  iconSvg() {
    return ICONS.phone;
  }

  override init(): void {
    if (this.arg.tab === 'channel') this.tab = 'channel';
    this.listen(this.store.on('tg', () => this.refresh()));
    void this.net
      .rpc('tg.read', {})
      .then((s) => this.store.setTg(s))
      .catch((err) => this.ui.error(err));
    this.timer = window.setInterval(() => {
      const el = this.bodyEl.querySelector('[data-clock]') as HTMLElement | null;
      const until = Number(el?.dataset.clock ?? 0);
      if (el && until) el.textContent = mmss(Math.max(0, (until - this.store.serverNow()) / 1000));
    }, 1000);
    this.listen(() => {
      if (this.timer) clearInterval(this.timer);
    });
  }

  renderBody(): Child {
    const s = this.store.tg;
    if (!s) return h('div', { class: 'empty' }, 'Bağlanıyor…');
    const open = s.orders.filter((o) => o.status === 'open').length;
    const tabs = h(
      'div',
      { class: 'tg-tabs' },
      h('button', { class: `tg-tab ${this.tab === 'supplier' ? 'on' : ''}`, 'data-testid': 'tg-tab-supplier', onclick: () => ((this.tab = 'supplier'), this.refresh()) }, '💬 Tedarikçi'),
      h('button', { class: `tg-tab ${this.tab === 'channel' ? 'on' : ''}`, 'data-testid': 'tg-tab-channel', onclick: () => ((this.tab = 'channel'), this.refresh()) }, `📢 Kanalım${open ? ` (${open})` : ''}`),
    );
    const msgs = s.messages.filter((m) => m.chat === this.tab);
    const chat = h('div', { class: 'tg-chat', 'data-testid': 'tg-chat' }, msgs.map((m) => this.bubble(m)));
    requestAnimationFrame(() => (chat.scrollTop = chat.scrollHeight));
    return h('div', { class: 'tg-phone', 'data-testid': 'phone-panel' }, tabs, chat, this.tab === 'supplier' ? this.supplierBar() : this.channelBar(s.orders));
  }

  private bubble(m: TgMessage): Child {
    const me = this.store.me;
    const pos = me ? this.ui.game.localPosition() : { x: 0, z: 0 };
    return h(
      'div',
      { class: `tg-msg ${m.from}` },
      m.name && m.from === 'them' ? h('div', { class: 'tg-name' }, `@${m.name}`) : null,
      m.car
        ? h(
            'div',
            { class: 'tg-car' },
            h('img', { src: picture(m.car.color, m.car.sticker), alt: 'araç' }),
            h('div', { class: 'tiny' }, `${m.car.colorName} ${getModel(m.car.modelId).brand} ${getModel(m.car.modelId).name} · camda ${m.car.sticker}`),
          )
        : null,
      h('div', null, m.text),
      m.pin ? h('div', { class: 'tg-pin' }, `📍 ${m.pin.label} · ${Math.round(Math.hypot(m.pin.x - pos.x, m.pin.z - pos.z))} m (haritada)`) : null,
      h('div', { class: 'tg-time' }, new Date(m.at).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })),
    );
  }

  private supplierBar(): Child {
    const s = this.store.tg!;
    const money = this.store.me?.money ?? 0;
    if (s.pickup) {
      return h('div', { class: 'tg-bar' }, h('div', { class: 'tiny' }, '📦 Paket arabada seni bekliyor: ', h('b', { 'data-clock': String(s.pickup.until) }, mmss(Math.max(0, (s.pickup.until - this.store.serverNow()) / 1000))), ' · yolcu koltuğuna bin (E).'));
    }
    return h(
      'div',
      { class: 'tg-bar' },
      h('button', { class: 'btn primary', disabled: this.busy || money < DEALS.buyPrice, 'data-testid': 'tg-order', onclick: () => void this.act(() => this.net.rpc('tg.order', {}), (r) => this.store.setTg(r)) }, `${DEALS.grams} gr sipariş ver · ${formatMoney(DEALS.buyPrice)}`),
      h('div', { class: 'tiny muted' }, 'Nakit ödenir (temiz para). Satışlardan kara para gelir.'),
    );
  }

  private channelBar(orders: DealOrder[]): Child {
    const goods = this.store.tg?.goods ?? 0;
    if (orders.length === 0) return h('div', { class: 'tg-bar tiny muted' }, `Yeni siparişler ara ara gelir. Teslimatın %${Math.round(DEALS.copChance * 100)}'i gizli polis olabilir: ölü nokta daha güvenli ama %${Math.round((1 - DEALS.dropShare) * 100)} daha az öder.`);
    return h(
      'div',
      { class: 'tg-bar tg-orders' },
      orders.map((o) => {
        const head = h('div', null, h('b', null, `@${o.name}`), ` · ${o.grams} gr · elden ${formatMoney(o.price)} / ölü nokta ${formatMoney(dropPrice(o.price))}`);
        if (o.status === 'open') {
          return h(
            'div',
            { class: 'tg-order', 'data-testid': `tg-order-${o.id}` },
            head,
            h(
              'div',
              { class: 'row', style: { gap: '6px', marginTop: '4px' } },
              h('button', { class: 'btn small primary', disabled: this.busy || goods < o.grams, onclick: () => void this.act(() => this.net.rpc('tg.accept', { orderId: o.id, mode: 'hand' }), (r) => this.store.setTg(r)) }, '🤝 Elden teslim'),
              h('button', { class: 'btn small', disabled: this.busy || goods < o.grams, onclick: () => void this.act(() => this.net.rpc('tg.accept', { orderId: o.id, mode: 'drop' }), (r) => this.store.setTg(r)) }, '📍 Ölü nokta'),
              h('button', { class: 'btn small danger', disabled: this.busy, onclick: () => void this.act(() => this.net.rpc('tg.decline', { orderId: o.id }), (r) => this.store.setTg(r)) }, 'Reddet'),
            ),
            goods < o.grams ? h('div', { class: 'tiny muted' }, 'Önce tedarikçiden mal al.') : null,
          );
        }
        const drop = o.dropId ? findDrop(o.dropId) : undefined;
        const status = o.status === 'hand' ? '🤝 Müşterinin arabasına git, yolcu koltuğuna bin (E).' : o.status === 'drop' ? `📍 ${drop?.name ?? ''}: paketi bırak (E).` : '📦 Paket bırakıldı, müşteri alacak.';
        return h('div', { class: 'tg-order' }, head, h('div', { class: 'tiny' }, status));
      }),
      h('div', { class: 'tiny muted' }, `Satışlar kara para öder: ${formatMoney(ECONOMY.deals.perGram[0])}-${formatMoney(ECONOMY.deals.perGram[1])} / gr.`),
    );
  }
}
