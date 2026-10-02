// "Geçiş Geçmişi / Ceza Bildirimi": every toll pass, evasion fine, number-plate camera read and police
// checkpoint of this session, newest first, with the totals and the rules.

import { ECONOMY } from '../../../../shared/economy.config';
import type { TollEvent } from '../../../../shared/tolls';
import { formatMoney } from '../../../../shared/util';
import { getModel } from '../../../../shared/vehicles';
import { h, type Child } from '../dom';
import { ICONS } from '../icons';
import { Panel } from '../Panel';
import { tollAmount, tollTime } from '../TollFeed';

const KIND: Record<TollEvent['kind'], string> = { toll: 'Geçiş', evasion: 'Kaçak geçiş', anpr: 'Plaka okuma', checkpoint: 'Kontrol noktası', breakthrough: 'Barikat' };

export class TollsPanel extends Panel {
  readonly name = 'tolls';
  override size = 'wide' as const;

  title() {
    return 'Geçiş Geçmişi · Ceza Bildirimi';
  }
  override subtitle() {
    return 'Köprü gişeleri, plaka tanıma kameraları ve polis kontrol noktaları';
  }
  iconSvg() {
    return ICONS.flag;
  }

  override init(): void {
    this.listen(this.store.on('tolls', () => this.refresh()));
    void this.net
      .rpc('toll.history', {})
      .then((r) => this.store.setTollEvents(r.events))
      .catch((err) => this.ui.error(err));
  }

  renderBody(): Child {
    const events = this.store.tollEvents;
    const paid = events.filter((e) => e.kind === 'toll').reduce((s, e) => s - e.amount, 0);
    const fines = events.filter((e) => e.kind === 'evasion').reduce((s, e) => s - e.amount, 0);
    const reads = events.filter((e) => e.kind === 'anpr' && e.stars > 0).length;
    const t = ECONOMY.tolls;
    return h(
      'div',
      { 'data-testid': 'tolls-panel' },
      h(
        'div',
        { class: 'toll-sum' },
        h('div', null, h('div', { class: 'tiny muted' }, 'Geçiş ücreti'), h('div', { class: 'mono' }, formatMoney(paid))),
        h('div', null, h('div', { class: 'tiny muted' }, 'Ceza'), h('div', { class: 'mono red' }, formatMoney(fines))),
        h('div', null, h('div', { class: 'tiny muted' }, 'Kamera ihbarı'), h('div', { class: 'mono' }, String(reads))),
      ),
      events.length === 0
        ? h('div', { class: 'empty' }, 'Henüz geçiş yok. Köprüden karşı kıyıya geçince gişede ücret ödenir.')
        : h(
            'table',
            { class: 'toll-table' },
            h('thead', null, h('tr', null, h('th', null, 'Saat'), h('th', null, 'Tür'), h('th', null, 'Yer'), h('th', null, 'Plaka / Araç'), h('th', null, 'Tutar'))),
            h(
              'tbody',
              null,
              events.map((e) =>
                h(
                  'tr',
                  { class: e.kind, 'data-testid': 'toll-row', 'data-kind': e.kind },
                  h('td', { class: 'mono' }, tollTime(e.at)),
                  h('td', null, KIND[e.kind]),
                  h('td', null, e.place),
                  h('td', null, [e.plate ? h('span', { class: 'fn-plate small' }, e.plate) : null, e.modelId ? ` ${getModel(e.modelId).brand} ${getModel(e.modelId).name}` : '']),
                  h('td', { class: `mono ${e.amount < 0 || e.stars > 0 ? 'red' : 'green'}` }, tollAmount(e)),
                ),
              ),
            ),
          ),
      h(
        'div',
        { class: 'tiny muted', style: { marginTop: '10px', lineHeight: '1.5' } },
        `Karşı kıyıya geçerken gişede ${formatMoney(t.fee)} ödenir: ${t.maxKmh} km/s altına yavaşla, HGS okur ve kol kalkar. Bariyeri hızla kırıp geçmek kaçak geçiştir: ${formatMoney(t.evasionFine)} ceza. ` +
          'Plaka tanıma kameraları çalıntı kayıtlı (Kara Borsa), çalıntı veya aranan araçları okursa 1 yıldız eklenir; çevrik plaka okunamaz, sahte plaka temiz okunur. ' +
          `2 yıldızla köprüye çıkarsan karşı uçta polis kontrol noktası kurulur: barikatı yarıp geçersen +${formatMoney(t.checkpoint.reward)}.`,
      ),
    );
  }
}
