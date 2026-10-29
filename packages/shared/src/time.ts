/**
 * Timezone helpers built on Intl only (no DST assumptions), used for the
 * per-day work-log key, quiet hours, work hours and nudge expiry.
 */

export interface LocalParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: number; // 0=Sun .. 6=Sat
}

const partsFormatterCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let f = partsFormatterCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
      weekday: 'short',
    });
    partsFormatterCache.set(timeZone, f);
  }
  return f;
}

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export function localParts(date: Date, timeZone: string): LocalParts {
  const out: Partial<Record<Intl.DateTimeFormatPartTypes, string>> = {};
  for (const p of formatterFor(timeZone).formatToParts(date)) out[p.type] = p.value;
  return {
    year: Number(out.year),
    month: Number(out.month),
    day: Number(out.day),
    hour: Number(out.hour),
    minute: Number(out.minute),
    second: Number(out.second),
    weekday: WEEKDAYS[out.weekday ?? 'Sun'] ?? 0,
  };
}

/** Offset (ms) of `timeZone` from UTC at the given instant. */
export function tzOffsetMs(date: Date, timeZone: string): number {
  const p = localParts(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** Instant for a wall-clock time in `timeZone`. */
export function zonedTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute, 0);
  let instant = guess - tzOffsetMs(new Date(guess), timeZone);
  // Second pass corrects for offset changes between guess and result.
  instant = guess - tzOffsetMs(new Date(instant), timeZone);
  return new Date(instant);
}

const pad = (n: number) => String(n).padStart(2, '0');

/** `YYYY-MM-DD` of the instant in `timeZone` (the work-log period key). */
export function localDateKey(date: Date, timeZone: string): string {
  const p = localParts(date, timeZone);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

export function parseHm(hm: string): { hour: number; minute: number } {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hm);
  if (!m) throw new Error(`invalid HH:MM: ${hm}`);
  return { hour: Number(m[1]), minute: Number(m[2]) };
}

export function minutesOfDay(date: Date, timeZone: string): number {
  const p = localParts(date, timeZone);
  return p.hour * 60 + p.minute;
}

function hmToMinutes(hm: string): number {
  const { hour, minute } = parseHm(hm);
  return hour * 60 + minute;
}

/** True when local time is inside [start, end) — supports ranges that wrap midnight. */
export function isWithinLocalRange(date: Date, timeZone: string, start: string, end: string): boolean {
  const m = minutesOfDay(date, timeZone);
  const s = hmToMinutes(start);
  const e = hmToMinutes(end);
  return s <= e ? m >= s && m < e : m >= s || m < e;
}

export function isWeekend(date: Date, timeZone: string): boolean {
  const wd = localParts(date, timeZone).weekday;
  return wd === 0 || wd === 6;
}

/** Business day = not weekend and not a listed holiday (`YYYY-MM-DD` keys). */
export function isBusinessDay(date: Date, timeZone: string, holidays: ReadonlySet<string>): boolean {
  return !isWeekend(date, timeZone) && !holidays.has(localDateKey(date, timeZone));
}

/** Start of the local day containing `date`. */
export function startOfLocalDay(date: Date, timeZone: string): Date {
  const p = localParts(date, timeZone);
  return zonedTimeToUtc(p.year, p.month, p.day, 0, 0, timeZone);
}

/** Wall-clock `hm` on the same local day as `date`. */
export function atLocalTime(date: Date, timeZone: string, hm: string): Date {
  const p = localParts(date, timeZone);
  const { hour, minute } = parseHm(hm);
  return zonedTimeToUtc(p.year, p.month, p.day, hour, minute, timeZone);
}

/** Adds whole local days (calendar arithmetic on the local date). */
export function addLocalDays(date: Date, timeZone: string, days: number): Date {
  const p = localParts(date, timeZone);
  const utcNoon = new Date(Date.UTC(p.year, p.month - 1, p.day + days, 12, 0, 0));
  return zonedTimeToUtc(
    utcNoon.getUTCFullYear(),
    utcNoon.getUTCMonth() + 1,
    utcNoon.getUTCDate(),
    p.hour,
    p.minute,
    timeZone,
  );
}

/** First business day strictly after the local day of `date`, at `hm`. */
export function nextBusinessDayAt(
  date: Date,
  timeZone: string,
  hm: string,
  holidays: ReadonlySet<string>,
): Date {
  let d = addLocalDays(date, timeZone, 1);
  for (let i = 0; i < 14 && !isBusinessDay(d, timeZone, holidays); i++) d = addLocalDays(d, timeZone, 1);
  return atLocalTime(d, timeZone, hm);
}

/** Most recent business day strictly before the local day of `date` (as its local date key). */
export function previousBusinessDayKey(date: Date, timeZone: string, holidays: ReadonlySet<string>): string {
  let d = addLocalDays(date, timeZone, -1);
  for (let i = 0; i < 14 && !isBusinessDay(d, timeZone, holidays); i++) d = addLocalDays(d, timeZone, -1);
  return localDateKey(d, timeZone);
}

/** `HH:MM` local time string, e.g. for the due-time chip shown outside pet bubbles. */
export function formatLocalHm(date: Date, timeZone: string): string {
  const p = localParts(date, timeZone);
  return `${pad(p.hour)}:${pad(p.minute)}`;
}
