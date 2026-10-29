import { APP_TIMEZONE_DEFAULT, formatLocalHm, localDateKey } from '@enu/shared';
import { ko } from '@/i18n/ko';

const TZ = APP_TIMEZONE_DEFAULT;

/** 'YYYY-MM-DD HH:MM' in Asia/Seoul (today: just 'HH:MM'). */
export function formatAbsolute(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const day = localDateKey(d, TZ);
  const hm = formatLocalHm(d, TZ);
  return day === localDateKey(now, TZ) ? hm : `${day} ${hm}`;
}

/** '방금' / 'N분 전' / 'N시간 전' / 'N일 전'. */
export function formatRelative(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const diff = Math.max(0, now.getTime() - t);
  const min = Math.floor(diff / 60_000);
  if (min < 1) return ko.time.justNow;
  if (min < 60) return ko.townUi.ago.minutes(min);
  const h = Math.floor(min / 60);
  if (h < 24) return ko.townUi.ago.hours(h);
  return ko.townUi.ago.days(Math.floor(h / 24));
}

/** 'N분 전 (YYYY-MM-DD HH:MM)'. */
export function formatBoth(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return '';
  return `${formatRelative(iso, now)} (${formatAbsolute(iso, now)})`;
}

export function formatHm(epochMsOrIso: number | string): string {
  return formatLocalHm(new Date(epochMsOrIso), TZ);
}
