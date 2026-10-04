// The live "Geçiş Geçmişi / Ceza Bildirimi" feed: the latest toll passes, fines, plate-camera reads and
// checkpoints slide in under the HUD for a few seconds; a fine or a camera hit also shows an official-
// looking fine notice. "Geçmiş" opens the full history panel.

import type { TollEvent } from '../../../shared/tolls';
import { formatMoney } from '../../../shared/util';
import { getModel } from '../../../shared/vehicles';
import { append, clear, h } from './dom';

const ICON: Record<TollEvent['kind'], string> = { toll: '🛣', evasion: '⛔', anpr: '📷', checkpoint: '🚨', breakthrough: '💥' };

export function tollAmount(e: TollEvent): string {
  if (e.amount < 0) return `-${formatMoney(-e.amount)}`;
  if (e.amount > 0) return `+${formatMoney(e.amount)}`;
  return e.stars > 0 ? `+${e.stars} ★` : '';
}

export function tollTime(at: number): string {
  const d = new Date(at);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
}

export class TollFeed {
  readonly el: HTMLElement;
  readonly notice: HTMLElement;
  private list: HTMLElement;
  private hideTimer: number | null = null;
  private noticeTimer: number | null = null;

  constructor(onHistory: () => void) {
    this.list = h('div', { class: 'tf-list' });
    this.el = h(
      'div',
      { class: 'toll-feed', 'data-testid': 'toll-feed' },
      h('div', { class: 'tf-head' }, h('span', null, 'GEÇİŞ GEÇMİŞİ'), h('button', { class: 'tf-more', 'data-testid': 'toll-history-open', onclick: onHistory }, 'Geçmiş ›')),
      this.list,
    );
    this.notice = h('div', { class: 'fine-notice', 'data-testid': 'fine-notice' });
  }

  /** A new event: shown on top of the feed (the last four), and as a fine notice when it is one. */
  push(e: TollEvent, recent: TollEvent[]): void {
    clear(this.list);
    for (const ev of recent.slice(0, 4)) {
      this.list.append(
        h('div', { class: `tf-row ${ev.kind}${ev === e ? ' new' : ''}` }, h('span', { class: 'tf-ic' }, ICON[ev.kind]), h('span', { class: 'tf-text' }, ev.text), h('span', { class: `tf-amt ${ev.amount < 0 || ev.stars > 0 ? 'neg' : 'pos'}` }, tollAmount(ev))),
      );
    }
    this.el.classList.add('show');
    if (this.hideTimer) clearTimeout(this.hideTimer);
    this.hideTimer = window.setTimeout(() => this.el.classList.remove('show'), 9000);
    if (e.kind === 'evasion' || (e.kind === 'anpr' && e.stars > 0)) this.fine(e);
  }

  /** "TRAFİK CEZA BİLDİRİMİ": an evasion fine or a camera hit. */
  private fine(e: TollEvent): void {
    clear(this.notice);
    const car = e.modelId ? `${getModel(e.modelId).brand} ${getModel(e.modelId).name}` : '';
    append(this.notice, [
      h('div', { class: 'fn-head' }, h('span', null, 'T.C. KARAYOLLARI'), h('span', null, tollTime(e.at))),
      h('div', { class: 'fn-title' }, e.kind === 'evasion' ? 'TRAFİK CEZA BİLDİRİMİ' : 'PLAKA TANIMA UYARISI'),
      h('div', { class: 'fn-row' }, h('span', null, 'Yer'), h('b', null, e.place)),
      e.plate ? h('div', { class: 'fn-row' }, h('span', null, 'Plaka'), h('b', { class: 'fn-plate' }, e.plate)) : null,
      car ? h('div', { class: 'fn-row' }, h('span', null, 'Araç'), h('b', null, car)) : null,
      h('div', { class: 'fn-row' }, h('span', null, e.kind === 'evasion' ? 'Ceza' : 'Sonuç'), h('b', { class: 'fn-amt' }, e.kind === 'evasion' ? formatMoney(-e.amount) : `Aranma +${e.stars} ★`)),
      h('div', { class: 'fn-text' }, e.text),
    ]);
    this.notice.classList.add('show');
    if (this.noticeTimer) clearTimeout(this.noticeTimer);
    this.noticeTimer = window.setTimeout(() => this.notice.classList.remove('show'), 6000);
  }
}
