// Wires sockets, RPC handlers, services, simulation ticks and persistence.

import type { Server, Socket } from 'socket.io';
import { ECONOMY } from '../../shared/economy.config';
import { CHAR_RADIUS, dynToTuple, resolveCircle } from '../../shared/physics';
import {
  PROTOCOL_VERSION,
  type ClientToServerEvents,
  type PrivateState,
  type RpcName,
  type RpcRequest,
  type RpcResponse,
  type ServerToClientEvents,
} from '../../shared/protocol';
import type { Appearance, LeaderboardEntry, Notification, PlayerPublic, PlayerSettings, WorldInit } from '../../shared/types';
import { hashString } from '../../shared/util';
import { spawnPoint } from '../../shared/world';
import { DRAG_STRIP } from '../../shared/highway';
import type { AuthService } from '../auth';
import { APPEARANCE_OPTIONS } from '../auth';
import type { ServerConfig } from '../config';
import * as repo from '../db/repo';
import { GameError } from '../errors';
import { normalizeIp, resolveClientIp } from '../http/clientIp';
import { KeyedMutex } from '../locks';
import { createLogger } from '../logger';
import { KeyedRateLimiter, TokenBucket } from '../rateLimit';
import * as val from '../validate';
import { K, type Ctx, type Hub } from './context';
import { Simulation } from './simulation';
import { isPublicVehicle, type CommitResult, type GameState } from './state';
import { AuctionService } from './services/auction';
import { BankService } from './services/bank';
import { ChatService } from './services/chat';
import { CustomerService } from './services/customers';
import { DealershipService } from './services/dealership';
import { DragService } from './services/drag';
import { DrivingService } from './services/driving';
import { MissionService } from './services/missions';
import { RewardService } from './services/rewards';
import { PursuitService } from './services/pursuit';
import { StreetRaceService } from './services/streetRace';
import { MotoService } from './services/moto';
import { HitmanService } from './services/hitman';
import { CombatService } from './services/combat';
import { PoliceService } from './services/police';
import { TheftService } from './services/theft';
import { HighwayService } from './services/highway';
import { GarageService } from './services/garage';
import { MarketService } from './services/market';
import { RareMarketService } from './services/rareMarket';
import { TrendsService } from './services/trends';
import { TuningService } from './services/tuning';
import { VehicleService } from './services/vehicles';

const log = createLogger('game');

export interface SocketData {
  playerId: string;
  ip: string;
}

type GameSocket = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;

interface Session {
  playerId: string;
  socket: GameSocket;
  rpcBucket: TokenBucket;
  inputBucket: TokenBucket;
  recent: Map<string, Promise<RpcResponse>>;
  connectedAt: number;
}

type Handler = (playerId: string, params: unknown) => unknown;

export class GameServer implements Hub {
  readonly locks = new KeyedMutex();
  readonly sim: Simulation;
  readonly ctx: Ctx;
  readonly market: MarketService;
  readonly vehicles: VehicleService;
  readonly dealership: DealershipService;
  readonly garage: GarageService;
  readonly bank: BankService;
  readonly auctions: AuctionService;
  readonly chat: ChatService;
  readonly customers: CustomerService;
  readonly trends: TrendsService;
  readonly tuning: TuningService;
  readonly rare: RareMarketService;
  readonly highway: HighwayService;
  readonly drag: DragService;
  readonly driving: DrivingService;
  readonly missions: MissionService;
  readonly rewards: RewardService;
  readonly pursuit: PursuitService;
  readonly streetRace: StreetRaceService;
  readonly combat: CombatService;
  readonly moto: MotoService;
  readonly hitman: HitmanService;
  readonly police: PoliceService;
  readonly theft: TheftService;
  private tickCount = 0;
  private sessions = new Map<string, Session>();
  private timers: NodeJS.Timeout[] = [];
  private selfDirty = new Set<string>();
  private ipCounts = new Map<string, number>();
  /** Per-player RPC buckets survive reconnects (bounded by the number of accounts). */
  private rpcBuckets = new Map<string, TokenBucket>();
  private handshakeLimiter = new KeyedRateLimiter(60, 2);
  private leaderboardCache: { at: number; entries: LeaderboardEntry[] } | null = null;
  private handlers: Record<RpcName, Handler>;
  private lastTick = Date.now();
  private stopping = false;

