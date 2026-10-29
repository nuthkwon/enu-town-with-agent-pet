import { MCP_TOOL_NAMES, type McpToolName } from '@enu/shared';

export interface RateLimitRule {
  max: number;
  windowMs: number;
}

export type RateLimitDecision = { ok: true; remaining: number } | { ok: false; retryAfterSeconds: number };

export interface RateLimiter {
  /** Admits (and records) one call for `key`, or reports when the next call would be admitted. */
  consume(key: string, rule: RateLimitRule, nowMs: number): RateLimitDecision;
}

const HOUR_MS = 60 * 60 * 1000;

/** Per-user hourly budgets (reads are cheap; writes are what an unattended loop could spam). */
export const TOOL_RATE_LIMITS: Record<McpToolName, RateLimitRule> = {
  [MCP_TOOL_NAMES.getMyContext]: { max: 60, windowMs: HOUR_MS },
  [MCP_TOOL_NAMES.postWorkLog]: { max: 20, windowMs: HOUR_MS },
  [MCP_TOOL_NAMES.upsertTodos]: { max: 20, windowMs: HOUR_MS },
  [MCP_TOOL_NAMES.postPetNudges]: { max: 12, windowMs: HOUR_MS },
  [MCP_TOOL_NAMES.postActivity]: { max: 20, windowMs: HOUR_MS },
};

/**
 * In-memory sliding-window limiter (one process; good enough for 14 people behind one web
 * instance). Only admitted calls are recorded, so a rejected caller is told exactly when the
 * oldest admitted call leaves the window.
 */
export class SlidingWindowRateLimiter implements RateLimiter {
  private readonly hits = new Map<string, number[]>();
  private lastSweepMs = 0;
  private maxWindowMs = 0;

  constructor(private readonly maxKeys = 10_000) {}

  consume(key: string, rule: RateLimitRule, nowMs: number): RateLimitDecision {
    this.maxWindowMs = Math.max(this.maxWindowMs, rule.windowMs);
    this.sweep(nowMs);
    const cutoff = nowMs - rule.windowMs;
    const list = (this.hits.get(key) ?? []).filter((t) => t > cutoff);
    if (list.length >= rule.max) {
      this.hits.set(key, list);
      const oldest = Math.min(...list);
      const retryAfterMs = oldest + rule.windowMs - nowMs;
      return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)) };
    }
    list.push(nowMs);
    this.hits.set(key, list);
    return { ok: true, remaining: rule.max - list.length };
  }

  /** Number of tracked keys (for tests). */
  get size(): number {
    return this.hits.size;
  }

  reset(): void {
    this.hits.clear();
  }

  /** Drops keys whose newest hit left the window, at most once per minute or when too many keys exist. */
  private sweep(nowMs: number): void {
    if (nowMs - this.lastSweepMs < 60_000 && this.hits.size < this.maxKeys) return;
    this.lastSweepMs = nowMs;
    for (const [key, list] of this.hits) {
      const newest = list.length ? Math.max(...list) : -Infinity;
      if (newest <= nowMs - this.maxWindowMs) this.hits.delete(key);
    }
  }
}

export function rateLimitKey(userId: string, toolName: string): string {
  return `${userId}:${toolName}`;
}
