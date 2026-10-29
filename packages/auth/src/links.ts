import {
  audit,
  claudeLinks,
  desks,
  loadHolidays,
  newId,
  notifyTown,
  oauthConsent,
  oauthRefreshToken,
  profiles,
  session,
  user,
  type Db,
  type DbOrTx,
} from '@enu/db';
import { computeLinkState } from '@enu/domain';
import type { LinkState } from '@enu/shared';
import { and, desc, eq, isNull } from 'drizzle-orm';

/**
 * Claude connector links: one row per (user, OAuth client). A link is created when the
 * employee approves the consent screen in ENU Town (or, as a fallback, on the first MCP call)
 * and revoked from /me. ENU Town never sees claude.ai credentials — only its own tokens.
 */

export function classifyClient(
  clientId: string,
  redirectUri: string | null,
): 'claude_ai' | 'claude_code' | 'other' {
  const redirectHost = redirectUri ? safeHost(redirectUri) : null;
  if (redirectHost === 'localhost' || redirectHost === '127.0.0.1') return 'claude_code';
  const clientHost = safeHost(clientId);
  if (
    redirectHost?.endsWith('claude.ai') ||
    clientHost?.endsWith('claude.ai') ||
    clientHost?.endsWith('claude.com')
  ) {
    return 'claude_ai';
  }
  return 'other';
}

function safeHost(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/** Recomputes the owner's link state and notifies realtime when it changes. */
export async function refreshLinkState(
  tx: DbOrTx,
  userId: string,
  now = new Date(),
): Promise<LinkState | null> {
  const [profile] = await tx
    .select({
      timezone: profiles.timezone,
      lastWorkLogAt: profiles.lastWorkLogAt,
      linkState: profiles.linkState,
    })
    .from(profiles)
    .where(eq(profiles.userId, userId));
  if (!profile) return null;
  const [latest] = await tx
    .select({ consentedAt: claudeLinks.consentedAt })
    .from(claudeLinks)
    .where(and(eq(claudeLinks.userId, userId), isNull(claudeLinks.revokedAt)))
    .orderBy(desc(claudeLinks.consentedAt))
    .limit(1);
  const holidays = await loadHolidays(tx);
  const state = computeLinkState({
    now,
    timeZone: profile.timezone,
    holidays,
    hasActiveLink: Boolean(latest),
    consentedAt: latest?.consentedAt ?? null,
    lastWorkLogAt: profile.lastWorkLogAt,
  });
  if (state !== profile.linkState) {
    await tx
      .update(profiles)
      .set({ linkState: state, linkStateChangedAt: now })
      .where(eq(profiles.userId, userId));
    await notifyTown(tx, { v: 1, type: 'link_state_changed', user_id: userId, state });
  }
  return state;
}

export interface ConsentRecord {
  userId: string;
  clientId: string;
  clientName: string | null;
  redirectUri: string | null;
  ip?: string | null;
  userAgent?: string | null;
}

/** Called when the employee approves the consent screen. Re-activates a revoked link. */
export async function recordConsent(db: Db, c: ConsentRecord, now = new Date()): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .insert(claudeLinks)
      .values({
        id: newId(),
        userId: c.userId,
        clientId: c.clientId,
        clientName: c.clientName,
        clientKind: classifyClient(c.clientId, c.redirectUri),
        redirectHost: c.redirectUri ? safeHost(c.redirectUri) : null,
        consentedAt: now,
      })
      .onConflictDoUpdate({
        target: [claudeLinks.userId, claudeLinks.clientId],
        set: {
          clientName: c.clientName,
          clientKind: classifyClient(c.clientId, c.redirectUri),
          redirectHost: c.redirectUri ? safeHost(c.redirectUri) : null,
          consentedAt: now,
          revokedAt: null,
          revokedReason: null,
        },
      });
    await refreshLinkState(tx, c.userId, now);
    await audit(tx, {
      actorType: 'user',
      actorUserId: c.userId,
      oauthClientId: c.clientId,
      action: 'oauth.consent',
      ip: c.ip ?? null,
      userAgent: c.userAgent ?? null,
      metadata: { redirectHost: c.redirectUri ? safeHost(c.redirectUri) : null },
    });
  });
}

/**
 * Revokes one link (by id) or all of the user's links: marks them revoked, deletes the
 * matching refresh tokens and stored consents (so reconnecting always shows the consent
 * screen again) and, when everything is revoked, invalidates all outstanding access tokens.
 */
export async function revokeClaudeLinks(
  db: Db,
  userId: string,
  opts: { linkId?: string; reason?: string; actor?: 'user' | 'admin' } = {},
  now = new Date(),
): Promise<number> {
  return db.transaction(async (tx) => {
    const rows = await tx
      .select({ id: claudeLinks.id, clientId: claudeLinks.clientId })
      .from(claudeLinks)
      .where(
        and(
          eq(claudeLinks.userId, userId),
          isNull(claudeLinks.revokedAt),
          opts.linkId ? eq(claudeLinks.id, opts.linkId) : undefined,
        ),
      );
    for (const row of rows) {
      await tx
        .update(claudeLinks)
        .set({ revokedAt: now, revokedReason: opts.reason ?? 'user_revoked' })
        .where(eq(claudeLinks.id, row.id));
      await tx
        .delete(oauthRefreshToken)
        .where(and(eq(oauthRefreshToken.userId, userId), eq(oauthRefreshToken.clientId, row.clientId)));
      await tx
        .delete(oauthConsent)
        .where(and(eq(oauthConsent.userId, userId), eq(oauthConsent.clientId, row.clientId)));
    }
    const [stillActive] = await tx
      .select({ id: claudeLinks.id })
      .from(claudeLinks)
      .where(and(eq(claudeLinks.userId, userId), isNull(claudeLinks.revokedAt)))
      .limit(1);
    if (!stillActive && rows.length > 0) {
      await tx.update(user).set({ tokensRevokedAt: now }).where(eq(user.id, userId));
    }
    await refreshLinkState(tx, userId, now);
    if (rows.length > 0) {
      await audit(tx, {
        actorType: opts.actor ?? 'user',
        actorUserId: userId,
        action: 'claude_link.revoke',
        targetType: 'claude_link',
        targetId: opts.linkId ?? 'all',
        metadata: { count: rows.length },
      });
    }
    return rows.length;
  });
}

/** Admin offboarding: blocks sign-in, revokes every token and link, frees the desk. */
export async function deactivateUser(
  db: Db,
  userId: string,
  adminId: string,
  now = new Date(),
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.update(user).set({ status: 'deactivated', tokensRevokedAt: now }).where(eq(user.id, userId));
    await tx.delete(session).where(eq(session.userId, userId));
    await tx.delete(oauthRefreshToken).where(eq(oauthRefreshToken.userId, userId));
    await tx.delete(oauthConsent).where(eq(oauthConsent.userId, userId));
    await tx
      .update(claudeLinks)
      .set({ revokedAt: now, revokedReason: 'deactivated' })
      .where(and(eq(claudeLinks.userId, userId), isNull(claudeLinks.revokedAt)));
    await tx.update(desks).set({ userId: null }).where(eq(desks.userId, userId));
    await tx
      .update(profiles)
      .set({ linkState: 'not_linked', linkStateChangedAt: now })
      .where(eq(profiles.userId, userId));
    await notifyTown(tx, { v: 1, type: 'user_deactivated', user_id: userId });
    await notifyTown(tx, { v: 1, type: 'desks_changed' });
    await audit(tx, {
      actorType: 'admin',
      actorUserId: adminId,
      action: 'admin.deactivate',
      targetType: 'user',
      targetId: userId,
    });
  });
}
