import { claudeLinks, loadHolidays, notifyTown, profiles, user, type Db } from '@enu/db';
import { computeLinkState } from '@enu/domain';
import { LINK_STATES, type LinkState } from '@enu/shared';
import { and, eq, isNull, max } from 'drizzle-orm';
import type { WorkerEnv } from '../env';

export interface LinkStateChange {
  userId: string;
  from: string;
  to: LinkState;
}

export interface LinkStateSummary {
  /** Active users evaluated. */
  checked: number;
  changed: number;
  changes: LinkStateChange[];
}

/** Returns `timeZone` when Intl knows it, else `fallback` (a bad profile value must not stop the job). */
export function safeTimeZone(timeZone: string | null | undefined, fallback: string): string {
  if (!timeZone) return fallback;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return timeZone;
  } catch {
    return fallback;
  }
}

const isLinkState = (v: string): v is LinkState => (LINK_STATES as readonly string[]).includes(v);

/**
 * claude.link-state (every 15 min). Recomputes linked / stale / not_linked for every active
 * user with the same rule the web app uses on write (`computeLinkState`), so "stale" appears
 * without any request. Each change is written with a guard on the old value (a concurrent
 * web-side update wins) and announced with `link_state_changed` in the same transaction.
 */
export async function refreshLinkStates(
  db: Db,
  now: Date,
  env: Pick<WorkerEnv, 'APP_TIMEZONE'>,
): Promise<LinkStateSummary> {
  const holidays = await loadHolidays(db);

  const rows = await db
    .select({
      userId: profiles.userId,
      timezone: profiles.timezone,
      linkState: profiles.linkState,
      lastWorkLogAt: profiles.lastWorkLogAt,
    })
    .from(profiles)
    .innerJoin(user, eq(user.id, profiles.userId))
    .where(eq(user.status, 'active'));

  const links = await db
    .select({ userId: claudeLinks.userId, consentedAt: max(claudeLinks.consentedAt) })
    .from(claudeLinks)
    .where(isNull(claudeLinks.revokedAt))
    .groupBy(claudeLinks.userId);
  const latestConsent = new Map(links.map((l) => [l.userId, l.consentedAt]));

  const changes: LinkStateChange[] = [];
  for (const row of rows) {
    const hasActiveLink = latestConsent.has(row.userId);
    const next = computeLinkState({
      now,
      timeZone: safeTimeZone(row.timezone, env.APP_TIMEZONE),
      holidays,
      hasActiveLink,
      consentedAt: latestConsent.get(row.userId) ?? null,
      lastWorkLogAt: row.lastWorkLogAt,
    });
    if (isLinkState(row.linkState) && next === row.linkState) continue;

    const applied = await db.transaction(async (tx) => {
      const updated = await tx
        .update(profiles)
        .set({ linkState: next, linkStateChangedAt: now })
        .where(and(eq(profiles.userId, row.userId), eq(profiles.linkState, row.linkState)))
        .returning({ userId: profiles.userId });
      if (updated.length === 0) return false;
      await notifyTown(tx, { v: 1, type: 'link_state_changed', user_id: row.userId, state: next });
      return true;
    });
    if (applied) changes.push({ userId: row.userId, from: row.linkState, to: next });
  }

  return { checked: rows.length, changed: changes.length, changes };
}
