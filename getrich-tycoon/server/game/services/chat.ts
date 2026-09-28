// Global / nearby chat with basic anti-spam.

import { CHAT_MAX, sanitizeText } from '../../../shared/protocol';
import type { ChatMessage } from '../../../shared/types';
import { GameError } from '../../errors';
import { newId } from '../../ids';
import { TokenBucket } from '../../rateLimit';
import * as val from '../../validate';
import type { Ctx } from '../context';

const NEARBY_RADIUS = 45;
const HISTORY = 40;

export class ChatService {
  private buckets = new Map<string, TokenBucket>();
  private lastText = new Map<string, { text: string; at: number }>();
  private mutedUntil = new Map<string, number>();
  readonly history: ChatMessage[] = [];

  constructor(private readonly ctx: Ctx) {}

  send(playerId: string, params: unknown): { ok: true } {
    const p = val.obj(params);
    const channel = val.oneOf(p.channel, 'channel', ['global', 'nearby'] as const);
    const text = sanitizeText(val.str(p.text, 'message', 2000), CHAT_MAX);
    if (!text) throw new GameError('bad_request', 'Message is empty.');
    const now = Date.now();
    const muted = this.mutedUntil.get(playerId) ?? 0;
    if (muted > now) throw new GameError('rate_limited', `You are sending messages too fast. Wait ${Math.ceil((muted - now) / 1000)}s.`);
    let bucket = this.buckets.get(playerId);
    if (!bucket) this.buckets.set(playerId, (bucket = new TokenBucket(5, 0.5)));
    if (!bucket.take()) {
      this.mutedUntil.set(playerId, now + 10_000);
      throw new GameError('rate_limited', 'Slow down! You are muted for 10 seconds.');
    }
    const last = this.lastText.get(playerId);
    if (last && last.text.toLowerCase() === text.toLowerCase() && now - last.at < 15_000) {
      throw new GameError('rate_limited', "Don't repeat the same message.");
    }
    this.lastText.set(playerId, { text, at: now });
    const player = this.ctx.state.players.get(playerId)!;
    const msg: ChatMessage = { id: newId('msg'), channel, fromId: playerId, fromName: player.name, text, at: now };
    if (channel === 'global') {
      this.push(msg);
      this.ctx.hub.broadcast('chat', msg);
    } else {
      const me = this.ctx.sim.position(playerId);
      if (!me) throw new GameError('conflict', 'You are not in the world.');
      for (const c of this.ctx.sim.chars.values()) {
        if (Math.hypot(c.x - me.x, c.z - me.z) <= NEARBY_RADIUS) this.ctx.hub.sendTo(c.id, 'chat', msg);
      }
    }
    return { ok: true };
  }

  system(text: string): ChatMessage {
    const msg: ChatMessage = { id: newId('msg'), channel: 'system', fromId: null, fromName: 'GetRich', text, at: Date.now() };
    this.push(msg);
    return msg;
  }

  private push(m: ChatMessage): void {
    this.history.push(m);
    if (this.history.length > HISTORY) this.history.shift();
  }

  forget(playerId: string): void {
    this.buckets.delete(playerId);
    this.lastText.delete(playerId);
  }
}
