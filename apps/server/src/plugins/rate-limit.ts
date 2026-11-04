/** Tiny in-memory failure limiter (sliding window per key). Good enough for a single-process server. */
export class FailureLimiter {
  private hits = new Map<string, number[]>();
  constructor(private max: number, private windowMs: number) {}

  private prune(key: string, now: number): number[] {
    const list = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (list.length) this.hits.set(key, list); else this.hits.delete(key);
    return list;
  }
  isLimited(key: string, now = Date.now()): boolean { return this.prune(key, now).length >= this.max; }
  fail(key: string, now = Date.now()): void { const l = this.prune(key, now); l.push(now); this.hits.set(key, l); }
  reset(key: string): void { this.hits.delete(key); }
  /** Seconds until the oldest hit expires (for Retry-After). */
  retryAfter(key: string, now = Date.now()): number {
    const l = this.prune(key, now);
    return l.length ? Math.max(1, Math.ceil((this.windowMs - (now - l[0]!)) / 1000)) : 0;
  }
}