  constructor(
    private readonly io: Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>,
    readonly state: GameState,
    private readonly auth: AuthService,
    private readonly cfg: ServerConfig,
  ) {
    this.sim = new Simulation(state);
    this.ctx = { state, locks: this.locks, sim: this.sim, hub: this, rng: Math.random };
    this.market = new MarketService(this.ctx);
    this.vehicles = new VehicleService(this.ctx);
    this.dealership = new DealershipService(this.ctx);
    this.garage = new GarageService(this.ctx, this.vehicles);
    this.bank = new BankService(this.ctx);
    this.auctions = new AuctionService(this.ctx);
    this.chat = new ChatService(this.ctx);
    this.customers = new CustomerService(this.ctx);
    this.trends = new TrendsService(this.ctx);
    this.tuning = new TuningService(this.ctx);
    this.rare = new RareMarketService(this.ctx);
    this.highway = new HighwayService(this.ctx);
    this.drag = new DragService(this.ctx);
    this.driving = new DrivingService(this.ctx);
    this.missions = new MissionService(this.ctx);
    this.rewards = new RewardService(this.ctx);
    this.police = new PoliceService(this.ctx, this.vehicles);
    this.theft = new TheftService(this.ctx, this.police, this.vehicles);
    this.pursuit = new PursuitService(this.ctx, this.police);
    this.streetRace = new StreetRaceService(this.ctx, this.police);
    this.combat = new CombatService(this.ctx, this.police, this.theft, this.customers, this.vehicles);
    this.moto = new MotoService(this.ctx, this.combat, this.vehicles);
    this.hitman = new HitmanService(this.ctx, this.combat, this.police);
    this.theft.theftListeners.push((pid, vehicleId) => this.pursuit.start(pid, vehicleId, 'lockpick'));
    // Near misses feed the wanted level and the missions; distance and escapes feed missions.
    this.highway.listeners.push((pid, e) => {
      this.police.onNearMiss(pid, e.kmh);
      this.missions.onNearMiss(pid, { kmh: e.kmh, combo: this.highway.comboOf(pid)?.count ?? 0 });
    });
    this.driving.listeners.push((pid, metres) => this.missions.onDistance(pid, metres));
    this.police.escapeListeners.push((pid) => this.missions.onEscape(pid));
    state.onCommit = (r) => this.onCommit(r);

    this.handlers = {
      'market.list': () => this.market.list(),
      'market.buy': (pid, p) => this.market.buy(pid, p),
      'market.negotiate': (pid, p) => this.market.negotiate(pid, p),
      'market.offer': (pid, p) => this.market.offer(pid, p),
      'market.buyPlayer': (pid, p) => this.market.buyFromPlayer(pid, p),
      'vehicle.list': (pid, p) => this.vehicles.listClassifieds(pid, p),
      'vehicle.unlist': (pid, p) => this.vehicles.unlist(pid, p),
      'vehicle.quickSell': (pid, p) => this.vehicles.quickSell(pid, p),
      'vehicle.spawn': (pid, p) => this.vehicles.spawn(pid, p),
      'vehicle.store': (pid, p) => this.vehicles.store(pid, p),
      'vehicle.enter': (pid, p) => this.vehicles.enter(pid, p),
      'vehicle.exit': (pid) => this.vehicles.exit(pid),
      'vehicle.ride': (pid, p) => this.vehicles.ride(pid, p),
      'vehicle.nitro': (pid) => this.vehicles.nitro(pid),
      'vehicle.air': (pid, p) => this.vehicles.air(pid, p),
      'vehicle.plate': (pid, p) => this.vehicles.plate(pid, p),
      'dealership.buy': (pid, p) => this.dealership.buy(pid, p),
      'dealership.upgrade': (pid) => this.dealership.upgrade(pid),
      'dealership.rename': (pid, p) => this.dealership.rename(pid, p),
      'dealership.place': (pid, p) => this.dealership.place(pid, p),
      'dealership.remove': (pid, p) => this.dealership.remove(pid, p),
      'dealership.price': (pid, p) => this.dealership.setPrice(pid, p),
      'repair.start': (pid, p) => this.garage.repair(pid, p),
      'wash.start': (pid, p) => this.garage.wash(pid, p),
      'fuel.refill': (pid, p) => this.garage.refuel(pid, p),
      'custom.apply': (pid, p) => this.garage.customize(pid, p),
      'tuning.apply': (pid, p) => this.tuning.apply(pid, p),
      'rare.list': () => this.rare.list(),
      'rare.buy': (pid, p) => this.rare.buy(pid, p),
      'parts.buy': (pid, p) => this.garage.buyParts(pid, p),
      'drag.info': () => this.drag.info(),
      'drag.join': (pid, p) => this.drag.join(pid, p),
      'drag.leave': (pid) => this.drag.leave(pid),
      'blackmarket.info': (pid) => this.theft.info(pid),
      'blackmarket.buy': (pid) => this.theft.buy(pid),
      'street.list': () => this.theft.list(),
      'lockpick.start': (pid, p) => this.theft.start(pid, p),
      'lockpick.try': (pid, p) => this.theft.tryPick(pid, p),
      'lockpick.cancel': (pid, p) => this.theft.cancel(pid, p),
      'sanayi.lift': (pid, p) => this.theft.lift(pid, p),
      'sanayi.strip': (pid, p) => this.theft.strip(pid, p),
      'sanayi.papers': (pid, p) => this.theft.papers(pid, p),
      'ammu.buy': (pid, p) => this.combat.buy(pid, p),
      'hospital.heal': (pid) => this.combat.heal(pid),
      'weapon.equip': (pid, p) => this.combat.equip(pid, p),
      'combat.health': (pid) => this.combat.healthView(pid),
      'hitman.take': (pid) => this.hitman.take(pid),
      'hitman.info': (pid) => ({ contract: this.hitman.current(pid) }),
      'hitman.drop': (pid) => (this.hitman.drop(pid), { ok: true as const }),
      'helmet.buy': (pid, p) => this.moto.buy(pid, p),
      'helmet.wear': (pid, p) => this.moto.wear(pid, p),
      'race.info': () => ({ race: this.streetRace.view() }),
      'race.join': async (pid) => ({ race: await this.streetRace.join(pid) }),
      'race.leave': (pid) => (this.streetRace.leave(pid), { ok: true as const }),
      'pawn.sell': (pid, p) => this.theft.sell(pid, p),
      'missions.list': (pid) => this.missions.list(pid),
      'rewards.info': (pid) => this.rewards.view(pid),
      'rewards.daily': (pid) => this.rewards.claimDaily(pid),
      'rewards.playtime': (pid, p) => this.rewards.claimPlaytime(pid, p),
      'missions.start': (pid, p) => this.missions.start(pid, p),
      'bank.deposit': (pid, p) => this.bank.deposit(pid, p),
      'bank.withdraw': (pid, p) => this.bank.withdraw(pid, p),
      'auction.list': () => ({ auctions: this.auctions.list() }),
      'auction.create': (pid, p) => this.auctions.create(pid, p),
      'auction.bid': (pid, p) => this.auctions.bid(pid, p),
      'chat.send': (pid, p) => this.chat.send(pid, p),
      'offer.respond': (pid, p) => this.customers.respond(pid, p),
      'settings.save': (pid, p) => this.saveSettings(pid, p),
      'appearance.save': (pid, p) => this.saveAppearance(pid, p),
      leaderboard: () => ({ entries: this.leaderboard() }),
      transactions: async (pid) => ({ transactions: await repo.recentTransactions(this.state.db, pid, 50) }),
    };
  }

