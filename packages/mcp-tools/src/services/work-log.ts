import { audit, newId, notifyTown, workLogs, type Db } from '@enu/db';
import { decideWorkLogUpsert, prepareWorkLog, type ExistingWorkLog } from '@enu/domain';
import {
  SOURCE_HINT_TO_SOURCE,
  localDateKey,
  type PostWorkLogInput,
  type PostWorkLogOutput,
  type Visibility,
} from '@enu/shared';
import { and, eq, sql } from 'drizzle-orm';
import { trimTrailingSlash } from '../format';
import { markLinkedAfterWorkLog, recordLinkWrite, type CallerInfo } from '../links';
import { loadOwnerContext, type OwnerContext } from '../owner';
import { ToolError } from '../result';

export interface PostWorkLogOptions {
  now: Date;
  publicUrl: string;
  owner?: OwnerContext;
}

export function workLogViewUrl(publicUrl: string, logId: string): string {
  return `${trimTrailingSlash(publicUrl)}/me?log=${encodeURIComponent(logId)}`;
}

const asSetBy = (v: string): 'claude' | 'user' => (v === 'user' ? 'user' : 'claude');

/**
 * Writes the owner's cumulative work log for their local day. Text is normalized only in
 * meaning-preserving ways; any policy problem rejects the whole call (ToolError with field
 * reasons) so Claude can rewrite it. Owner edits, deletions and visibility choices always win.
 */
