import { audit, desks, notifyTown, profiles, user, workLogs, type Db, type DbOrTx } from '@enu/db';
import { DESK_IDS, type AdminSeatsDto, type LinkState } from '@enu/shared';
import { and, asc, eq, isNull, max, ne } from 'drizzle-orm';
import { ko } from '@/i18n/ko';
import { asLinkState } from '../dto';
import { HttpError } from '../http';
import type { Viewer } from '../session';
import { listDesks } from './people';

export async function adminSeats(db: DbOrTx): Promise<AdminSeatsDto> {
  const [deskList, users] = await Promise.all([
    listDesks(db),
    db
      .select({ userId: user.id, displayName: profiles.displayName, name: user.name, email: user.email, status: user.status, deskId: desks.deskId })
      .from(user)
      .leftJoin(profiles, eq(profiles.userId, user.id))
      .leftJoin(desks, eq(desks.userId, user.id))
      .orderBy(asc(user.email)),
  ]);
  return {
    desks: deskList,
    users: users.map((u) => ({
      userId: u.userId,
      displayName: u.displayName ?? u.name,
      email: u.email,
      deskId: u.deskId ?? null,
      status: u.status,
    })),
  };
}

/** Assigns (or, with userId null, frees) a desk. A user holds at most one desk. */
export async function assignSeat(db: Db, admin: Viewer, deskId: string, userId: string | null): Promise<void> {
  if (!(DESK_IDS as readonly string[]).includes(deskId)) throw new HttpError(400, 'unknown_desk', ko.errors.unknownDesk);
  await db.transaction(async (tx) => {
    const [desk] = await tx.select({ deskId: desks.deskId, userId: desks.userId }).from(desks).where(eq(desks.deskId, deskId)).for('update');
    if (!desk) throw new HttpError(404, 'unknown_desk', ko.errors.unknownDesk);
    if (userId) {
      const [u] = await tx.select({ id: user.id, status: user.status }).from(user).where(eq(user.id, userId));
      if (!u) throw new HttpError(404, 'unknown_user', ko.errors.unknownUser);
      if (u.status !== 'active') throw new HttpError(409, 'user_inactive', ko.errors.userInactive);
      if (desk.userId === userId) return;
      // Free the user's previous desk and evict the current occupant of the target desk.
      await tx.update(desks).set({ userId: null }).where(and(eq(desks.userId, userId), ne(desks.deskId, deskId)));
      await tx.update(desks).set({ userId }).where(eq(desks.deskId, deskId));
    } else {
      if (!desk.userId) return;
      await tx.update(desks).set({ userId: null }).where(eq(desks.deskId, deskId));
    }
    await audit(tx, {
      actorType: 'admin',
      actorUserId: admin.userId,
      action: userId ? 'admin.seat_assign' : 'admin.seat_unassign',
      targetType: 'desk',
      targetId: deskId,
      metadata: { userId, previousUserId: desk.userId },
    });
    await notifyTown(tx, { v: 1, type: 'desks_changed' });
  });
}

export interface AdminUserRow {
  userId: string;
  displayName: string;
  email: string;
  status: string;
  role: string;
  linkState: LinkState;
  lastLogDate: string | null;
  deskId: string | null;
  isSelf: boolean;
}

/** Users for the admin console: account and link state, last log DATE only (never contents). */
export async function adminUsers(db: DbOrTx, admin: Viewer): Promise<AdminUserRow[]> {
  const lastLogs = db
    .select({ userId: workLogs.userId, last: max(workLogs.periodKey).as('last') })
    .from(workLogs)
    .where(isNull(workLogs.deletedAt))
    .groupBy(workLogs.userId)
    .as('last_logs');
  const rows = await db
    .select({
      userId: user.id,
      name: user.name,
      email: user.email,
      status: user.status,
      role: user.role,
      displayName: profiles.displayName,
      linkState: profiles.linkState,
      deskId: desks.deskId,
      lastLogDate: lastLogs.last,
    })
    .from(user)
    .leftJoin(profiles, eq(profiles.userId, user.id))
    .leftJoin(desks, eq(desks.userId, user.id))
    .leftJoin(lastLogs, eq(lastLogs.userId, user.id))
    .orderBy(asc(user.status), asc(user.email));
  return rows.map((r) => ({
    userId: r.userId,
    displayName: r.displayName ?? r.name,
    email: r.email,
    status: r.status,
    role: r.role,
    linkState: asLinkState(r.linkState),
    lastLogDate: r.lastLogDate ?? null,
    deskId: r.deskId ?? null,
    isSelf: r.userId === admin.userId,
  }));
}

/** Link-state adoption counts among active users. */
export function adoption(rows: AdminUserRow[]): Record<LinkState, number> & { total: number } {
  const active = rows.filter((r) => r.status === 'active');
  const out = { linked: 0, stale: 0, not_linked: 0, total: active.length };
  for (const r of active) out[r.linkState] += 1;
  return out;
}