  // ------------------------------------------------------------ Hub

  isOnline(playerId: string): boolean {
    return this.sessions.has(playerId);
  }

  sendTo<E extends keyof ServerToClientEvents>(playerId: string, event: E, ...args: Parameters<ServerToClientEvents[E]>): void {
    const s = this.sessions.get(playerId);
    if (s) (s.socket.emit as (e: string, ...a: unknown[]) => void)(event, ...args);
  }

  broadcast<E extends keyof ServerToClientEvents>(event: E, ...args: Parameters<ServerToClientEvents[E]>): void {
    (this.io.emit as (e: string, ...a: unknown[]) => void)(event, ...args);
  }

  notify(playerId: string, n: Notification): void {
    this.sendTo(playerId, 'notify', n);
  }

  systemChat(text: string): void {
    this.broadcast('chat', this.chat.system(text));
  }

  /** Client IP for per-IP limits; same rules as the HTTP API (see http/clientIp.ts). */
  private clientIp(socket: Socket): string {
    if (this.cfg.trustProxy) return resolveClientIp(socket.handshake.headers['x-forwarded-for'], socket.handshake.address);
    return normalizeIp(socket.handshake.address);
  }

  // ------------------------------------------------------------ lifecycle

  async start(): Promise<void> {
    this.io.use((socket, next) => {
      const ip = this.clientIp(socket);
      // Handshake rate limit per IP (reconnect spam would otherwise reset per-connection limits).
      if (!this.handshakeLimiter.take(ip)) return next(new Error('too many connection attempts'));
      const token = (socket.handshake.auth as Record<string, unknown> | undefined)?.token;
      this.auth
        .verify(token)
        .then((playerId) => {
          if (!playerId || !this.state.players.has(playerId)) return next(new Error('unauthorized'));
          if ((this.ipCounts.get(ip) ?? 0) >= 12) return next(new Error('too many connections'));
          // Reserve the slot now so parallel handshakes can't all pass the check.
          this.ipCounts.set(ip, (this.ipCounts.get(ip) ?? 0) + 1);
          socket.data.playerId = playerId;
          socket.data.ip = ip;
          next();
        })
        .catch((err) => {
          log.error('auth middleware failed', { error: (err as Error).message });
          next(new Error('server error'));
        });
    });
    this.io.on('connection', (socket) => {
      const ip = (socket as GameSocket).data.ip;
      socket.once('disconnect', () => {
        const count = (this.ipCounts.get(ip) ?? 1) - 1;
        if (count <= 0) this.ipCounts.delete(ip);
        else this.ipCounts.set(ip, count);
      });
      // Serialize connection setup per player so two simultaneous logins can't both register.
      const pid = (socket as GameSocket).data.playerId;
      this.locks.run([`conn:${pid}`], () => this.onConnection(socket as GameSocket)).catch((err) => {
        log.error('connection setup failed', { error: (err as Error).message });
        socket.disconnect(true);
      });
    });

    await this.rare.init();
    await this.theft.init();
    if (this.cfg.simulation) {
      await this.market.refresh().catch((err) => log.error('initial market refresh failed', { error: (err as Error).message }));
    }
    const tickMs = Math.round(1000 / this.cfg.tickRate);
    this.every(tickMs, () => this.tick());
    this.every(1000, () => this.slowTick());
    if (this.cfg.simulation) {
      this.every(ECONOMY.marketplace.refreshIntervalSec * 1000, () => this.market.refresh());
      this.every(ECONOMY.demand.updateIntervalSec * 1000, () => this.trends.update());
      this.every(60_000, () => this.payInterest());
    }
    this.every(this.cfg.autosaveSeconds * 1000, () => this.autosave());
    this.every(3600_000, () => repo.purgeExpiredSessions(this.state.db, Date.now()));
    log.info('game server started', { tickRate: this.cfg.tickRate });
  }

