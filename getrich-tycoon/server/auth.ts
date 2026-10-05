// Accounts & sessions. Passwords are hashed with scrypt (node:crypto), session
// tokens are random and only their SHA-256 hash is stored in the database.

import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { ECONOMY } from '../shared/economy.config';
import { emptyStats } from '../shared/progression';
import { validatePassword, validatePlayerName } from '../shared/protocol';
import type { Appearance, PlayerSettings } from '../shared/types';
import { hashString, mulberry32, pick } from '../shared/util';
import { spawnPoint } from '../shared/world';
import type { Database } from './db';
import * as repo from './db/repo';
import { GameError } from './errors';
import { newId } from './ids';
import { createLogger } from './logger';
import type { PlayerRecord } from './game/records';
import type { GameState } from './game/state';

const log = createLogger('auth');
const scrypt = promisify(crypto.scrypt) as (pw: string, salt: Buffer, keylen: number, opts: crypto.ScryptOptions) => Promise<Buffer>;

// N=2^15, r=8 uses 32 MB per hash. (OWASP suggests 2^17 = 128 MB, which is too heavy for
// 512 MB free-tier instances under concurrent logins.) Old hashes keep their own parameters.
const SCRYPT = { N: 32768, r: 8, p: 1, keylen: 64 };
export const SESSION_TTL_MS = 30 * 24 * 3600 * 1000;

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, maxmem: 64 * 1024 * 1024 });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, n, r, p, saltB64, hashB64] = parts;
  const expected = Buffer.from(hashB64!, 'base64');
  const actual = await scrypt(password, Buffer.from(saltB64!, 'base64'), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    maxmem: 64 * 1024 * 1024,
  });
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

const SKINS = ['#f1c27d', '#e0ac69', '#c68642', '#8d5524', '#ffdbac', '#a5694f'];
const SHIRTS = ['#e63946', '#457b9d', '#2a9d8f', '#f4a261', '#8338ec', '#ffbe0b', '#06d6a0', '#ef476f', '#118ab2', '#073b4c'];
const PANTS = ['#1d3557', '#2b2d42', '#3d405b', '#495057', '#6c584c', '#264653'];
const HAIR = ['#1b1b1b', '#4a2c2a', '#8d5524', '#d4a373', '#e9c46a', '#7f5539', '#b5838d'];

export function defaultAppearance(seed: string): Appearance {
  const rng = mulberry32(hashString(seed));
  return { skin: pick(rng, SKINS), shirt: pick(rng, SHIRTS), pants: pick(rng, PANTS), hair: pick(rng, HAIR) };
}

export const APPEARANCE_OPTIONS = { skin: SKINS, shirt: SHIRTS, pants: PANTS, hair: HAIR };

export function defaultSettings(): PlayerSettings {
  return {
    masterVolume: 0.8,
    sfxVolume: 0.9,
    ambientVolume: 0.5,
    mouseSensitivity: 1,
    invertY: false,
    graphics: 'high',
    showNames: true,
  };
}

export class AuthService {
  constructor(
    private readonly db: Database,
    private readonly state: GameState,
  ) {}

  async register(name: unknown, password: unknown): Promise<{ token: string; playerId: string; name: string }> {
    const nameErr = validatePlayerName(name);
    if (nameErr) throw new GameError('bad_request', nameErr);
    const pwErr = validatePassword(password);
    if (pwErr) throw new GameError('bad_request', pwErr);
    const cleanName = (name as string).trim();
    const lower = cleanName.toLowerCase();
    if (this.state.playersByName.has(lower)) throw new GameError('conflict', 'That name is already taken.');
    const now = Date.now();
    const id = newId('pl');
    const spawn = spawnPoint(hashString(id));
    const record: PlayerRecord = {
      id,
      name: cleanName,
      nameLower: lower,
      passwordHash: await hashPassword(password as string),
      money: ECONOMY.player.startingMoney,
      bank: ECONOMY.player.startingBank,
      xp: 0,
      level: 1,
      reputation: ECONOMY.player.startingReputation,
      stats: emptyStats(),
      achievements: [],
      settings: defaultSettings(),
      inventory: {},
      appearance: defaultAppearance(id),
      dealershipPlotId: null,
      createdAt: now,
      posX: spawn.x,
      posZ: spawn.z,
      rot: spawn.rot,
      lastInterestAt: now,
      lastSeenAt: now,
    };
    // Re-check after the async hash (two concurrent registrations of one name).
    if (this.state.playersByName.has(lower)) throw new GameError('conflict', 'That name is already taken.');
    this.state.playersByName.set(lower, record);
    try {
      await repo.insertPlayer(this.db, record);
    } catch (err) {
      this.state.playersByName.delete(lower);
      if (/unique|duplicate/i.test((err as Error).message)) throw new GameError('conflict', 'That name is already taken.');
      throw err;
    }
    this.state.players.set(id, record);
    log.info('player registered', { playerId: id, name: cleanName });
    const token = await this.createSession(id);
    return { token, playerId: id, name: cleanName };
  }

  async login(name: unknown, password: unknown): Promise<{ token: string; playerId: string; name: string }> {
    if (typeof name !== 'string' || typeof password !== 'string') throw new GameError('bad_request', 'Name and password are required.');
    const record = this.state.playersByName.get(name.trim().toLowerCase());
    // Always spend the hashing time to avoid leaking which names exist.
    const ok = record ? await verifyPassword(password, record.passwordHash) : (await hashPassword(password), false);
    if (!record || !ok) throw new GameError('forbidden', 'Wrong name or password.');
    const token = await this.createSession(record.id);
    log.info('player logged in', { playerId: record.id });
    return { token, playerId: record.id, name: record.name };
  }

  async createSession(playerId: string): Promise<string> {
    const token = crypto.randomBytes(32).toString('base64url');
    const now = Date.now();
    await repo.insertSession(this.db, hashToken(token), playerId, now, now + SESSION_TTL_MS);
    return token;
  }

  async verify(token: unknown): Promise<string | null> {
    if (typeof token !== 'string' || token.length < 20 || token.length > 200) return null;
    return repo.findSession(this.db, hashToken(token), Date.now());
  }

  /** Delete the session; returns the player id so live sockets can be disconnected. */
  async logout(token: string): Promise<string | null> {
    const playerId = await this.verify(token);
    await repo.deleteSession(this.db, hashToken(token));
    return playerId;
  }
}
