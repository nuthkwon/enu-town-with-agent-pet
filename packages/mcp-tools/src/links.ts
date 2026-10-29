import { audit, claudeLinks, loadHolidays, newId, notifyTown, profiles, type Db, type DbOrTx } from '@enu/db';
import { computeLinkState } from '@enu/domain';
import { APP_TIMEZONE_DEFAULT, type LinkState } from '@enu/shared';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';

export interface CallerInfo {
  userId: string;
  clientId: string;
}

export type TouchLinkResult = { ok: true; created: boolean } | { ok: false; reason: 'revoked' };

/**
 * Records a tool call on the caller's (user, OAuth client) link. Creates the link when the
 * consent hook missed it (consentedAt = now). A revoked link is left untouched and reported,
 * so the tool can refuse (defense in depth; the token gate should already have refused).
 */
export async function touchClaudeLink(
  db: Db,
  caller: CallerInfo,
  toolName: string,
  now: Date,
): Promise<TouchLinkResult> {
  return db.transaction(async (tx) => {
    const rows = await tx
      .insert(claudeLinks)
      .values({
        id: newId(),
        userId: caller.userId,
        clientId: caller.clientId,
        consentedAt: now,
        firstToolCallAt: now,
        lastToolCallAt: now,
        lastToolName: toolName,
        toolCallCount: 1,
      })
      .onConflictDoUpdate({
        target: [claudeLinks.userId, claudeLinks.clientId],
        set: {
          firstToolCallAt: sql`coalesce(${claudeLinks.firstToolCallAt}, excluded.first_tool_call_at)`,
          lastToolCallAt: now,
          lastToolName: toolName,
          toolCallCount: sql`${claudeLinks.toolCallCount} + 1`,
        },
        setWhere: sql`${claudeLinks.revokedAt} is null`,
      })
      .returning({ id: claudeLinks.id, inserted: sql<boolean>`(xmax = 0)` });
    const row = rows[0];
    if (!row) return { ok: false, reason: 'revoked' } as const;
    if (row.inserted) {
      await refreshLinkStateInTx(tx, caller.userId, now);
      await audit(tx, {
        actorType: 'claude',
        actorUserId: caller.userId,
        oauthClientId: caller.clientId,
        action: 'claude_link.create_on_tool_call',
        targetType: 'claude_link',
        targetId: row.id,
        metadata: { tool: toolName },
      });
    }
    return { ok: true, created: row.inserted } as const;
  });
}

/** Marks a successful Claude write on the caller's link (inside the write transaction). */
export async function recordLinkWrite(tx: DbOrTx, caller: CallerInfo, now: Date): Promise<void> {
  await tx
    .update(claudeLinks)
    .set({ lastWriteAt: now })
    .where(and(eq(claudeLinks.userId, caller.userId), eq(claudeLinks.clientId, caller.clientId)));
}

/** Recomputes the owner's link state from active links (used when a link was created by a tool call). */
async function refreshLinkStateInTx(tx: DbOrTx, userId: string, now: Date): Promise<void> {
  const [profile] = await tx
    .select({
      timezone: profiles.timezone,
      lastWorkLogAt: profiles.lastWorkLogAt,
      linkState: profiles.linkState,
    })
    .from(profiles)
    .where(eq(profiles.userId, userId))
    .for('update');
  if (!profile) return;
  const [latest] = await tx
    .select({ consentedAt: claudeLinks.consentedAt })
    .from(claudeLinks)
    .where(and(eq(claudeLinks.userId, userId), isNull(claudeLinks.revokedAt)))
    .orderBy(desc(claudeLinks.consentedAt))
    .limit(1);
  const state = computeLinkState({
    now,
    timeZone: profile.timezone || APP_TIMEZONE_DEFAULT,
    holidays: await loadHolidays(tx),
    hasActiveLink: Boolean(latest),
    consentedAt: latest?.consentedAt ?? null,
    lastWorkLogAt: profile.lastWorkLogAt,
  });
  if (state !== profile.linkState) {
    await tx
      .update(profiles)
      .set({ linkState: state, linkStateChangedAt: now, updatedAt: now })
      .where(eq(profiles.userId, userId));
    await notifyTown(tx, { v: 1, type: 'link_state_changed', user_id: userId, state });
  }
}

/**
 * A Claude work-log write proves the link is alive: sets last_work_log_at and link_state='linked'
 * and publishes link_state_changed when the state actually changes. Returns the previous state.
 */
export async function markLinkedAfterWorkLog(
  tx: DbOrTx,
  userId: string,
  now: Date,
): Promise<{ changed: boolean; previous: LinkState | null }> {
  const [profile] = await tx
    .select({ linkState: profiles.linkState })
    .from(profiles)
    .where(eq(profiles.userId, userId))
    .for('update');
  if (!profile) return { changed: false, previous: null };
  const changed = profile.linkState !== 'linked';
  await tx
    .update(profiles)
    .set(
      changed
        ? { lastWorkLogAt: now, linkState: 'linked', linkStateChangedAt: now, updatedAt: now }
        : { lastWorkLogAt: now, updatedAt: now },
    )
    .where(eq(profiles.userId, userId));
  if (changed) await notifyTown(tx, { v: 1, type: 'link_state_changed', user_id: userId, state: 'linked' });
  return { changed, previous: profile.linkState as LinkState };
}

/**
 * Serializes concurrent writes of one owner within a scope (to-do cap, nudge daily cap, dedupe)
 * for the rest of the transaction.
 */
export async function lockOwnerScope(tx: DbOrTx, scope: string, userId: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`enu-den:${scope}:${userId}`}))`);
}
