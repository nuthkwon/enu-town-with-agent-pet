import {
  activityReports,
  audit,
  defaultPetOf,
  lockPetSpecies,
  newId,
  notifyTown,
  privacyConsents,
  profiles,
  takenPetSpecies,
  updateDefaultPet,
  type Db,
  type DbOrTx,
} from '@enu/db';
import {
  PRIVACY_NOTICE_VERSION,
  normalizeLine,
  type ConsentScope,
  type PetSpecies,
  type ProfilePatch,
  type Visibility,
} from '@enu/shared';
import { and, eq, isNull } from 'drizzle-orm';
import { ko } from '@/i18n/ko';
import { HttpError, type FieldIssue } from '../http';
import type { Viewer } from '../session';
import { ensureProfile } from './me';

/** Records (or re-activates) a consent scope for the current notice version. */
export async function grantConsent(
  tx: DbOrTx,
  userId: string,
  scope: ConsentScope,
  now: Date,
): Promise<void> {
  await tx
    .insert(privacyConsents)
    .values({ id: newId(), userId, noticeVersion: PRIVACY_NOTICE_VERSION, scope, acceptedAt: now })
    .onConflictDoUpdate({
      target: [privacyConsents.userId, privacyConsents.noticeVersion, privacyConsents.scope],
      set: { withdrawnAt: null, acceptedAt: now },
    });
}

export async function withdrawConsent(
  tx: DbOrTx,
  userId: string,
  scope: Exclude<ConsentScope, 'service'>,
  now: Date,
): Promise<void> {
  await tx
    .update(privacyConsents)
    .set({ withdrawnAt: now })
    .where(
      and(
        eq(privacyConsents.userId, userId),
        eq(privacyConsents.scope, scope),
        isNull(privacyConsents.withdrawnAt),
      ),
    );
}

/**
 * Every active member's default pet is different: refuses (409 pet_taken) a species another active member's default
 * pet has.
 * Call inside the transaction that writes the species; the lock makes check-and-write atomic.
 */
export async function claimPetSpecies(tx: DbOrTx, userId: string, species: PetSpecies): Promise<void> {
  await lockPetSpecies(tx);
  const taken = await takenPetSpecies(tx, userId);
  if (taken.includes(species)) {
    throw new HttpError(409, 'pet_taken', ko.errors.petTaken, [{ field: 'pet_species', reason: 'taken' }]);
  }
}

/**
 * Records a 활동 공유 choice in the transaction that already updated `profiles.share_activity` (that row
 * lock is what post_activity's FOR UPDATE waits on). On: the activity_sharing consent. Off: the consent
 * is withdrawn and the owner's activity reports are deleted at once. NOTIFY activity_changed on a change.
 */
export async function recordShareActivity(
  tx: DbOrTx,
  userId: string,
  before: boolean | null,
  after: boolean,
  now: Date,
): Promise<void> {
  if (after) {
    await grantConsent(tx, userId, 'activity_sharing', now);
  } else {
    await withdrawConsent(tx, userId, 'activity_sharing', now);
    await tx.delete(activityReports).where(eq(activityReports.userId, userId));
  }
  if (before !== after) await notifyTown(tx, { v: 1, type: 'activity_changed', user_id: userId });
}

const line = (v: string) => normalizeLine(v);
const optLine = (v: string | null) => (v === null ? null : normalizeLine(v) || null);

/**
 * Applies a partial profile update. Organisation fields (title, team, role note) come from the
 * roster and may only be changed by admins; members sending their current value is a no-op.
 */
