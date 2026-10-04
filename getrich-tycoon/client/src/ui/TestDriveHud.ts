// The test-drive card under the wanted stars: which car, the showroom and the clock.

import { findShowroom, type TestDriveView } from '../../../shared/showrooms';
import { getModel } from '../../../shared/vehicles';
import { h } from './dom';
import { mmss } from './RewardsHud';

export class TestDriveHud {
  readonly el: HTMLElement;
  private title: HTMLElement;
  private where: HTMLElement;
  private clock: HTMLElement;
  private view: TestDriveView | null = null;

  constructor(onReturn: () => void) {
    this.title = h('div', { class: 'td-title', 'data-testid': 'testdrive-car' });
    this.where = h('div', { class: 'td-text' });
    this.clock = h('span', { class: 'td-clock', 'data-testid': 'testdrive-clock' });
    this.el = h(
      'div',
      { class: 'testdrive-hud', 'data-testid': 'testdrive-hud' },
      h('div', { class: 'td-icon' }, '🔑'),
      h(
        'div',
        { class: 'td-body' },
        h('div', { class: 'td-kicker' }, 'TEST SÜRÜŞÜ · ', this.clock),
        this.title,
        this.where,
        h('button', { class: 'btn small td-return', 'data-testid': 'testdrive-return', onclick: onReturn }, 'Teslim Et'),
      ),
    );
  }

  set(v: TestDriveView | null): void {
    this.view = v;
    this.el.classList.toggle('show', !!v);
    if (!v) return;
    const m = getModel(v.modelId);
    this.title.textContent = `${m.brand} ${m.name}`;
    this.where.textContent = `${findShowroom(v.showroomId)?.name ?? 'Showroom'} · inince araç galeriye döner`;
  }

  update(now: number): void {
    const v = this.view;
    if (!v) return;
    const left = Math.max(0, (v.endsAt - now) / 1000);
    this.clock.textContent = mmss(left);
    this.el.classList.toggle('ending', left <= 15);
  }
}
