import { verifyOAuthQueryParams } from '@better-auth/oauth-provider';
import { recordConsent } from '@enu/auth';
import { audit, oauthClient, safeErr } from '@enu/db';
import { eq } from 'drizzle-orm';
import { signedOAuthQuery } from '@/lib/oauth-query';
import { getAuth } from './auth';
import { getDb } from './db';
import { publicUrl } from './env';
import { getViewer } from './session';

export interface ConsentClientInfo {
  clientId: string;
  name: string | null;
  /** Host of a CIMD client id URL (https://claude.ai/...), else null. */
  clientIdHost: string | null;
  isCimd: boolean;
}

function hostOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

/** Verifies the signed consent query (signature + expiry) with the provider secret. */
export async function verifyConsentQuery(rawQuery: string): Promise<URLSearchParams | null> {
  const signed = signedOAuthQuery(rawQuery);
  if (!signed) return null;
  const { secret } = await getAuth().$context;
  if (!(await verifyOAuthQueryParams(signed, secret))) return null;
  return new URLSearchParams(signed);
}

export async function lookupClient(clientId: string): Promise<ConsentClientInfo> {
  const [row] = await getDb()
    .select({ name: oauthClient.name, discovery: oauthClient.clientDiscoveryId })
    .from(oauthClient)
    .where(eq(oauthClient.clientId, clientId))
    .limit(1);
  const clientIdHost = hostOf(clientId);
  return {
    clientId,
    name: row?.name ?? null,
    clientIdHost: clientIdHost && /^https?:/.test(clientId) ? clientIdHost : null,
    isCimd: row?.discovery === 'cimd' || clientId.startsWith('https://'),
  };
}

export type ConsentOutcome =
  | { kind: 'redirect'; url: string }
  | { kind: 'sign_in'; url: string }
  | { kind: 'invalid' }
  | { kind: 'failed' };

/**
 * The consent decision (used by the /consent server action; testable in-process):
 * session -> signed query -> provider consent endpoint (issues the code or access_denied) ->
 * claude_links upsert + audit (allow) or audit (deny) -> the client's redirect URL.
 */
export async function performConsent(input: {
  headers: Headers;
  accept: boolean;
  rawQuery: string;
}): Promise<ConsentOutcome> {
  const viewer = await getViewer(input.headers);
  const signed = signedOAuthQuery(input.rawQuery);
  if (!viewer) return { kind: 'sign_in', url: `/sign-in${signed ? `?${signed}` : ''}` };
  const params = await verifyConsentQuery(input.rawQuery);
  if (!params || !signed) return { kind: 'invalid' };
  const clientId = params.get('client_id') ?? '';
  const redirectUri = params.get('redirect_uri');

  let url: string;
  try {
    // The provider re-runs /oauth2/authorize internally, which needs a Request object; give it
    // one for the public consent endpoint carrying only what it needs (session cookie, origin).
    const forwarded = new Headers({ accept: 'application/json', origin: publicUrl() });
    for (const name of ['cookie', 'user-agent', 'x-forwarded-for']) {
      const v = input.headers.get(name);
      if (v) forwarded.set(name, v);
    }
    const raw: unknown = await getAuth().api.oauth2Consent({
      headers: forwarded,
      body: { accept: input.accept, oauth_query: signed },
      request: new Request(`${publicUrl()}/api/auth/oauth2/consent`, { method: 'POST', headers: forwarded }),
    });
    // With an explicit `request` the endpoint answers with a Response; without one, with JSON.
    const res = (raw instanceof Response ? await raw.json().catch(() => null) : raw) as {
      url?: string;
    } | null;
    if (!res?.url) {
      console.error('[enu-den] oauth2 consent returned no redirect URL');
      return { kind: 'failed' };
    }
    url = res.url;
  } catch (e) {
    console.error('[enu-den] oauth2 consent failed', safeErr(e));
    return { kind: 'failed' };
  }

  const db = getDb();
  const ip = input.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;
  const userAgent = input.headers.get('user-agent');
  try {
    if (input.accept) {
      const client = await lookupClient(clientId);
      await recordConsent(db, {
        userId: viewer.userId,
        clientId,
        clientName: client.name ?? client.clientIdHost,
        redirectUri,
        ip,
        userAgent,
      });
    } else {
      await audit(db, {
        actorType: 'user',
        actorUserId: viewer.userId,
        oauthClientId: clientId,
        action: 'oauth.consent_denied',
        ip,
        userAgent,
        metadata: { redirectHost: hostOf(redirectUri) },
      });
    }
  } catch (e) {
    // The provider already decided; the first MCP call re-creates a missing link row.
    console.error('[enu-den] recording consent failed', safeErr(e));
  }
  return { kind: 'redirect', url };
}
