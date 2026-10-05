// Gang territories (shared/gangs.ts). Four zones belong to street gangs; members hang round each
// gang's hangout. Shooting up a shop in a zone, shooting a member or raiding the hangout (E at its
// door) starts a turf war: "BÖLGE SAVAŞI BAŞLADI". Waves of gang cars and bikes race in along the
// roads, stop, and armed members jump out and fight; each wave down, the next comes after a few
// seconds; the last one down and the zone is the player's (100%): purple on the map, protection money
// every 10 minutes (into the bank, or in cash kept at Emlak Dünyası while that's the choice or the
// owner is away). Every 30-45 minutes (while the owner is on) the gang hits back: "BÖLGEN SALDIRI
// ALTINDA" - into the zone within 2 minutes and beat them off, or the zone is lost and the money
// stops. Out of the zone too long during a war, or wasted: the war is lost.
//
// Who holds what, the cash boxes and the pay choice are kept in the world state ('gangs').

import { ECONOMY } from '../../../shared/economy.config';
import {
  GANG_ZONES,
  distToZone,
  findZone,
  hangoutSpots,
  waveMix,
  zoneOf,
  type GangCarView,
  type GangMine,
  type GangZone,
  type GangZoneId,
  type GangZoneView,
  type TurfWarView,
} from '../../../shared/gangs';
import { CHAR_RADIUS, resolveCircle } from '../../../shared/physics';
import { Anim } from '../../../shared/types';
import { angleDiff, formatMoney } from '../../../shared/util';
import { getModel } from '../../../shared/vehicles';
import { BUILDINGS, INTERACTABLES } from '../../../shared/world';
import { GameError } from '../../errors';
import { createLogger } from '../../logger';
import * as repo from '../../db/repo';
import * as val from '../../validate';
import { K, type Ctx } from '../context';
import type { NpcEntity } from '../simulation';
import type { CombatService } from './combat';

const log = createLogger('gangs');
const G = ECONOMY.gangs;
const KEY = 'gangs';
const ZONE_IDS = GANG_ZONES.map((z) => z.id);

interface ZoneState {
  owner: string | null;
  ownerName: string | null;
  nextIncomeAt: number;
  nextAttackAt: number;
  /** The gang is hitting back: the owner must be in the zone by then (ms). */
  attackUntil: number | null;
}

interface Saved {
  zones: Partial<Record<GangZoneId, Omit<ZoneState, 'attackUntil'>>>;
  cash: Record<string, number>;
  mode: Record<string, 'bank' | 'cash'>;
}

interface Member {
  npc: NpcEntity;
  zone: GangZoneId;
  hp: number;
  /** Standing round the hangout (not in a war yet). */
  idle: boolean;
  war: War | null;
  fireAt: number;
  deadAt: number;
  /** Where it stands idle. */
  post: { x: number; z: number; rot: number } | null;
}

interface Car {
  id: string;
  zone: GangZoneId;
  modelId: string;
  color: string;
  lane: { x: number; z: number }[];
  seg: number;
  x: number;
  z: number;
  rot: number;
  speed: number;
  /** Members to let out when it stops. */
  riders: number;
  arrived: boolean;
  war: War;
}

interface War {
  zone: GangZone;
  kind: 'war' | 'defend';
  leader: string;
  crew: Set<string>;
  wave: number;
  waves: number;
  /** Members of this wave (alive or dead) and how many there are in all. */
  members: Set<string>;
  total: number;
  /** The next wave sets off at (ms; null: one is on). */
  nextAt: number | null;
  leaveAt: number | null;
  text: string;
  killed: number;
  startedAt: number;
}

let seq = 1;

export class GangService {
  private zones = new Map<GangZoneId, ZoneState>();
  private cash = new Map<string, number>();
  private mode = new Map<string, 'bank' | 'cash'>();
  private members = new Map<string, Member>();
  private cars = new Map<string, Car>();
  private wars = new Map<GangZoneId, War>();
  /** Which war each player is in. */
  private warOf = new Map<string, War>();
  private sent = new Map<string, string>();
  private lastZones = '';
  private carsAt = 0;
  /** Zone captured / lost (missions, logs). */
  readonly captureListeners: ((playerId: string, zone: GangZoneId) => void)[] = [];

