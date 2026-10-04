// "VEHICLE STOLEN - POLICE TRACKING (03:00)": the countdown of a stolen car's police tracking. It
// runs while the thief drives the car and starts over whenever a CCTV camera or a police car sees it.

import type { PursuitView } from '../../../shared/cctv';
import { modelDisplayName } from '../../../shared/vehicles';
import { h } from './dom';
import { mmss } from './RewardsHud';

export class PursuitHud {
  readonly el: HTMLElement;
  private title: HTMLElement;
  private sub: HTMLElement;
  private alert: HTMLElement;
  private fill: HTMLElement;
  private view: PursuitView | null = null;
  private left = 0;
  private lastSeenAt = 0;
  private flashUntil = 0;

  constructor() {
    this.title = h('div', { class: 'ph-title', 'data-testid': 'pursuit-title' });
    this.sub = h('div', { class: 'ph-sub' });
    this.alert = h('div', { class: 'ph-alert' });
    this.fill = h('div');
    this.el = h('div', { class: 'pursuit-hud', 'data-testid': 'pursuit-hud' }, h('div', { class: 'ph-lights' }, h('span', { class: 'red' }), h('span', { class: 'blue' })), this.title, h('div', { class: 'ph-bar' }, this.fill), this.sub, this.alert);
  }

  get active(): boolean {
    return !!this.view;
  }

  set(v: PursuitView | null): void {
    this.view = v;
    this.el.classList.toggle('show', !!v);
    if (!v) return;
    this.left = v.left;
    // Seen again: flash the reason.
    if (v.seenAt !== this.lastSeenAt) {
      if (this.lastSeenAt !== 0 && v.seenBy !== 'lockpick') this.flashUntil = performance.now() + 2600;
      this.lastSeenAt = v.seenAt;
      this.alert.textContent = v.seenBy === 'camera' ? '📹 KAMERAYA YAKALANDIN! Sayaç sıfırlandı' : v.seenBy === 'police' ? '🚓 POLİS SENİ GÖRDÜ! Sayaç sıfırlandı' : '';
    }
    this.render();
  }

  /** Per frame: the clock runs down between server updates. */
  update(dt: number): void {
    const v = this.view;
    if (!v) return;
    if (!v.paused) this.left = Math.max(0, this.left - dt);
    this.render();
  }

  private render(): void {
    const v = this.view!;
    this.title.textContent = `VEHICLE STOLEN - POLICE TRACKING (${mmss(this.left)})`;
    this.fill.style.width = `${(1 - this.left / v.total) * 100}%`;
    this.sub.textContent = v.paused
      ? `${modelDisplayName(v.modelId)} · sayaç durdu: arabaya geri bin`
      : `${modelDisplayName(v.modelId)} · kameralardan ve polisten uzak dur · stay out of the red camera cones`;
    const flash = performance.now() < this.flashUntil;
    this.el.classList.toggle('seen', flash);
    this.el.classList.toggle('paused', v.paused);
    this.alert.style.display = flash ? '' : 'none';
  }
}
