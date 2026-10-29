/** Display formatting in the app time zone (Asia/Seoul by default). */

const TZ = 'Asia/Seoul';

export function formatDateTime(iso: string | null | undefined, timeZone = TZ): string {
  if (!iso) return '';
  const d = new Date(iso);
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone,
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d);
}

export function formatDate(isoOrKey: string | null | undefined, timeZone = TZ): string {
  if (!isoOrKey) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(isoOrKey)) {
    const [y, m, d] = isoOrKey.split('-').map(Number);
    const local = new Date(Date.UTC(y!, (m ?? 1) - 1, d ?? 1, 12));
    return new Intl.DateTimeFormat('ko-KR', {
      timeZone: 'UTC',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      weekday: 'short',
    }).format(local);
  }
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone,
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(new Date(isoOrKey));
}

export function formatTime(iso: string | null | undefined, timeZone = TZ): string {
  if (!iso) return '';
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso));
}