  constructor(
    private readonly ctx: Ctx,
    private readonly combat: CombatService,
  ) {
    for (const z of GANG_ZONES) this.zones.set(z.id, { owner: null, ownerName: null, nextIncomeAt: 0, nextAttackAt: 0, attackUntil: null });
    combat.hostileSources.push({
      list: () => [...this.members.values()].filter((m) => !m.deadAt).map((m) => m.npc),
      hit: (id, amount, by) => this.hit(id, amount, by),
    });
    // A bullet in a shop's wall in a gang's zone: that's a war.
    combat.wallHitListeners.push((buildingId, shooter) => {
      const b = BUILDINGS.find((x) => x.id === buildingId);
      if (!b) return;
      const zone = zoneOf((b.box.minX + b.box.maxX) / 2, (b.box.minZ + b.box.maxZ) / 2);
      if (zone) this.provoke(shooter, zone, `${zone.gang} dükkanına ateş açtın!`);
    });
    combat.wastedListeners.push((pid) => this.fall(pid));
  }

  async init(): Promise<void> {
    const raw = await repo.getWorldValue(this.ctx.state.db, KEY);
    if (!raw) return;
    try {
      const s = JSON.parse(raw) as Saved;
      for (const [id, z] of Object.entries(s.zones ?? {})) {
        const st = this.zones.get(id as GangZoneId);
        if (st && z) Object.assign(st, { owner: z.owner ?? null, ownerName: z.ownerName ?? null, nextIncomeAt: z.nextIncomeAt ?? 0, nextAttackAt: z.nextAttackAt ?? 0 });
      }
      for (const [pid, n] of Object.entries(s.cash ?? {})) if (n > 0) this.cash.set(pid, n);
      for (const [pid, m] of Object.entries(s.mode ?? {})) if (m === 'cash' || m === 'bank') this.mode.set(pid, m);
    } catch {
      /* start fresh */
    }
  }

  private saved(): string {
    const zones: Saved['zones'] = {};
    for (const [id, z] of this.zones) zones[id] = { owner: z.owner, ownerName: z.ownerName, nextIncomeAt: z.nextIncomeAt, nextAttackAt: z.nextAttackAt };
    return JSON.stringify({ zones, cash: Object.fromEntries(this.cash), mode: Object.fromEntries(this.mode) } satisfies Saved);
  }

  private async save(): Promise<void> {
    const uow = this.ctx.state.begin();
    uow.setWorldValue(KEY, this.saved());
    await uow.commit();
  }

  // ---------------------------------------------------------------- views

  views(now = Date.now()): GangZoneView[] {
    return GANG_ZONES.map((z) => {
      const st = this.zones.get(z.id)!;
      const war = this.wars.get(z.id);
      let dominance = st.owner ? 100 : 0;
      if (war?.kind === 'war') dominance = Math.round((war.killed / Math.max(1, this.warTotal(war))) * 100);
      if (st.attackUntil) dominance = Math.max(0, Math.round(((st.attackUntil - now) / (G.attackSec * 1000)) * 100));
      if (war?.kind === 'defend') dominance = Math.max(10, Math.round(50 + (war.killed / Math.max(1, this.warTotal(war))) * 50));
      return { id: z.id, owner: st.owner, ownerName: st.ownerName, dominance, war: !!war, attackUntil: st.attackUntil };
    });
  }

  /** Every member the war will bring (all waves). */
  private warTotal(w: War): number {
    let n = 0;
    for (let i = 0; i < w.waves; i++) {
      const m = waveMix(w.kind === 'defend' ? 1 : i);
      n += m.cars * 2 + m.bikes;
    }
    return n;
  }

  private publish(force = false): void {
    const v = this.views();
    const key = JSON.stringify(v.map((x) => [x.id, x.owner, Math.round(x.dominance / 5), x.war, !!x.attackUntil]));
    if (!force && key === this.lastZones) return;
    this.lastZones = key;
    this.ctx.hub.broadcast('gang.zones', v);
  }

  mine(playerId: string, now = Date.now()): GangMine {
    const zones = GANG_ZONES.filter((z) => this.zones.get(z.id)!.owner === playerId);
    const next = zones.map((z) => this.zones.get(z.id)!.nextIncomeAt).filter((t) => t > now);
    return { zones: zones.map((z) => z.id), cash: this.cash.get(playerId) ?? 0, mode: this.mode.get(playerId) ?? 'bank', nextIncomeAt: next.length ? Math.min(...next) : null };
  }

  private sendMine(playerId: string): void {
    this.ctx.hub.sendTo(playerId, 'gang.mine', this.mine(playerId));
  }

  status(playerId: string) {
    const w = this.warOf.get(playerId);
    return { zones: this.views(), mine: this.mine(playerId), war: w ? this.warView(w) : null };
  }

