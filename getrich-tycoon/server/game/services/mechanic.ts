// The part-time mechanic at the Sanayi (shared/mechanic.ts): a shift at the job board, customers'
// damaged cars up on a free lift one after another, the engine, the body and the tyres fixed at
// their spots round the car, $1,000 clean money for each car on the spot.

import { HALL_CENTRE, JOB_BOARD, MECH, REPAIR_TASKS, TASK_LABEL, taskPoint, type MechanicView, type RepairCar, type RepairTask } from '../../../shared/mechanic';
import { LIFT_BAYS } from '../../../shared/theft';
import { formatMoney } from '../../../shared/util';
import { CATALOG_MODELS, getModel, modelDisplayName } from '../../../shared/vehicles';
import { GameError } from '../../errors';
import { createLogger } from '../../logger';
import * as val from '../../validate';
import { K, type Ctx } from '../context';
import type { TheftService } from './theft';

const log = createLogger('mechanic');
const OWNERS = ['Hasan Usta', 'Ayşe Hanım', 'Taksici Cemil', 'Kurye Burak', 'Emekli Nuri Bey', 'Doktor Elif', 'Pazarcı Ramazan', 'Öğretmen Zeynep', 'Servisçi Kadir', 'Berber Selim'];
const COLORS = ['#b23a3a', '#2f5d8a', '#e6e6e0', '#3b3f45', '#7a6a4f', '#4a7a4a', '#c9a227'];
/** Everyday cars come in for repair. */
const MODELS = CATALOG_MODELS.filter((m) => m.specs.kind === 'car' && m.basePrice < 60_000).map((m) => m.id);

interface Shift {
  playerId: string;
  car: RepairCar | null;
  working: { task: RepairTask; until: number; sec: number } | null;
  cars: number;
  earned: number;
  nextAt: number | null;
  /** Sent last (to send changes only). */
  sent: string;
}

let seq = 1;

export class MechanicService {
  private shifts = new Map<string, Shift>();

  constructor(
    private readonly ctx: Ctx,
    theft: TheftService,
  ) {
    theft.bayBusy = (bay) => [...this.shifts.values()].some((s) => s.car?.bay === bay);
  }

  /** "Tamirci Olarak Çalış": at the job board, on foot. */
  start(playerId: string): MechanicView {
    const c = this.ctx.sim.chars.get(playerId);
    if (!c || c.dead) throw new GameError('conflict', 'Önce ayağa kalk.');
    if (c.drivingId || c.ridingId) throw new GameError('conflict', 'Araçtan in.');
    if (Math.hypot(c.x - JOB_BOARD.x, c.z - JOB_BOARD.z) > JOB_BOARD.radius + 1) throw new GameError('too_far', 'Sanayi salonundaki iş panosuna git.');
    let s = this.shifts.get(playerId);
    if (!s) {
      s = { playerId, car: null, working: null, cars: 0, earned: 0, nextAt: Date.now() + 2500, sent: '' };
      this.shifts.set(playerId, s);
      this.ctx.hub.notify(playerId, { kind: 'info', title: '🔧 Mesai başladı', text: `İlk müşteri geliyor. Her araç ${formatMoney(MECH.pay)}: motoru, kaportayı ve lastikleri onar.` });
    }
    return this.send(s, true);
  }

  /** End the shift (the car on the lift goes back to its owner). */
  stop(playerId: string): MechanicView {
    this.end(playerId, null);
    return this.view(null);
  }

  /** Do a job on the car on the lift (stand at its spot). */
  work(playerId: string, params: unknown): MechanicView {
    const task = val.oneOf(val.obj(params).task, 'task', REPAIR_TASKS);
    const s = this.shifts.get(playerId);
    if (!s?.car) throw new GameError('conflict', 'Liftte araç yok.');
    if (!s.car.todo.includes(task)) throw new GameError('conflict', 'O iş zaten yapıldı.');
    if (s.working) throw new GameError('conflict', 'Elindeki işi bitir.');
    if (!this.atSpot(s, task)) throw new GameError('too_far', `${TASK_LABEL[task]}: aracın doğru tarafına geç.`);
    const sec = MECH.taskSec[task];
    s.working = { task, until: Date.now() + sec * 1000, sec };
    this.ctx.sim.markInteract(playerId);
    return this.send(s, true);
  }

  private atSpot(s: Shift, task: RepairTask, slack = 0): boolean {
    const c = this.ctx.sim.chars.get(s.playerId);
    if (!c || !s.car || c.drivingId || c.ridingId) return false;
    const m = getModel(s.car.modelId);
    const p = taskPoint(s.car.bay, task, m.shape.length, m.shape.width);
    return Math.hypot(c.x - p.x, c.z - p.z) <= MECH.workRadius + slack;
  }

  /** A free lift: no stolen car being stripped on it and no other customer's car. */
  private freeBay(): number {
    const used = new Set<number>();
    for (const v of this.ctx.state.vehicles.values()) if (v.mods.strip) used.add(v.mods.strip.bay);
    for (const s of this.shifts.values()) if (s.car) used.add(s.car.bay);
    // The repair lifts at the ends of the hall first.
    for (const bay of [2, 3, 0, 1]) if (bay < LIFT_BAYS.length && !used.has(bay)) return bay;
    return -1;
  }

