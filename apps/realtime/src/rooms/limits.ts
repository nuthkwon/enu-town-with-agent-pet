import { KeyedLimiter, TokenBucket, perWindow } from '../infra/RateLimiter';
import { createStepGate } from '../world/Movement';

/** Per-connection message budgets (on top of Colyseus' maxMessagesPerSecond flood guard). */
export interface ClientLimits {
  /** Cadence gate: average >= 0.75*STEP_MS between steps, burst of 3. */
  step: TokenBucket;
  /** Hard cap of 10 steps per second. */
  stepFlood: TokenBucket;
  face: TokenBucket;
  status: TokenBucket;
  presence: TokenBucket;
  chat: TokenBucket;
  dm: TokenBucket;
  dmRead: TokenBucket;
  wave: TokenBucket;
  ping: TokenBucket;
  /** One ping per target per 30 s. */
  pingTarget: KeyedLimiter;
  bubbleSeen: TokenBucket;
}

export function createClientLimits(): ClientLimits {
  return {
    step: createStepGate(),
    stepFlood: perWindow(10, 1000),
    face: perWindow(10, 1000),
    status: perWindow(5, 10_000),
    presence: perWindow(10, 10_000),
    chat: perWindow(5, 10_000),
    dm: perWindow(10, 10_000),
    dmRead: perWindow(20, 10_000),
    wave: perWindow(3, 10_000),
    ping: perWindow(5, 30_000),
    pingTarget: new KeyedLimiter(() => new TokenBucket(1, 30_000)),
    bubbleSeen: perWindow(10, 10_000),
  };
}
