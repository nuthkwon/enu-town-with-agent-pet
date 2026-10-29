/**
 * Token bucket: holds up to `capacity` tokens and regains one every `refillMs`.
 * Time comes from the caller (monotonic ms) so tests can drive it deterministically.
 */
export class TokenBucket {
  private tokens: number;
  private updatedAt: number | null = null;

  constructor(
    readonly capacity: number,
    readonly refillMs: number,
  ) {
    this.tokens = capacity;
  }

  /** Takes one token when available. */
  take(nowMs: number): boolean {
    this.refill(nowMs);
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }
    return false;
  }

  available(nowMs: number): number {
    this.refill(nowMs);
    return Math.floor(this.tokens);
  }

  private refill(nowMs: number): void {
    if (this.updatedAt === null) {
      this.updatedAt = nowMs;
      return;
    }
    const elapsed = nowMs - this.updatedAt;
    if (elapsed <= 0) return;
    this.tokens = Math.min(this.capacity, this.tokens + elapsed / this.refillMs);
    this.updatedAt = nowMs;
  }
}

/** `count` events per `windowMs`, as a bucket that refills evenly over the window. */
export function perWindow(count: number, windowMs: number): TokenBucket {
  return new TokenBucket(count, windowMs / count);
}

/** One bucket per key (e.g. ping target), pruned lazily once full again. */
export class KeyedLimiter {
  private readonly buckets = new Map<string, TokenBucket>();

  constructor(private readonly make: () => TokenBucket) {}

  take(key: string, nowMs: number): boolean {
    let b = this.buckets.get(key);
    if (!b) {
      b = this.make();
      this.buckets.set(key, b);
    }
    const ok = b.take(nowMs);
    if (this.buckets.size > 64) {
      for (const [k, v] of this.buckets)
        if (k !== key && v.available(nowMs) >= v.capacity) this.buckets.delete(k);
    }
    return ok;
  }
}
