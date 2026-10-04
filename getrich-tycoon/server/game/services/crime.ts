// The underworld side of each player (shared/underworld.ts): dirty money from heists and dealing,
// kept in one JSON document per player (player_crime). Changes go through a unit of work so the
// dirty money and whatever it is traded for are written together.

import { crimeView, normalizeCrimeState, type CrimeState, type CrimeView } from '../../../shared/underworld';
import * as repo from '../../db/repo';
import { GameError } from '../../errors';
import { createLogger } from '../../logger';
import type { Ctx } from '../context';
import type { UnitOfWork } from '../state';

const log = createLogger('crime');

export class CrimeService {
  private states = new Map<string, CrimeState>();
  /** Drafts written by a unit of work, applied once it commits. */
  private pending = new Map<UnitOfWork, Map<string, CrimeState>>();

  constructor(private readonly ctx: Ctx) {}

  async load(playerId: string): Promise<void> {
    let raw: unknown = null;
    try {
      raw = await repo.loadCrime(this.ctx.state.db, playerId);
    } catch (err) {
      log.error('loading crime state failed', { playerId, error: (err as Error).message });
    }
    this.states.set(playerId, normalizeCrimeState(raw));
    this.send(playerId);
  }

  forget(playerId: string): void {
    this.states.delete(playerId);
  }

  /** A player's state (read-only). */
  get(playerId: string): Readonly<CrimeState> {
    const s = this.states.get(playerId);
    if (!s) throw new GameError('conflict', 'Still loading.');
    return s;
  }

  view(playerId: string): CrimeView {
    return crimeView(this.get(playerId));
  }

  send(playerId: string): void {
    const s = this.states.get(playerId);
    if (s) this.ctx.hub.sendTo(playerId, 'crime.update', crimeView(s));
  }

  /**
   * Change a player's state inside a unit of work: `fn` edits a copy, which is saved with the
   * transaction; call `applied(uow)` after the commit to make it live (and tell the player).
   */
  edit(uow: UnitOfWork, playerId: string, fn: (s: CrimeState) => void): CrimeState {
    let drafts = this.pending.get(uow);
    if (!drafts) this.pending.set(uow, (drafts = new Map()));
    const draft = drafts.get(playerId) ?? structuredClone(this.get(playerId));
    fn(draft);
    if (draft.dirty < 0) throw new GameError('insufficient_funds', 'Yeterli kara paran yok.');
    drafts.set(playerId, draft);
    uow.setCrimeState(playerId, draft);
    return draft;
  }

  /** Commit a unit of work that edited crime states, and make the edits live. */
  async commit(uow: UnitOfWork): Promise<void> {
    try {
      await uow.commit();
    } catch (err) {
      this.discard(uow);
      throw err;
    }
    this.applied(uow);
  }

  /** After a successful commit: the drafts become the live state. */
  applied(uow: UnitOfWork): void {
    const drafts = this.pending.get(uow);
    this.pending.delete(uow);
    if (!drafts) return;
    for (const [pid, s] of drafts) {
      if (!this.states.has(pid)) continue;
      this.states.set(pid, s);
      this.send(pid);
    }
  }

  /** A unit of work that failed: forget its drafts. */
  discard(uow: UnitOfWork): void {
    this.pending.delete(uow);
  }
}