  welcome(playerId: string): void {
    this.ctx.hub.sendTo(playerId, 'gang.zones', this.views());
    this.ctx.hub.sendTo(playerId, 'gang.cars', this.carViews());
    this.sendMine(playerId);
    // Their name may have been missing on the zones they hold (saved before).
    for (const st of this.zones.values()) if (st.owner === playerId && !st.ownerName) st.ownerName = this.ctx.state.players.get(playerId)?.name ?? null;
  }

  forget(playerId: string): void {
    const w = this.warOf.get(playerId);
    if (w) this.leaveWar(playerId, w);
    this.sent.delete(playerId);
  }

  private warView(w: War): TurfWarView {
    const left = [...w.members].filter((id) => !this.members.get(id)?.deadAt && this.members.has(id)).length + [...this.cars.values()].filter((c) => c.war === w && !c.arrived).reduce((a, c) => a + c.riders, 0);
    const now = Date.now();
    return {
      zone: w.zone.id,
      kind: w.kind,
      wave: w.wave + 1,
      waves: w.waves,
      left,
      total: Math.max(w.total, left),
      nextAt: w.nextAt,
      leaveAt: w.leaveAt && w.leaveAt > now ? w.leaveAt : null,
      text: w.text,
    };
  }

  private sendWar(w: War, force = false): void {
    const v = this.warView(w);
    const key = JSON.stringify({ ...v, leaveAt: v.leaveAt ? Math.ceil((v.leaveAt - Date.now()) / 1000) : null });
    for (const pid of w.crew) {
      if (!force && this.sent.get(pid) === key) continue;
      this.sent.set(pid, key);
      this.ctx.hub.sendTo(pid, 'gang.war', v);
    }
  }

  private banner(ids: Iterable<string>, text: string, color: string, kind: 'war' | 'win' | 'lost' | 'wave' | 'attack'): void {
    for (const pid of ids) this.ctx.hub.sendTo(pid, 'gang.banner', { text, color, kind });
  }

  carViews(): GangCarView[] {
    return [...this.cars.values()].map((c) => ({ id: c.id, zone: c.zone, modelId: c.modelId, color: c.color, x: c.x, z: c.z, rot: c.rot, speed: c.arrived ? 0 : c.speed }));
  }

  // ---------------------------------------------------------------- starting a war

  /** E at a hangout's door. */
  raid(playerId: string, params: unknown): TurfWarView {
    const p = val.obj(params);
    const zone = findZone(val.oneOf(p.zoneId, 'zone', ZONE_IDS))!;
    const c = this.ctx.sim.chars.get(playerId);
    if (!c || c.dead) throw new GameError('conflict', 'Önce ayağa kalk.');
    if (c.drivingId || c.ridingId) throw new GameError('conflict', 'Araçtan in: mekan yaya basılır.');
    if (Math.hypot(c.x - zone.venue.door.x, c.z - zone.venue.door.z) > G.raidReach + 1) throw new GameError('too_far', 'Kapıya yaklaş.');
    const w = this.provoke(playerId, zone, `${zone.venue.name} basıldı!`, true);
    if (!w) throw new GameError('conflict', this.zones.get(zone.id)!.owner === playerId ? 'Burası zaten senin bölgen.' : 'Burada zaten bir savaş var.');
    this.ctx.sim.markInteract(playerId);
    return this.warView(w);
  }

  /** Something that starts a war in a zone (unless it's the player's own or one is on there). */
  private provoke(playerId: string, zone: GangZone, why: string, raid = false): War | null {
    const st = this.zones.get(zone.id)!;
    if (st.owner === playerId || this.wars.has(zone.id) || this.warOf.has(playerId)) return null;
    const c = this.ctx.sim.chars.get(playerId);
    if (!c || c.dead) return null;
    // Only from in (or right by) the zone.
    if (!raid && distToZone(zone, c.x, c.z) > 30) return null;
    const now = Date.now();
    const w: War = { zone, kind: 'war', leader: playerId, crew: new Set([playerId]), wave: 0, waves: zone.waves, members: new Set(), total: 0, nextAt: now + 2500, leaveAt: null, text: why, killed: 0, startedAt: now };
    // Everyone close by fights along.
    for (const o of this.ctx.sim.chars.values()) if (o.id !== playerId && !o.dead && !this.warOf.has(o.id) && Math.hypot(o.x - c.x, o.z - c.z) < 30) w.crew.add(o.id);
    this.wars.set(zone.id, w);
    for (const pid of w.crew) this.warOf.set(pid, w);
    // The members at the hangout join in.
    for (const m of this.members.values()) {
      if (m.zone !== zone.id || !m.idle || m.deadAt) continue;
      m.idle = false;
      m.war = w;
      m.fireAt = now + 900 + this.ctx.rng() * 900;
      w.members.add(m.npc.id);
      w.total++;
    }
    this.banner(w.crew, `BÖLGE SAVAŞI BAŞLADI: ${zone.name}`, zone.color, 'war');
    for (const pid of w.crew) this.ctx.hub.notify(pid, { kind: 'warning', title: `⚔️ BÖLGE SAVAŞI BAŞLADI: ${zone.name}`, text: `${why} ${zone.gang} ${zone.waves} dalga halinde geliyor: hepsini temizle, bölge senin olsun.` });
    this.sendWar(w, true);
    this.publish(true);
    log.info('turf war', { playerId, zone: zone.id });
    return w;
  }

