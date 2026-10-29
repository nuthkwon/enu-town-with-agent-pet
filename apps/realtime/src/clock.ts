/**
 * Wall clock used for business decisions (quiet hours, daily caps, nudge eligibility, bubble expiry).
 * Tests inject a controllable clock; rate limits and movement cadence use `monotonicMs()` instead.
 */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };

/** Milliseconds from a monotonic source (never jumps with wall-clock changes). */
export function monotonicMs(): number {
  return performance.now();
}
