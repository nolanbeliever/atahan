// Drag strip panel: pay the $250 entry and race a bot now, or wait for another player; the winner
// takes the $500 pool. Shows your car's 0-100 / top speed from its tuning.

import type { DragInfo } from '../../../../shared/drag';
import { DRAG_STRIP } from '../../../../shared/highway';
import { calculateVehicleStats } from '../../../../shared/tuningSystem';
import { formatMoney } from '../../../../shared/util';
import { getModel, modelDisplayName } from '../../../../shared/vehicles';
import { h, type Child } from '../dom';
import { ICONS } from '../icons';
import { Panel } from '../Panel';

export class DragPanel extends Panel {
  readonly name = 'drag';
  override size = 'medium' as const;
  private info: DragInfo | null = null;
  private timer: number | null = null;

  title() {
    return 'GetRich Dragway';
  }
  override subtitle() {
    const e = this.info?.entry ?? 250;
    return `${DRAG_STRIP.lengthLabel} · ${formatMoney(e)} entry · winner takes ${formatMoney(this.info?.prize ?? 500)}`;
  }
  iconSvg() {
    return ICONS.trophy;
  }

  override init(): void {
    const load = () =>
      this.net
        .rpc('drag.info', {})
        .then((i) => {
          this.info = i;
          this.refresh();
        })
        .catch(() => undefined);
    void load();
    this.timer = window.setInterval(load, 1000);
    this.listen(() => {
      if (this.timer) clearInterval(this.timer);
    });
    this.listen(this.store.on('self', () => this.refresh()));
  }

  renderBody(): Child {
    const me = this.store.playerId;
    const driving = this.game.driving ? this.store.myVehicle(this.game.driving) : undefined;
    const here = this.game.nearKind('drag', 2);
    const info = this.info;
    const race = info?.race ?? null;
    const queued = !!info?.queue.some((q) => q.playerId === me);
    const others = info?.queue.filter((q) => q.playerId !== me) ?? [];
    const money = this.store.me?.money ?? 0;
    const entry = info?.entry ?? 250;
    const car = driving
      ? (() => {
          const m = getModel(driving.modelId);
          const s = calculateVehicleStats(m, driving.mods.tuning);
          return h(
            'div',
            { class: 'drag-car', 'data-testid': 'drag-car' },
            h('div', { class: 'drag-car-name' }, modelDisplayName(driving.modelId)),
            h(
              'div',
              { class: 'drag-stats' },
              h('div', null, h('b', { 'data-testid': 'drag-0100' }, `${s.accel.toFixed(1)} s`), h('small', null, '0-100 km/h')),
              h('div', null, h('b', null, `${Math.round(s.topSpeed)} km/h`), h('small', null, 'Top speed')),
              h('div', null, h('b', null, `${Math.round(s.hp)} hp`), h('small', null, 'Power')),
            ),
            h('div', { class: 'tiny muted' }, 'Figures come from your tuning. Upgrade at Chroma Customs to go quicker.'),
          );
        })()
      : null;
    const rules = h(
      'ul',
      { class: 'drag-rules' },
      h('li', null, 'Line up in the staging lane at the south end of the strip.'),
      h('li', null, 'Three red lights, then GREEN after a random pause. Hold the brake!'),
      h('li', null, 'Moving before green is a FALSE START - you lose your entry.'),
      h('li', null, `Stay in your lane. First across the ${DRAG_STRIP.lengthLabel} line wins ${formatMoney(info?.prize ?? 500)}.`),
    );
    if (!driving || !here) {
      return [
        h('div', { class: 'pill gold', style: { marginBottom: '10px' }, 'data-testid': 'drag-need-car' }, 'Drive your own car into the staging lane (south end of the drag strip, west of the city).'),
        rules,
      ];
    }
    const busy = !!race && race.phase !== 'finished';
    const canPay = money >= entry;
    return [
      car,
      busy
        ? h('div', { class: 'pill', style: { margin: '10px 0' } }, `Race in progress: ${race!.racers.map((r) => r.name).join(' vs ')}`)
        : null,
      h(
        'div',
        { class: 'drag-actions' },
        h(
          'button',
          {
            class: 'btn primary',
            'data-testid': 'drag-bot',
            disabled: this.busy || busy || !canPay,
            onclick: () =>
              void this.act(
                () => this.net.rpc('drag.join', { mode: 'bot' }),
                () => this.ui.closeAll(),
              ),
          },
          `Race a bot · ${formatMoney(entry)}`,
        ),
        queued
          ? h('button', { class: 'btn', 'data-testid': 'drag-leave', disabled: this.busy, onclick: () => void this.act(() => this.net.rpc('drag.leave', {}), (i) => (this.info = i)) }, 'Stop waiting')
          : h(
              'button',
              {
                class: 'btn',
                'data-testid': 'drag-player',
                disabled: this.busy || busy || !canPay,
                onclick: () =>
                  void this.act(
                    () => this.net.rpc('drag.join', { mode: 'player' }),
                    (i) => {
                      this.info = i;
                      if (i.race?.racers.some((r) => r.playerId === me)) this.ui.closeAll();
                    },
                  ),
              },
              others.length > 0 ? `Race ${others[0]!.name} · ${formatMoney(entry)}` : `Wait for a player · ${formatMoney(entry)}`,
            ),
      ),
      !canPay ? h('div', { class: 'tiny', style: { color: '#ff5c7a' } }, `You need ${formatMoney(entry)} in cash.`) : null,
      queued ? h('div', { class: 'pill', style: { marginTop: '8px' } }, 'Waiting for another player to accept… (you can still race a bot)') : null,
      others.length > 0 ? h('div', { class: 'tiny muted', style: { marginTop: '6px' } }, `Waiting: ${others.map((q) => `${q.name} (${modelDisplayName(q.modelId)})`).join(', ')}`) : null,
      rules,
    ];
  }
}
