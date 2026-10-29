import { localParts, tzOffsetMs } from '@enu/shared';
import type { Visibility } from '@enu/shared';

const pad = (n: number) => String(Math.trunc(Math.abs(n))).padStart(2, '0');

/** `2026-10-29T14:05:00+09:00` for the instant in `timeZone`. */
export function formatLocalIso(date: Date, timeZone: string): string {
  const p = localParts(date, timeZone);
  const offsetMin = Math.round(tzOffsetMs(date, timeZone) / 60_000);
  const sign = offsetMin < 0 ? '-' : '+';
  const off = `${sign}${pad(offsetMin / 60)}:${pad(offsetMin % 60)}`;
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}${off}`;
}

const WEEKDAY_KO = ['일', '월', '화', '수', '목', '금', '토'] as const;

/** `10월 29일(목) 14:05` */
export function formatKoDateTime(date: Date, timeZone: string): string {
  const p = localParts(date, timeZone);
  return `${p.month}월 ${p.day}일(${WEEKDAY_KO[p.weekday]}) ${pad(p.hour)}:${pad(p.minute)}`;
}

export function visibilityKo(v: Visibility): string {
  return v === 'company' ? '회사 전체 공개' : '나만 보기';
}

export function trimTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '');
}
