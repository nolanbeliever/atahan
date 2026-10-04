// Illegal street races (see shared/streetRace.ts): open -> countdown on the grid -> racing ->
// results, then the next one a few minutes later on another route.
//
// Players join near the start line while driving any car. At the countdown they are lined up on the
// grid and held; bots fill the field. Soon after the green light every racer is wanted (2 stars). Players
// pass a checkpoint by driving within its radius, in order; bots follow the route at their own pace
// (ghost cars: they don't collide). The first over the line wins the prize if they are a player.
// Leaving the car, or being arrested, is a DNF.

import { ECONOMY } from '../../../shared/economy.config';
import { RACE_ROUTES, gridSlot, raceRoute, routeDistanceTo, routeLegs, routePose, type RaceBotSnap, type RaceRoute, type RacerView, type StreetRaceView } from '../../../shared/streetRace';
import { CATALOG_MODELS } from '../../../shared/vehicles';
import { formatMoney } from '../../../shared/util';
import { GameError } from '../../errors';
import { createLogger } from '../../logger';
import { K, type Ctx } from '../context';
import { randomPersonName } from '../generator';
import type { PoliceService } from './police';

const log = createLogger('streetRace');
const R = ECONOMY.streetRace;

interface Bot {
  s: number;
  speed: number;
  cruise: number;
}

interface Racer {
  view: RacerView;
  vehicleId: string | null;
  bot: Bot | null;
}

interface Race {
  view: StreetRaceView;
  route: RaceRoute;
  legs: number[];
  total: number;
  racers: Racer[];
  heldUntil: number;
  /** The police have been told. */
  alerted: boolean;
}

let raceSeq = 1;

export class StreetRaceService {
  private race: Race | null = null;
  private nextAt = Date.now() + R.firstSec * 1000;
  private routeIndex = 0;
  private sentAt = 0;

  constructor(
    private readonly ctx: Ctx,
    private readonly police: PoliceService,
  ) {}

  view(): StreetRaceView | null {
    return this.race?.view ?? null;
  }

  /** Open a race now (tests, and the schedule). */
  open(now = Date.now(), routeId?: string): StreetRaceView {
    const route = (routeId && raceRoute(routeId)) || RACE_ROUTES[this.routeIndex++ % RACE_ROUTES.length]!;
    const { legs, total } = routeLegs(route);
    const startsAt = now + (R.joinSec + R.countdownSec) * 1000;
    this.race = {
      route,
      legs,
      total,
      racers: [],
      heldUntil: 0,
      alerted: false,
      view: { id: `race${raceSeq++}`, routeId: route.id, phase: 'open', startsAt, endsAt: startsAt + R.timeLimitSec * 1000, prize: R.prize, racers: [] },
    };
    this.ctx.hub.systemChat(`Street race on the ${route.name}! Get to the flag on the map within ${R.joinSec} s: the winner takes ${formatMoney(R.prize)}. The police are listening...`);
    this.publish();
    return this.race.view;
  }

  /** Join the open race: driving a car, close to the start line. */
  async join(playerId: string): Promise<StreetRaceView> {
    return this.ctx.locks.run([K.player(playerId)], async () => {
      const race = this.race;
      if (!race || race.view.phase !== 'open') throw new GameError('conflict', 'No street race is open right now.');
      if (race.racers.some((r) => r.view.id === playerId)) throw new GameError('conflict', 'You are already in this race.');
      const c = this.ctx.sim.chars.get(playerId);
      const d = c?.drivingId ? this.ctx.sim.drives.get(c.drivingId) : undefined;
      if (!c || !d) throw new GameError('conflict', 'Drive a car to the start line to race.');
      const start = race.route.points[0]!;
      if (Math.hypot(d.dyn.x - start.x, d.dyn.z - start.z) > R.joinRadius) throw new GameError('too_far', 'Drive to the start line (the flag on the map).');
      if (race.racers.filter((r) => !r.bot).length >= R.maxPlayers) throw new GameError('conflict', 'The grid is full.');
      const v = this.ctx.state.vehicles.get(d.vehicleId)!;
      if (v.status === 'testdrive') throw new GameError('forbidden', 'Not in a test-drive car: race your own.');
      race.racers.push({ vehicleId: d.vehicleId, bot: null, view: { id: playerId, name: this.ctx.state.players.get(playerId)?.name ?? 'Racer', bot: false, modelId: v.modelId, next: 1, place: null, timeMs: null, dnf: false } });
      this.publish();
      return race.view;
    });
  }

  leave(playerId: string): void {
    const race = this.race;
    if (!race) return;
    const r = race.racers.find((x) => x.view.id === playerId);
    if (!r) return;
    if (race.view.phase === 'open') race.racers.splice(race.racers.indexOf(r), 1);
    else if (r.view.place === null) this.dnf(race, r);
    const d = r.vehicleId ? this.ctx.sim.drives.get(r.vehicleId) : undefined;
    if (d && race.view.phase === 'countdown') d.hold = false;
    this.publish();
  }

