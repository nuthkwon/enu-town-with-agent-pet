import { audit, desks, notifyTown, profiles, updateDefaultPet, type Db } from '@enu/db';
import { PRIVACY_NOTICE_VERSION, normalizeLine, type OnboardingSubmit } from '@enu/shared';
import { and, eq, isNull } from 'drizzle-orm';
import { ko } from '@/i18n/ko';
import { HttpError } from '../http';
import type { Viewer } from '../session';
import { deskOf, ensureProfile } from './me';
import { claimPetSpecies, grantConsent, recordShareActivity, withdrawConsent } from './profile';

/**
 * Finishes the /welcome wizard in one transaction: consent(s) for the current notice version,
 * pet (409 pet_taken when another active member has that species), seat (assign a free one, keep the
 * current one, or 409 when taken), avatar/chat-summary default, the explicit 활동 공유 choice,
 * onboarding timestamp, and NOTIFY profile_changed (+ desks_changed when the seat moved,
 * + activity_changed when sharing changed).
 */
export async function submitOnboarding(
  db: Db,
  viewer: Viewer,
  body: OnboardingSubmit,
  now = new Date(),
): Promise<void> {
  if (body.accept_notice_version !== PRIVACY_NOTICE_VERSION) {
    throw new HttpError(400, 'notice_required', ko.errors.noticeRequired, [
      { field: 'accept_notice_version', reason: 'invalid_value' },
    ]);
  }
  const petName = normalizeLine(body.pet_name);
  if (!petName)
    throw new HttpError(400, 'invalid_body', ko.errors.invalidBody, [{ field: 'pet_name', reason: 'empty' }]);
  const profile = await ensureProfile(db, viewer);

  await db.transaction(async (tx) => {
    await claimPetSpecies(tx, viewer.userId, body.pet_species);
    await grantConsent(tx, viewer.userId, 'service', now);
    if (body.default_chat_summary_visibility === 'company')
      await grantConsent(tx, viewer.userId, 'claude_chat_summary', now);
    else await withdrawConsent(tx, viewer.userId, 'claude_chat_summary', now);

    let seatChanged = false;
    const current = await deskOf(tx, viewer.userId);
    if (body.desk_id && body.desk_id !== current) {
      const [desk] = await tx
        .select({ deskId: desks.deskId, userId: desks.userId })
        .from(desks)
        .where(eq(desks.deskId, body.desk_id))
        .for('update');
      if (!desk)
        throw new HttpError(400, 'unknown_desk', ko.errors.unknownDesk, [
          { field: 'desk_id', reason: 'invalid_value' },
        ]);
      if (desk.userId && desk.userId !== viewer.userId)
        throw new HttpError(409, 'desk_taken', ko.errors.deskTaken, [{ field: 'desk_id', reason: 'taken' }]);
      await tx.update(desks).set({ userId: null }).where(eq(desks.userId, viewer.userId));
      const taken = await tx
        .update(desks)
        .set({ userId: viewer.userId })
        .where(and(eq(desks.deskId, body.desk_id), isNull(desks.userId)))
        .returning({ deskId: desks.deskId });
      if (taken.length === 0)
        throw new HttpError(409, 'desk_taken', ko.errors.deskTaken, [{ field: 'desk_id', reason: 'taken' }]);
      seatChanged = true;
      await audit(tx, {
        actorType: 'user',
        actorUserId: viewer.userId,
        action: 'desk.self_assign',
        targetType: 'desk',
        targetId: body.desk_id,
        metadata: { from: current },
      });
    }

    await tx
      .update(profiles)
      .set({
        avatar: body.avatar,
        defaultChatSummaryVisibility: body.default_chat_summary_visibility,
        shareActivity: body.share_activity,
        onboardingCompletedAt: profile.onboardingCompletedAt ?? now,
      })
      .where(eq(profiles.userId, viewer.userId));
    await updateDefaultPet(tx, viewer.userId, { name: petName, species: body.pet_species });
    await recordShareActivity(tx, viewer.userId, profile.shareActivity, body.share_activity, now);
    await audit(tx, {
      actorType: 'user',
      actorUserId: viewer.userId,
      action: 'onboarding.completed',
      metadata: {
        noticeVersion: PRIVACY_NOTICE_VERSION,
        chatSummaryVisibility: body.default_chat_summary_visibility,
        shareActivity: body.share_activity,
      },
    });
    await notifyTown(tx, { v: 1, type: 'profile_changed', user_id: viewer.userId });
    if (seatChanged) await notifyTown(tx, { v: 1, type: 'desks_changed' });
  });
}
