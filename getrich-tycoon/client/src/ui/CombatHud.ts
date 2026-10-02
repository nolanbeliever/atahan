// Fight HUD: the health bar, the drawn gun with its rounds, the crosshair, a red flash with an arrow
// towards whoever hit you, and the WASTED screen.

import { COMBAT, type HealthView, type WeaponDef } from '../../../shared/weapons';
import { h } from './dom';

export class CombatHud {
  readonly health: HTMLElement;
  readonly gun: HTMLElement;
  readonly crosshair: HTMLElement;
  readonly overlay: HTMLElement;
  private hpFill: HTMLElement;
  private hpText: HTMLElement;
  private gunName: HTMLElement;
  private gunAmmo: HTMLElement;
  private arrow: HTMLElement;
  private flashTimer = 0;

  constructor() {
    this.hpFill = h('div', { class: 'hp-fill' });
    this.hpText = h('div', { class: 'hp-text mono', 'data-testid': 'hp-text' }, `${COMBAT.playerHp}`);
    this.health = h('div', { class: 'hp-bar', 'data-testid': 'hp-bar', title: 'Health' }, h('span', { class: 'hp-heart' }, '❤'), h('div', { class: 'hp-track' }, this.hpFill), this.hpText);
    this.gunName = h('div', { class: 'gun-hud-name' });
    this.gunAmmo = h('div', { class: 'gun-hud-ammo mono', 'data-testid': 'gun-ammo' });
    this.gun = h('div', { class: 'gun-hud', 'data-testid': 'gun-hud' }, this.gunName, this.gunAmmo, h('div', { class: 'gun-hud-keys' }, '1-6 gun · Q away · click fire'));
    this.crosshair = h('div', { class: 'gun-crosshair', 'data-testid': 'crosshair' }, h('i'), h('i'), h('i'), h('i'));
    this.arrow = h('div', { class: 'hurt-arrow' });
    this.overlay = h('div', { class: 'hurt-overlay' }, this.arrow);
    this.setHealth({ hp: COMBAT.playerHp, max: COMBAT.playerHp, hitAt: 0 });
  }

  setHealth(v: HealthView): void {
    const k = Math.max(0, Math.min(1, v.hp / v.max));
    this.hpFill.style.width = `${k * 100}%`;
    this.hpFill.style.background = k < 0.3 ? '#ff3b47' : k < 0.6 ? '#ffb547' : '#2ee59d';
    this.hpText.textContent = String(v.hp);
    this.health.classList.toggle('low', k < 0.3);
  }

  setGun(w: WeaponDef | null, ammo: number, onFoot: boolean): void {
    const show = !!w && onFoot;
    this.gun.classList.toggle('show', show);
    this.crosshair.classList.toggle('show', show);
    this.crosshair.classList.toggle('big', !!w && w.spread > 0.05);
    if (!w) return;
    this.gunName.textContent = w.name;
    this.gunAmmo.textContent = ammo > 0 ? `${ammo}` : 'NO AMMO';
    this.gunAmmo.classList.toggle('empty', ammo <= 0);
  }

  /** Hit: a red flash and an arrow pointing to where it came from. */
  hurt(v: HealthView, me: { x: number; z: number }, camYaw: number): void {
    this.setHealth(v);
    this.overlay.classList.remove('show');
    void this.overlay.offsetWidth;
    this.overlay.classList.add('show');
    if (v.fromX !== undefined && v.fromZ !== undefined) {
      const ang = Math.atan2(v.fromX - me.x, v.fromZ - me.z) - camYaw;
      this.arrow.style.transform = `translate(-50%, -50%) rotate(${-ang}rad) translateY(-130px)`;
      this.arrow.style.display = '';
    } else this.arrow.style.display = 'none';
    window.clearTimeout(this.flashTimer);
    this.flashTimer = window.setTimeout(() => this.overlay.classList.remove('show'), 700);
  }

  /** Health gone: grey world, WASTED, what the police took. */
  wasted(lost: string[], ms: number): void {
    const el = h(
      'div',
      { class: 'wasted', 'data-testid': 'wasted' },
      h('div', { class: 'wasted-title' }, 'WASTED'),
      h('div', { class: 'wasted-sub' }, 'You wake up at GetRich General Hospital.'),
      lost.length ? h('div', { class: 'wasted-lost' }, `Lost: ${lost.join(', ')}`) : null,
    );
    document.body.appendChild(el);
    document.body.classList.add('is-wasted');
    window.setTimeout(() => {
      el.remove();
      document.body.classList.remove('is-wasted');
    }, ms);
  }
}
