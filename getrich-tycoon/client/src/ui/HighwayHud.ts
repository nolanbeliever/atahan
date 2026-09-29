// Highway and drag strip HUD: near-miss popups with the combo meter, and the drag race
// Christmas tree with the result card.

import type { DragRaceView, DragResult } from '../../../shared/drag';
import { ECONOMY } from '../../../shared/economy.config';
import type { NearMissEvent } from '../../../shared/protocol';
import { formatMoney } from '../../../shared/util';
import { modelDisplayName } from '../../../shared/vehicles';
import { clear, h } from './dom';

export class NearMissHud {
  readonly el: HTMLElement;
  private pop: HTMLElement;
  private combo: HTMLElement;
  private comboMult: HTMLElement;
  private comboCount: HTMLElement;
  private comboMoney: HTMLElement;
  private comboFill: HTMLElement;
  private lastAt = 0;
  private active = false;
  private popTimer: number | null = null;

  constructor() {
    this.pop = h('div', { class: 'nm-pop', 'data-testid': 'nearmiss-pop' });
    this.comboMult = h('div', { class: 'nm-mult' }, 'x1');
    this.comboCount = h('div', { class: 'nm-count' });
    this.comboMoney = h('div', { class: 'nm-money', 'data-testid': 'combo-money' });
    this.comboFill = h('div');
    this.combo = h(
      'div',
      { class: 'nm-combo', 'data-testid': 'combo' },
      h('div', { class: 'nm-head' }, h('span', null, 'COMBO'), this.comboMult),
      this.comboCount,
      this.comboMoney,
      h('div', { class: 'nm-bar' }, this.comboFill),
    );
    this.el = h('div', { class: 'nm-layer passthrough' }, this.pop, this.combo);
  }

  nearMiss(e: NearMissEvent): void {
    this.lastAt = performance.now();
    this.active = true;
    clear(this.pop);
    this.pop.append(
      h('div', { class: 'nm-title' }, 'NEAR MISS', h('span', null, ' · MAKAS')),
      h('div', { class: 'nm-amount' }, e.capped && e.amount === 0 ? `+${e.xp} XP` : `+${formatMoney(e.amount)}`),
      h('div', { class: 'nm-sub' }, `${e.mult > 1 ? `x${e.mult} COMBO · ` : ''}${e.gap.toFixed(2)} m · ${e.kind.toUpperCase()}${e.capped ? ' · hourly cash limit' : ''}`),
    );
    this.pop.className = `nm-pop show m${e.mult}`;
    if (this.popTimer) clearTimeout(this.popTimer);
    this.popTimer = window.setTimeout(() => this.pop.classList.remove('show'), 1800);
    this.comboMult.textContent = `x${e.mult}`;
    this.comboMult.className = `nm-mult m${e.mult}`;
    this.comboCount.textContent = `${e.combo} near miss${e.combo === 1 ? '' : 'es'}`;
    this.comboMoney.textContent = `${formatMoney(e.comboMoney)} · ${e.comboXp} XP`;
    this.combo.classList.add('show');
  }

  ended(reason: 'crash' | 'expired', count: number, earned: number): void {
    this.active = false;
    this.combo.classList.remove('show');
    if (count === 0) return;
    clear(this.pop);
    if (reason === 'crash') {
      this.pop.append(h('div', { class: 'nm-title crash' }, 'CRASH!'), h('div', { class: 'nm-sub' }, `Combo reset (${count} near misses)`));
      this.pop.className = 'nm-pop show crash';
    } else {
      this.pop.append(h('div', { class: 'nm-title' }, 'COMBO COMPLETE'), h('div', { class: 'nm-amount' }, `+${formatMoney(earned)}`), h('div', { class: 'nm-sub' }, `${count} near misses`));
      this.pop.className = 'nm-pop show done';
    }
    if (this.popTimer) clearTimeout(this.popTimer);
    this.popTimer = window.setTimeout(() => this.pop.classList.remove('show'), 1800);
  }

  update(): void {
    if (!this.active) return;
    const left = 1 - (performance.now() - this.lastAt) / (ECONOMY.highway.comboWindowSec * 1000);
    this.comboFill.style.width = `${Math.max(0, Math.min(1, left)) * 100}%`;
  }
}

const OUTCOME: Record<DragResult['outcome'], string> = {
  finished: 'FINISHED',
  false_start: 'FALSE START',
  dnf: 'DID NOT FINISH',
  dq: 'DISQUALIFIED',
};

export class DragHud {
  readonly el: HTMLElement;
  private tree: HTMLElement;
  private lamps: HTMLElement[][] = [];
  private status: HTMLElement;
  private timer: HTMLElement;
  private card: HTMLElement;
  private race: DragRaceView | null = null;
  private me: string | null = null;
  private shownResult = '';