  // ---------------------------------------------------------------- members

  private spawnMember(zone: GangZone, x: number, z: number, rot: number, war: War | null, post: Member['post']): Member {
    const id = `gng_${zone.id}_${seq++}`;
    const style = GANG_ZONES.indexOf(zone) * 4 + (seq % 4);
    const npc: NpcEntity = { id, x, z, rot, anim: war ? Anim.Aim : Anim.Idle, style };
    const m: Member = { npc, zone: zone.id, hp: G.memberHp, idle: !war, war, fireAt: Date.now() + 1200 + this.ctx.rng() * 800, deadAt: 0, post };
    this.members.set(id, m);
    this.ctx.sim.npcs.set(id, npc);
    if (war) {
      war.members.add(id);
      war.total++;
    }
    return m;
  }

  private hit(id: string, amount: number, by: string | null): boolean {
    const m = this.members.get(id);
    if (!m) return false;
    if (m.deadAt) return true;
    // Shooting a member of a gang at their hangout starts a war.
    if (m.idle && by) this.provoke(by, findZone(m.zone)!, `${findZone(m.zone)!.gang} üyesini vurdun!`);
    m.hp -= amount;
    if (m.hp <= 0) {
      m.deadAt = Date.now();
      m.npc.anim = Anim.Dead;
      if (m.war) {
        m.war.killed++;
        this.sendWar(m.war, true);
      }
    }
    return true;
  }

  private removeMember(id: string): void {
    this.members.delete(id);
    this.ctx.sim.npcs.delete(id);
  }

  // ---------------------------------------------------------------- waves

  private spawnWave(w: War): void {
    const z = w.zone;
    const mix = waveMix(w.kind === 'defend' ? 1 : w.wave);
    // (The first wave joins the members from the hangout still standing.)
    w.members = new Set([...w.members].filter((id) => this.members.has(id) && !this.members.get(id)!.deadAt));
    w.total = w.members.size;
    w.nextAt = null;
    w.text = w.kind === 'defend' ? `${z.gang} saldırıyor!` : `Dalga ${w.wave + 1}/${w.waves}: ${z.gang} geliyor!`;
    const n = mix.cars + mix.bikes;
    for (let i = 0; i < n; i++) {
      const bike = i >= mix.cars;
      const lane = z.lanes[(w.wave + i) % z.lanes.length]!;
      // One behind the other on the same lane.
      const back = Math.floor(i / z.lanes.length) * 9;
      const a = lane[0]!;
      const b = lane[1]!;
      const d = Math.hypot(b.x - a.x, b.z - a.z) || 1;
      const id = `gc_${seq++}`;
      const car: Car = {
        id,
        zone: z.id,
        modelId: bike ? z.bike : z.car,
        color: z.color,
        lane,
        seg: 0,
        x: a.x - ((b.x - a.x) / d) * back,
        z: a.z - ((b.z - a.z) / d) * back,
        rot: Math.atan2(b.x - a.x, b.z - a.z),
        speed: G.carSpeed,
        riders: bike ? 1 : 2,
        arrived: false,
        war: w,
      };
      this.cars.set(id, car);
    }
    this.banner(w.crew, w.kind === 'defend' ? `${z.gang} SALDIRIYOR!` : `DALGA ${w.wave + 1}/${w.waves}`, z.color, 'wave');
    this.sendWar(w, true);
    this.ctx.hub.broadcast('gang.cars', this.carViews());
  }

