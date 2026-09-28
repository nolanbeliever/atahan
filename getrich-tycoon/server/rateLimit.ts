// Token bucket rate limiter.

export class TokenBucket {
  private tokens: number;
  private last: number;

  constructor(
    private readonly capacity: number,
    private readonly refillPerSec: number,
    now = Date.now(),
  ) {
    this.tokens = capacity;
    this.last = now;
  }

  take(cost = 1, now = Date.now()): boolean {
    this.tokens = Math.min(this.capacity, this.tokens + ((now - this.last) / 1000) * this.refillPerSec);
    this.last = now;
    if (this.tokens < cost) return false;
    this.tokens -= cost;
    return true;
  }
}

/** Per-key buckets (e.g. per IP) with periodic cleanup. */
export class KeyedRateLimiter {
  private buckets = new Map<string, TokenBucket>();
  private lastSweep = Date.now();

  constructor(
    private readonly capacity: number,
    private readonly refillPerSec: number,
  ) {}

  take(key: string, cost = 1): boolean {
    const now = Date.now();
    if (now - this.lastSweep > 60_000) {
      this.buckets.clear();
      this.lastSweep = now;
    }
    let b = this.buckets.get(key);
    if (!b) {
      b = new TokenBucket(this.capacity, this.refillPerSec, now);
      this.buckets.set(key, b);
    }
    return b.take(cost, now);
  }
}
