import { formatLocalHm, localParts, tzOffsetMs } from '@enu/shared';
import type { ManualStatus, NowKind, Visibility } from '@enu/shared';

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

/** The town's labels for Claude's `now` kinds (the same words colleagues see). */
export const NOW_KIND_KO: Record<NowKind, string> = {
  work: '개인 업무',
  docs: '문서 작성',
  review: '검토 중',
  collab: '협업 중',
};

export const MANUAL_STATUS_KO: Record<ManualStatus, string> = {
  available: '대화 가능',
  focus: '집중 모드',
  meeting: '회의 중',
  break: '휴식',
  away: '자리 비움',
};

/** "주인이 직접 '집중 모드'(~11:00)로 설정해 …" for a status the owner set by hand ('' when none). */
export function ownerStatusKo(s: { status: ManualStatus; until: string } | null, timeZone: string): string {
  if (!s) return '';
  const until = formatLocalHm(new Date(s.until), timeZone);
  return ` 주인이 직접 '${MANUAL_STATUS_KO[s.status]}'(~${until})로 설정해 두어 그동안은 주인 설정이 보여요.`;
}

export function trimTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '');
}
