import { describe, expect, it } from 'vitest';
import { SlidingWindowRateLimiter, TOOL_RATE_LIMITS, rateLimitKey } from '../src/index';

const HOUR = 60 * 60 * 1000;

describe('SlidingWindowRateLimiter', () => {
  it('admits up to max calls per window and reports when the next one is allowed', () => {
    const rl = new SlidingWindowRateLimiter();
    const rule = { max: 3, windowMs: HOUR };
    const t0 = 1_000_000;
    expect(rl.consume('u:a', rule, t0)).toEqual({ ok: true, remaining: 2 });
    expect(rl.consume('u:a', rule, t0 + 1000)).toEqual({ ok: true, remaining: 1 });
    expect(rl.consume('u:a', rule, t0 + 2000)).toEqual({ ok: true, remaining: 0 });
    // Oldest admitted call (t0) leaves the window at t0 + 1h.
    expect(rl.consume('u:a', rule, t0 + 10_000)).toEqual({ ok: false, retryAfterSeconds: 3590 });
    // Refused calls are not recorded.
    expect(rl.consume('u:a', rule, t0 + HOUR - 1)).toEqual({ ok: false, retryAfterSeconds: 1 });
    expect(rl.consume('u:a', rule, t0 + HOUR + 1)).toEqual({ ok: true, remaining: 0 });
  });

  it('keeps users and tools apart', () => {
    const rl = new SlidingWindowRateLimiter();
    const rule = { max: 1, windowMs: HOUR };
    expect(rl.consume(rateLimitKey('u1', 'post_work_log'), rule, 0).ok).toBe(true);
    expect(rl.consume(rateLimitKey('u1', 'post_work_log'), rule, 1).ok).toBe(false);
    expect(rl.consume(rateLimitKey('u2', 'post_work_log'), rule, 1).ok).toBe(true);
    expect(rl.consume(rateLimitKey('u1', 'upsert_todos'), rule, 1).ok).toBe(true);
  });

  it('forgets idle keys', () => {
    const rl = new SlidingWindowRateLimiter();
    const rule = { max: 5, windowMs: HOUR };
    rl.consume('a', rule, 0);
    rl.consume('b', rule, 0);
    expect(rl.size).toBe(2);
    rl.consume('c', rule, 2 * HOUR);
    expect(rl.size).toBe(1);
  });

  it('uses the documented hourly budgets', () => {
    expect(TOOL_RATE_LIMITS).toEqual({
      get_my_context: { max: 60, windowMs: HOUR },
      post_work_log: { max: 20, windowMs: HOUR },
      upsert_todos: { max: 20, windowMs: HOUR },
      post_pet_nudges: { max: 12, windowMs: HOUR },
      post_activity: { max: 20, windowMs: HOUR },
      post_pet_reply: { max: 30, windowMs: HOUR },
    });
  });
});
