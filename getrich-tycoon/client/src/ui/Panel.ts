// Base class for modal panels.

import type { Game } from '../game/Game';
import { append, clear, h, icon, type Child } from './dom';
import type { UI } from './UI';

export type PanelArg = Record<string, unknown>;

export abstract class Panel {
  abstract readonly name: string;
  size: 'xl' | 'wide' | 'medium' | 'narrow' = 'wide';
  /** A click on the dimmed backdrop closes the panel. */
  closeOnBackdrop = true;
  protected bodyEl!: HTMLElement;
  protected footEl!: HTMLElement;
  protected subEl!: HTMLElement;
  private subs: (() => void)[] = [];
  private dirty = false;
  protected busy = false;
  private disposed = false;

  constructor(
    protected readonly ui: UI,
    protected readonly arg: PanelArg,
  ) {}

  get game(): Game {
    return this.ui.game;
  }
  get store() {
    return this.ui.game.store;
  }
  get net() {
    return this.ui.game.net;
  }

  abstract title(): string;
  subtitle(): string {
    return '';
  }
  abstract iconSvg(): string;
  abstract renderBody(): Child;
  renderFoot(): Child {
    return null;
  }
  /** Subscribe to events, fetch data... */
  init(): void {}

  mount(): HTMLElement {
    this.bodyEl = h('div', { class: 'modal-body' });
    this.footEl = h('div', { class: 'modal-foot' });
    this.subEl = h('div', { class: 'modal-sub' });
    this.bodyEl.addEventListener('focusout', () => {
      if (this.dirty) setTimeout(() => this.refresh(), 0);
    });
    const modal = h(
      'div',
      { class: `modal ${this.size === 'wide' ? '' : this.size}` },
      h(
        'div',
        { class: 'modal-head' },
        h('div', { class: 'modal-icon' }, icon(this.iconSvg())),
        h('div', null, h('div', { class: 'modal-title' }, this.title()), this.subEl),
        h('button', { class: 'modal-close', title: 'Close (Esc)', 'data-testid': 'panel-close', onclick: () => this.ui.closeAll() }, '✕'),
      ),
      this.bodyEl,
      this.footEl,
    );
    this.init();
    this.refresh();
    return modal;
  }

  refresh(): void {
    if (this.disposed) return;
    const active = document.activeElement;
    if (active && this.bodyEl.contains(active) && (active.tagName === 'INPUT' || active.tagName === 'SELECT')) {
      this.dirty = true;
      return;
    }
    this.dirty = false;
    const scroll = this.bodyEl.scrollTop;
    this.subEl.textContent = this.subtitle();
    clear(this.bodyEl);
    append(this.bodyEl, [this.renderBody()]);
    clear(this.footEl);
    const foot = this.renderFoot();
    append(this.footEl, [foot]);
    this.footEl.style.display = foot ? '' : 'none';
    this.bodyEl.scrollTop = scroll;
  }

  onStoreChange(): void {
    this.refresh();
  }

  protected listen(unsub: () => void): void {
    this.subs.push(unsub);
  }

  /** Run an action with busy state + error toast. */
  protected async act<T>(fn: () => Promise<T>, onOk?: (r: T) => void): Promise<T | undefined> {
    if (this.busy) return undefined;
    this.busy = true;
    this.refresh();
    try {
      const r = await fn();
      onOk?.(r);
      return r;
    } catch (err) {
      this.ui.error(err);
      return undefined;
    } finally {
      this.busy = false;
      this.refresh();
    }
  }

  dispose(): void {
    this.disposed = true;
    for (const u of this.subs) u();
    this.subs = [];
  }
}
