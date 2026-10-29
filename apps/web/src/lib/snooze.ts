import { addLocalDays, atLocalTime } from '@enu/shared';

/**
 * 09:00 tomorrow in the owner's time zone (`MeDto.timezone`), never the browser's: a laptop on UTC would
 * otherwise snooze a to-do (and its due bubble) to 18:00 KST.
 */
export function tomorrowMorning(timezone: string, now: Date = new Date()): string {
  return atLocalTime(addLocalDays(now, timezone, 1), timezone, '09:00').toISOString();
}