  private every(ms: number, fn: () => unknown): void {
    let running = false;
    const t = setInterval(() => {
      if (running || this.stopping) return;
      running = true;
      Promise.resolve()
        .then(fn)
        .catch((err) => log.error('timer task failed', { error: (err as Error).message }))
        .finally(() => (running = false));
    }, ms);
    this.timers.push(t);
  }

  async stop(): Promise<void> {
    this.stopping = true;
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
    this.garage.dispose();
    this.tuning.dispose();
    await this.autosave();
    for (const s of this.sessions.values()) s.socket.disconnect(true);
    log.info('game server stopped');
  }

  // ------------------------------------------------------------ connections

  private async onConnection(socket: GameSocket): Promise<void> {
    if (!socket.connected) return; // disconnected while waiting for the connection lock
    const playerId = socket.data.playerId;
    const existing = this.sessions.get(playerId);
    if (existing) {
      existing.socket.emit('kicked', 'You logged in from another window.');
      await this.cleanupSession(existing);
      existing.socket.disconnect(true);
    }
    if (!socket.connected) return; // dropped while the previous session was cleaned up
    const record = this.state.players.get(playerId)!;
    // RPC limits are per player (not per socket) so reconnecting does not grant a fresh burst.
    let rpcBucket = this.rpcBuckets.get(playerId);
    if (!rpcBucket) this.rpcBuckets.set(playerId, (rpcBucket = new TokenBucket(30, 12)));
    const session: Session = {
      playerId,
      socket,
      rpcBucket,
      inputBucket: new TokenBucket(60, 40),
      recent: new Map(),
      connectedAt: Date.now(),
    };
    this.sessions.set(playerId, session);

    // Place the character where they left (pushed out of any new buildings).
    const pos = resolveCircle(record.posX, record.posZ, CHAR_RADIUS, this.sim.collisionWorld);
    let { x, z } = pos;
    if (!Number.isFinite(x) || !Number.isFinite(z)) ({ x, z } = spawnPoint(hashString(playerId)));
    this.sim.addPlayer(playerId, x, z, record.rot);

    socket.on('input', (cmds) => {
      if (!session.inputBucket.take()) return;
      this.sim.handleInputs(playerId, cmds);
    });
    socket.on('fire', (shot) => {
      if (!session.inputBucket.take()) return;
      try {
        this.combat.fire(playerId, shot);
      } catch (err) {
        log.error('fire failed', { playerId, error: (err as Error).message });
      }
    });
    socket.on('rpc', (req, ack) => {
      if (typeof ack !== 'function') return;
      this.handleRpc(session, req).then(ack, () => ack({ ok: false, error: 'Server error', code: 'server_error' }));
    });
    socket.on('disconnect', (reason) => {
      if (this.sessions.get(playerId) !== session) return;
      this.cleanupSession(session).catch((err) => log.error('cleanup failed', { error: (err as Error).message }));
      log.info('player disconnected', { playerId, reason });
    });

    socket.emit('welcome', { playerId, self: this.privateState(playerId), world: this.worldInit(), protocol: PROTOCOL_VERSION });
    this.broadcast('player.upsert', this.publicPlayer(playerId));
    await this.missions.load(playerId);
    await this.rewards.load(playerId);
    this.combat.welcome(playerId);
    for (const m of this.chat.history) socket.emit('chat', m);
    log.info('player connected', { playerId, name: record.name, online: this.sessions.size });

    // Deliver notices collected while offline, then catch up on bank interest.
    const notices = await repo.takeNotices(this.state.db, playerId);
    if (notices.length > 0) {
      socket.emit('notify', { kind: 'info', title: 'While you were away', text: `${notices.length} thing(s) happened at your business.` });
      for (const n of notices.slice(-10)) socket.emit('notify', { kind: n.kind as Notification['kind'], title: n.title, text: n.text });
    }
    await this.bank.payInterest(playerId, 24);
  }

