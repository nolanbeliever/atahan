// The checkpoint card (top centre): the green "ÇEVİRME NOKTASI - YAVAŞLA VE DUR" as you drive up to
// a police checkpoint, the papers / boot check with its progress bar (and the K9 dog sniffing), then
// "Temiz, geçebilirsin", or the red news: the dog barked, you ran it, they saw you turn back.

import type { StopState } from '../../../shared/trafficStops';
import { h } from './dom';

const ICON: Record<StopState['phase'], string> = { warn: '🛑', check: '👮', clear: '✅', caught: '🐕', evaded: '🚨', uturn: '📻' };

export class StopHud {
  readonly el: HTMLElement;
  private icon: HTMLElement;
  private title: HTMLElement;
  private text: HTMLElement;
  private fill: HTMLElement;
  private bar: HTMLElement;
  private timer = 0;

  constructor() {
    this.icon = h('div', { class: 'stop-icon' });
    this.title = h('div', { class: 'stop-title', 'data-testid': 'stop-title' });
    this.text = h('div', { class: 'stop-text' });
    this.fill = h('div');
    this.bar = h('div', { class: 'stop-bar' }, this.fill);
    this.el = h('div', { class: 'stop-card', 'data-testid': 'stop-card' }, this.icon, h('div', { class: 'stop-body' }, this.title, this.text, this.bar));
  }

  set(st: StopState): void {
    window.clearTimeout(this.timer);
    this.el.className = `stop-card show ${st.phase}`;
    this.icon.textContent = st.phase === 'caught' && !st.k9 ? '🚔' : ICON[st.phase];
    const titles: Record<StopState['phase'], string> = {
      warn: 'ÇEVİRME NOKTASI - YAVAŞLA VE DUR',
      check: st.k9 ? 'KONTROL · K9 KÖPEĞİ KOKLUYOR' : 'EVRAK / BAGAJ KONTROLÜ',
      clear: 'TEMİZ, GEÇEBİLİRSİN',
      caught: st.k9 ? 'K9 KÖPEĞİ HAVLADI! · 2 YILDIZ' : 'ÇEVİRMEDE YAKALANDIN! · 2 YILDIZ',
      evaded: 'ÇEVİRMEDEN KAÇTIN! · 2 YILDIZ',
      uturn: 'NÖBETÇİ POLİS GERİ DÖNDÜĞÜNÜ GÖRDÜ',
    };
    this.title.textContent = titles[st.phase];
    this.text.textContent = st.phase === 'warn' ? `${st.name}${st.k9 ? ' · K9 narkotik köpeği var' : ''} · çizgide dur, kontrol 3-5 sn sürer` : st.text ?? '';
    this.bar.style.display = st.phase === 'check' ? '' : 'none';
    this.fill.style.width = `${Math.round((st.progress ?? 0) * 100)}%`;
    if (st.phase !== 'warn' && st.phase !== 'check') this.timer = window.setTimeout(() => this.hide(), 4500);
  }

  hide(): void {
    this.el.classList.remove('show');
  }
}