  private driveCars(dt: number): void {
    let moved = false;
    for (const c of this.cars.values()) {
      if (c.arrived) continue;
      moved = true;
      const to = c.lane[c.seg + 1];
      if (!to) {
        this.arrive(c);
        continue;
      }
      const dx = to.x - c.x;
      const dz = to.z - c.z;
      const d = Math.hypot(dx, dz);
      // Brake into the last stop.
      const last = c.seg + 2 >= c.lane.length;
      c.speed = last ? Math.min(G.carSpeed, Math.max(3, Math.sqrt(2 * 6 * d))) : G.carSpeed;
      const step = c.speed * dt;
      c.rot += angleDiff(c.rot, Math.atan2(dx, dz)) * Math.min(1, dt * 6);
      if (d <= step) {
        c.x = to.x;
        c.z = to.z;
        c.seg++;
        if (c.seg + 1 >= c.lane.length) this.arrive(c);
      } else {
        c.x += (dx / d) * step;
        c.z += (dz / d) * step;
      }
    }
    // Solid for everyone (and cover).
    this.ctx.sim.setExtraObstacles('gangs', [...this.cars.values()].map((c) => ({ id: c.id, modelId: c.modelId, x: c.x, z: c.z, rot: c.rot })));
    const now = Date.now();
    if (moved && now - this.carsAt > 200) {
      this.carsAt = now;
      this.ctx.hub.broadcast('gang.cars', this.carViews());
    }
  }

  /** At the end of its road: the members jump out either side. */
  private arrive(c: Car): void {
    if (c.arrived) return;
    c.arrived = true;
    c.speed = 0;
    const z = findZone(c.zone)!;
    const m = getModel(c.modelId);
    for (let i = 0; i < c.riders; i++) {
      const side = i === 0 ? 1 : -1;
      const off = m.shape.width / 2 + 0.8;
      const x = c.x + Math.cos(c.rot) * off * side;
      const zz = c.z - Math.sin(c.rot) * off * side;
      this.spawnMember(z, x, zz, c.rot, c.war, null);
    }
    c.riders = 0;
    this.sendWar(c.war, true);
    this.ctx.hub.broadcast('gang.cars', this.carViews());
  }

  // ---------------------------------------------------------------- per tick

  tick(dt: number, now: number): void {
    this.keepHangouts();
    this.driveCars(dt);
    this.fight(dt, now);
    for (const w of [...this.wars.values()]) this.tickWar(w, now);
    this.tickZones(now);
    // Bodies are cleared away after a while.
    for (const [id, m] of this.members) if (m.deadAt && now - m.deadAt > 12_000) this.removeMember(id);
    this.publish();
  }

  /** Idle members round the hangouts of the zones the gangs still hold (none during a war). */
  private keepHangouts(): void {
    for (const z of GANG_ZONES) {
      const st = this.zones.get(z.id)!;
      const idle = [...this.members.values()].filter((m) => m.zone === z.id && m.idle && !m.deadAt);
      if (st.owner || this.wars.has(z.id)) {
        // A zone a player holds: the gang has cleared out.
        if (st.owner) for (const m of idle) this.removeMember(m.npc.id);
        continue;
      }
      const spots = hangoutSpots(z);
      for (let i = idle.length; i < G.idleMembers; i++) {
        const taken = new Set(idle.map((m) => m.post && `${m.post.x},${m.post.z}`));
        const post = spots.find((s) => !taken.has(`${s.x},${s.z}`)) ?? spots[i % spots.length]!;
        idle.push(this.spawnMember(z, post.x, post.z, post.rot, null, post));
      }
    }
  }

  /** The members at war: close in on the nearest of the crew and shoot. */
  private fight(dt: number, now: number): void {
    const world = this.ctx.sim.collisionWorld;
    for (const m of this.members.values()) {
      if (m.deadAt) continue;
      if (m.idle) {
        m.npc.anim = Anim.Idle;
        continue;
      }
      const w = m.war;
      if (!w) continue;
      let best: { id: string; x: number; z: number; d: number } | null = null;
      for (const pid of w.crew) {
        const c = this.ctx.sim.chars.get(pid);
        if (!c || c.dead) continue;
        const vid = c.drivingId ?? c.ridingId;
        const pos = vid ? this.ctx.sim.drives.get(vid)?.dyn : c;
        if (!pos) continue;
        const d = Math.hypot(pos.x - m.npc.x, pos.z - m.npc.z);
        if (!best || d < best.d) best = { id: pid, x: pos.x, z: pos.z, d };
      }
      if (!best) {
        m.npc.anim = Anim.Aim;
        continue;
      }
      const dx = best.x - m.npc.x;
      const dz = best.z - m.npc.z;
      m.npc.rot += angleDiff(m.npc.rot, Math.atan2(dx, dz)) * Math.min(1, dt * 8);
      if (best.d > 14) {
        const step = Math.min(best.d - 12, 3.8 * dt);
        const r = resolveCircle(m.npc.x + (dx / best.d) * step, m.npc.z + (dz / best.d) * step, CHAR_RADIUS, world, m.npc.id);
        m.npc.x = r.x;
        m.npc.z = r.z;
        m.npc.anim = Anim.Run;
      } else m.npc.anim = Anim.Aim;
      if (now >= m.fireAt && best.d < G.memberRange) {
        m.fireAt = now + G.memberFireSec * 1000 * (0.8 + this.ctx.rng() * 0.5);
        this.combat.npcFire(m.npc.id, m.npc, best.id, { accuracy: G.memberAccuracy, range: G.memberRange, damage: G.memberDamage, weapon: m.npc.style % 4 === 3 ? 'shotgun' : 'pistol' }, now);
      }
    }
  }