  private async cleanupSession(session: Session): Promise<void> {
    const { playerId } = session;
    if (this.sessions.get(playerId) === session) this.sessions.delete(playerId);
    this.highway.forget(playerId);
    this.drag.forget(playerId);
    this.driving.forget(playerId);
    this.police.forget(playerId);
    this.theft.forget(playerId);
    this.pursuit.forget(playerId);
    this.streetRace.forget(playerId);
    this.combat.forget(playerId);
    await this.missions.forget(playerId);
    await this.rewards.forget(playerId);
    const c = this.sim.chars.get(playerId);
    if (c?.drivingId) {
      const vehicleId = c.drivingId;
      await this.locks.run([K.player(playerId), K.vehicle(vehicleId)], async () => {
        await this.vehicles.flushDrive(vehicleId, true);
        this.sim.stopDriving(playerId);
      });
      const v = this.state.vehicles.get(vehicleId);
      if (v) this.broadcast('vehicle.upsert', this.state.toPublicVehicle(v));
    }
    const pos = this.sim.position(playerId);
    if (pos) await repo.savePlayerPosition(this.state.db, playerId, pos.x, pos.z, pos.rot, Date.now());
    const rec = this.state.players.get(playerId);
    if (rec && pos) {
      rec.posX = pos.x;
      rec.posZ = pos.z;
      rec.rot = pos.rot;
      rec.lastSeenAt = Date.now();
    }
    this.sim.removePlayer(playerId);
    this.broadcast('player.remove', playerId);
  }

