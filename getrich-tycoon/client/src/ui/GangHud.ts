// Gang territories on the HUD: the big banner across the screen (BÖLGE SAVAŞI BAŞLADI, DALGA 2/3,
// BÖLGE ELE GEÇİRİLDİ, BÖLGEN SALDIRI ALTINDA...), the war card (zone, wave, members left, the next
// wave's countdown, the "back into the zone" countdown) and the attack alert with its 2-minute clock.

import { findZone, type TurfWarView } from '../../../shared/gangs';
import { h } from './dom';

export class GangHud {
  readonly el: HTMLElement;
  readonly banner: HTMLElement;
  private bannerText: HTMLElement;
  private card: HTMLElement;
  private title: HTMLElement;
  private wave: HTMLElement;
  private left: HTMLElement;
  private fill: HTMLElement;
  private note: HTMLElement;
  private alert: HTMLElement;
  private alertText: HTMLElement;
  private alertTime: HTMLElement;
  private war: TurfWarView | null = null;
  private attack: { until: number; text: string } | null = null;
  private bannerTimer = 0;

  constructor() {
    this.bannerText = h('div', { class: 'gb-text' });
    this.banner = h('div', { class: 'gang-banner', 'data-testid': 'gang-banner' }, this.bannerText);
    this.title = h('div', { class: 'gw-title' });
    this.wave = h('div', { class: 'gw-wave mono' });
    this.left = h('div', { class: 'gw-left' });
    this.fill = h('div', { class: 'gw-fill' });
    this.note = h('div', { class: 'gw-note' });
    this.card = h('div', { class: 'gang-war', 'data-testid': 'gang-war' }, h('div', { class: 'gw-head' }, this.title, this.wave), this.left, h('div', { class: 'gw-bar' }, this.fill), this.note);
    this.alertText = h('div', { class: 'ga-text' });
    this.alertTime = h('div', { class: 'ga-time mono' });
    this.alert = h('div', { class: 'gang-alert', 'data-testid': 'gang-alert' }, this.alertText, this.alertTime);
    this.el = h('div', { class: 'gang-hud' }, this.card, this.alert);
  }

  showBanner(text: string, color: string): void {
    window.clearTimeout(this.bannerTimer);
    this.bannerText.textContent = text;
    this.banner.style.setProperty('--gang', color);
    this.banner.classList.remove('show');
    void this.banner.offsetWidth;
    this.banner.classList.add('show');
    this.bannerTimer = window.setTimeout(() => this.banner.classList.remove('show'), 3800);
  }

  setWar(w: TurfWarView | null): void {
    this.war = w;
    this.card.classList.toggle('show', !!w);
    if (!w) return;
    const z = findZone(w.zone)!;
    this.card.style.setProperty('--gang', z.color);
    this.title.textContent = w.kind === 'defend' ? `🛡️ BÖLGENİ SAVUN · ${z.name}` : `⚔️ BÖLGE SAVAŞI · ${z.name}`;
    this.wave.textContent = w.kind === 'defend' ? 'SAVUNMA' : `DALGA ${w.wave}/${w.waves}`;
    this.left.textContent = `${z.gang}: ${w.left} kişi kaldı`;
    this.fill.style.width = `${Math.round((1 - w.left / Math.max(1, w.total)) * 100)}%`;
    this.render(Date.now());
  }

  setAttack(a: { until: number; text: string } | null): void {
    this.attack = a;
    this.alert.classList.toggle('show', !!a);
    if (a) this.alertText.textContent = a.text;
  }

  render(serverNow: number): void {
    const w = this.war;
    if (w) {
      const parts: string[] = [];
      if (w.nextAt && w.nextAt > serverNow) parts.push(`Sıradaki dalga: ${Math.ceil((w.nextAt - serverNow) / 1000)} sn`);
      if (w.leaveAt) parts.push(`⚠️ Bölgeye dön: ${Math.max(0, Math.ceil((w.leaveAt - serverNow) / 1000))} sn`);
      this.note.textContent = parts.join(' · ') || w.text;
      this.note.classList.toggle('warn', !!w.leaveAt);
    }
    if (this.attack) {
      const left = Math.max(0, Math.ceil((this.attack.until - serverNow) / 1000));
      this.alertTime.textContent = `${String(Math.floor(left / 60)).padStart(2, '0')}:${String(left % 60).padStart(2, '0')}`;
    }
  }
}
