import type { LinkState } from '@enu/shared';
import { localDateKey, previousBusinessDayKey } from '@enu/shared';

export interface LinkStateInput {
  now: Date;
  timeZone: string;
  holidays: ReadonlySet<string>;
  /** At least one non-revoked Claude connector grant exists. */
  hasActiveLink: boolean;
  /** When the most recent active grant was consented. */
  consentedAt: Date | null;
  lastWorkLogAt: Date | null;
}

/**
 * not_linked: no active connector grant.
 * linked:     the last log (or, before any log, the consent) is from today or the previous business day.
 * stale:      linked, but Claude has not written since before the previous business day.
 */
export function computeLinkState(i: LinkStateInput): LinkState {
  if (!i.hasActiveLink) return 'not_linked';
  const ref = i.lastWorkLogAt ?? i.consentedAt;
  if (!ref) return 'linked';
  const prevBiz = previousBusinessDayKey(i.now, i.timeZone, i.holidays);
  return localDateKey(ref, i.timeZone) >= prevBiz ? 'linked' : 'stale';
}