  // ------------------------------------------------------------ RPC

  private async handleRpc(session: Session, req: RpcRequest): Promise<RpcResponse> {
    if (!req || typeof req !== 'object' || typeof req.method !== 'string' || typeof req.id !== 'string' || req.id.length > 64) {
      return { ok: false, error: 'Malformed request.', code: 'bad_request' };
    }
    const cached = session.recent.get(req.id);
    if (cached) return cached;
    if (!session.rpcBucket.take()) return { ok: false, error: 'Too many requests. Slow down.', code: 'rate_limited' };
    const handler = Object.prototype.hasOwnProperty.call(this.handlers, req.method) ? this.handlers[req.method as RpcName] : undefined;
    if (!handler) return { ok: false, error: 'Unknown action.', code: 'bad_request' };
    // Using a menu counts as playing (playtime rewards).
    const ch = this.ctx.sim.chars.get(session.playerId);
    if (ch && req.method !== 'rewards.info') ch.activeAt = Date.now();
    const run = (async (): Promise<RpcResponse> => {
      try {
        const result = await handler(session.playerId, req.params ?? {});
        return { ok: true, result } as RpcResponse;
      } catch (err) {
        if (err instanceof GameError) return { ok: false, error: err.message, code: err.code };
        log.error('rpc failed', { method: req.method, playerId: session.playerId, error: (err as Error).message });
        return { ok: false, error: 'Something went wrong. Please try again.', code: 'server_error' };
      } finally {
        this.flushSelf();
      }
    })();
    session.recent.set(req.id, run);
    if (session.recent.size > 64) session.recent.delete(session.recent.keys().next().value!);
    return run;
  }

  private saveSettings(playerId: string, params: unknown) {
    const s = val.obj(val.obj(params).settings);
    const settings: PlayerSettings = {
      masterVolume: val.num(s.masterVolume, 'volume', 0, 1),
      sfxVolume: val.num(s.sfxVolume, 'volume', 0, 1),
      ambientVolume: val.num(s.ambientVolume, 'volume', 0, 1),
      mouseSensitivity: val.num(s.mouseSensitivity, 'sensitivity', 0.1, 3),
      invertY: val.bool(s.invertY, 'invertY'),
      graphics: val.oneOf(s.graphics, 'graphics', ['low', 'medium', 'high'] as const),
      showNames: val.bool(s.showNames, 'showNames'),
    };
    return this.locks.run([K.player(playerId)], async () => {
      const uow = this.state.begin();
      uow.player(playerId).settings = settings;
      await uow.commit();
      return { settings };
    });
  }

  private saveAppearance(playerId: string, params: unknown) {
    const a = val.obj(val.obj(params).appearance);
    const appearance: Appearance = {
      skin: val.oneOf(a.skin, 'skin', APPEARANCE_OPTIONS.skin),
      shirt: val.oneOf(a.shirt, 'shirt', APPEARANCE_OPTIONS.shirt),
      pants: val.oneOf(a.pants, 'pants', APPEARANCE_OPTIONS.pants),
      hair: val.oneOf(a.hair, 'hair', APPEARANCE_OPTIONS.hair),
    };
    return this.locks.run([K.player(playerId)], async () => {
      const uow = this.state.begin();
      const player = uow.player(playerId);
      // The helmet stays as it is (changed at Moto Gear).
      player.appearance = { ...appearance, helmet: player.appearance.helmet ?? null, visor: player.appearance.visor ?? null, helmetColor: player.appearance.helmetColor ?? null };
      await uow.commit();
      return { appearance: this.state.players.get(playerId)!.appearance };
    });
  }

  /** Top-20 by net worth. Expensive (all players x vehicles), so it is cached for 15 s. */
  leaderboard(): LeaderboardEntry[] {
    const now = Date.now();
    if (this.leaderboardCache && now - this.leaderboardCache.at < 15_000) return this.leaderboardCache.entries;
    const entries: LeaderboardEntry[] = [];
    for (const p of this.state.players.values()) {
      entries.push({ id: p.id, name: p.name, level: p.level, netWorth: this.state.netWorth(p.id), vehiclesSold: p.stats.vehiclesSold ?? 0 });
    }
    const top = entries.sort((a, b) => b.netWorth - a.netWorth).slice(0, 20);
    this.leaderboardCache = { at: now, entries: top };
    return top;
  }

