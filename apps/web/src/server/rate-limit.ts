import { SlidingWindowRateLimiter, type RateLimitRule } from '@enu/mcp-tools';
import { ko } from '@/i18n/ko';
import { HttpError } from './http';

const MIN = 60_000;
const HOUR = 60 * MIN;

/** Per-user budgets for REST writes and the reads someone could poll (one web process, like the MCP limits). */
export const REST_LIMITS = {
  /** Creating, editing or deleting pets, and changing pet visibility defaults. */
  petConfig: { max: 30, windowMs: HOUR },
  petMessageSend: { max: 20, windowMs: MIN },
  petMessageEdit: { max: 60, windowMs: MIN },
  petRead: { max: 60, windowMs: MIN },
  colleaguePetThread: { max: 120, windowMs: MIN },
  /** The work overview's feed and today's status (ADR 0007). */
  overviewRead: { max: 120, windowMs: MIN },
  pairingCodes: { max: 10, windowMs: HOUR },
  /** Unauthenticated pairing attempts: per client address, and for the whole server. */
  channelPairPerIp: { max: 10, windowMs: HOUR },
  channelPairGlobal: { max: 60, windowMs: HOUR },
  /** A parked long-poll answers at most every 25 s; a busy owner wakes it more often. */
  channelPoll: { max: 600, windowMs: HOUR },
  channelReply: { max: 120, windowMs: HOUR },
} satisfies Record<string, RateLimitRule>;
export type RestLimitName = keyof typeof REST_LIMITS;

const holder = globalThis as unknown as { __enuRestLimiter?: SlidingWindowRateLimiter };
const limiter = (holder.__enuRestLimiter ??= new SlidingWindowRateLimiter());

/** Admits one call or throws 429 with Retry-After. */
export function enforceRateLimit(userId: string, name: RestLimitName, nowMs = Date.now()): void {
  const d = limiter.consume(`${userId}:${name}`, REST_LIMITS[name], nowMs);
  if (!d.ok) {
    throw new HttpError(429, 'rate_limited', ko.errors.rateLimited, undefined, {
      'retry-after': String(d.retryAfterSeconds),
    });
  }
}

/** Tests only. */
export function resetRateLimits(): void {
  limiter.reset();
}