  private tickWar(w: War, now: number): void {
    // The crew: anyone gone or down is out.
    for (const pid of [...w.crew]) {
      const c = this.ctx.sim.chars.get(pid);
      if (!c || c.dead) this.leaveWar(pid, w);
    }
    if (!this.wars.has(w.zone.id)) return;
    if (w.crew.size === 0) {
      this.endWar(w, false, 'Savaş kaybedildi.');
      return;
    }
    // Out of the zone for too long.
    const inside = [...w.crew].some((pid) => {
      const c = this.ctx.sim.chars.get(pid)!;
      const vid = c.drivingId ?? c.ridingId;
      const pos = vid ? this.ctx.sim.drives.get(vid)?.dyn ?? c : c;
      return distToZone(w.zone, pos.x, pos.z) <= G.leaveDist;
    });
    if (inside) w.leaveAt = null;
    else if (w.leaveAt === null) {
      w.leaveAt = now + G.leaveSec * 1000;
      w.text = `Bölgeden çok uzaklaştın: ${G.leaveSec} sn içinde geri dön!`;
      this.sendWar(w, true);
    } else if (now >= w.leaveAt) {
      this.endWar(w, false, 'Bölgeden kaçtın: savaş kaybedildi.');
      return;
    }
    // The next wave.
    if (w.nextAt !== null) {
      if (now >= w.nextAt) this.spawnWave(w);
      else this.sendWar(w);
      return;
    }
    const alive = [...w.members].some((id) => {
      const m = this.members.get(id);
      return m && !m.deadAt;
    });
    const coming = [...this.cars.values()].some((c) => c.war === w && !c.arrived);
    if (alive || coming) {
      this.sendWar(w);
      return;
    }
    w.wave++;
    if (w.wave >= w.waves) {
      this.endWar(w, true, '');
      return;
    }
    w.nextAt = now + G.waveGapSec * 1000;
    w.text = `Dalga temizlendi! Sıradaki ${G.waveGapSec} sn içinde geliyor...`;
    this.sendWar(w, true);
  }

  private leaveWar(pid: string, w: War): void {
    w.crew.delete(pid);
    this.warOf.delete(pid);
    this.sent.delete(pid);
    this.ctx.hub.sendTo(pid, 'gang.war', null);
  }

  /** Won (the zone changes hands / is kept) or lost. */
  private endWar(w: War, won: boolean, why: string): void {
    const z = w.zone;
    const st = this.zones.get(z.id)!;
    const now = Date.now();
    this.wars.delete(z.id);
    const crew = [...w.crew];
    for (const pid of crew) this.leaveWar(pid, w);
    // The gang's cars drive off; the members still standing go back to the hangout (or away).
    for (const [id, c] of this.cars) if (c.war === w) this.cars.delete(id);
    for (const m of this.members.values()) {
      if (m.war !== w) continue;
      m.war = null;
      if (!m.deadAt) this.removeMember(m.npc.id);
    }
    this.ctx.hub.broadcast('gang.cars', this.carViews());
    if (won) {
      if (w.kind === 'war') {
        const prev = st.owner;
        st.owner = w.leader;
        st.ownerName = this.ctx.state.players.get(w.leader)?.name ?? null;
        st.nextIncomeAt = now + G.incomeSec * 1000;
        st.nextAttackAt = now + this.retaliateGap() * 1000;
        st.attackUntil = null;
        if (prev && prev !== w.leader) {
          this.ctx.hub.notify(prev, { kind: 'error', title: `Bölgeni kaybettin: ${z.name}`, text: `${st.ownerName ?? 'Başka biri'} ${z.name} bölgesini ele geçirdi. Haraç artık sana gelmiyor.` });
          this.sendMine(prev);
        }
        this.banner(crew, `BÖLGE ELE GEÇİRİLDİ: ${z.name} · %100`, '#a855f7', 'win');
        this.ctx.hub.notify(w.leader, { kind: 'success', title: `🏴 ${z.name} artık senin!`, text: `Her 10 dakikada ${formatMoney(z.income)} haraç (bankaya otomatik, ya da nakit: Emlak Dünyası). ${z.gang} 30-45 dakikada bir misilleme yapacak.` });
        void this.reward(w.leader);
        for (const l of this.captureListeners) l(w.leader, z.id);
        log.info('zone captured', { playerId: w.leader, zone: z.id });
      } else {
        st.nextAttackAt = now + this.retaliateGap() * 1000;
        this.banner(crew, `SALDIRI PÜSKÜRTÜLDÜ: ${z.name} hâlâ senin`, '#a855f7', 'win');
      }
    } else {
      if (w.kind === 'defend') this.loseZone(z, 'Misilleme püskürtülemedi');
      this.banner(crew, w.kind === 'defend' ? `BÖLGE KAYBEDİLDİ: ${z.name}` : `SAVAŞ KAYBEDİLDİ: ${z.name}`, z.color, 'lost');
      for (const pid of crew) this.ctx.hub.notify(pid, { kind: 'error', title: `Savaş kaybedildi: ${z.name}`, text: why || `${z.gang} bölgeyi tuttu.` });
    }
    void this.save();
    for (const pid of new Set([...crew, w.leader])) this.sendMine(pid);
    this.publish(true);
  }