  // ------------------------------------------------------------ state views

  privateState(playerId: string): PrivateState {
    const p = this.state.players.get(playerId)!;
    const { passwordHash: _ph, nameLower: _nl, posX: _x, posZ: _z, rot: _r, lastInterestAt: _li, lastSeenAt: _ls, ...priv } = p;
    return { player: priv, vehicles: this.state.vehiclesOf(playerId), driving: this.sim.chars.get(playerId)?.drivingId ?? null };
  }

  publicPlayer(playerId: string): PlayerPublic {
    const p = this.state.players.get(playerId)!;
    return { id: p.id, name: p.name, level: p.level, appearance: p.appearance, dealershipPlotId: p.dealershipPlotId, online: this.isOnline(p.id) };
  }

  worldInit(): WorldInit {
    const vehicles = [];
    for (const v of this.state.vehicles.values()) if (isPublicVehicle(v)) vehicles.push(this.state.toPublicVehicle(v));
    return {
      serverTime: Date.now(),
      tickRate: this.cfg.tickRate,
      players: [...this.sessions.keys()].map((id) => this.publicPlayer(id)),
      vehicles,
      dealerships: [...this.state.dealerships.values()],
      marketListings: this.market.npcListings(),
      trends: this.state.trends,
    };
  }

  // ------------------------------------------------------------ change propagation

  private onCommit(r: CommitResult): void {
    for (const id of r.players) this.selfDirty.add(id);
    for (const id of r.publicPlayers) if (this.isOnline(id)) this.broadcast('player.upsert', this.publicPlayer(id));
    for (const ch of r.vehicles) {
      if (ch.after && isPublicVehicle(ch.after)) this.broadcast('vehicle.upsert', this.state.toPublicVehicle(ch.after));
      else if (isPublicVehicle(ch.before)) this.broadcast('vehicle.remove', ch.id);
    }
    for (const d of r.dealerships) this.broadcast('dealership.upsert', d);
    if (r.listingsChanged) this.broadcast('market.update', { listings: this.market.npcListings() });
    if (r.playerListingsChanged) this.broadcast('listings.changed');
    for (const a of r.auctions) {
      const pub = this.auctions.toPublic(a) ?? {
        id: a.id,
        vehicle: null as never,
        sellerId: a.sellerId,
        sellerName: a.sellerName,
        startingBid: a.startingBid,
        currentBid: a.currentBid,
        currentBidderId: a.currentBidderId,
        currentBidderName: a.currentBidderName,
        bidCount: a.bidCount,
        endsAt: a.endsAt,
        status: a.status,
      };
      this.broadcast('auction.update', pub);
    }
    for (const { playerId, n } of r.notifications) this.notify(playerId, n);
    if (r.transactions.length > 0) this.missions.onTransactions(r.transactions);
    // Self updates are flushed right after the current RPC or tick.
    queueMicrotask(() => this.flushSelf());
  }

  private flushSelf(): void {
    if (this.selfDirty.size === 0) return;
    const ids = [...this.selfDirty];
    this.selfDirty.clear();
    for (const id of ids) if (this.isOnline(id)) this.sendTo(id, 'self', this.privateState(id));
  }

  // ------------------------------------------------------------ ticks

