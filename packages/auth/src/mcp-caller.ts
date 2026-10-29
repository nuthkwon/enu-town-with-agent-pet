import { claudeLinks, user, type Db } from '@enu/db';
import { and, eq } from 'drizzle-orm';
import { checkEmailAllowed, type DomainPolicy } from './domain-guard';

/** Verified access-token claims as handed over by `requireMcpAuth`. */
export interface AccessTokenClaims {
  sub?: string;
  azp?: string;
  client_id?: string;
  scope?: string;
  iat?: number;
  exp?: number;
  [key: string]: unknown;
}

export type McpCaller =
  | {
      ok: true;
      userId: string;
      email: string;
      clientId: string;
      scopes: string[];
      expiresAt: number | undefined;
    }
  | { ok: false; reason: string };

/**
 * Identity checks that run AFTER signature/issuer/audience/expiry verification and BEFORE any
 * tool code: the user must still be active and in the workspace domain, and the token must
 * have been issued after any revocation (all links, or this client's link).
 */
export async function resolveMcpCaller(
  db: Db,
  claims: AccessTokenClaims,
  policy: DomainPolicy,
): Promise<McpCaller> {
  const userId = typeof claims.sub === 'string' ? claims.sub : null;
  const clientId =
    typeof claims.azp === 'string'
      ? claims.azp
      : typeof claims.client_id === 'string'
        ? claims.client_id
        : null;
  if (!userId || !clientId) return { ok: false, reason: 'token_missing_subject_or_client' };

  const [u] = await db
    .select({
      id: user.id,
      email: user.email,
      status: user.status,
      hd: user.hd,
      tokensRevokedAt: user.tokensRevokedAt,
    })
    .from(user)
    .where(eq(user.id, userId));
  if (!u) return { ok: false, reason: 'unknown_user' };
  if (u.status !== 'active') return { ok: false, reason: 'user_inactive' };
  if (!checkEmailAllowed(u.email, policy).ok) return { ok: false, reason: 'domain_not_allowed' };

  const issuedAtMs = typeof claims.iat === 'number' ? claims.iat * 1000 : 0;
  if (u.tokensRevokedAt && issuedAtMs <= u.tokensRevokedAt.getTime())
    return { ok: false, reason: 'tokens_revoked' };

  const [link] = await db
    .select({ revokedAt: claudeLinks.revokedAt })
    .from(claudeLinks)
    .where(and(eq(claudeLinks.userId, userId), eq(claudeLinks.clientId, clientId)));
  if (link?.revokedAt && issuedAtMs <= link.revokedAt.getTime()) return { ok: false, reason: 'link_revoked' };

  return {
    ok: true,
    userId,
    email: u.email,
    clientId,
    scopes: typeof claims.scope === 'string' ? claims.scope.split(' ').filter(Boolean) : [],
    expiresAt: typeof claims.exp === 'number' ? claims.exp : undefined,
  };
}

/** RFC 6750 challenge that makes Claude restart the OAuth flow (reconnect). */
export function invalidTokenChallenge(
  resourceMetadataUrl: string,
  description = 'token is no longer valid',
): Response {
  return new Response(
    JSON.stringify({ jsonrpc: '2.0', error: { code: -32001, message: description }, id: null }),
    {
      status: 401,
      headers: {
        'content-type': 'application/json',
        'www-authenticate': `Bearer error="invalid_token", error_description="${description}", resource_metadata="${resourceMetadataUrl}"`,
      },
    },
  );
}

/** URL of the protected-resource metadata for a resource such as https://host/api/mcp. */
export function protectedResourceMetadataUrl(resource: string): string {
  const u = new URL(resource);
  return `${u.origin}/.well-known/oauth-protected-resource${u.pathname}`;
}