  forget(playerId: string): void {
    this.leave(playerId);
  }

  tick(dt: number, now = Date.now()): void {
    const race = this.race;
    if (!race) {
      if (now >= this.nextAt) this.open(now);
      return;
    }
    const v = race.view;
    if (v.phase === 'open' && now >= v.startsAt - R.countdownSec * 1000) {
      if (!race.racers.some((r) => !r.bot)) {
        this.ctx.hub.systemChat('Nobody showed up for the street race. Next time!');
        return this.finish(now, false);
      }
      this.grid(race);
      v.phase = 'countdown';
      this.publish();
    }
    if (v.phase === 'countdown') {
      this.holdGrid(race);
      if (now >= v.startsAt) {
        v.phase = 'racing';
        for (const r of race.racers) {
          const d = r.vehicleId ? this.ctx.sim.drives.get(r.vehicleId) : undefined;
          if (d) d.hold = false;
        }
        this.publish();
      }
      return;
    }
    if (v.phase === 'racing') {
      // A few seconds after the green light the police hear about it: every racer still out there is wanted.
      if (!race.alerted && now >= v.startsAt + R.policeDelaySec * 1000) {
        race.alerted = true;
        for (const r of race.racers) if (!r.bot && r.view.place === null && !r.view.dnf) this.police.raiseHeat(r.view.id, R.heat);
      }
      let changed = false;
      for (const r of race.racers) {
        if (r.view.place !== null || r.view.dnf) continue;
        if (r.bot) {
          changed = this.moveBot(race, r, dt, now) || changed;
          continue;
        }
        const c = this.ctx.sim.chars.get(r.view.id);
        const d = r.vehicleId ? this.ctx.sim.drives.get(r.vehicleId) : undefined;
        // Out of the car (or arrested, or gone): out of the race.
        if (!c || !d || c.drivingId !== r.vehicleId || this.police.wantedOf(r.view.id)?.busted) {
          this.dnf(race, r);
          changed = true;
          continue;
        }
        const cp = race.route.points[r.view.next]!;
        if (Math.hypot(d.dyn.x - cp.x, d.dyn.z - cp.z) <= R.checkpointRadius) {
          r.view.next++;
          changed = true;
          if (r.view.next >= race.route.points.length) this.finished(race, r, now);
          else this.ctx.hub.sendTo(r.view.id, 'race.checkpoint', { next: r.view.next, of: race.route.points.length - 1 });
        }
      }
      const open = race.racers.filter((r) => r.view.place === null && !r.view.dnf);
      if (!open.some((r) => !r.bot) || now >= v.endsAt) {
        for (const r of open) this.dnf(race, r);
        v.phase = 'results';
        v.endsAt = now + R.resultsSec * 1000;
        this.publish();
        return;
      }
      if (changed || now - this.sentAt > 2000) this.publish();
      return;
    }
    if (v.phase === 'results' && now >= v.endsAt) this.finish(now, true);
  }

  /** Bot positions for snapshots (players near the route get them). */
  botSnapshot(): { id: string; cars: RaceBotSnap[] } | null {
    const race = this.race;
    if (!race || race.view.phase === 'open') return null;
    const cars: RaceBotSnap[] = [];
    race.racers.forEach((r, i) => {
      if (!r.bot || r.view.dnf) return;
      const pose = routePose(race.route, Math.min(r.bot.s, race.total));
      cars.push([i, Math.round(pose.x * 100) / 100, Math.round(pose.z * 100) / 100, Math.round(pose.rot * 1000) / 1000, Math.round(r.bot.speed * 100) / 100]);
    });
    return { id: race.view.id, cars };
  }

  /** Distance along the route a racer has covered (for the standings). */
  progress(id: string): number {
    const race = this.race;
    const r = race?.racers.find((x) => x.view.id === id);
    if (!race || !r) return 0;
    if (r.bot) return r.bot.s;
    const d = r.vehicleId ? this.ctx.sim.drives.get(r.vehicleId) : undefined;
    const next = race.route.points[Math.min(r.view.next, race.route.points.length - 1)]!;
    const to = d ? Math.hypot(d.dyn.x - next.x, d.dyn.z - next.z) : race.legs[r.view.next - 1] ?? 0;
    return routeDistanceTo(race.route, r.view.next) - Math.min(to, race.legs[r.view.next - 1] ?? 0);
  }

  // ---------------------------------------------------------------- internals

