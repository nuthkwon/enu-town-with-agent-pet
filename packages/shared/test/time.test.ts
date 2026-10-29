import { describe, expect, it } from 'vitest';
import {
  addLocalDays,
  atLocalTime,
  isBusinessDay,
  isWithinLocalRange,
  localDateKey,
  nextBusinessDayAt,
  previousBusinessDayKey,
  startOfLocalDay,
  zonedTimeToUtc,
} from '../src/time';

const TZ = 'Asia/Seoul';

describe('time (Asia/Seoul)', () => {
  it('keys the local date, not the UTC date', () => {
    // 2026-10-29 15:30 UTC = 2026-10-30 00:30 KST
    expect(localDateKey(new Date('2026-10-29T15:30:00Z'), TZ)).toBe('2026-10-30');
    expect(localDateKey(new Date('2026-10-29T14:59:59Z'), TZ)).toBe('2026-10-29');
  });

  it('converts wall clock to instant', () => {
    expect(zonedTimeToUtc(2026, 10, 29, 9, 0, TZ).toISOString()).toBe('2026-10-29T00:00:00.000Z');
    expect(startOfLocalDay(new Date('2026-10-29T16:00:00Z'), TZ).toISOString()).toBe('2026-10-29T15:00:00.000Z');
    expect(atLocalTime(new Date('2026-10-29T03:00:00Z'), TZ, '19:00').toISOString()).toBe('2026-10-29T10:00:00.000Z');
  });

  it('handles ranges that wrap midnight', () => {
    const at = (iso: string) => new Date(iso);
    expect(isWithinLocalRange(at('2026-10-29T11:00:00Z'), TZ, '19:30', '08:30')).toBe(true); // 20:00
    expect(isWithinLocalRange(at('2026-10-29T22:00:00Z'), TZ, '19:30', '08:30')).toBe(true); // 07:00
    expect(isWithinLocalRange(at('2026-10-29T01:00:00Z'), TZ, '19:30', '08:30')).toBe(false); // 10:00
  });

  it('knows business days and holidays', () => {
    const holidays = new Set(['2026-10-09']);
    expect(isBusinessDay(new Date('2026-10-31T03:00:00Z'), TZ, holidays)).toBe(false); // Saturday
    expect(isBusinessDay(new Date('2026-10-09T03:00:00Z'), TZ, holidays)).toBe(false); // 한글날
    expect(isBusinessDay(new Date('2026-10-29T03:00:00Z'), TZ, holidays)).toBe(true);
    // Friday evening -> Monday 19:00
    expect(nextBusinessDayAt(new Date('2026-10-30T11:00:00Z'), TZ, '19:00', holidays).toISOString()).toBe(
      '2026-11-02T10:00:00.000Z',
    );
    expect(previousBusinessDayKey(new Date('2026-11-02T03:00:00Z'), TZ, holidays)).toBe('2026-10-30');
    expect(localDateKey(addLocalDays(new Date('2026-10-29T03:00:00Z'), TZ, 3), TZ)).toBe('2026-11-01');
  });
});
