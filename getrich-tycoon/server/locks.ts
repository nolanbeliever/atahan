// Keyed async mutex used for transaction locking. Multiple keys are always
// acquired in sorted order so two operations can never deadlock.

export class KeyedMutex {
  private tails = new Map<string, Promise<void>>();

  private async acquire(key: string): Promise<() => void> {
    const prev = this.tails.get(key) ?? Promise.resolve();
    let release!: () => void;
    const next = new Promise<void>((r) => (release = r));
    const tail = prev.then(() => next);
    this.tails.set(key, tail);
    await prev;
    return () => {
      release();
      if (this.tails.get(key) === tail) this.tails.delete(key);
    };
  }

  async run<T>(keys: string[], fn: () => Promise<T>): Promise<T> {
    const unique = [...new Set(keys)].sort();
    const releases: (() => void)[] = [];
    try {
      for (const k of unique) releases.push(await this.acquire(k));
      return await fn();
    } finally {
      for (const r of releases.reverse()) r();
    }
  }

  isLocked(key: string): boolean {
    return this.tails.has(key);
  }
}
