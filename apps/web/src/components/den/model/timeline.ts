import type { ColleaguePetMessageDto, OwnerPetMessageDto, WorkLogDto } from '@enu/shared';

/**
 * A pet room as a list to draw: day separators, the messages of that day in order, and the day's work-log card
 * last (default pet only). Pure: the same pages always give the same entries.
 */
export type TimelineEntry<M> =
  | { kind: 'day'; key: string; dayKey: string }
  | { kind: 'message'; key: string; message: M; firstOfRun: boolean }
  | { kind: 'log'; key: string; log: WorkLogDto };

type AnyMessage = OwnerPetMessageDto | ColleaguePetMessageDto;

export function buildTimeline<M extends AnyMessage>(
  messages: readonly M[],
  workLogs: readonly WorkLogDto[] = [],
): TimelineEntry<M>[] {
  const days = new Map<string, { messages: M[]; logs: WorkLogDto[] }>();
  const day = (key: string) => {
    let d = days.get(key);
    if (!d) {
      d = { messages: [], logs: [] };
      days.set(key, d);
    }
    return d;
  };
  for (const m of messages) day(m.dayKey).messages.push(m);
  for (const l of workLogs) day(l.periodKey).logs.push(l);

  const out: TimelineEntry<M>[] = [];
  for (const key of [...days.keys()].sort()) {
    const d = days.get(key)!;
    out.push({ kind: 'day', key: `day:${key}`, dayKey: key });
    let prevAuthor: string | null = null;
    for (const m of d.messages) {
      out.push({ kind: 'message', key: m.id, message: m, firstOfRun: m.author !== prevAuthor });
      prevAuthor = m.author;
    }
    for (const l of d.logs) out.push({ kind: 'log', key: `log:${l.id}`, log: l });
  }
  return out;
}

/** Merges an older page in front of what is shown (ids are unique; a repeated id keeps the newer copy). */
export function prependPage<M extends { id: string }>(shown: readonly M[], older: readonly M[]): M[] {
  const seen = new Set(shown.map((m) => m.id));
  return [...older.filter((m) => !seen.has(m.id)), ...shown];
}

/** The newest unread pet reply (what `read` should be called with), or null. */
export function lastUnreadReply(messages: readonly OwnerPetMessageDto[]): OwnerPetMessageDto | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    if (m.author === 'pet' && m.unread) return m;
  }
  return null;
}