  /** Line everyone up behind the start line and fill the field with bots. */
  private grid(race: Race): void {
    const players = race.racers.filter((r) => !r.bot);
    const bots = Math.max(2, R.fieldSize - players.length);
    const pool = CATALOG_MODELS.filter((m) => m.specs.kind !== 'bike' && m.category !== 'truck');
    for (let i = 0; i < bots; i++) {
      const model = pool[Math.floor(this.ctx.rng() * pool.length)]!;
      const cruise = R.botCruise[i % R.botCruise.length]! * (0.96 + this.ctx.rng() * 0.08);
      race.racers.push({
        vehicleId: null,
        bot: { s: 0, speed: 0, cruise },
        view: { id: `bot${i + 1}`, name: `${randomPersonName(this.ctx.rng).split(' ')[0]} (Street)`, bot: true, modelId: model.id, color: model.colors[Math.floor(this.ctx.rng() * model.colors.length)], next: 1, place: null, timeMs: null, dnf: false },
      });
    }
    // Players at the front of the grid, bots behind.
    race.racers.forEach((r, i) => {
      const slot = gridSlot(race.route, i);
      if (r.bot) {
        r.bot.s = -(4 + Math.floor(i / 2) * 7.5);
        return;
      }
      if (!r.vehicleId) return;
      const d = this.ctx.sim.drives.get(r.vehicleId);
      if (!d) return;
      this.ctx.sim.placeDrive(r.vehicleId, slot.x, slot.z, slot.rot);
      d.hold = true;
    });
  }

  private holdGrid(race: Race): void {
    for (const r of race.racers) {
      const d = r.vehicleId ? this.ctx.sim.drives.get(r.vehicleId) : undefined;
      if (d) {
        d.hold = true;
        d.dyn.speed = 0;
      }
    }
  }

  /** A bot drives on: up to its cruising speed, slower into the corners. */
  private moveBot(race: Race, r: Racer, dt: number, now: number): boolean {
    const b = r.bot!;
    let corner = Infinity;
    let acc = 0;
    for (let i = 0; i < race.legs.length; i++) {
      acc += race.legs[i]!;
      if (acc > b.s) {
        corner = acc - b.s;
        break;
      }
    }
    const lastLeg = corner >= race.total - b.s - 1e-6;
    const target = !lastLeg && corner < 28 ? b.cruise * R.botCorner + (b.cruise * (1 - R.botCorner) * corner) / 28 : b.cruise;
    b.speed += Math.max(-14 * dt, Math.min(6.5 * dt, target - b.speed));
    b.s += Math.max(0, b.speed) * dt;
    // Checkpoints passed (for the standings).
    let next = 1;
    while (next < race.route.points.length && routeDistanceTo(race.route, next) <= b.s) next++;
    const changed = next !== r.view.next;
    r.view.next = next;
    if (b.s >= race.total) {
      this.finished(race, r, now);
      return true;
    }
    return changed;
  }

  private finished(race: Race, r: Racer, now: number): void {
    const place = race.racers.filter((x) => x.view.place !== null).length + 1;
    r.view.place = place;
    r.view.timeMs = now - race.view.startsAt;
    r.view.next = race.route.points.length;
    if (r.bot) return;
    void this.pay(r.view.id, place, r.view.timeMs).catch((err) => log.error('race payout failed', { error: (err as Error).message }));
  }

  private async pay(playerId: string, place: number, timeMs: number): Promise<void> {
    await this.ctx.locks.run([K.player(playerId)], async () => {
      const uow = this.ctx.state.begin();
      const p = uow.player(playerId);
      const win = place === 1;
      if (win) uow.credit(p, R.prize, 'race', 'Street race win');
      uow.grantXp(p, win ? R.xpWin : R.xpFinish);
      uow.notify(playerId, win ? { kind: 'money', title: 'SOKAK YARIŞINI KAZANDIN!', text: `1st in ${(timeMs / 1000).toFixed(1)} s: +${formatMoney(R.prize)}. Now lose the police!` } : { kind: 'info', title: `Street race: ${place}. place`, text: `Finished in ${(timeMs / 1000).toFixed(1)} s. Only the winner gets paid.` });
      await uow.commit();
      if (win) this.ctx.hub.systemChat(`${p.name} won the street race and ${formatMoney(R.prize)}!`);
    });
  }

  private dnf(race: Race, r: Racer): void {
    r.view.dnf = true;
    const d = r.vehicleId ? this.ctx.sim.drives.get(r.vehicleId) : undefined;
    if (d && race.view.phase !== 'racing') d.hold = false;
  }

  private finish(now: number, ran: boolean): void {
    const race = this.race;
    if (race) for (const r of race.racers) {
      const d = r.vehicleId ? this.ctx.sim.drives.get(r.vehicleId) : undefined;
      if (d) d.hold = false;
    }
    this.race = null;
    this.nextAt = now + R.intervalSec * 1000;
    this.ctx.hub.broadcast('race.update', null);
    if (ran) log.info('street race over', { route: race?.route.id });
  }

  private publish(): void {
    this.sentAt = Date.now();
    if (this.race) this.race.view.racers = this.race.racers.map((r) => r.view);
    this.ctx.hub.broadcast('race.update', this.race?.view ?? null);
  }
}