  constructor() {
    const col = (lane: number) => {
      const row: HTMLElement[] = [];
      const c = h('div', { class: 'dt-col' });
      for (const cls of ['red', 'red', 'red', 'green', 'foul']) {
        const l = h('div', { class: `dt-lamp ${cls}`, 'data-testid': `tree-${lane}-${row.length}` });
        row.push(l);
        c.append(l);
      }
      this.lamps.push(row);
      return c;
    };
    this.status = h('div', { class: 'dt-status', 'data-testid': 'drag-status' });
    this.timer = h('div', { class: 'dt-timer' });
    this.tree = h('div', { class: 'dt-tree', 'data-testid': 'drag-tree' }, h('div', { class: 'dt-lamps' }, col(0), col(1)), this.status, this.timer);
    this.card = h('div', { class: 'dt-card', 'data-testid': 'drag-result' });
    this.el = h('div', { class: 'dt-layer passthrough' }, this.tree, this.card);
  }

  set(race: DragRaceView | null, me: string | null): void {
    this.race = race;
    this.me = me;
    const mine = !!race && race.racers.some((r) => r.playerId === me);
    this.tree.classList.toggle('show', mine && race!.phase !== 'finished');
    if (!race || !mine) {
      this.card.classList.remove('show');
      this.shownResult = '';
      return;
    }
    const foul = [0, 1].map((lane) => race.racers.find((r) => r.lane === lane)?.result?.outcome === 'false_start');
    for (let lane = 0; lane < 2; lane++) {
      const row = this.lamps[lane]!;
      for (let i = 0; i < 3; i++) row[i]!.classList.toggle('on', race.lights >= i + 1 && race.lights < 4);
      row[3]!.classList.toggle('on', race.lights === 4 && !foul[lane]);
      row[4]!.classList.toggle('on', !!foul[lane]);
    }
    const my = race.racers.find((r) => r.playerId === me);
    this.status.textContent =
      my?.result?.outcome === 'false_start' ? 'FALSE START!' : race.phase === 'staging' ? 'STAGING…' : race.phase === 'countdown' ? 'READY…' : race.phase === 'racing' ? 'GO!' : '';
    this.status.className = `dt-status ${my?.result?.outcome === 'false_start' ? 'bad' : race.phase === 'racing' ? 'go' : ''}`;
    if (race.phase === 'finished' && this.shownResult !== race.id) {
      this.shownResult = race.id;
      this.showResult(race);
    }
  }

  private showResult(race: DragRaceView): void {
    const my = race.racers.find((r) => r.playerId === this.me);
    const won = !!my && race.winner === my.lane;
    const tie = race.winner === null && race.racers.every((r) => r.result?.outcome === 'finished');
    clear(this.card);
    const fmt = (n: number | null, unit = 's') => (n === null ? '-' : `${n.toFixed(3)} ${unit}`);
    this.card.append(
      h('div', { class: `dt-head ${won ? 'win' : tie ? '' : 'lose'}` }, won ? `YOU WIN! +${formatMoney(race.pool)}` : tie ? 'DEAD HEAT - entry refunded' : my?.result?.outcome === 'false_start' ? 'FALSE START - you lose' : 'YOU LOSE'),
      h(
        'table',
        { class: 'dt-table' },
        h('tr', null, h('th', null, ''), h('th', null, 'Reaction'), h('th', null, '1/8 mile ET'), h('th', null, 'Trap'), h('th', null, '0-100 (spec)')),
        ...race.racers.map((r) =>
          h(
            'tr',
            { class: race.winner === r.lane ? 'winner' : '' },
            h('td', null, h('b', null, r.name), h('div', { class: 'muted' }, modelDisplayName(r.modelId)), r.result && r.result.outcome !== 'finished' ? h('div', { class: 'bad' }, OUTCOME[r.result.outcome]) : null),
            h('td', null, fmt(r.result?.reaction ?? null)),
            h('td', null, fmt(r.result?.et ?? null)),
            h('td', null, r.result?.trapKmh ? `${r.result.trapKmh} km/h` : '-'),
            h('td', null, `${r.zeroTo100.toFixed(1)} s · ${Math.round(r.topSpeedKmh)} km/h`),
          ),
        ),
      ),
    );
    this.card.classList.add('show');
    window.setTimeout(() => this.card.classList.remove('show'), 7000);
  }

  update(serverNow: number): void {
    const r = this.race;
    if (!r || !this.tree.classList.contains('show')) return;
    this.timer.textContent = r.greenAt ? `${Math.max(0, (serverNow - r.greenAt) / 1000).toFixed(2)} s` : '';
  }
}
