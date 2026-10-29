import { notifyTown, petNudges, type Db } from '@enu/db';
import { and, eq, gt, gte, inArray, lt, lte } from 'drizzle-orm';

/** A nudge shown `max_shows` times is kept around this long after its last showing (for ack/dismiss). */
export const EXHAUSTED_NUDGE_GRACE_MS = 2 * 60 * 60 * 1000;

const ACTIVE_STATUSES = ['pending', 'shown', 'snoozed'] as const;

export interface ExpireNudgesSummary {
  /** Active nudges whose `expires_at` passed. */
  expired: number;
  /** Shown `max_shows` times and last shown more than 2 h ago. */
  exhausted: number;
  /** Snooze ended (and not expired): back to pending. */
  unsnoozed: number;
  /** Distinct owners notified with `nudges_changed`. */
  notifiedUsers: number;
}

/**
 * nudges.expire (every 10 min). Status transitions only; the text is never touched.
 * All updates and the per-owner NOTIFYs happen in one transaction, so realtime reloads
 * only after commit and sees the final state.
 */
export async function expireNudges(db: Db, now: Date): Promise<ExpireNudgesSummary> {
  const exhaustedBefore = new Date(now.getTime() - EXHAUSTED_NUDGE_GRACE_MS);
  return db.transaction(async (tx) => {
    const expired = await tx
      .update(petNudges)
      .set({ status: 'expired' })
      .where(and(inArray(petNudges.status, [...ACTIVE_STATUSES]), lte(petNudges.expiresAt, now)))
      .returning({ userId: petNudges.userId });

    const exhausted = await tx
      .update(petNudges)
      .set({ status: 'expired' })
      .where(
        and(
          eq(petNudges.status, 'shown'),
          gte(petNudges.showCount, petNudges.maxShows),
          lt(petNudges.lastShownAt, exhaustedBefore),
        ),
      )
      .returning({ userId: petNudges.userId });

    const unsnoozed = await tx
      .update(petNudges)
      .set({ status: 'pending' })
      .where(
        and(eq(petNudges.status, 'snoozed'), lte(petNudges.snoozedUntil, now), gt(petNudges.expiresAt, now)),
      )
      .returning({ userId: petNudges.userId });

    const users = [...new Set([...expired, ...exhausted, ...unsnoozed].map((r) => r.userId))].sort();
    for (const userId of users) {
      await notifyTown(tx, { v: 1, type: 'nudges_changed', user_id: userId });
    }
    return {
      expired: expired.length,
      exhausted: exhausted.length,
      unsnoozed: unsnoozed.length,
      notifiedUsers: users.length,
    };
  });
}
