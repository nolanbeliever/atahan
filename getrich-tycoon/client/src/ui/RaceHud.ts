// Street race HUD: the invitation while a race is open, 3-2-1-GO on the grid, checkpoint / position /
// time while racing, and the result.

import { RACE, raceRoute, type StreetRaceView } from '../../../shared/streetRace';
import { formatMoney } from '../../../shared/util';
import { h } from './dom';
import { mmss } from './RewardsHud';

export class RaceHud {
  readonly el: HTMLElement;
  readonly count: HTMLElement;
  private title: HTMLElement;
  private line: HTMLElement;
  private sub: HTMLElement;
  private lastCount = '';
  onCountdown: ((n: number) => void) | null = null;

  constructor() {
    this.title = h('div', { class: 'rh-title' });
    this.line = h('div', { class: 'rh-line mono', 'data-testid': 'race-line' });
    this.sub = h('div', { class: 'rh-sub' });
    this.el = h('div', { class: 'race-hud', 'data-testid': 'race-hud' }, h('div', { class: 'rh-flag' }, '🏁'), h('div', null, this.title, this.line, this.sub));
    this.count = h('div', { class: 'race-count', 'data-testid': 'race-count' });
  }

  /** Every frame. */
  update(v: StreetRaceView | null, now: number, me: { joined: boolean; next: number; place: number; of: number; dnf: boolean; finished: number | null }): void {
    this.el.classList.toggle('show', !!v);
    if (!v) {
      this.setCount('');
      return;
    }
    const route = raceRoute(v.routeId);
    const cps = (route?.points.length ?? 1) - 1;
    this.el.classList.toggle('joined', me.joined);
    if (v.phase === 'open') {
      const left = (v.startsAt - RACE.countdownSec * 1000 - now) / 1000;
      this.title.textContent = me.joined ? 'YARIŞA KATILDIN!' : `SOKAK YARIŞI · ${route?.name ?? ''}`;
      this.line.textContent = me.joined ? `Start in ${mmss(left + RACE.countdownSec)}` : `Join within ${mmss(left)}`;
      this.sub.textContent = me.joined ? 'Wait at the start line. The police come soon after the green light.' : `Drive to the flag on the map, press G. 1st place: ${formatMoney(v.prize)} · wanted 2★ in the race`;
      this.setCount('');
      return;
    }
    if (v.phase === 'countdown') {
      this.title.textContent = me.joined ? 'GET READY' : 'STREET RACE STARTING';
      this.line.textContent = route?.name ?? '';
      this.sub.textContent = `${v.racers.length} cars on the grid`;
      const n = Math.ceil((v.startsAt - now) / 1000);
      if (me.joined) this.setCount(n > 0 ? String(n) : 'GO!');
      return;
    }
    if (v.phase === 'racing') {
      const t = Math.max(0, now - v.startsAt);
      if (me.joined && t < 1200) this.setCount('GO!');
      else this.setCount('');
      if (!me.joined) {
        this.title.textContent = 'STREET RACE ON';
        this.line.textContent = `${route?.name ?? ''} · ${mmss(t / 1000)}`;
        this.sub.textContent = 'Join the next one: they start every few minutes.';
        return;
      }
      this.title.textContent = me.dnf ? 'OUT OF THE RACE' : me.finished !== null ? `FINISHED ${me.place}.` : `POSITION ${me.place} / ${me.of}`;
      this.line.textContent = me.finished !== null ? `${(me.finished / 1000).toFixed(1)} s` : `CP ${Math.min(me.next, cps)} / ${cps} · ${mmss(t / 1000)}`;
      this.sub.textContent = me.dnf ? 'You left the car or got arrested.' : me.finished !== null ? 'Now lose the police!' : 'Drive through the yellow rings in order. Green = finish.';
      return;
    }
    // Results.
    this.setCount('');
    const winner = v.racers.find((r) => r.place === 1);
    this.title.textContent = 'RACE OVER';
    this.line.textContent = winner ? `Winner: ${winner.name}` : 'Nobody finished';
    this.sub.textContent = v.racers
      .filter((r) => r.place !== null)
      .sort((a, b) => a.place! - b.place!)
      .slice(0, 4)
      .map((r) => `${r.place}. ${r.name} ${(r.timeMs! / 1000).toFixed(1)}s`)
      .join(' · ');
  }

  private setCount(text: string): void {
    if (text === this.lastCount) return;
    this.lastCount = text;
    this.count.textContent = text;
    this.count.classList.toggle('show', !!text);
    this.count.classList.toggle('go', text === 'GO!');
    if (text) {
      this.count.classList.remove('pop');
      void this.count.offsetWidth;
      this.count.classList.add('pop');
      this.onCountdown?.(text === 'GO!' ? 0 : Number(text));
    }
  }
}
