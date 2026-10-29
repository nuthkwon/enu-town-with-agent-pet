import type { WaitHint } from './waitHint';

/**
 * The big pet's mood in its owner's room (pure, owner only, never sent anywhere): it listens while the owner
 * types, thinks while a message waits for a reply that is coming, talks when a reply arrives, is happy after a
 * success, and sleeps when nothing can answer now.
 */
export type CompanionExpr = 'idle' | 'listening' | 'thinking' | 'talking' | 'happy' | 'sleeping';

/** The sheet animation for each mood (COMPANION_EXPRESSIONS). */
export const COMPANION_SPRITE = {
  idle: 'idle',
  listening: 'listen',
  thinking: 'think',
  talking: 'talk',
  happy: 'happy',
  sleeping: 'sleep',
} as const satisfies Record<CompanionExpr, string>;

export const COMPANION_TIMING = {
  talkBaseMs: 1800,
  talkPerCharMs: 35,
  talkMaxMs: 6000,
  happyMs: 1600,
  listenAfterKeyMs: 1500,
} as const;

export interface CompanionInput {
  now: number;
  composer: { focused: boolean; draftLength: number; lastKeyAt: number | null };
  /** Since when the oldest unanswered message waits (null when none). */
  pendingSince: number | null;
  /** The hint for a waiting message (or what would apply). */
  wait: WaitHint;
  lastReply: { at: number; length: number } | null;
  happyUntil: number | null;
}

export interface CompanionOutput {
  expr: CompanionExpr;
  /** When the result may change without new input (schedule one re-evaluation), or null. */
  nextAt: number | null;
}

export function companionState(i: CompanionInput): CompanionOutput {
  const t = COMPANION_TIMING;
  if (i.lastReply) {
    const end = i.lastReply.at + Math.min(t.talkMaxMs, t.talkBaseMs + t.talkPerCharMs * i.lastReply.length);
    if (i.now < end) return { expr: 'talking', nextAt: end };
  }
  if (i.happyUntil !== null && i.now < i.happyUntil) return { expr: 'happy', nextAt: i.happyUntil };
  const { composer } = i;
  if (composer.focused) {
    if (composer.draftLength > 0) return { expr: 'listening', nextAt: null };
    if (composer.lastKeyAt !== null && i.now - composer.lastKeyAt < t.listenAfterKeyMs) {
      return { expr: 'listening', nextAt: composer.lastKeyAt + t.listenAfterKeyMs };
    }
  }
  if (i.pendingSince !== null) {
    if (i.wait === 'live' || i.wait === 'checkin') return { expr: 'thinking', nextAt: null };
    if (i.wait === 'nextBusinessDay' || i.wait === 'channelOffline')
      return { expr: 'sleeping', nextAt: null };
    return { expr: 'idle', nextAt: null };
  }
  if (i.wait === 'notLinked') return { expr: 'sleeping', nextAt: null };
  return { expr: 'idle', nextAt: null };
}
