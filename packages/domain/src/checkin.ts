import {
  WORK_HOURS,
  atLocalTime,
  isBusinessDay,
  isWithinLocalRange,
  nextBusinessDayAt,
} from '@enu/shared';

/** Scheduled check-ins outside office time are told to stop immediately (saves seat usage). */
export function checkinSkipReason(now: Date, timeZone: string, holidays: ReadonlySet<string>): string | null {
  if (!isBusinessDay(now, timeZone, holidays)) return '오늘은 주말 또는 공휴일이라 체크인을 건너뜁니다.';
  if (!isWithinLocalRange(now, timeZone, WORK_HOURS.start, WORK_HOURS.end)) {
    return `근무 시간(${WORK_HOURS.start}–${WORK_HOURS.end}) 밖이라 체크인을 건너뜁니다.`;
  }
  return null;
}

export const NUDGE_EXPIRY_HM = '19:00';
const MAX_SHOW_AFTER_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_LIFETIME_MS = 24 * 60 * 60 * 1000;

export type NudgeTimeResult =
  | { ok: true; showAfter: Date; expiresAt: Date }
  | { ok: false; detail: string };

/**
 * Resolves show/expiry times for a Claude-authored nudge.
 * Default expiry is 19:00 local on the show day; if that is not after `showAfter`
 * it moves to 19:00 on the next business day. Expiry is clamped to show_after+24h.
 */
export function resolveNudgeTimes(
  now: Date,
  showAfterIn: Date | undefined,
  expiresAtIn: Date | undefined,
  timeZone: string,
  holidays: ReadonlySet<string>,
): NudgeTimeResult {
  const showAfter = showAfterIn && showAfterIn > now ? showAfterIn : now;
  if (showAfter.getTime() - now.getTime() > MAX_SHOW_AFTER_MS) {
    return { ok: false, detail: 'show_after must be within 7 days' };
  }
  let expiresAt: Date;
  if (expiresAtIn) {
    if (expiresAtIn <= showAfter) return { ok: false, detail: 'expires_at must be after show_after' };
    expiresAt = expiresAtIn;
  } else {
    expiresAt = atLocalTime(showAfter, timeZone, NUDGE_EXPIRY_HM);
    if (expiresAt <= showAfter) expiresAt = nextBusinessDayAt(showAfter, timeZone, NUDGE_EXPIRY_HM, holidays);
  }
  const cap = new Date(showAfter.getTime() + MAX_LIFETIME_MS);
  if (expiresAt > cap) expiresAt = cap;
  return { ok: true, showAfter, expiresAt };
}
