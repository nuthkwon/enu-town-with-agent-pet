import {
  LIMITS,
  SCHEDULE_KINDS,
  containsUrl,
  detectPii,
  graphemeLength,
  localDateKey,
  normalizeLine,
  normalizeText,
} from '@enu/shared';
import type { NowKind, PostActivityInput, RejectionReason, ScheduleKind } from '@enu/shared';
import { officeDayBounds } from './activity';

/**
 * Content rules for Claude-authored text. Violations are rejected (never rewritten)
 * so that whatever ENU Town shows is exactly what the owner's Claude wrote.
 */

export interface FieldProblem {
  field: string;
  reason: RejectionReason;
  detail?: string;
}

export function checkPublishableText(field: string, text: string, opts: { allowUrl: boolean }): FieldProblem[] {
  const problems: FieldProblem[] = [];
  const pii = detectPii(text);
  if (pii.length) problems.push({ field, reason: 'pii', detail: `contains ${pii.join(', ')}` });
  if (!opts.allowUrl && containsUrl(text)) problems.push({ field, reason: 'url' });
  return problems;
}

export function prepareNudgeText(raw: string): { text: string } | { problem: FieldProblem } {
  const text = normalizeLine(raw);
  if (!text) return { problem: { field: 'text', reason: 'empty' } };
  if (graphemeLength(text) > LIMITS.nudgeTextMax) return { problem: { field: 'text', reason: 'too_long' } };
  const [first] = checkPublishableText('text', text, { allowUrl: false });
  return first ? { problem: first } : { text };
}

export interface WorkLogTextInput {
  summary: string;
  tasks: { title: string; status: string; ref?: string | undefined }[];
  blockers: string[];
  claudeChatSummary?: string | undefined;
}

export interface PreparedWorkLog {
  summary: string;
  tasks: { title: string; status: string; ref?: string }[];
  blockers: string[];
  claudeChatSummary: string | null;
}

