// Hitman contracts from the contact at the end of the alley between Wrench Bros and the Parts
// Depot. One contract at a time per player, $1,000 a success:
//  - drive-by: hit a named venue's walls `drivebyHits` times from a moving vehicle (a passenger out
//    of the window, the pillion of a bike, or a bike rider with a pistol);
//  - hit: a VIP or rival gang member walks round a block inside a marked search area; shoot them.
// Your crew (everyone in the same vehicle) shares your contract. Contracts run out after a while.

import { ECONOMY } from '../../../shared/economy.config';
import { KMH_PER_MS } from '../../../shared/drivetrain';
import { HITMAN_ALLEY, MARKS, VENUES, type ContractKind, type ContractView } from '../../../shared/hitman';
import { Anim } from '../../../shared/types';
import { BUILDINGS } from '../../../shared/world';
import { GameError } from '../../errors';
import { createLogger } from '../../logger';
import { K, type Ctx } from '../context';
import { requireNear } from '../guards';
import type { CombatService } from './combat';
import type { PoliceService } from './police';

const log = createLogger('hitman');
const H = ECONOMY.hitman;

/** The contact's NPC id (it stands in the alley). */
export const CONTACT_ID = 'hmc_contact';

interface Contract {
  id: string;
  player: string;
  kind: ContractKind;
  venue?: (typeof VENUES)[number];
  /** The mark's NPC id and which mark it is. */
  markId?: string;
  mark?: (typeof MARKS)[number];
  hits: number;
  x: number;
  z: number;
  radius: number;
  expiresAt: number;
}

let seq = 1;

export class HitmanService {
  private contracts = new Map<string, Contract>();
  private cooldown = new Map<string, number>();

  constructor(
    private readonly ctx: Ctx,
    private readonly combat: CombatService,
    private readonly police: PoliceService,
  ) {
    const c = HITMAN_ALLEY.contact;
    ctx.sim.npcs.set(CONTACT_ID, { id: CONTACT_ID, x: c.x, z: c.z, rot: c.rot, anim: Anim.Idle, style: 0 });
    combat.killListeners.push((id, by) => this.onKill(id, by));
    combat.wallHitListeners.push((building, shooter) => this.onWallHit(building, shooter));
  }

  /** "Görev Al": a new contract from the contact. */
  take(playerId: string): { contract: ContractView } {
    requireNear(this.ctx, playerId, 'hitman');
    if (this.contracts.has(playerId)) throw new GameError('conflict', 'Önce elindeki işi bitir.');
    const wait = (this.cooldown.get(playerId) ?? 0) - Date.now();
    if (wait > 0) throw new GameError('rate_limited', `Ortalık biraz soğusun: ${Math.ceil(wait / 1000)} sn sonra gel.`);
    const rng = this.ctx.rng;
    const now = Date.now();
    const id = `ct_${seq++}`;
    const kind: ContractKind = rng() < 0.5 ? 'driveby' : 'hit';
    let c: Contract;
    if (kind === 'driveby') {
      const venue = VENUES[Math.floor(rng() * VENUES.length)]!;
      const b = BUILDINGS.find((x) => x.id === venue.building)!.box;
      c = { id, player: playerId, kind, venue, hits: 0, x: (b.minX + b.maxX) / 2, z: (b.minZ + b.maxZ) / 2, radius: 20, expiresAt: now + H.drivebySec * 1000 };
    } else {
      const markIndex = Math.floor(rng() * MARKS.length);
      const mark = MARKS[markIndex]!;
      // Somewhere in the city, away from the alley; the search area is not centred on them.
      const blocks = [-100, 0, 100];
      const bx = blocks[Math.floor(rng() * 3)]!;
      const bz = blocks[Math.floor(rng() * 3)]!;
      const markId = `hmt_${seq++}`;
      this.combat.spawnMark(markId, markIndex, bx, bz, H.markHp);
      const npc = this.ctx.sim.npcs.get(markId)!;
      const a = rng() * Math.PI * 2;
      const off = rng() * (H.searchRadius * 0.5);
      c = { id, player: playerId, kind, mark, markId, hits: 0, x: npc.x + Math.cos(a) * off, z: npc.z + Math.sin(a) * off, radius: H.searchRadius, expiresAt: now + H.hitSec * 1000 };
    }
    this.contracts.set(playerId, c);
    log.info('contract', { playerId, kind, target: c.venue?.id ?? c.mark?.id });
    const view = this.view(c);
    this.ctx.hub.sendTo(playerId, 'hitman.update', view);
    return { contract: view };
  }

  /** The player's contract (or null). */
  current(playerId: string): ContractView | null {
    const c = this.contracts.get(playerId);
    return c ? this.view(c) : null;
  }