export async function postWorkLog(
  db: Db,
  caller: CallerInfo,
  input: PostWorkLogInput,
  opts: PostWorkLogOptions,
): Promise<PostWorkLogOutput> {
  const { now } = opts;
  const { log, problems } = prepareWorkLog({
    summary: input.summary,
    tasks: input.tasks ?? [],
    blockers: input.blockers ?? [],
    claudeChatSummary: input.claude_chat_summary,
  });
  if (problems.length) {
    throw new ToolError(
      'validation_failed',
      'work log rejected: ENU Town never edits your text. Rewrite the listed fields (no personal data such as phone/resident/card/account numbers, no links except https URLs in tasks[].ref) and call post_work_log again. Nothing was saved.',
      { problems: problems.map((p) => ({ field: p.field, reason: p.reason, ...(p.detail ? { detail: p.detail } : {}) })) },
    );
  }

  const owner = opts.owner ?? (await loadOwnerContext(db, caller.userId));
  const periodKey = localDateKey(now, owner.timezone);
  const source = SOURCE_HINT_TO_SOURCE[input.source_hint ?? 'scheduled_task'];

  const out = await db.transaction(async (tx) => {
    for (let attempt = 0; ; attempt++) {
      const [existing] = await tx
        .select()
        .from(workLogs)
        .where(and(eq(workLogs.userId, caller.userId), eq(workLogs.periodKey, periodKey)))
        .for('update');

      const existingForDecision: ExistingWorkLog | null = existing
        ? {
            summary: existing.summary ?? '',
            // jsonb reorders object keys; rebuild tasks in prepareWorkLog's key order so that
            // identical content compares equal.
            tasks: (existing.tasks ?? []).map((t) => (t.ref ? { title: t.title, status: t.status, ref: t.ref } : { title: t.title, status: t.status })),
            blockers: existing.blockers ?? [],
            claudeChatSummary: existing.claudeChatSummary,
            visibility: existing.visibility,
            visibilitySetBy: asSetBy(existing.visibilitySetBy),
            chatSummaryVisibility: existing.chatSummaryVisibility,
            chatSummaryVisibilitySetBy: asSetBy(existing.chatSummaryVisibilitySetBy),
            editedByUser: existing.editedByUser,
            deletedAt: existing.deletedAt,
          }
        : null;

      const decision = decideWorkLogUpsert(
        existingForDecision,
        { ...log, visibility: input.visibility, chatSummaryVisibility: input.chat_summary_visibility },
        { logVisibility: owner.defaultLogVisibility, chatSummaryVisibility: owner.defaultChatSummaryVisibility },
      );

      let logId: string;
      let visibility: Visibility;
      let chatSummaryVisibility: Visibility;
      let revision = existing?.claudeRevision ?? 0;

      if (decision.result === 'created') {
        logId = newId();
        const inserted = await tx
          .insert(workLogs)
          .values({
            id: logId,
            userId: caller.userId,
            periodKey,
            periodStart: now,
            periodEnd: now,
            summary: decision.content.summary,
            tasks: log.tasks,
            blockers: decision.content.blockers,
            claudeChatSummary: decision.content.claudeChatSummary,
            visibility: decision.visibility,
            visibilitySetBy: 'claude',
            chatSummaryVisibility: decision.chatSummaryVisibility,
            chatSummaryVisibilitySetBy: 'claude',
            source,
            oauthClientId: caller.clientId,
            claudeWrittenAt: now,
            claudeRevision: 1,
            createdAt: now,
            updatedAt: now,
          })
          .onConflictDoNothing({ target: [workLogs.userId, workLogs.periodKey] })
          .returning({ id: workLogs.id });
        // A concurrent call created today's row first: decide again against it.
        if (!inserted.length && attempt === 0) continue;
        if (!inserted.length) throw new Error('work log insert conflicted twice');
        visibility = decision.visibility;
        chatSummaryVisibility = decision.chatSummaryVisibility;
        revision = 1;
      } else if (!existing) {
        throw new Error('unreachable: non-create decision without an existing log');
      } else if (decision.result === 'updated') {
        logId = existing.id;
        revision = existing.claudeRevision + 1;
        await tx
          .update(workLogs)
          .set({
            summary: decision.content.summary,
            tasks: log.tasks,
            blockers: decision.content.blockers,
            claudeChatSummary: decision.content.claudeChatSummary,
            visibility: decision.visibility,
            chatSummaryVisibility: decision.chatSummaryVisibility,
            periodEnd: now,
            claudeRevision: sql`${workLogs.claudeRevision} + 1`,
            claudeWrittenAt: now,
            source,
            oauthClientId: caller.clientId,
            updatedAt: now,
          })
          .where(eq(workLogs.id, existing.id));
        visibility = decision.visibility;
        chatSummaryVisibility = decision.chatSummaryVisibility;
      } else if (decision.result === 'unchanged') {
        logId = existing.id;
        // Record the check-in without bumping updated_at (the company feed is ordered by it).
        await tx
          .update(workLogs)
          .set({ claudeWrittenAt: now, source, oauthClientId: caller.clientId, updatedAt: existing.updatedAt })
          .where(eq(workLogs.id, existing.id));
        visibility = decision.visibility;
        chatSummaryVisibility = decision.chatSummaryVisibility;
      } else {
        // skipped_user_edited / skipped_user_deleted: the owner's decision wins; nothing is written.
        logId = existing.id;
        visibility = existing.visibility;
        chatSummaryVisibility = existing.chatSummaryVisibility;
      }

      await markLinkedAfterWorkLog(tx, caller.userId, now);
      await recordLinkWrite(tx, caller, now);

      if (decision.result === 'created' || decision.result === 'updated') {
        await notifyTown(tx, {
          v: 1,
          type: 'work_log_changed',
          user_id: caller.userId,
          log_id: logId,
          visibility,
          created: decision.result === 'created',
          by: 'claude',
        });
      }

      await audit(tx, {
        actorType: 'claude',
        actorUserId: caller.userId,
        oauthClientId: caller.clientId,
        action:
          decision.result === 'created'
            ? 'work_log.create'
            : decision.result === 'updated' || decision.result === 'unchanged'
              ? 'work_log.update'
              : 'work_log.skipped',
        targetType: 'work_log',
        targetId: logId,
        // Counts and lengths only: never the text itself.
        metadata: {
          result: decision.result,
          period_key: periodKey,
          revision,
          source,
          visibility,
          chat_summary_visibility: chatSummaryVisibility,
          summary_len: log.summary.length,
          tasks_count: log.tasks.length,
          blockers_count: log.blockers.length,
          chat_summary_len: log.claudeChatSummary?.length ?? 0,
        },
      });

      const result: PostWorkLogOutput = {
        log_id: logId,
        result: decision.result,
        period_key: periodKey,
        visibility,
        chat_summary_visibility: chatSummaryVisibility,
        view_url: workLogViewUrl(opts.publicUrl, logId),
      };
      return result;
    }
  });
  return out;
}