  private tick(): void {
    const now = Date.now();
    const dt = Math.min(0.25, (now - this.lastTick) / 1000);
    this.lastTick = now;
    this.customers.tickMovement(dt);
    this.sim.rebuildDynamic();
    if (this.sessions.size === 0) return;
    this.tickCount++;
    // Snapshots go out first: socket events emitted earlier in the same tick would make the
    // (volatile) snapshot get dropped while the transport is still busy.
    const lists = this.sim.buildSnapshotLists();
    const dr = this.drag.botSnapshot();
    const sr = this.streetRace.botSnapshot();
    for (const s of this.sessions.values()) {
      const c = this.sim.chars.get(s.playerId);
      if (!c) continue;
      const d = c.drivingId ? this.sim.drives.get(c.drivingId) : undefined;
      // Highway traffic rides along: close cars 10x a second, the rest in view twice a second.
      const wide = this.tickCount % 10 === 0;
      const tr = wide || this.tickCount % 2 === 0 ? this.sim.traffic.snapshot(c.x, c.z, wide ? 330 : 150) : [];
      const nearStrip = !!dr && Math.hypot(c.x - DRAG_STRIP.stage.x, c.z - DRAG_STRIP.stage.z) < 380;
      const nearRace = !!sr && sr.cars.some((b) => Math.hypot(c.x - b[1], c.z - b[2]) < 320);
      const po = this.police.active ? this.police.snapshot(c.x, c.z, 320) : [];
      const sp = this.police.active ? this.police.spikeSnapshot(c.x, c.z, 300) : [];
      const ph = this.police.active ? this.police.heliSnapshot(c.x, c.z, 450) : [];
      s.socket.volatile.emit('snapshot', {
        t: now,
        ack: c.lastSeq,
        p: lists.p,
        v: lists.v,
        n: lists.n,
        self: c.ridingId ? [c.x, c.z, c.rot, null, null, c.ridingId, c.seat] : [c.x, c.z, d ? d.dyn.rot : c.rot, c.drivingId, d ? dynToTuple(d.dyn) : null],
        ...(tr.length > 0 ? { tr } : {}),
        ...(nearStrip ? { dr: dr! } : {}),
        ...(nearRace ? { sr: sr! } : {}),
        ...(po.length > 0 ? { po } : {}),
        ...(sp.length > 0 ? { sp } : {}),
        ...(ph.length > 0 ? { ph } : {}),
      });
    }
    // Game logic that may send events (near misses, drag lights) runs after the snapshots.
    this.sim.stepTraffic(dt);
    this.highway.tick(now);
    this.drag.tick(dt);
    this.police.tick(dt, now);
    this.pursuit.tick(dt, now);
    this.streetRace.tick(dt, now);
    this.combat.tick(dt, now);
    this.hitman.tick(now);
    this.missions.tickFast(dt);
  }

  private async slowTick(): Promise<void> {
    this.rare.tick();
    await this.highway.flush();
    await this.driving.tick();
    await this.missions.tick();
    await this.rewards.tick();
    await this.theft.tick();
    if (this.cfg.simulation) {
      await this.customers.tick();
      await this.auctions.tick();
    }
    // Periodically persist driving so fuel/mileage stay current for the HUD.
    const now = Date.now();
    for (const d of [...this.sim.drives.values()]) {
      if (now - d.lastFlushAt < 3000 || d.pendingDistance < 1) continue;
      await this.locks.run([K.player(d.playerId), K.vehicle(d.vehicleId)], () => this.vehicles.flushDrive(d.vehicleId, true));
    }
    this.flushSelf();
  }

  private async payInterest(): Promise<void> {
    for (const id of this.sessions.keys()) await this.bank.payInterest(id, 1);
    this.flushSelf();
  }

  async autosave(): Promise<void> {
    const now = Date.now();
    for (const d of [...this.sim.drives.values()]) {
      await this.locks
        .run([K.player(d.playerId), K.vehicle(d.vehicleId)], () => this.vehicles.flushDrive(d.vehicleId, true))
        .catch((err) => log.error('autosave drive failed', { error: (err as Error).message }));
    }
    let saved = 0;
    for (const id of this.sessions.keys()) {
      const pos = this.sim.position(id);
      if (!pos) continue;
      try {
        await repo.savePlayerPosition(this.state.db, id, pos.x, pos.z, pos.rot, now);
        const rec = this.state.players.get(id);
        if (rec) Object.assign(rec, { posX: pos.x, posZ: pos.z, rot: pos.rot, lastSeenAt: now });
        saved++;
      } catch (err) {
        log.error('autosave position failed', { playerId: id, error: (err as Error).message });
      }
    }
    if (saved > 0) log.debug('autosave complete', { players: saved });
  }

  get onlineCount(): number {
    return this.sessions.size;
  }

  /** Disconnect a player's live socket (e.g. after logout). */
  kick(playerId: string, reason: string): void {
    const s = this.sessions.get(playerId);
    if (!s) return;
    s.socket.emit('kicked', reason);
    s.socket.disconnect(true);
  }
}
