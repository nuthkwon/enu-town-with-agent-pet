import type { Visibility } from '@enu/shared';
import { effectiveVisibility } from './visibility';

export interface WorkLogContent {
  summary: string;
  tasks: { title: string; status: string; ref?: string | undefined }[];
  blockers: string[];
  claudeChatSummary: string | null;
}

export interface ExistingWorkLog extends WorkLogContent {
  visibility: Visibility;
  visibilitySetBy: 'claude' | 'user';
  chatSummaryVisibility: Visibility;
  chatSummaryVisibilitySetBy: 'claude' | 'user';
  editedByUser: boolean;
  deletedAt: Date | null;
}

export interface IncomingWorkLog extends WorkLogContent {
  visibility?: Visibility | undefined;
  chatSummaryVisibility?: Visibility | undefined;
}

export interface OwnerDefaults {
  logVisibility: Visibility;
  chatSummaryVisibility: Visibility | null;
}

export type UpsertDecision =
  | { result: 'skipped_user_deleted' }
  | { result: 'skipped_user_edited' }
  | { result: 'unchanged'; visibility: Visibility; chatSummaryVisibility: Visibility }
  | {
      result: 'created' | 'updated';
      content: WorkLogContent;
      visibility: Visibility;
      chatSummaryVisibility: Visibility;
    };

function sameContent(a: WorkLogContent, b: WorkLogContent): boolean {
  return (
    a.summary === b.summary &&
    a.claudeChatSummary === b.claudeChatSummary &&
    JSON.stringify(a.tasks) === JSON.stringify(b.tasks) &&
    JSON.stringify(a.blockers) === JSON.stringify(b.blockers)
  );
}

/**
 * Decides how Claude's daily (cumulative) work log write applies to the stored row.
 * - The owner's deletions and body edits always win.
 * - Visibility chosen by the owner in the web UI is never overwritten by Claude.
 * - Claude can only lower visibility relative to the owner default.
 */
export function decideWorkLogUpsert(
  existing: ExistingWorkLog | null,
  incoming: IncomingWorkLog,
  defaults: OwnerDefaults,
): UpsertDecision {
  const content: WorkLogContent = {
    summary: incoming.summary,
    tasks: incoming.tasks,
    blockers: incoming.blockers,
    claudeChatSummary: incoming.claudeChatSummary,
  };
  const claudeLogVis = effectiveVisibility(incoming.visibility, defaults.logVisibility);
  const claudeChatVis = effectiveVisibility(incoming.chatSummaryVisibility, defaults.chatSummaryVisibility);

  if (!existing) {
    return { result: 'created', content, visibility: claudeLogVis, chatSummaryVisibility: claudeChatVis };
  }
  if (existing.deletedAt) return { result: 'skipped_user_deleted' };
  if (existing.editedByUser) return { result: 'skipped_user_edited' };

  const visibility = existing.visibilitySetBy === 'user' ? existing.visibility : claudeLogVis;
  const chatSummaryVisibility =
    existing.chatSummaryVisibilitySetBy === 'user' ? existing.chatSummaryVisibility : claudeChatVis;

  if (
    sameContent(existing, content) &&
    visibility === existing.visibility &&
    chatSummaryVisibility === existing.chatSummaryVisibility
  ) {
    return { result: 'unchanged', visibility, chatSummaryVisibility };
  }
  return { result: 'updated', content, visibility, chatSummaryVisibility };
}
