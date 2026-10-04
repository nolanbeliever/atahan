import type { Notification } from '../../shared/types';
import type { ServerToClientEvents } from '../../shared/protocol';
import type { KeyedMutex } from '../locks';
import type { Simulation } from './simulation';
import type { GameState } from './state';

/** Outbound messaging used by services. */
export interface Hub {
  isOnline(playerId: string): boolean;
  sendTo<E extends keyof ServerToClientEvents>(playerId: string, event: E, ...args: Parameters<ServerToClientEvents[E]>): void;
  broadcast<E extends keyof ServerToClientEvents>(event: E, ...args: Parameters<ServerToClientEvents[E]>): void;
  notify(playerId: string, n: Notification): void;
  systemChat(text: string): void;
}

export interface Ctx {
  state: GameState;
  locks: KeyedMutex;
  sim: Simulation;
  hub: Hub;
  rng: () => number;
}

export const K = {
  player: (id: string) => `p:${id}`,
  vehicle: (id: string) => `v:${id}`,
  listing: (id: string) => `l:${id}`,
  plot: (id: string) => `plot:${id}`,
  auction: (id: string) => `a:${id}`,
  offer: (id: string) => `o:${id}`,
};
