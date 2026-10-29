import { TASK_STATUSES, type TaskStatus, type WorkLogChange } from '@enu/shared';
import type { WorkLogContent } from './worklog-upsert';

/**
 * What a Claude write changed in a work log, as the work overview shows it (ADR 0007). Claude resends the whole day
 * each time, so this compares the stored log with the new one. Pure: no clock, no I/O.
 */

type DeltaContent = Pick<WorkLogContent, 'summary' | 'tasks' | 'blockers'>;

const STATUSES: ReadonlySet<string> = new Set(TASK_STATUSES);
const isTaskStatus = (s: string): s is TaskStatus => STATUSES.has(s);

/** A task is the same task when its reference matches, else its title (case and spacing as written). */
const taskKey = (t: { title: string; ref?: string | undefined }) =>
  t.ref ? `ref:${t.ref}` : `title:${t.title}`;

/**
 * The visible changes from `prev` (null: the day's first write) to `next`: the summary when it changed, tasks whose
 * status moved, tasks added, blockers added. Removals, the chat summary, references and visibility are not changes
 * the feed shows; `[]` means nothing visible changed.
 */
export function workLogDelta(prev: DeltaContent | null, next: DeltaContent): WorkLogChange[] {
  const out: WorkLogChange[] = [];
  const summary = next.summary.trim();
  if (summary && summary !== (prev?.summary.trim() ?? '')) out.push({ type: 'summary', text: next.summary });

  // Earlier tasks by key, as a multiset (two tasks may share a title).
  const before = new Map<string, string[]>();
  for (const t of prev?.tasks ?? []) {
    const list = before.get(taskKey(t)) ?? [];
    list.push(t.status);
    before.set(taskKey(t), list);
  }
  const moved: WorkLogChange[] = [];
  const added: WorkLogChange[] = [];
  for (const t of next.tasks) {
    if (!isTaskStatus(t.status)) continue;
    const earlier = before.get(taskKey(t))?.shift();
    if (earlier === undefined) added.push({ type: 'task_added', title: t.title, status: t.status });
    else if (earlier !== t.status && isTaskStatus(earlier))
      moved.push({ type: 'task_status', title: t.title, from: earlier, to: t.status });
  }

  const knownBlockers = new Map<string, number>();
  for (const b of prev?.blockers ?? []) knownBlockers.set(b, (knownBlockers.get(b) ?? 0) + 1);
  const blockers: WorkLogChange[] = [];
  for (const b of next.blockers) {
    const n = knownBlockers.get(b) ?? 0;
    if (n > 0) knownBlockers.set(b, n - 1);
    else blockers.push({ type: 'blocker_added', text: b });
  }
  return [...out, ...moved, ...added, ...blockers];
}

/**
 * Several writes of one day as one line (a past day, or today's writes the feed shows without a time): a task added
 * and then moved is added with its last status, a→b→c is a→c, a→b→a disappears, blockers once each, the last summary.
 */
export function mergeWorkLogChanges(lists: readonly (readonly WorkLogChange[])[]): WorkLogChange[] {
  let summary: string | null = null;
  const tasks = new Map<string, { title: string; added: boolean; from: TaskStatus; to: TaskStatus }>();
  const blockers: string[] = [];
  for (const list of lists) {
    for (const c of list) {
      if (c.type === 'summary') summary = c.text;
      else if (c.type === 'blocker_added') {
        if (!blockers.includes(c.text)) blockers.push(c.text);
      } else if (c.type === 'task_added') {
        const known = tasks.get(c.title);
        if (known) known.to = c.status;
        else tasks.set(c.title, { title: c.title, added: true, from: c.status, to: c.status });
      } else {
        const known = tasks.get(c.title);
        if (known) known.to = c.to;
        else tasks.set(c.title, { title: c.title, added: false, from: c.from, to: c.to });
      }
    }
  }
  const out: WorkLogChange[] = summary === null ? [] : [{ type: 'summary', text: summary }];
  for (const t of tasks.values()) {
    if (!t.added && t.from !== t.to)
      out.push({ type: 'task_status', title: t.title, from: t.from, to: t.to });
  }
  for (const t of tasks.values()) {
    if (t.added) out.push({ type: 'task_added', title: t.title, status: t.to });
  }
  for (const b of blockers) out.push({ type: 'blocker_added', text: b });
  return out;
}
