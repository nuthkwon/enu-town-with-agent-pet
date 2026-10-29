const WEEKDAY_KO = ['일', '월', '화', '수', '목', '금', '토'] as const;

/** `2026-10-29` -> `10월 29일 (목)` (a calendar date: no time zone involved). */
export function dayLabel(dayKey: string, todayKey?: string): string {
  const [y, m, d] = dayKey.split('-').map(Number) as [number, number, number];
  if (!y || !m || !d) return dayKey;
  if (todayKey && dayKey === todayKey) return '오늘';
  const weekday = WEEKDAY_KO[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]!;
  return `${m}월 ${d}일 (${weekday})`;
}
