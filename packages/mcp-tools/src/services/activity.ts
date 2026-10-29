import { createHmac } from 'node:crypto';
import { activityReports, audit, notifyTown, profiles, type Db, type ScheduleBlockRow } from '@enu/db';
import { canShareActivity, prepareActivity } from '@enu/domain';
import {
  SOURCE_HINT_TO_SOURCE,
  localDateKey,
  type PostActivityInput,
  type PostActivityOutput,
} from '@enu/shared';
import { eq } from 'drizzle-orm';
import { recordLinkWrite, type CallerInfo } from '../links';
import { activeOwnerStatus, loadOwnerContext, type OwnerContext } from '../owner';
import { ToolError } from '../result';

export interface PostActivityOptions {
  now: Date;
  /** Key for the daily ref hash (derived once from BETTER_AUTH_SECRET by the web route). */
  refKey: Uint8Array;
  /** APP_TIMEZONE: the office day of every town rule (period_key, ref salt, block validation). */
  officeTimeZone: string;
  owner?: OwnerContext;
}

/**
 * The stored form of a work ref: 32 hex chars of HMAC-SHA256(key, periodKey + '\n' + ref). Equal refs of
 * one office day match; nothing links them across days, and the raw ref is never stored.
 */
export function activityRefHash(key: Uint8Array, periodKey: string, ref: string): string {
  return createHmac('sha256', key).update(`${periodKey}\n${ref}`).digest('hex').slice(0, 32);
}

/**
 * Stores what the owner is doing now and today's calendar blocks, reported by the owner's own Claude.
 * Nothing is stored unless the owner turned 활동 공유 on: the share flag is re-read under the profile row
 * lock that `PATCH share_activity=false` also takes, so a report can never outlive turning sharing off.
 * Any validation problem rejects the whole call. Audit rows carry no activity metadata.
 */
export async function postActivity(
  db: Db,
  caller: CallerInfo,
  input: PostActivityInput,
  opts: PostActivityOptions,
): Promise<PostActivityOutput> {
  const { now, officeTimeZone } = opts;
  const owner = opts.owner ?? (await loadOwnerContext(db, caller.userId));
  const periodKey = localDateKey(now, officeTimeZone);
  const ownerStatus = activeOwnerStatus(owner, now);

  const skipped = async (): Promise<PostActivityOutput> => {
    await audit(db, {
      actorType: 'claude',
      actorUserId: caller.userId,
      oauthClientId: caller.clientId,
      action: 'activity.skipped',
    });
    return {
      result: 'skipped_sharing_off',
      period_key: periodKey,
      now_until: null,
      schedule_blocks: 0,
      owner_status: ownerStatus,
    };
  };
  if (!canShareActivity(owner, { active: true })) return skipped();

  const { prepared, problems } = prepareActivity(input, now, officeTimeZone);
  if (problems.length) {
    throw new ToolError(
      'validation_failed',
      'activity rejected: nothing was saved. Fix the listed fields and call post_activity again.',
      { problems: problems.map((p) => ({ field: p.field, reason: p.reason, ...(p.detail ? { detail: p.detail } : {}) })) },
    );
  }

  const hash = (ref: string | null) => (ref ? activityRefHash(opts.refKey, prepared.periodKey, ref) : null);
  const reported = {
    nowKind: prepared.now?.kind ?? null,
    nowRefHash: hash(prepared.now?.ref ?? null),
    nowUntil: prepared.now?.until ?? null,
  };
  const schedule: ScheduleBlockRow[] | null =
    prepared.schedule?.map((b) => ({
      start_at: b.start.toISOString(),
      end_at: b.end.toISOString(),
      kind: b.kind,
      ref_hash: hash(b.ref),
    })) ?? null;
  const source = SOURCE_HINT_TO_SOURCE[input.source_hint ?? 'scheduled_task'];

  const blocks = await db.transaction(async (tx) => {
    const [profile] = await tx
      .select({ shareActivity: profiles.shareActivity })
      .from(profiles)
      .where(eq(profiles.userId, caller.userId))
      .for('update');
    // Sharing was turned off since the owner context was read: store nothing.
    if (profile?.shareActivity !== true) return null;

    const [row] = await tx
      .insert(activityReports)
      .values({
        userId: caller.userId,
        periodKey: prepared.periodKey,
        ...reported,
        schedule: schedule ?? [],
        source,
        oauthClientId: caller.clientId,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [activityReports.userId, activityReports.periodKey],
        // `now` is always replaced (null clears it); the schedule only when it was sent.
        set: { ...reported, ...(schedule ? { schedule } : {}), source, oauthClientId: caller.clientId, updatedAt: now },
      })
      .returning({ schedule: activityReports.schedule });
    await notifyTown(tx, { v: 1, type: 'activity_changed', user_id: caller.userId });
    await recordLinkWrite(tx, caller, now);
    await audit(tx, {
      actorType: 'claude',
      actorUserId: caller.userId,
      oauthClientId: caller.clientId,
      action: 'activity.post',
    });
    return row?.schedule.length ?? 0;
  });
  if (blocks === null) return skipped();

  return {
    result: 'stored',
    period_key: prepared.periodKey,
    now_until: prepared.now?.until.toISOString() ?? null,
    schedule_blocks: blocks,
    owner_status: ownerStatus,
  };
}
