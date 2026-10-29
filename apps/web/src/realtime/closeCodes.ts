import { CloseCodes } from '@enu/protocol';

/** Colyseus' own close codes (mirrors `CloseCode` from @colyseus/sdk without importing the SDK). */
export const SDK_CLOSE = {
  NORMAL_CLOSURE: 1000,
  GOING_AWAY: 1001,
  NO_STATUS_RECEIVED: 1005,
  ABNORMAL_CLOSURE: 1006,
  CONSENTED: 4000,
  SERVER_SHUTDOWN: 4001,
  WITH_ERROR: 4002,
  FAILED_TO_RECONNECT: 4003,
  MAY_TRY_RECONNECT: 4010,
} as const;

export type LeaveAction =
  | { kind: 'replaced' }
  | { kind: 'forbidden' }
  | { kind: 'map_mismatch' }
  | { kind: 'protocol_mismatch' }
  | { kind: 'stopped' }
  | { kind: 'rejoin'; delayMs: number; rateLimited: boolean }
  | { kind: 'failed' };

export const REJOIN_MAX_ATTEMPTS = 8;
export const REJOIN_BASE_MS = 1000;
export const REJOIN_MAX_MS = 30_000;
export const RATE_LIMITED_MIN_MS = 10_000;

/**
 * Exponential backoff with +-20% jitter (pass `random` for deterministic tests).
 * attempt 1 -> ~1s, 2 -> ~2s, 3 -> ~4s ... capped at 30s.
 */
export function backoffMs(attempt: number, random: () => number = Math.random): number {
  const n = Math.max(1, Math.floor(attempt));
  const raw = Math.min(REJOIN_MAX_MS, REJOIN_BASE_MS * 2 ** (n - 1));
  const jitter = 1 + (random() * 0.4 - 0.2);
  return Math.round(Math.min(REJOIN_MAX_MS, raw * jitter));
}

/**
 * What to do once the room has finally left (after any SDK auto-reconnect gave up).
 * `attempt` is the number of the rejoin attempt this would start (1 = first retry).
 * `consentedByUs` is true when this client called `leave()` itself.
 */
export function leaveAction(
  code: number,
  attempt: number,
  opts: { consentedByUs?: boolean; random?: () => number } = {},
): LeaveAction {
  if (opts.consentedByUs) return { kind: 'stopped' };
  switch (code) {
    case CloseCodes.SessionReplaced:
      return { kind: 'replaced' };
    case CloseCodes.Forbidden:
      return { kind: 'forbidden' };
    case CloseCodes.MapMismatch:
      return { kind: 'map_mismatch' };
    case CloseCodes.ProtocolMismatch:
      return { kind: 'protocol_mismatch' };
    default:
      break;
  }
  if (attempt > REJOIN_MAX_ATTEMPTS) return { kind: 'failed' };
  const rateLimited = code === CloseCodes.RateLimited;
  const delay = backoffMs(attempt, opts.random);
  return { kind: 'rejoin', delayMs: rateLimited ? Math.max(RATE_LIMITED_MIN_MS, delay) : delay, rateLimited };
}

/** Close codes on which the SDK itself retries the same seat (see Room#handleReconnection). */
export function sdkWillAutoReconnect(code: number): boolean {
  return (
    code === SDK_CLOSE.GOING_AWAY ||
    code === SDK_CLOSE.NO_STATUS_RECEIVED ||
    code === SDK_CLOSE.ABNORMAL_CLOSURE ||
    code === SDK_CLOSE.MAY_TRY_RECONNECT
  );
}
