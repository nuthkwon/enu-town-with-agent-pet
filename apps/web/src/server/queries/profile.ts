import { audit, newId, notifyTown, privacyConsents, profiles, type Db, type DbOrTx } from '@enu/db';
import { PRIVACY_NOTICE_VERSION, normalizeLine, type ProfilePatch, type Visibility } from '@enu/shared';
import { and, eq, isNull } from 'drizzle-orm';
import { ko } from '@/i18n/ko';
import { HttpError, type FieldIssue } from '../http';
import type { Viewer } from '../session';
import { ensureProfile } from './me';

/** Records (or re-activates) a consent scope for the current notice version. */
export async function grantConsent(tx: DbOrTx, userId: string, scope: 'service' | 'claude_chat_summary', now: Date): Promise<void> {
  await tx
    .insert(privacyConsents)
    .values({ id: newId(), userId, noticeVersion: PRIVACY_NOTICE_VERSION, scope, acceptedAt: now })
    .onConflictDoUpdate({
      target: [privacyConsents.userId, privacyConsents.noticeVersion, privacyConsents.scope],
      set: { withdrawnAt: null, acceptedAt: now },
    });
}

export async function withdrawConsent(tx: DbOrTx, userId: string, scope: 'claude_chat_summary', now: Date): Promise<void> {
  await tx
    .update(privacyConsents)
    .set({ withdrawnAt: now })
    .where(and(eq(privacyConsents.userId, userId), eq(privacyConsents.scope, scope), isNull(privacyConsents.withdrawnAt)));
}

const line = (v: string) => normalizeLine(v);
const optLine = (v: string | null) => (v === null ? null : normalizeLine(v) || null);

/**
 * Applies a partial profile update. Organisation fields (title, team, role note) come from the
 * roster and may only be changed by admins; members sending their current value is a no-op.
 */
export async function patchProfile(db: Db, viewer: Viewer, patch: ProfilePatch, now = new Date()): Promise<void> {
  const keys = Object.keys(patch) as (keyof ProfilePatch)[];
  if (keys.length === 0) throw new HttpError(400, 'empty_patch', ko.errors.emptyPatch);
  const current = await ensureProfile(db, viewer);

  const set: Partial<typeof profiles.$inferInsert> = {};
  const problems: FieldIssue[] = [];

  if (patch.display_name !== undefined) {
    const v = line(patch.display_name);
    if (!v) problems.push({ field: 'display_name', reason: 'empty' });
    else set.displayName = v;
  }
  const org: [keyof ProfilePatch, 'title' | 'team' | 'roleNote', string | null | undefined][] = [
    ['title', 'title', patch.title === undefined ? undefined : optLine(patch.title)],
    ['team', 'team', patch.team],
    ['role_note', 'roleNote', patch.role_note === undefined ? undefined : optLine(patch.role_note)],
  ];
  for (const [field, col, value] of org) {
    if (value === undefined) continue;
    if ((current[col] ?? null) === value) continue;
    if (!viewer.isAdmin) {
      throw new HttpError(403, 'forbidden', ko.me.profile.readOnly, [{ field, reason: 'admin_only' }]);
    }
    set[col] = value;
  }
  if (patch.status_text !== undefined) set.statusText = optLine(patch.status_text);
  if (patch.avatar !== undefined) set.avatar = patch.avatar;
  if (patch.pet_species !== undefined) set.petSpecies = patch.pet_species;
  if (patch.pet_name !== undefined) {
    const v = line(patch.pet_name);
    if (!v) problems.push({ field: 'pet_name', reason: 'empty' });
    else set.petName = v;
  }
  if (patch.default_log_visibility !== undefined) set.defaultLogVisibility = patch.default_log_visibility;
  if (patch.default_chat_summary_visibility !== undefined) set.defaultChatSummaryVisibility = patch.default_chat_summary_visibility;
  if (patch.share_dms_with_my_claude !== undefined) set.shareDmsWithMyClaude = patch.share_dms_with_my_claude;
  if (patch.nudges_enabled !== undefined) set.nudgesEnabled = patch.nudges_enabled;
  if (patch.nudge_min_interval_min !== undefined) set.nudgeMinIntervalMin = patch.nudge_min_interval_min;
  if (patch.max_bubbles_per_day !== undefined) set.maxBubblesPerDay = patch.max_bubbles_per_day;
  if (patch.quiet_start !== undefined) set.quietStart = patch.quiet_start;
  if (patch.quiet_end !== undefined) set.quietEnd = patch.quiet_end;
  if (problems.length) throw new HttpError(400, 'invalid_body', ko.errors.invalidBody, problems);

  await db.transaction(async (tx) => {
    await tx.update(profiles).set(set).where(eq(profiles.userId, viewer.userId));

    const chatBefore = (current.defaultChatSummaryVisibility ?? null) as Visibility | null;
    const chatAfter = patch.default_chat_summary_visibility;
    if (chatAfter !== undefined && chatAfter !== chatBefore) {
      if (chatAfter === 'company') await grantConsent(tx, viewer.userId, 'claude_chat_summary', now);
      else await withdrawConsent(tx, viewer.userId, 'claude_chat_summary', now);
      await audit(tx, {
        actorType: 'user',
        actorUserId: viewer.userId,
        action: 'profile.default_chat_summary_visibility',
        targetType: 'user',
        targetId: viewer.userId,
        metadata: { from: chatBefore, to: chatAfter },
      });
    }
    if (patch.default_log_visibility !== undefined && patch.default_log_visibility !== current.defaultLogVisibility) {
      await audit(tx, {
        actorType: 'user',
        actorUserId: viewer.userId,
        action: 'profile.default_log_visibility',
        targetType: 'user',
        targetId: viewer.userId,
        metadata: { from: current.defaultLogVisibility, to: patch.default_log_visibility },
      });
    }
    if (patch.share_dms_with_my_claude !== undefined && patch.share_dms_with_my_claude !== current.shareDmsWithMyClaude) {
      await audit(tx, {
        actorType: 'user',
        actorUserId: viewer.userId,
        action: 'profile.share_dms_with_my_claude',
        targetType: 'user',
        targetId: viewer.userId,
        metadata: { enabled: patch.share_dms_with_my_claude },
      });
    }
    if (set.title !== undefined || set.team !== undefined || set.roleNote !== undefined) {
      await audit(tx, { actorType: 'admin', actorUserId: viewer.userId, action: 'profile.org_fields', targetType: 'user', targetId: viewer.userId });
    }
    await notifyTown(tx, { v: 1, type: 'profile_changed', user_id: viewer.userId });
  });
}
