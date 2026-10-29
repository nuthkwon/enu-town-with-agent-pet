import { userPresence, type Db } from '@enu/db';
import { and, eq, gt } from 'drizzle-orm';

export const PRESENCE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export interface PresenceRow {
  x: number;
  y: number;
  dir: number;
  zoneId: string | null;
}

/** Last known position if it is younger than 24h. */
export async function loadRecentPresence(db: Db, userId: string, now: Date): Promise<PresenceRow | null> {
  const [row] = await db
    .select({ x: userPresence.x, y: userPresence.y, dir: userPresence.dir, zoneId: userPresence.zoneId })
    .from(userPresence)
    .where(and(eq(userPresence.userId, userId), gt(userPresence.lastSeenAt, new Date(now.getTime() - PRESENCE_MAX_AGE_MS))))
    .limit(1);
  return row ?? null;
}

export async function savePresence(db: Db, userId: string, p: PresenceRow, now: Date): Promise<void> {
  await db
    .insert(userPresence)
    .values({ userId, x: p.x, y: p.y, dir: p.dir, zoneId: p.zoneId, lastSeenAt: now })
    .onConflictDoUpdate({
      target: userPresence.userId,
      set: { x: p.x, y: p.y, dir: p.dir, zoneId: p.zoneId, lastSeenAt: now },
    });
}