const SAFE_REF = /^(https:\/\/\S+|[\w.:#@\-/ ]{1,200})$/;

export function prepareWorkLog(input: WorkLogTextInput): { log: PreparedWorkLog; problems: FieldProblem[] } {
  const problems: FieldProblem[] = [];
  const summary = normalizeText(input.summary);
  if (!summary) problems.push({ field: 'summary', reason: 'empty' });
  problems.push(...checkPublishableText('summary', summary, { allowUrl: false }));

  const tasks = input.tasks.map((t, i) => {
    const title = normalizeLine(t.title);
    problems.push(...checkPublishableText(`tasks[${i}].title`, title, { allowUrl: false }));
    const ref = t.ref ? normalizeLine(t.ref) : undefined;
    if (ref && !SAFE_REF.test(ref)) problems.push({ field: `tasks[${i}].ref`, reason: 'url', detail: 'ref must be a label or https URL' });
    return ref ? { title, status: t.status, ref } : { title, status: t.status };
  });
  const blockers = input.blockers.map((b, i) => {
    const text = normalizeLine(b);
    problems.push(...checkPublishableText(`blockers[${i}]`, text, { allowUrl: false }));
    return text;
  });
  let claudeChatSummary: string | null = null;
  if (input.claudeChatSummary) {
    claudeChatSummary = normalizeText(input.claudeChatSummary) || null;
    if (claudeChatSummary) {
      problems.push(...checkPublishableText('claude_chat_summary', claudeChatSummary, { allowUrl: false }));
    }
  }
  return { log: { summary, tasks, blockers, claudeChatSummary }, problems };
}

export function prepareTodoText(title: string, note: string | undefined): { title: string; note: string | null; problems: FieldProblem[] } {
  const t = normalizeLine(title);
  const n = note ? normalizeText(note) || null : null;
  const problems = [
    ...(t ? [] : [{ field: 'title', reason: 'empty' as const }]),
    ...checkPublishableText('title', t, { allowUrl: false }),
    ...(n ? checkPublishableText('note', n, { allowUrl: true }) : []),
  ];
  return { title: t, note: n, problems };
}

export interface PreparedScheduleBlock {
  start: Date;
  end: Date;
  kind: ScheduleKind;
  /** Scheme lower-cased; the service stores only its keyed daily hash. */
  ref: string | null;
}

export interface PreparedActivity {
  /** The office date (APP_TIMEZONE) the report belongs to. */
  periodKey: string;
  /** `until` defaulted and clamped; null clears the previous report. */
  now: { kind: NowKind; ref: string | null; until: Date } | null;
  /** Sorted by (start, end, kind) without exact duplicates; null = not sent, keep the stored list. */
  schedule: PreparedScheduleBlock[] | null;
}

const MIN = 60_000;

/** `JIRA:ENU-1` -> `jira:ENU-1`: only the scheme is case-insensitive; the id is kept verbatim. */
export function normalizeWorkRef(ref: string): string {
  const colon = ref.indexOf(':');
  return ref.slice(0, colon).toLowerCase() + ref.slice(colon);
}

function compareBlocks(a: PreparedScheduleBlock, b: PreparedScheduleBlock): number {
  const ra = a.ref ?? '';
  const rb = b.ref ?? '';
  return (
    a.start.getTime() - b.start.getTime() ||
    a.end.getTime() - b.end.getTime() ||
    SCHEDULE_KINDS.indexOf(a.kind) - SCHEDULE_KINDS.indexOf(b.kind) ||
    (ra < rb ? -1 : ra > rb ? 1 : 0)
  );
}

/**
 * Checks a `post_activity` call (already zod-validated). Any problem rejects the whole call; nothing is
 * rewritten, only times are normalized: `now.until` defaults to now+90 min and is clamped to now+120 min.
 * Blocks must lie within the office day of `now` in `officeTimeZone` (APP_TIMEZONE).
 */
export function prepareActivity(
  input: Pick<PostActivityInput, 'now' | 'schedule'>,
  now: Date,
  officeTimeZone: string,
): { prepared: PreparedActivity; problems: FieldProblem[] } {
  const problems: FieldProblem[] = [];
  const periodKey = localDateKey(now, officeTimeZone);

  let reported: PreparedActivity['now'] = null;
  if (input.now) {
    const max = new Date(now.getTime() + LIMITS.nowMaxMin * MIN);
    const until = input.now.until ? new Date(input.now.until) : new Date(now.getTime() + LIMITS.nowDefaultMin * MIN);
    if (until <= now) problems.push({ field: 'now.until', reason: 'invalid_time', detail: 'until must be in the future' });
    reported = {
      kind: input.now.kind,
      ref: input.now.ref ? normalizeWorkRef(input.now.ref) : null,
      until: until > max ? max : until,
    };
  }

  let schedule: PreparedScheduleBlock[] | null = null;
  if (input.schedule) {
    const day = officeDayBounds(now, officeTimeZone);
    const blocks = input.schedule.map((b, i): PreparedScheduleBlock => {
      const start = new Date(b.start_at);
      const end = new Date(b.end_at);
      if (end <= start) {
        problems.push({ field: `schedule[${i}].end_at`, reason: 'invalid_time', detail: 'end_at must be after start_at' });
      }
      if (start < day.start || end > day.end) {
        problems.push({
          field: `schedule[${i}]`,
          reason: 'invalid_time',
          detail: `blocks must lie within ${periodKey} (${officeTimeZone}); cut blocks at midnight`,
        });
      }
      // An away block (leave, business trip) may span the whole office day.
      if (b.kind !== 'away' && end.getTime() - start.getTime() > LIMITS.scheduleBlockMaxHours * 60 * MIN) {
        problems.push({
          field: `schedule[${i}]`,
          reason: 'invalid_time',
          detail: `meeting/focus blocks may last at most ${LIMITS.scheduleBlockMaxHours} hours`,
        });
      }
      if (b.ref && b.kind !== 'meeting') {
        problems.push({ field: `schedule[${i}].ref`, reason: 'unsupported', detail: 'ref is only for meeting blocks' });
      }
      return { start, end, kind: b.kind, ref: b.ref ? normalizeWorkRef(b.ref) : null };
    });
    schedule = [];
    for (const b of blocks.sort(compareBlocks)) {
      const last = schedule.at(-1);
      if (!last || compareBlocks(last, b) !== 0) schedule.push(b);
    }
  }
  return { prepared: { periodKey, now: reported, schedule }, problems };
}