  /** Give a contract up. */
  drop(playerId: string): void {
    const c = this.contracts.get(playerId);
    if (!c) return;
    this.end(c);
    this.ctx.hub.sendTo(playerId, 'hitman.update', null);
  }

  /** Run-out contracts. */
  tick(now = Date.now()): void {
    for (const c of [...this.contracts.values()]) {
      if (now < c.expiresAt) continue;
      this.end(c);
      this.cooldown.set(c.player, now + H.cooldownSec * 1000);
      this.ctx.hub.sendTo(c.player, 'hitman.update', null);
      this.ctx.hub.notify(c.player, { kind: 'error', title: 'İş yattı', text: 'Süre doldu. Bağlantı memnun değil.' });
    }
  }

  /** A contract by its holder or anyone in their vehicle. */
  private contractFor(shooter: string): Contract | undefined {
    for (const p of this.police.crew(shooter)) {
      const c = this.contracts.get(p);
      if (c) return c;
    }
    return undefined;
  }

  private onWallHit(building: string, shooter: string): void {
    const c = this.contractFor(shooter);
    if (!c || c.kind !== 'driveby' || c.venue!.building !== building) return;
    // From a moving vehicle only.
    const ch = this.ctx.sim.chars.get(shooter);
    const inside = ch?.ridingId ?? ch?.drivingId;
    const d = inside ? this.ctx.sim.drives.get(inside) : undefined;
    if (!d || Math.abs(d.dyn.speed) * KMH_PER_MS < H.drivebyMinKmh) return;
    c.hits++;
    if (c.hits >= H.drivebyHits) void this.complete(c);
    else this.ctx.hub.sendTo(c.player, 'hitman.update', this.view(c));
  }

  private onKill(id: string, by: string | null): void {
    for (const c of this.contracts.values()) {
      if (c.markId !== id) continue;
      if (by && this.police.crew(by).includes(c.player)) void this.complete(c);
      else {
        // Somebody else got there first.
        this.end(c);
        this.ctx.hub.sendTo(c.player, 'hitman.update', null);
        this.ctx.hub.notify(c.player, { kind: 'error', title: 'İş yattı', text: 'Hedefi başkası indirdi.' });
      }
      return;
    }
  }

  private async complete(c: Contract): Promise<void> {
    if (this.contracts.get(c.player) !== c) return;
    this.contracts.delete(c.player);
    this.cooldown.set(c.player, Date.now() + H.cooldownSec * 1000);
    try {
      await this.ctx.locks.run([K.player(c.player)], async () => {
        if (!this.ctx.state.players.has(c.player)) return;
        const uow = this.ctx.state.begin();
        const p = uow.player(c.player);
        uow.credit(p, H.reward, 'hitman', c.kind === 'driveby' ? `Drive-by: ${c.venue!.name}` : `Hit: ${c.mark!.name}`);
        uow.grantXp(p, H.xp);
        await uow.commit();
      });
    } catch (err) {
      log.warn('payout failed', { player: c.player, err: String(err) });
      return;
    }
    // The mark's body stays a while (it is a dead pedestrian now), then goes.
    if (c.markId) setTimeout(() => this.combat.removeMark(c.markId!), 9000).unref?.();
    this.ctx.hub.sendTo(c.player, 'hitman.update', null);
    this.ctx.hub.sendTo(c.player, 'hitman.done', { title: c.kind === 'driveby' ? `${c.venue!.name} kurşunlandı` : `${c.mark!.name} indirildi`, reward: H.reward, xp: H.xp });
    log.info('contract done', { player: c.player, kind: c.kind });
  }

  private end(c: Contract): void {
    this.contracts.delete(c.player);
    if (c.markId) this.combat.removeMark(c.markId);
  }

  private view(c: Contract): ContractView {
    const v: ContractView = {
      id: c.id,
      kind: c.kind,
      title: c.kind === 'driveby' ? `Drive-by: ${c.venue!.name}` : `Hedef: ${c.mark!.name}`,
      text:
        c.kind === 'driveby'
          ? `Hareket halindeki bir araçtan ${c.venue!.name} binasına ${H.drivebyHits} isabet. Arka koltuktan, motorun arkasından ya da motorda tabancayla.`
          : `${c.mark!.kind === 'vip' ? 'VIP' : 'Rakip çete üyesi'} işaretli alanda yürüyor. Bul ve indir.`,
      x: Math.round(c.x * 10) / 10,
      z: Math.round(c.z * 10) / 10,
      radius: c.radius,
      reward: H.reward,
      expiresAt: c.expiresAt,
    };
    if (c.kind === 'driveby') {
      v.hits = c.hits;
      v.need = H.drivebyHits;
    }
    if (c.markId) v.markId = c.markId;
    return v;
  }
}
