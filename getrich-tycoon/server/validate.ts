// Strict validators for untrusted RPC parameters.

import { ECONOMY } from '../shared/economy.config';
import { GameError } from './errors';

export function obj(v: unknown): Record<string, unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new GameError('bad_request', 'Malformed request.');
  return v as Record<string, unknown>;
}

export function id(v: unknown, what = 'id'): string {
  if (typeof v !== 'string' || v.length < 1 || v.length > 64 || !/^[A-Za-z0-9_\-]+$/.test(v)) {
    throw new GameError('bad_request', `Invalid ${what}.`);
  }
  return v;
}

export function int(v: unknown, what: string, min: number, max: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || !Number.isInteger(v) || v < min || v > max) {
    throw new GameError('bad_request', `Invalid ${what}.`);
  }
  return v;
}

export function num(v: unknown, what: string, min: number, max: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) throw new GameError('bad_request', `Invalid ${what}.`);
  return v;
}

export function bool(v: unknown, what: string): boolean {
  if (typeof v !== 'boolean') throw new GameError('bad_request', `Invalid ${what}.`);
  return v;
}

export function str(v: unknown, what: string, maxLen: number): string {
  if (typeof v !== 'string' || v.length > maxLen) throw new GameError('bad_request', `Invalid ${what}.`);
  return v;
}

export function oneOf<T extends string>(v: unknown, what: string, values: readonly T[]): T {
  if (typeof v !== 'string' || !(values as readonly string[]).includes(v)) throw new GameError('bad_request', `Invalid ${what}.`);
  return v as T;
}

/** A player-set price: whole dollars within the global limits. */
export function price(v: unknown, what = 'price'): number {
  return int(v, what, ECONOMY.limits.minPrice, ECONOMY.limits.maxPrice);
}
