import { LIMITS, containsUrl, detectPii, graphemeLength, normalizeLine, normalizeText } from '@enu/shared';
import type { RejectionReason } from '@enu/shared';

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
