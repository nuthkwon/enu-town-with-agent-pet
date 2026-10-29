import { zonedTimeToUtc } from '@enu/shared';
import { describe, expect, it } from 'vitest';
import { tomorrowMorning } from './snooze';

describe('tomorrowMorning', () => {
  it("is 09:00 the next day in the owner's time zone, whatever the browser's zone is", () => {
    // 23:30 KST on Wed 2026-10-28 is 14:30 UTC: a UTC browser would still say "today" is the 28th.
    const now = zonedTimeToUtc(2026, 10, 28, 23, 30, 'Asia/Seoul');
    expect(tomorrowMorning('Asia/Seoul', now)).toBe(
      zonedTimeToUtc(2026, 10, 29, 9, 0, 'Asia/Seoul').toISOString(),
    );
    expect(tomorrowMorning('Asia/Seoul', now)).toBe('2026-10-29T00:00:00.000Z');
    // 00:30 KST on the 29th: tomorrow is the 30th even though UTC still reads the 28th.
    const early = zonedTimeToUtc(2026, 10, 29, 0, 30, 'Asia/Seoul');
    expect(tomorrowMorning('Asia/Seoul', early)).toBe('2026-10-30T00:00:00.000Z');
    expect(tomorrowMorning('UTC', early)).toBe('2026-10-29T09:00:00.000Z');
  });
});
