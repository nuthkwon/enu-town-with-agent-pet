import { createHash, randomBytes } from 'node:crypto';
import { claudeLinks, petChannelTokens, privacyConsents, profiles, user, type Db } from '@enu/db';
import { PET_CHANNEL, PRIVACY_NOTICE_VERSION } from '@enu/shared';
import { and, eq, isNull } from 'drizzle-orm';
import { checkEmailAllowed, type DomainPolicy } from './domain-guard';

/**
 * Bearer tokens of the Claude Code pet channel (ADR 0006). A token is `edc_` + 32 random bytes (base64url); only
 * its sha256 is stored. It is accepted only by `/api/v1/pet-channel/*`: it is not a JWT, so `/api/mcp` refuses it,
 * and cookie routes never read the Authorization header.
 */

const TOKEN_BYTES = 32;
/** `edc_` + base64url of 32 bytes (43 characters). */
const TOKEN_RE = new RegExp(`^${PET_CHANNEL.tokenPrefix}[A-Za-z0-9_-]{43}$`);

export function newPetChannelToken(): string {
  return `${PET_CHANNEL.tokenPrefix}${randomBytes(TOKEN_BYTES).toString('base64url')}`;
}

export function hashPetChannelToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** The `claude_links.client_id` of one paired machine (unique per user, never a host name). */
export function petChannelClientId(tokenId: string): string {
  return `enu-den-channel:${tokenId}`;
}

export type PetChannelRefusal =
  | 'invalid_token'
  | 'token_revoked'
  | 'token_expired'
  | 'user_inactive'
  /** Not onboarded, or the current privacy notice is not accepted (403). */
  | 'notice_required';

export type PetChannelCaller =
  | {
      ok: true;
      userId: string;
      tokenId: string;
      linkId: string;
      clientId: string;
      expiresAt: Date;
      displayName: string;
      timezone: string;
    }
  | { ok: false; reason: PetChannelRefusal };

/** Reads `Authorization: Bearer edc_…`; anything else is null (never a cookie). */
export function bearerPetChannelToken(headers: Headers): string | null {
  const auth = headers.get('authorization');
  if (!auth) return null;
  const m = /^Bearer\s+(\S+)$/i.exec(auth.trim());
  const token = m?.[1] ?? null;
  return token && TOKEN_RE.test(token) ? token : null;
}

/**
 * Who is calling a channel route, checked on every request: the token exists, its link is not revoked, it has not
 * expired, and its owner is active, in the domain, onboarded and has accepted the current notice.
 */
export async function resolvePetChannelCaller(
  db: Db,
  token: string | null,
  policy: DomainPolicy,
  now = new Date(),
): Promise<PetChannelCaller> {
  if (!token || !TOKEN_RE.test(token)) return { ok: false, reason: 'invalid_token' };
  const [row] = await db
    .select({
      tokenId: petChannelTokens.id,
      linkId: petChannelTokens.linkId,
      expiresAt: petChannelTokens.expiresAt,
      clientId: claudeLinks.clientId,
      revokedAt: claudeLinks.revokedAt,
      userId: user.id,
      email: user.email,
      status: user.status,
      displayName: profiles.displayName,
      timezone: profiles.timezone,
      onboardedAt: profiles.onboardingCompletedAt,
    })
    .from(petChannelTokens)
    .innerJoin(claudeLinks, eq(claudeLinks.id, petChannelTokens.linkId))
    .innerJoin(user, eq(user.id, petChannelTokens.userId))
    .leftJoin(profiles, eq(profiles.userId, petChannelTokens.userId))
    .where(eq(petChannelTokens.tokenHash, hashPetChannelToken(token)))
    .limit(1);
  if (!row) return { ok: false, reason: 'invalid_token' };
  if (row.revokedAt) return { ok: false, reason: 'token_revoked' };
  if (row.expiresAt <= now) return { ok: false, reason: 'token_expired' };
  if (row.status !== 'active' || !checkEmailAllowed(row.email, policy).ok) {
    return { ok: false, reason: 'user_inactive' };
  }
  if (!row.onboardedAt || !(await acceptedNotice(db, row.userId))) {
    return { ok: false, reason: 'notice_required' };
  }
  return {
    ok: true,
    userId: row.userId,
    tokenId: row.tokenId,
    linkId: row.linkId,
    clientId: row.clientId,
    expiresAt: row.expiresAt,
    displayName: row.displayName ?? row.email,
    timezone: row.timezone ?? 'Asia/Seoul',
  };
}

async function acceptedNotice(db: Db, userId: string): Promise<boolean> {
  const [c] = await db
    .select({ id: privacyConsents.id })
    .from(privacyConsents)
    .where(
      and(
        eq(privacyConsents.userId, userId),
        eq(privacyConsents.noticeVersion, PRIVACY_NOTICE_VERSION),
        eq(privacyConsents.scope, 'service'),
        isNull(privacyConsents.withdrawnAt),
      ),
    )
    .limit(1);
  return Boolean(c);
}
