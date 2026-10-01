// Test helpers: start a real game server and connect real Socket.IO clients.

import pg from 'pg';
import { io, type Socket } from 'socket.io-client';
import type { InputCmd } from '../../shared/physics';
import type {
  ClientToServerEvents,
  PrivateState,
  RpcName,
  RpcParams,
  RpcResponse,
  RpcResult,
  ServerToClientEvents,
} from '../../shared/protocol';
import { totalXpForLevel } from '../../shared/progression';
import type { Snapshot, WorldInit } from '../../shared/types';
import { createServer, type RunningServer } from '../../server/main';
import type { ServerConfig } from '../../server/config';

export const TEST_DB_URL = process.env.TEST_DATABASE_URL ?? '';

const TABLES = ['player_rewards', 'player_missions', 'notices', 'transactions', 'auctions', 'market_listings', 'dealerships', 'vehicles', 'sessions', 'players', 'world_state', 'schema_info'];

export async function resetPostgres(url = TEST_DB_URL): Promise<void> {
  if (!url) return;
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    for (const t of TABLES) await client.query(`DROP TABLE IF EXISTS ${t} CASCADE`);
  } finally {
    await client.end();
  }
}

/** Start a server on a random port. Uses Postgres when TEST_DATABASE_URL is set, else in-memory SQLite. */
export async function startServer(overrides: Partial<ServerConfig> = {}): Promise<RunningServer> {
  return createServer({
    port: 0,
    host: '127.0.0.1',
    env: 'test',
    databaseUrl: TEST_DB_URL,
    sqlitePath: ':memory:',
    authRatePerMinute: 10_000,
    registerPerHour: 100_000,
    registerGlobalPerHour: 100_000,
    ...overrides,
  });
}

let counter = 0;
export function uniqueName(prefix = 't'): string {
  counter++;
  return `${prefix}${Date.now().toString(36).slice(-5)}${counter}${Math.floor(Math.random() * 1000)}`.slice(0, 16);
}

export async function register(url: string, name = uniqueName(), password = 'secret123') {
  const res = await fetch(`${url}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, password }),
  });
  const body = (await res.json()) as { ok: boolean; token: string; playerId: string; name: string; error?: string };
  if (!body.ok) throw new Error(`register failed: ${body.error}`);
  return body;
}

type ClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export class TestClient {
  socket!: ClientSocket;
  playerId = '';
  self!: PrivateState;
  world!: WorldInit;
  lastSnapshot: Snapshot | null = null;
  events: { event: string; data: unknown }[] = [];
  private seq = 0;
  private reqId = 0;

  constructor(
    readonly url: string,
    readonly token: string,
  ) {}

  async connect(): Promise<this> {
    this.socket = io(this.url, { auth: { token: this.token }, transports: ['websocket'], reconnection: false, forceNew: true });
    this.socket.onAny((event: string, data: unknown) => {
      if (event !== 'snapshot') this.events.push({ event, data });
    });
    this.socket.on('snapshot', (s) => (this.lastSnapshot = s));
    this.socket.on('self', (s) => (this.self = s));
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('welcome timeout')), 10_000);
      this.socket.once('welcome', (w) => {
        clearTimeout(t);
        this.playerId = w.playerId;
        this.self = w.self;
        this.world = w.world;
        resolve();
      });
      this.socket.once('connect_error', (err) => {
        clearTimeout(t);
        reject(err);
      });
    });
    return this;
  }

  async rpcRaw<K extends RpcName>(method: K, params: RpcParams<K> | unknown, id?: string): Promise<RpcResponse<K>> {
    const reqId = id ?? `r${++this.reqId}_${Math.random().toString(36).slice(2, 8)}`;
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`rpc timeout ${method}`)), 15_000);
      this.socket.emit('rpc', { id: reqId, method, params: params as RpcParams<K> }, (res) => {
        clearTimeout(t);
        resolve(res as RpcResponse<K>);
      });
    });
  }

  async rpc<K extends RpcName>(method: K, params: RpcParams<K>): Promise<RpcResult<K>> {
    const res = await this.rpcRaw(method, params);
    if (!res.ok) throw new Error(`${method} failed: ${res.error} (${res.code})`);
    return res.result;
  }

  sendInputs(keys: number, count: number, yaw = 0, dt = 1 / 30): void {
    const cmds: InputCmd[] = [];
    for (let i = 0; i < count; i++) cmds.push({ seq: ++this.seq, dt, keys, yaw });
    for (let i = 0; i < cmds.length; i += 8) this.socket.emit('input', cmds.slice(i, i + 8));
  }

  async waitFor<T = unknown>(event: string, pred: (d: T) => boolean = () => true, timeout = 8000): Promise<T> {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const hit = this.events.find((e) => e.event === event && pred(e.data as T));
      if (hit) return hit.data as T;
      await sleep(25);
    }
    throw new Error(`timeout waiting for ${event}`);
  }

  async waitSnapshot(pred: (s: Snapshot) => boolean, timeout = 8000): Promise<Snapshot> {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      if (this.lastSnapshot && pred(this.lastSnapshot)) return this.lastSnapshot;
      await sleep(25);
    }
    throw new Error('timeout waiting for snapshot');
  }

  close(): void {
    this.socket?.disconnect();
  }
}

export async function connectNew(server: RunningServer, name?: string) {
  const reg = await register(server.url, name);
  const client = await new TestClient(server.url, reg.token).connect();
  return { client, reg };
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Test-only: set a player's cash directly through a unit of work (persisted). */
export async function setMoney(server: RunningServer, playerId: string, money: number): Promise<void> {
  const uow = server.game.state.begin();
  uow.player(playerId).money = money;
  await uow.commit();
}

export async function setLevel(server: RunningServer, playerId: string, level: number): Promise<void> {
  const uow = server.game.state.begin();
  const p = uow.player(playerId);
  p.level = level;
  p.xp = totalXpForLevel(level);
  await uow.commit();
}
