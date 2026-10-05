// Server bootstrap, exported for tests (createServer) and used by index.ts.

import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { Server } from 'socket.io';
import type { ClientToServerEvents, ServerToClientEvents } from '../shared/protocol';
import { AuthService } from './auth';
import { loadConfig, type ServerConfig } from './config';
import { openDatabase, type Database } from './db';
import { GameServer, type SocketData } from './game/GameServer';
import { GameState } from './game/state';
import { createApp } from './http/app';
import { createLogger, setLogLevel } from './logger';

const log = createLogger('main');

export interface RunningServer {
  url: string;
  port: number;
  game: GameServer;
  db: Database;
  close(): Promise<void>;
}

export async function createServer(overrides: Partial<ServerConfig> = {}): Promise<RunningServer> {
  const cfg = loadConfig(overrides);
  setLogLevel(cfg.logLevel, cfg.env === 'test' && process.env.LOG_LEVEL === undefined);
  const db = await openDatabase(cfg);
  const state = new GameState(db);
  await state.load();
  const auth = new AuthService(db, state);

  let game: GameServer | null = null;
  const app = createApp(cfg, auth, {
    db: db.kind,
    online: () => game?.onlineCount ?? 0,
    onLogout: (playerId) => game?.kick(playerId, 'You logged out.'),
  });
  const httpServer = http.createServer(app);
  const io = new Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>(httpServer, {
    maxHttpBufferSize: 32 * 1024,
    pingInterval: 20_000,
    pingTimeout: 25_000,
    cors: cfg.corsOrigins.length ? { origin: cfg.corsOrigins, credentials: false } : undefined,
    serveClient: false,
  });
  game = new GameServer(io, state, auth, cfg);
  await game.start();

  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(cfg.port, cfg.host, () => resolve());
  });
  const port = (httpServer.address() as AddressInfo).port;
  const url = `http://localhost:${port}`;
  log.info('listening', { url, env: cfg.env, db: db.kind });

  let closed = false;
  return {
    url,
    port,
    game,
    db,
    async close() {
      if (closed) return;
      closed = true;
      await game!.stop();
      io.close();
      await new Promise<void>((r) => httpServer.close(() => r()));
      await db.close();
    },
  };
}
