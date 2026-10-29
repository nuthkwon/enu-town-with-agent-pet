import { notifyTown, nudgeDeliveries, petNudges, type Db, type DbOrTx } from '@enu/db';
import type { NudgeAction, NudgeDto } from '@enu/shared';
import { and, asc, eq, gt, inArray, isNull } from 'drizzle-orm';
import { ko } from '@/i18n/ko';
import { toNudgeDto } from '../dto';
import { HttpError, notFound } from '../http';
import type { Viewer } from '../session';

const ACTIVE = ['pending', 'shown', 'snoozed'] as const;
export const DEFAULT_SNOOZE_MINUTES = 30;

/** Bubbles that can still be shown (not expired, not acked/dismissed/superseded). */
export async function listActiveNudges(db: DbOrTx, userId: string, now = new Date()): Promise<NudgeDto[]> {
  const rows = await db
    .select()
    .from(petNudges)
    .where(
      and(eq(petNudges.userId, userId), inArray(petNudges.status, [...ACTIVE]), gt(petNudges.expiresAt, now)),
    )
    .orderBy(asc(petNudges.priority), asc(petNudges.showAfter), asc(petNudges.createdAt))
    .limit(100);
  return rows.map(toNudgeDto);
}

/** ack / dismiss / snooze from the pet bubble or /me; realtime hides the bubble on NOTIFY. */
export async function applyNudgeAction(
  db: Db,
  viewer: Viewer,
  id: string,
  body: NudgeAction,
  now = new Date(),
): Promise<NudgeDto> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(petNudges)
      .where(and(eq(petNudges.id, id), eq(petNudges.userId, viewer.userId)))
      .for('update');
    if (!row) throw notFound();
    if (!(ACTIVE as readonly string[]).includes(row.status))
      throw new HttpError(409, 'nudge_not_active', ko.errors.nudgeNotActive);

    const set: Partial<typeof petNudges.$inferInsert> =
      body.action === 'ack'
        ? { status: 'acked', ackedAt: now }
        : body.action === 'dismiss'
          ? { status: 'dismissed', dismissedAt: now }
          : {
              status: 'snoozed',
              snoozedUntil: new Date(
                now.getTime() + (body.snooze_minutes ?? DEFAULT_SNOOZE_MINUTES) * 60_000,
              ),
            };
    const [after] = await tx.update(petNudges).set(set).where(eq(petNudges.id, id)).returning();
    await tx
      .update(nudgeDeliveries)
      .set({ outcome: body.action, outcomeAt: now })
      .where(and(eq(nudgeDeliveries.nudgeId, id), isNull(nudgeDeliveries.outcome)));
    await notifyTown(tx, { v: 1, type: 'nudges_changed', user_id: viewer.userId });
    return toNudgeDto(after ?? row);
  });
}
