// The heist card under the wanted stars: the job, the work bar and the time left while you're at
// the door ("step away and the work stops"), the bag of loot while you get away from the police,
// and for the showroom job the clock to the docks and how far it is.

import type { HeistView } from '../../../shared/heists';
import { formatMoney } from '../../../shared/util';
import { h } from './dom';
import { mmss } from './RewardsHud';

export class HeistHud {
  readonly el: HTMLElement;
  private kicker: HTMLElement;
  private title: HTMLElement;
  private bar: HTMLElement;
  private barWrap: HTMLElement;
  private text: HTMLElement;
  private view: HeistView | null = null;

  constructor() {
    this.kicker = h('div', { class: 'hs-kicker' });
    this.title = h('div', { class: 'hs-title', 'data-testid': 'heist-title' });
    this.bar = h('div');
    this.barWrap = h('div', { class: 'hs-bar' }, this.bar);
    this.text = h('div', { class: 'hs-text', 'data-testid': 'heist-text' });
    this.el = h('div', { class: 'heist-hud', 'data-testid': 'heist-hud' }, h('div', { class: 'hs-icon' }, '💰'), h('div', { class: 'hs-body' }, this.kicker, this.title, this.barWrap, this.text));
  }

  get current(): HeistView | null {
    return this.view;
  }

  set(v: HeistView | null): void {
    this.view = v;
    this.el.classList.toggle('show', !!v);
    if (!v) return;
    this.el.dataset.phase = v.phase;
    this.title.textContent = v.title;
    this.barWrap.style.display = v.phase === 'work' ? '' : 'none';
    this.bar.style.width = `${Math.round(v.progress * 100)}%`;
    this.el.classList.toggle('stopped', v.phase === 'work' && !v.atDoor);
    if (v.phase === 'work') {
      this.kicker.textContent = `${v.policeIn ? `🚔 POLİS YOLDA ${mmss(v.policeIn)}` : '🚨 POLİS GELDİ'} · İŞ ${mmss(v.left)} · %${Math.round(v.progress * 100)}`;
      this.text.textContent = v.atDoor ? `${v.task}… Kapıda kal!` : 'KAPIDAN UZAKTASIN: iş durdu! Geri dön (çok uzaklaşırsan iş yatar).';
    } else if (v.phase === 'drive') {
      this.kicker.textContent = '🏁 LİMANA TESLİM';
      this.text.textContent = 'Galeri arabası bariyerlerin dışında: bin ve limana götür.';
    } else if (v.phase === 'escape') {
      this.kicker.textContent = '🎒 GANİMET ÇANTADA';
      this.text.textContent = `${formatMoney(v.loot)} · Polisi atlat: kaçınca kara paran olur. Yakalanırsan polis el koyar!`;
    }
  }

  /** Per frame: the docks clock and distance (showroom job). */
  update(now: number, x: number, z: number): void {
    const v = this.view;
    if (!v || v.phase !== 'drive' || !v.drop) return;
    const d = Math.hypot(v.drop.x - x, v.drop.z - z);
    this.kicker.textContent = `🏁 LİMANA TESLİM · ${mmss(Math.max(0, (v.drop.until - now) / 1000))}`;
    this.text.textContent = d < 12 ? 'Konteyner sahasındasın: dur, alıcı arabayı alsın.' : `Galeri arabasını limana götür: ${Math.round(d)} m (haritada 🏁).`;
  }
}
