import { describe, expect, it } from 'vitest';
import { KeyedMutex } from '../../server/locks';
import { TokenBucket } from '../../server/rateLimit';
import { convertPlaceholders } from '../../server/db/sqlite';
import * as val from '../../server/validate';
import { hashPassword, hashToken, verifyPassword } from '../../server/auth';
import { sanitizeText, validatePlayerName } from '../../shared/protocol';

describe('KeyedMutex', () => {
  it('serializes operations on the same key and never deadlocks on overlapping key sets', async () => {
    const m = new KeyedMutex();
    const order: string[] = [];
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    await Promise.all([
      m.run(['a', 'b'], async () => {
        order.push('1s');
        await sleep(20);
        order.push('1e');
      }),
      m.run(['b', 'a'], async () => {
        order.push('2s');
        await sleep(5);
        order.push('2e');
      }),
      m.run(['c'], async () => {
        order.push('3');
      }),
    ]);
    expect(order.indexOf('1e')).toBeLessThan(order.indexOf('2s'));
    expect(order).toContain('3');
  });

  it('releases the lock when the operation throws', async () => {
    const m = new KeyedMutex();
    await expect(m.run(['x'], async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    expect(await m.run(['x'], async () => 42)).toBe(42);
  });
});

describe('rate limiting', () => {
  it('token bucket allows bursts and refills over time', () => {
    const b = new TokenBucket(3, 1, 0);
    expect([b.take(1, 0), b.take(1, 0), b.take(1, 0), b.take(1, 0)]).toEqual([true, true, true, false]);
    expect(b.take(1, 1500)).toBe(true);
  });
});

describe('database helpers', () => {
  it('converts $n placeholders for SQLite including repeats', () => {
    expect(convertPlaceholders('SELECT * FROM t WHERE a=$1 AND b=$2 OR c=$1', [1, 'x'])).toEqual({
      sql: 'SELECT * FROM t WHERE a=? AND b=? OR c=?',
      params: [1, 'x', 1],
    });
  });
});

describe('validation', () => {
  it('rejects malformed values', () => {
    expect(() => val.int(1.5, 'n', 0, 10)).toThrow();
    expect(() => val.int(-1, 'n', 0, 10)).toThrow();
    expect(() => val.int(Number.NaN, 'n', 0, 10)).toThrow();
    expect(() => val.id('../etc/passwd')).toThrow();
    expect(() => val.id('a'.repeat(100))).toThrow();
    expect(() => val.obj([])).toThrow();
    expect(() => val.price(0)).toThrow();
    expect(val.price(500)).toBe(500);
  });

  it('validates player names and sanitizes chat text', () => {
    expect(validatePlayerName('ok_name')).toBeNull();
    expect(validatePlayerName('a')).not.toBeNull();
    expect(validatePlayerName('bad name!')).not.toBeNull();
    expect(sanitizeText('  hi\u0000‮   there  ', 50)).toBe('hi there');
    expect(sanitizeText('x'.repeat(500), 200).length).toBe(200);
  });
});

describe('auth crypto', () => {
  it('hashes and verifies passwords with scrypt and hashes tokens', async () => {
    const h = await hashPassword('secret123');
    expect(h.startsWith('scrypt$')).toBe(true);
    expect(await verifyPassword('secret123', h)).toBe(true);
    expect(await verifyPassword('wrong', h)).toBe(false);
    expect(hashToken('abc')).toHaveLength(64);
    expect(hashToken('abc')).not.toBe('abc');
  });
});
