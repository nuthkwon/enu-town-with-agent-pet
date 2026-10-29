import { describe, expect, it } from 'vitest';
import { checkinSkipReason, resolveNudgeTimes } from '../src/checkin';

const TZ = 'Asia/Seoul';
const none = new Set<string>();

describe('checkin', () => {
  it('skips weekends, holidays and off hours', () => {
    expect(checkinSkipReason(new Date('2026-10-31T03:00:00Z'), TZ, none)).toMatch(/주말/); // Sat
    expect(checkinSkipReason(new Date('2026-10-29T12:00:00Z'), TZ, none)).toMatch(/근무 시간/); // 21:00
    expect(checkinSkipReason(new Date('2026-10-29T03:00:00Z'), TZ, none)).toBeNull(); // 12:00
    expect(checkinSkipReason(new Date('2026-10-29T03:00:00Z'), TZ, new Set(['2026-10-29']))).not.toBeNull();
  });

  it('defaults expiry to 19:00 local and rolls to the next business day after 19:00', () => {
    const noon = new Date('2026-10-29T03:00:00Z');
    const r1 = resolveNudgeTimes(noon, undefined, undefined, TZ, none);
    expect(r1.ok && r1.expiresAt.toISOString()).toBe('2026-10-29T10:00:00.000Z');

    const friEvening = new Date('2026-10-30T11:00:00Z'); // Fri 20:00 KST
    const r2 = resolveNudgeTimes(friEvening, undefined, undefined, TZ, none);
    // next business day 19:00 is Monday, but clamped to show_after + 24h
    expect(r2.ok && r2.expiresAt.toISOString()).toBe('2026-10-31T11:00:00.000Z');
    expect(r2.ok && r2.expiresAt > r2.showAfter).toBe(true);
  });

  it('rejects inconsistent times', () => {
    const now = new Date('2026-10-29T03:00:00Z');
    expect(resolveNudgeTimes(now, new Date('2026-11-29T03:00:00Z'), undefined, TZ, none).ok).toBe(false);
    expect(resolveNudgeTimes(now, undefined, new Date('2026-10-29T02:00:00Z'), TZ, none).ok).toBe(false);
  });
});