  tick(now = Date.now()): void {
    let carsChanged = false;
    for (const s of [...this.shifts.values()]) {
      const c = this.ctx.sim.chars.get(s.playerId);
      if (!c || !this.ctx.hub.isOnline(s.playerId)) {
        this.shifts.delete(s.playerId);
        carsChanged ||= !!s.car;
        continue;
      }
      if (Math.hypot(c.x - HALL_CENTRE.x, c.z - HALL_CENTRE.z) > MECH.shiftRadius) {
        this.end(s.playerId, 'Sanayi\'den ayrıldın: mesai bitti.');
        continue;
      }
      if (!s.car && s.nextAt !== null && now >= s.nextAt) {
        const bay = this.freeBay();
        if (bay < 0) s.nextAt = now + 3000;
        else {
          const rng = this.ctx.rng;
          // Two or three jobs: the engine and the body always want something; the tyres often.
          const todo: RepairTask[] = rng() < 0.6 ? ['engine', 'body', 'tyres'] : ['engine', 'body'];
          s.car = {
            id: `rc_${seq++}`,
            forId: s.playerId,
            bay,
            modelId: MODELS[Math.floor(rng() * MODELS.length)]!,
            color: COLORS[Math.floor(rng() * COLORS.length)]!,
            owner: OWNERS[Math.floor(rng() * OWNERS.length)]!,
            upAt: now,
            todo,
          };
          s.nextAt = null;
          carsChanged = true;
          this.ctx.hub.notify(s.playerId, { kind: 'info', title: `🔧 Yeni müşteri: ${s.car.owner}`, text: `${modelDisplayName(s.car.modelId)} ${s.car.bay + 1}. liftte. İşler: ${todo.map((t) => TASK_LABEL[t]).join(', ')}.` });
        }
      }
      if (s.working) {
        if (!this.atSpot(s, s.working.task, 0.8)) {
          this.ctx.hub.notify(s.playerId, { kind: 'warning', title: 'İş yarım kaldı', text: `${TASK_LABEL[s.working.task]}: başından ayrıldın.` });
          s.working = null;
        } else if (now >= s.working.until) {
          s.car!.todo = s.car!.todo.filter((t) => t !== s.working!.task);
          s.working = null;
          carsChanged = true;
          if (s.car!.todo.length === 0) void this.pay(s);
        }
      }
      this.send(s);
    }
    if (carsChanged) this.publish();
  }

  /** All jobs done: the customer pays on the spot, the car comes down and leaves. */
  private async pay(s: Shift): Promise<void> {
    const car = s.car!;
    try {
      await this.ctx.locks.run([K.player(s.playerId)], async () => {
        if (!this.ctx.state.players.has(s.playerId)) return;
        const uow = this.ctx.state.begin();
        const p = uow.player(s.playerId);
        uow.credit(p, MECH.pay, 'mechanic', `Tamir: ${car.owner}, ${modelDisplayName(car.modelId)}`);
        uow.grantXp(p, MECH.xp);
        await uow.commit();
      });
    } catch (err) {
      log.warn('mechanic pay failed', { playerId: s.playerId, err: String(err) });
      return;
    }
    s.cars++;
    s.earned += MECH.pay;
    this.ctx.hub.sendTo(s.playerId, 'mech.paid', { amount: MECH.pay, owner: car.owner, modelId: car.modelId });
    log.info('car repaired', { playerId: s.playerId, model: car.modelId });
    setTimeout(() => {
      if (s.car !== car) return;
      s.car = null;
      const [lo, hi] = MECH.nextCarSec;
      s.nextAt = Date.now() + (lo + this.ctx.rng() * (hi - lo)) * 1000;
      this.publish();
      this.send(s, true);
    }, 1800).unref?.();
  }

  private end(playerId: string, text: string | null): void {
    const s = this.shifts.get(playerId);
    if (!s) return;
    this.shifts.delete(playerId);
    if (s.car) this.publish();
    this.ctx.hub.sendTo(playerId, 'mech.update', this.view(null));
    if (text) this.ctx.hub.notify(playerId, { kind: 'info', title: '🔧 Mesai bitti', text: `${text} Bugün ${s.cars} araç, ${formatMoney(s.earned)}.` });
  }

  /** The cars on the lifts (everyone sees them). */
  cars(): RepairCar[] {
    return [...this.shifts.values()].flatMap((s) => (s.car ? [s.car] : []));
  }

  private publish(): void {
    this.ctx.hub.broadcast('mech.cars', this.cars());
  }

  welcome(playerId: string): void {
    this.ctx.hub.sendTo(playerId, 'mech.cars', this.cars());
  }

  forget(playerId: string): void {
    const s = this.shifts.get(playerId);
    this.shifts.delete(playerId);
    if (s?.car) this.publish();
  }

  shiftOf(playerId: string): Readonly<Shift> | undefined {
    return this.shifts.get(playerId);
  }

  private view(s: Shift | null): MechanicView {
    if (!s) return { onDuty: false, car: null, working: null, cars: 0, earned: 0, nextAt: null };
    return { onDuty: true, car: s.car, working: s.working, cars: s.cars, earned: s.earned, nextAt: s.nextAt };
  }

  private send(s: Shift, force = false): MechanicView {
    const v = this.view(s);
    const key = JSON.stringify(v);
    if (force || key !== s.sent) {
      s.sent = key;
      this.ctx.hub.sendTo(s.playerId, 'mech.update', v);
    }
    return v;
  }
}
