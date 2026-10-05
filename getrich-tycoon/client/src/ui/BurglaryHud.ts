// The night burglary HUD (inside a place): the noise meter (green, amber, red; it pulses near the
// top), what is in the bag, taking something (a progress bar), the alarm banner with the police
// countdown, and a line of advice (walk, don't run; freeze while a sensor is red).

import { LOOT_LABELS, findTarget, type BurglaryState, type LootItemId } from '../../../shared/burglary';
import { formatMoney } from '../../../shared/util';
import { h } from './dom';

export class BurglaryHud {
  readonly el: HTMLElement;
  private title: HTMLElement;
  private fill: HTMLElement;
  private pct: HTMLElement;
  private bag: HTMLElement;
  private work: HTMLElement;
  private workFill: HTMLElement;
  private workLabel: HTMLElement;
  private alarm: HTMLElement;
  private alarmText: HTMLElement;
  private alarmTime: HTMLElement;
  private tip: HTMLElement;
  private st: BurglaryState | null = null;

  constructor() {
    this.title = h('div', { class: 'bg-title' });
    this.fill = h('div', { class: 'bg-fill' });
    this.pct = h('div', { class: 'bg-pct mono' });
    this.bag = h('div', { class: 'bg-bag', 'data-testid': 'burglary-bag' });
    this.workLabel = h('div', { class: 'work-label' });
    this.workFill = h('div');
    this.work = h('div', { class: 'bg-work' }, this.workLabel, h('div', { class: 'work-bar' }, this.workFill));
    this.alarmText = h('div', { class: 'bg-alarm-text' });
    this.alarmTime = h('div', { class: 'bg-alarm-time mono' });
    this.alarm = h('div', { class: 'bg-alarm', 'data-testid': 'burglary-alarm' }, h('div', { class: 'bg-alarm-head' }, '🚨 ALARM ÇALIYOR!'), this.alarmText, this.alarmTime);
    this.tip = h('div', { class: 'bg-tip' });
    this.el = h(
      'div',
      { class: 'burglary-hud', 'data-testid': 'burglary-hud' },
      this.alarm,
      h('div', { class: 'bg-card' }, this.title, h('div', { class: 'bg-meter-row' }, h('div', { class: 'bg-label' }, 'GÜRÜLTÜ'), h('div', { class: 'bg-meter', 'data-testid': 'noise-meter' }, this.fill), this.pct), this.bag, this.work, this.tip),
    );
  }

  set(st: BurglaryState | null): void {
    this.st = st;
    this.el.classList.toggle('show', !!st);
    if (!st) return;
    const t = findTarget(st.targetId);
    this.title.textContent = `🕶️ ${t?.name ?? ''}`;
    const items = Object.entries(st.bag.items).filter(([, n]) => (n ?? 0) > 0) as [LootItemId, number][];
    this.bag.textContent = `Çanta: ${formatMoney(st.bag.cash)}${items.length ? ' · ' + items.map(([id, n]) => `${LOOT_LABELS[id].icon}×${n}`).join(' ') : ''}`;
    this.alarm.classList.toggle('show', st.alarm);
    this.alarmText.textContent = st.cause ?? '';
    this.render(Date.now());
  }

  /** Every frame: the meter, the countdowns. */
  render(now: number, serverOffset = 0): void {
    const st = this.st;
    if (!st) return;
    const k = Math.max(0, Math.min(1, st.noise / 100));
    this.fill.style.width = `${Math.round(k * 100)}%`;
    this.fill.className = `bg-fill ${k > 0.75 ? 'hot' : k > 0.4 ? 'warm' : ''}`;
    this.pct.textContent = `%${Math.round(k * 100)}`;
    this.el.classList.toggle('loud', k > 0.75 && !st.alarm);
    const server = now + serverOffset;
    if (st.work) {
      const p = Math.max(0, Math.min(1, 1 - (st.work.until - server) / (st.work.sec * 1000)));
      this.work.style.display = '';
      this.workLabel.textContent = `Alınıyor... %${Math.round(p * 100)} (kıpırdama)`;
      this.workFill.style.width = `${Math.round(p * 100)}%`;
    } else this.work.style.display = 'none';
    if (st.alarm && st.policeAt) {
      const left = Math.max(0, Math.ceil((st.policeAt - server) / 1000));
      this.alarmTime.textContent = left > 0 ? `POLİS KAPIDA: ${left} sn · ÇIKIŞA KOŞ!` : 'POLİS İÇERİ GİRİYOR!';
    }
    this.tip.textContent = st.alarm ? 'Çantayı kap ve çık: polis gelmeden uzaklaş, izini kaybettirince ganimet senin.' : 'Yürü, koşma (Shift gürültü yapar) · sensör kırmızıyken dur · lazere dokunma · ÇIKIŞ kapısından sessizce çık.';
  }
}
