import { PET_CHANNEL } from '@enu/shared';

/**
 * Whether a paired Claude Code is listening (ADR 0006 §7): the time of each token's last poll, kept only in this
 * web process for the owner's own status. Never stored, sent over NOTIFY, logged, audited or shown to anyone else.
 * Kept on globalThis so dev reloads share one map.
 */
const holder = globalThis as unknown as { __enuPetLive?: Map<string, Map<string, number>> };
const seen = (holder.__enuPetLive ??= new Map());

const WINDOW_MS = PET_CHANNEL.liveWindowS * 1000;

export function markLive(userId: string, tokenId: string, nowMs = Date.now()): void {
  let tokens = seen.get(userId);
  if (!tokens) {
    tokens = new Map();
    seen.set(userId, tokens);
  }
  tokens.set(tokenId, nowMs);
}

/** Token ids of `userId` that polled within the live window. */
export function liveTokens(userId: string, nowMs = Date.now()): Set<string> {
  const out = new Set<string>();
  const tokens = seen.get(userId);
  if (!tokens) return out;
  for (const [tokenId, at] of tokens) {
    if (nowMs - at <= WINDOW_MS) out.add(tokenId);
    else tokens.delete(tokenId);
  }
  if (tokens.size === 0) seen.delete(userId);
  return out;
}

/** A revoked or unpaired token stops counting at once. */
export function forgetToken(userId: string, tokenId: string): void {
  seen.get(userId)?.delete(tokenId);
}

/** Tests only. */
export function resetLiveness(): void {
  seen.clear();
}