  private async reward(playerId: string): Promise<void> {
    try {
      await this.ctx.locks.run([K.player(playerId)], async () => {
        if (!this.ctx.state.players.has(playerId)) return;
        const uow = this.ctx.state.begin();
        uow.grantXp(uow.player(playerId), G.xp);
        await uow.commit();
      });
    } catch (err) {
      log.error('gang xp failed', { playerId, error: (err as Error).message });
    }
  }

  private loseZone(z: GangZone, why: string): void {
    const st = this.zones.get(z.id)!;
    const owner = st.owner;
    st.owner = null;
    st.ownerName = null;
    st.attackUntil = null;
    if (owner) {
      this.ctx.hub.notify(owner, { kind: 'error', title: `BÖLGE KAYBEDİLDİ: ${z.name}`, text: `${why}: ${z.gang} bölgeyi geri aldı, haraç durdu.` });
      this.sendMine(owner);
    }
    log.info('zone lost', { playerId: owner, zone: z.id });
  }

  private retaliateGap(): number {
    const [lo, hi] = G.retaliateSec;
    return lo + this.ctx.rng() * (hi - lo);
  }

  /** A player wasted: out of any war (the waves don't care). */
  private fall(playerId: string): void {
    const w = this.warOf.get(playerId);
    if (w) this.leaveWar(playerId, w);
  }

  // ---------------------------------------------------------------- holding a zone

  private online(playerId: string): boolean {
    return this.ctx.sim.chars.has(playerId);
  }

  private tickZones(now: number): void {
    for (const z of GANG_ZONES) {
      const st = this.zones.get(z.id)!;
      if (!st.owner) continue;
      const owner = st.owner;
      // Protection money.
      if (st.nextIncomeAt && now >= st.nextIncomeAt) {
        st.nextIncomeAt = now + G.incomeSec * 1000;
        void this.pay(owner, z);
      }
      if (!this.online(owner)) continue;
      // The gang hits back.
      if (st.attackUntil === null && !this.wars.has(z.id) && st.nextAttackAt && now >= st.nextAttackAt) {
        st.attackUntil = now + G.attackSec * 1000;
        const text = `BÖLGEN SALDIRI ALTINDA: ${z.name} - 2 Dakika İçinde Bölgeye Git!`;
        this.ctx.hub.sendTo(owner, 'gang.alert', { zone: z.id, until: st.attackUntil, text });
        this.banner([owner], text, z.color, 'attack');
        this.ctx.hub.notify(owner, { kind: 'warning', title: `🚨 BÖLGEN SALDIRI ALTINDA: ${z.name}`, text: `${z.gang} geri geldi. 2 dakika içinde bölgeye git ve onları püskürt, yoksa bölge ve haraç gider.` });
        this.publish(true);
        continue;
      }
      if (st.attackUntil !== null && !this.wars.has(z.id)) {
        const c = this.ctx.sim.chars.get(owner)!;
        const vid = c.drivingId ?? c.ridingId;
        const pos = vid ? this.ctx.sim.drives.get(vid)?.dyn ?? c : c;
        if (!c.dead && distToZone(z, pos.x, pos.z) <= 0) {
          // In time: the defence.
          st.attackUntil = null;
          const w: War = { zone: z, kind: 'defend', leader: owner, crew: new Set([owner]), wave: 0, waves: G.defendWaves, members: new Set(), total: 0, nextAt: now + 1500, leaveAt: null, text: `${z.gang} saldırıyor!`, killed: 0, startedAt: now };
          if (this.warOf.has(owner)) this.leaveWar(owner, this.warOf.get(owner)!);
          this.wars.set(z.id, w);
          this.warOf.set(owner, w);
          this.banner([owner], `BÖLGENİ SAVUN: ${z.name}`, z.color, 'war');
          this.ctx.hub.sendTo(owner, 'gang.alert', null);
          this.sendWar(w, true);
          this.publish(true);
        } else if (now >= st.attackUntil) {
          this.loseZone(z, 'Zamanında gelmedin');
          this.ctx.hub.sendTo(owner, 'gang.alert', null);
          this.banner([owner], `BÖLGE KAYBEDİLDİ: ${z.name}`, z.color, 'lost');
          void this.save();
          this.publish(true);
        }
      }
    }
  }

