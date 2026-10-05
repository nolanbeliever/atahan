import { describe, expect, it } from 'vitest';
import { KeyedMutex } from '../../server/locks';
import { TokenBucket } from '../../server/rateLimit';
import { convertPlaceholders } from '../../server/db/sqlite';
import * as val from '../../server/validate';
import { hashPassword, hashToken, verifyPassword } from '../../server/auth';
import { sanitizeText, validatePlayerName } from '../../shared/protocol';
import { normalizeIp, resolveClientIp } from '../../server/http/clientIp';
import { loadConfig } from '../../server/config';
import { openDatabase } from '../../server/db';

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

describe('client IP behind proxies', () => {
  const lb = '10.0.3.7';
  const cf = '172.70.1.2'; // Cloudflare edge
  it('uses the address the proxy appended, never client-supplied entries to its left', () => {
    expect(resolveClientIp('203.0.113.9', lb)).toBe('203.0.113.9');
    expect(resolveClientIp('6.6.6.6, 203.0.113.9', lb)).toBe('203.0.113.9');
    expect(resolveClientIp(['6.6.6.6', '203.0.113.9'], lb)).toBe('203.0.113.9');
  });
  it('skips internal load balancers and one Cloudflare edge (Render)', () => {
    expect(resolveClientIp(`203.0.113.9, ${cf}`, lb)).toBe('203.0.113.9');
    expect(resolveClientIp(`6.6.6.6, 203.0.113.9, ${cf}, 10.1.2.3`, lb)).toBe('203.0.113.9');
    expect(resolveClientIp('2001:db8::1, 2606:4700::1111', lb)).toBe('2001:db8::1');
  });
  it('does not walk past a second Cloudflare hop (requests relayed through a Worker)', () => {
    expect(resolveClientIp(`6.6.6.6, 104.16.5.5, ${cf}`, lb)).toBe('104.16.5.5');
  });
  it('falls back sensibly and normalizes IPv4-mapped addresses', () => {
    expect(resolveClientIp(undefined, '::ffff:198.51.100.4')).toBe('198.51.100.4');
    expect(resolveClientIp('', lb)).toBe(lb);
    expect(resolveClientIp('192.168.1.20', '127.0.0.1')).toBe('192.168.1.20');
    expect(normalizeIp(' ::ffff:1.2.3.4 ')).toBe('1.2.3.4');
    expect(normalizeIp('x'.repeat(200))).toHaveLength(64);
  });
});

describe('hosting defaults', () => {
  const saved = { RENDER: process.env.RENDER, TRUST_PROXY: process.env.TRUST_PROXY };
  const restore = () => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  };
  it('trusts the proxy and requires Postgres on Render, unless overridden', async () => {
    try {
      delete process.env.TRUST_PROXY;
      process.env.RENDER = 'true';
      const cfg = loadConfig({ databaseUrl: '' });
      expect(cfg.trustProxy).toBe(true);
      expect(cfg.requireDatabaseUrl).toBe(true);
      await expect(openDatabase(cfg)).rejects.toThrow(/DATABASE_URL is not set/);
      process.env.TRUST_PROXY = 'false';
      expect(loadConfig().trustProxy).toBe(false);
      delete process.env.RENDER;
      delete process.env.TRUST_PROXY;
      expect(loadConfig().trustProxy).toBe(false);
      expect(loadConfig().requireDatabaseUrl).toBe(false);
    } finally {
      restore();
    }
  });
});
