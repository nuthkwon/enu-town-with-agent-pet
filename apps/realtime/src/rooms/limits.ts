import { KeyedLimiter, TokenBucket, perWindow } from '../infra/RateLimiter';

/** Per-connection message budgets (on top of Colyseus' maxMessagesPerSecond flood guard). */
export interface ClientLimits {
  status: TokenBucket;
  presence: TokenBucket;
  chat: TokenBucket;
  dm: TokenBucket;
  dmRead: TokenBucket;
  wave: TokenBucket;
  /** One wave per target per 10 s. */
  waveTarget: KeyedLimiter;
  ping: TokenBucket;
  /** One ping per target per 30 s. */
  pingTarget: KeyedLimiter;
  bubbleSeen: TokenBucket;
}

export function createClientLimits(): ClientLimits {
  return {
    status: perWindow(5, 10_000),
    presence: perWindow(10, 10_000),
    chat: perWindow(5, 10_000),
    dm: perWindow(10, 10_000),
    dmRead: perWindow(20, 10_000),
    wave: perWindow(3, 10_000),
    waveTarget: new KeyedLimiter(() => new TokenBucket(1, 10_000)),
    ping: perWindow(5, 30_000),
    pingTarget: new KeyedLimiter(() => new TokenBucket(1, 30_000)),
    bubbleSeen: perWindow(10, 10_000),
  };
}