  /** Protection money: into the bank (owner on, bank chosen) or the cash box at Emlak Dünyası. */
  private async pay(owner: string, z: GangZone): Promise<void> {
    const toBank = (this.mode.get(owner) ?? 'bank') === 'bank' && this.ctx.state.players.has(owner) && this.online(owner);
    try {
      await this.ctx.locks.run([K.player(owner)], async () => {
        const uow = this.ctx.state.begin();
        if (toBank) {
          const p = uow.player(owner);
          p.bank += z.income;
          uow.notify(owner, { kind: 'money', title: `Haraç: +${formatMoney(z.income)}`, text: `${z.name} bölgesinden haraç bankaya yattı.` });
        } else {
          this.cash.set(owner, (this.cash.get(owner) ?? 0) + z.income);
          if (this.online(owner)) uow.notify(owner, { kind: 'money', title: `Haraç kasada: +${formatMoney(z.income)}`, text: `${z.name} haracı Emlak Dünyası'ndaki kasanda: gidip nakit topla.` });
        }
        uow.setWorldValue(KEY, this.saved());
        await uow.commit();
      });
      if (this.online(owner)) this.sendMine(owner);
    } catch (err) {
      log.error('protection payout failed', { owner, error: (err as Error).message });
    }
  }

  /** Bank (automatic) or cash (collected at Emlak Dünyası). */
  async setMode(playerId: string, params: unknown): Promise<GangMine> {
    const p = val.obj(params);
    const mode = val.oneOf(p.mode, 'mode', ['bank', 'cash'] as const);
    this.mode.set(playerId, mode);
    await this.save();
    return this.mine(playerId);
  }

  /** Take the protection money waiting in the cash box (at Emlak Dünyası). */
  async collect(playerId: string): Promise<GangMine & { amount: number }> {
    return this.ctx.locks.run([K.player(playerId)], async () => {
      const c = this.ctx.sim.chars.get(playerId);
      const office = INTERACTABLES.find((i) => i.kind === 'realestate');
      if (!c || !office || Math.hypot(c.x - office.x, c.z - office.z) > office.radius + 6) throw new GameError('too_far', "Emlak Dünyası'na git.");
      const amount = this.cash.get(playerId) ?? 0;
      if (amount <= 0) throw new GameError('conflict', 'Kasan boş.');
      this.cash.delete(playerId);
      const uow = this.ctx.state.begin();
      uow.credit(uow.player(playerId), amount, 'protection', 'Haraç kasası (Emlak Dünyası)');
      uow.setWorldValue(KEY, this.saved());
      await uow.commit();
      return { ...this.mine(playerId), amount };
    });
  }

  // ---------------------------------------------------------------- tests

  /** Who holds a zone. */
  ownerOf(zone: GangZoneId): string | null {
    return this.zones.get(zone)?.owner ?? null;
  }

  war(zone: GangZoneId): Readonly<War> | undefined {
    return this.wars.get(zone);
  }

  /** Every member of a zone's gang (alive). */
  membersOf(zone: GangZoneId): NpcEntity[] {
    return [...this.members.values()].filter((m) => m.zone === zone && !m.deadAt).map((m) => m.npc);
  }

  /** Bring the gang's next retaliation forward (tests, events). */
  attackNow(zone: GangZoneId): void {
    const st = this.zones.get(zone);
    if (st?.owner) st.nextAttackAt = Date.now() - 1;
  }

  /** Protection money due now (tests). */
  payNow(zone: GangZoneId): void {
    const st = this.zones.get(zone);
    if (st?.owner) st.nextIncomeAt = Date.now() - 1;
  }

  cars_(): GangCarView[] {
    return this.carViews();
  }
}
