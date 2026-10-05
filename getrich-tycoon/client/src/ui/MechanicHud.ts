// The mechanic's card while on a shift at the Sanayi (shared/mechanic.ts): whose car is up, the jobs
// still to do with a tick on the ones done, the bar of the job in hand, and the shift's takings.

import { MECH, REPAIR_TASKS, TASK_LABEL, type MechanicView } from '../../../shared/mechanic';
import { formatMoney } from '../../../shared/util';
import { modelDisplayName } from '../../../shared/vehicles';
import { clear, h } from './dom';
import { mmss } from './RewardsHud';

export class MechanicHud {
  readonly el: HTMLElement;
  private kicker: HTMLElement;
  private title: HTMLElement;
  private jobs: HTMLElement;
  private bar: HTMLElement;
  private barWrap: HTMLElement;
  private text: HTMLElement;
  private view: MechanicView | null = null;
  private asked: { id: string; tasks: Set<string> } | null = null;

  constructor() {
    this.kicker = h('div', { class: 'hs-kicker' });
    this.title = h('div', { class: 'hs-title', 'data-testid': 'mech-title' });
    this.jobs = h('div', { class: 'mech-jobs' });
    this.bar = h('div');
    this.barWrap = h('div', { class: 'hs-bar' }, this.bar);
    this.text = h('div', { class: 'hs-text', 'data-testid': 'mech-text' });
    this.el = h('div', { class: 'heist-hud mech-hud', 'data-testid': 'mech-hud' }, h('div', { class: 'hs-icon' }, '🔧'), h('div', { class: 'hs-body' }, this.kicker, this.title, this.jobs, this.barWrap, this.text));
  }

  get current(): MechanicView | null {
    return this.view;
  }

  set(v: MechanicView | null): void {
    this.view = v?.onDuty ? v : null;
    this.el.classList.toggle('show', !!this.view);
    if (!this.view) return;
    const s = this.view;
    this.kicker.textContent = `TAMİRCİ MESAİSİ · ${s.cars} ARAÇ · ${formatMoney(s.earned)}`;
    clear(this.jobs);
    if (s.car) {
      const car = s.car;
      this.title.textContent = `${car.owner} · ${modelDisplayName(car.modelId)}`;
      // The jobs asked of this car (the done ones stay on the list, ticked).
      if (this.asked?.id !== car.id) this.asked = { id: car.id, tasks: new Set() };
      for (const t of car.todo) this.asked.tasks.add(t);
      const asked = REPAIR_TASKS.filter((t) => this.asked!.tasks.has(t));
      for (const t of asked) {
        const done = !car.todo.includes(t);
        this.jobs.append(h('div', { class: `mech-job ${done ? 'done' : ''} ${s.working?.task === t ? 'on' : ''}` }, `${done ? '✅' : '⬜'} ${TASK_LABEL[t]}`));
      }
      this.text.textContent = car.todo.length === 0 ? `Tamir tamam: müşteri ${formatMoney(MECH.pay)} ödedi.` : s.working ? `${TASK_LABEL[s.working.task]}… başından ayrılma.` : 'Aracın etrafındaki işaretlere git, E ile işe başla.';
    } else {
      this.title.textContent = 'Müşteri bekleniyor';
      this.text.textContent = 'Sıradaki araç birazdan lifte çıkacak. Mesaiyi bitirmek için iş panosuna dön ya da Sanayi\'den ayrıl.';
    }
    this.barWrap.style.display = s.working ? '' : 'none';
  }

  /** Per frame: the job's bar and the next customer's clock. */
  update(now: number): void {
    const s = this.view;
    if (!s) return;
    if (s.working) this.bar.style.width = `${Math.round(Math.min(1, 1 - (s.working.until - now) / (s.working.sec * 1000)) * 100)}%`;
    if (!s.car && s.nextAt) this.title.textContent = `Müşteri geliyor · ${mmss(Math.max(0, (s.nextAt - now) / 1000))}`;
  }
}