export async function patchProfile(
  db: Db,
  viewer: Viewer,
  patch: ProfilePatch,
  now = new Date(),
): Promise<void> {
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
  // pet_species / pet_name edit the default pet (ADR 0005); its other fields live in /me/pets.
  const petChange: { name?: string; species?: string } = {};
  if (patch.pet_species !== undefined) petChange.species = patch.pet_species;
  if (patch.pet_name !== undefined) {
    const v = line(patch.pet_name);
    if (!v) problems.push({ field: 'pet_name', reason: 'empty' });
    else petChange.name = v;
  }
  if (patch.default_log_visibility !== undefined) set.defaultLogVisibility = patch.default_log_visibility;
  if (patch.default_chat_summary_visibility !== undefined)
    set.defaultChatSummaryVisibility = patch.default_chat_summary_visibility;
  if (patch.share_dms_with_my_claude !== undefined) set.shareDmsWithMyClaude = patch.share_dms_with_my_claude;
  if (patch.pet_chat_default_visibility !== undefined)
    set.petChatDefaultVisibility = patch.pet_chat_default_visibility;
  if (patch.share_activity !== undefined) set.shareActivity = patch.share_activity;
  if (patch.show_live !== undefined) set.showLive = patch.show_live;
  if (patch.nudges_enabled !== undefined) set.nudgesEnabled = patch.nudges_enabled;
  if (patch.nudge_min_interval_min !== undefined) set.nudgeMinIntervalMin = patch.nudge_min_interval_min;
  if (patch.max_bubbles_per_day !== undefined) set.maxBubblesPerDay = patch.max_bubbles_per_day;
  if (patch.quiet_start !== undefined) set.quietStart = patch.quiet_start;
  if (patch.quiet_end !== undefined) set.quietEnd = patch.quiet_end;
  if (problems.length) throw new HttpError(400, 'invalid_body', ko.errors.invalidBody, problems);

  await db.transaction(async (tx) => {
    // Only a change is a pick: re-sending my current species (the profile form always does) never conflicts.
    const pet = await defaultPetOf(tx, viewer.userId);
    if (patch.pet_species !== undefined && patch.pet_species !== pet?.species) {
      await claimPetSpecies(tx, viewer.userId, patch.pet_species);
    }
    if (Object.keys(set).length > 0)
      await tx.update(profiles).set(set).where(eq(profiles.userId, viewer.userId));
    if (Object.keys(petChange).length > 0) await updateDefaultPet(tx, viewer.userId, petChange);
    if (patch.share_activity !== undefined) {
      await recordShareActivity(tx, viewer.userId, current.shareActivity, patch.share_activity, now);
    }

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
    const petBefore = (current.petChatDefaultVisibility ?? 'company') as Visibility;
    const petAfter = patch.pet_chat_default_visibility;
    if (petAfter !== undefined && petAfter !== petBefore) {
      // Sharing pet conversations with colleagues is a consent of its own (ADR 0005); future messages follow it.
      if (petAfter === 'company') await grantConsent(tx, viewer.userId, 'pet_chat_sharing', now);
      else await withdrawConsent(tx, viewer.userId, 'pet_chat_sharing', now);
      await audit(tx, {
        actorType: 'user',
        actorUserId: viewer.userId,
        action: 'profile.pet_chat_default_visibility',
        targetType: 'user',
        targetId: viewer.userId,
        metadata: { from: petBefore, to: petAfter },
      });
      await notifyTown(tx, { v: 1, type: 'pets_changed', user_id: viewer.userId });
    }
    if (
      patch.default_log_visibility !== undefined &&
      patch.default_log_visibility !== current.defaultLogVisibility
    ) {
      await audit(tx, {
        actorType: 'user',
        actorUserId: viewer.userId,
        action: 'profile.default_log_visibility',
        targetType: 'user',
        targetId: viewer.userId,
        metadata: { from: current.defaultLogVisibility, to: patch.default_log_visibility },
      });
    }
    if (
      patch.share_dms_with_my_claude !== undefined &&
      patch.share_dms_with_my_claude !== current.shareDmsWithMyClaude
    ) {
      await audit(tx, {
        actorType: 'user',
        actorUserId: viewer.userId,
        action: 'profile.share_dms_with_my_claude',
        targetType: 'user',
        targetId: viewer.userId,
        metadata: { enabled: patch.share_dms_with_my_claude },
      });
    }
    if (patch.share_activity !== undefined && patch.share_activity !== current.shareActivity) {
      await audit(tx, {
        actorType: 'user',
        actorUserId: viewer.userId,
        action: 'profile.share_activity',
        targetType: 'user',
        targetId: viewer.userId,
        metadata: { enabled: patch.share_activity },
      });
    }
    if (set.title !== undefined || set.team !== undefined || set.roleNote !== undefined) {
      await audit(tx, {
        actorType: 'admin',
        actorUserId: viewer.userId,
        action: 'profile.org_fields',
        targetType: 'user',
        targetId: viewer.userId,
      });
    }
    // Also covers 접속 표시 (show_live) and 활동 공유: realtime reloads the snapshot.
    await notifyTown(tx, { v: 1, type: 'profile_changed', user_id: viewer.userId });
  });
}
