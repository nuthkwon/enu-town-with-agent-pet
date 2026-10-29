import { createHash, randomBytes } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { requireMcpAuth } from '@better-auth/mcp';
import { claudeLinks, profiles, user, type DbHandle } from '@enu/db';
import { createTestUser, setupTestDb, truncateAll } from '@enu/testing';
import { toNodeHandler } from 'better-auth/node';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createAuth, mcpResourceUrl, type Auth } from '../src/create-auth';
import { recordConsent, revokeClaudeLinks } from '../src/links';
import { invalidTokenChallenge, protectedResourceMetadataUrl, resolveMcpCaller } from '../src/mcp-caller';

/**
 * End-to-end OAuth 2.1 + PKCE against a real HTTP server and Postgres:
 * dev login -> authorize -> consent -> token -> MCP route auth -> revocation.
 * (Google and CIMD legs need the internet; they are covered by unit tests + the pilot checklist.)
 */

let h: DbHandle;
let server: http.Server;
let base: string;
let auth: Auth;
let mcpRoute: (req: Request) => Promise<Response>;
const policy = { allowedHd: 'enu-tech.co.kr', allowedEmails: [] as string[] };
const REDIRECT = 'http://127.0.0.1:7777/callback';

const b64url = (buf: Buffer) => buf.toString('base64url');

async function devLogin(email: string, oauthQuery?: string): Promise<{ cookie: string; body: unknown }> {
  const res = await fetch(`${base}/api/auth/dev/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: base },
    body: JSON.stringify({ email, ...(oauthQuery ? { oauth_query: oauthQuery } : {}) }),
  });
  expect(res.status).toBe(200);
  const cookie = res.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');
  return { cookie, body: await res.json() };
}

function toHeaders(h: http.IncomingHttpHeaders): Headers {
  const out = new Headers();
  for (const [k, v] of Object.entries(h))
    if (v !== undefined) out.set(k, Array.isArray(v) ? v.join(', ') : v);
  return out;
}

const ADMIN_EMAIL = 'oauth-admin@enu-tech.co.kr';

/** Manually managed OAuth clients are admin-only (Claude itself registers through CIMD). */
async function createPublicClient(): Promise<string> {
  const { cookie } = await devLogin(ADMIN_EMAIL);
  const created = await auth.api.adminCreateOAuthClient({
    headers: new Headers({ cookie }),
    body: {
      client_name: 'Test MCP client',
      redirect_uris: [REDIRECT],
      token_endpoint_auth_method: 'none',
      application_type: 'native',
    },
  });
  return (created as { client_id: string }).client_id;
}

beforeAll(async () => {
  h = await setupTestDb();
  await truncateAll(h.db);
  server = http.createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? '/', base);
      if (url.pathname === '/api/mcp') {
        const chunks: Buffer[] = [];
        for await (const c of req) chunks.push(c as Buffer);
        const r = await mcpRoute(
          new Request(url, {
            method: req.method,
            headers: toHeaders(req.headers),
            body: chunks.length ? Buffer.concat(chunks) : undefined,
          }),
        );
        res.writeHead(r.status, Object.fromEntries(r.headers));
        res.end(Buffer.from(await r.arrayBuffer()));
        return;
      }
      return toNodeHandler(auth)(req, res);
    })();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  auth = createAuth({
    db: h.db,
    publicUrl: base,
    secret: 'test-secret-test-secret-test-secret-0123',
    google: null,
    policy,
    adminEmails: [ADMIN_EMAIL],
    cimdAllowedHosts: ['claude.ai'],
    allowDcr: false,
    accessTokenTtlSeconds: 3600,
    refreshTokenTtlDays: 30,
    devLogin: true,
  });
  const resource = mcpResourceUrl(base);
  mcpRoute = requireMcpAuth(
    auth,
    async (_req, claims) => {
      const caller = await resolveMcpCaller(h.db, claims, policy);
      if (!caller.ok) return invalidTokenChallenge(protectedResourceMetadataUrl(resource), caller.reason);
      return Response.json({ userId: caller.userId, clientId: caller.clientId });
    },
    { resource },
  );
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await h.close();
});

beforeEach(async () => {
  // mcp() seeds its oauth_resource row once at startup; keep it (and the signing keys).
  await truncateAll(h.db, { keep: ['oauth_resource', 'jwks'] });
});

describe('dev login', () => {
  it('creates in-domain users with a profile and rejects other domains', async () => {
    const { cookie } = await devLogin('kim@enu-tech.co.kr');
    const session = await auth.api.getSession({ headers: new Headers({ cookie }) });
    expect(session?.user.email).toBe('kim@enu-tech.co.kr');
    const [p] = await h.db.select().from(profiles).where(eq(profiles.userId, session!.user.id));
    expect(p?.displayName).toBe('kim');

    const res = await fetch(`${base}/api/auth/dev/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: base },
      body: JSON.stringify({ email: 'kim@gmail.com' }),
    });
    expect(res.status).toBe(403);
  });

  it('refuses sessions for deactivated users', async () => {
    const u = await createTestUser(h.db, { email: 'gone@enu-tech.co.kr', status: 'deactivated' });
    const res = await fetch(`${base}/api/auth/dev/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: base },
      body: JSON.stringify({ email: u.email }),
    });
    expect(res.status).not.toBe(200);
  });
});

describe('OAuth authorization server for the MCP connector', () => {
  it('lets only admins register OAuth clients manually', async () => {
    const body = JSON.stringify({
      client_name: 'Manual client',
      redirect_uris: [REDIRECT],
      token_endpoint_auth_method: 'none',
      application_type: 'native',
    });
    const member = await devLogin('member@enu-tech.co.kr');
    const denied = await fetch(`${base}/api/auth/oauth2/create-client`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: base, cookie: member.cookie },
      body,
    });
    expect(denied.status).toBe(401);
    const admin = await devLogin(ADMIN_EMAIL);
    const allowed = await fetch(`${base}/api/auth/oauth2/create-client`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: base, cookie: admin.cookie },
      body,
    });
    expect(allowed.status).toBe(201);
  });

  it('serves discovery metadata that points at our resource', async () => {
    const resource = mcpResourceUrl(base);
    const prm = (await fetch(protectedResourceMetadataUrl(resource)).then((r) => r.json())) as {
      resource: string;
      authorization_servers: string[];
    };
    expect(prm.resource).toBe(resource);
    expect(prm.authorization_servers[0]).toBe(`${base}/api/auth`);
    const as = (await fetch(`${base}/.well-known/oauth-authorization-server/api/auth`).then((r) =>
      r.json(),
    )) as Record<string, string[]>;
    expect(as.code_challenge_methods_supported).toContain('S256');
    expect(as.token_endpoint_auth_methods_supported).toContain('none');
    expect(as.scopes_supported).toEqual(expect.arrayContaining(['offline_access']));
    const unauth = await fetch(`${base}/api/mcp`, { method: 'POST', body: '{}' });
    expect(unauth.status).toBe(401);
    expect(unauth.headers.get('www-authenticate')).toContain(protectedResourceMetadataUrl(resource));
  });

  it('runs authorize -> consent -> token -> MCP auth -> revocation', async () => {
    const { cookie } = await devLogin('lee@enu-tech.co.kr');
    const clientId = await createPublicClient();
    const resource = mcpResourceUrl(base);
    const verifier = b64url(randomBytes(32));
    const challenge = b64url(createHash('sha256').update(verifier).digest());
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: REDIRECT,
      scope: 'openid profile email offline_access',
      state: 's1',
      code_challenge: challenge,
      code_challenge_method: 'S256',
      resource,
    });

    // With a session, authorize redirects to our consent page with a signed query.
    const authz = await fetch(`${base}/api/auth/oauth2/authorize?${params}`, {
      redirect: 'manual',
      headers: { cookie, 'sec-fetch-mode': 'navigate', accept: 'text/html' },
    });
    // Browsers get a 302; programmatic callers get { redirect, url } JSON. Accept either.
    const location =
      authz.status === 302 ? authz.headers.get('location')! : ((await authz.json()) as { url: string }).url;
    const consentUrl = new URL(location, base);
    expect(consentUrl.pathname).toBe('/consent');

    const consent = await fetch(`${base}/api/auth/oauth2/consent`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json', origin: base },
      body: JSON.stringify({ accept: true, oauth_query: consentUrl.search.slice(1) }),
    }).then((r) => r.json() as Promise<{ url: string }>);
    const code = new URL(consent.url).searchParams.get('code');
    expect(code).toBeTruthy();

    const session = await auth.api.getSession({ headers: new Headers({ cookie }) });
    await recordConsent(h.db, {
      userId: session!.user.id,
      clientId,
      clientName: 'Test MCP client',
      redirectUri: REDIRECT,
    });

    const token = await fetch(`${base}/api/auth/oauth2/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: code!,
        redirect_uri: REDIRECT,
        client_id: clientId,
        code_verifier: verifier,
        resource,
      }),
    }).then((r) => r.json() as Promise<{ access_token: string; refresh_token?: string }>);
    expect(token.access_token.split('.')).toHaveLength(3);
    expect(token.refresh_token).toBeTruthy();

    const ok = await fetch(`${base}/api/mcp`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token.access_token}`, 'content-type': 'application/json' },
      body: '{}',
    });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ userId: session!.user.id, clientId });

    const [link] = await h.db.select().from(claudeLinks).where(eq(claudeLinks.userId, session!.user.id));
    expect(link?.revokedAt).toBeNull();
    const [prof] = await h.db.select().from(profiles).where(eq(profiles.userId, session!.user.id));
    expect(prof?.linkState).toBe('linked');

    // Revoking the link invalidates already-issued access tokens and refresh tokens.
    await new Promise((r) => setTimeout(r, 1100));
    expect(await revokeClaudeLinks(h.db, session!.user.id)).toBe(1);
    const revoked = await fetch(`${base}/api/mcp`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token.access_token}`, 'content-type': 'application/json' },
      body: '{}',
    });
    expect(revoked.status).toBe(401);
    expect(revoked.headers.get('www-authenticate')).toContain('invalid_token');
    const refresh = await fetch(`${base}/api/auth/oauth2/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: token.refresh_token!,
        client_id: clientId,
      }),
    });
    expect(refresh.status).toBeGreaterThanOrEqual(400);
    const [u] = await h.db.select().from(user).where(eq(user.id, session!.user.id));
    expect(u?.tokensRevokedAt).toBeTruthy();
  });

  it('rejects tokens of deactivated users at the MCP gate', async () => {
    const { cookie } = await devLogin('park@enu-tech.co.kr');
    const session = await auth.api.getSession({ headers: new Headers({ cookie }) });
    await h.db.update(user).set({ status: 'deactivated' }).where(eq(user.id, session!.user.id));
    const r = await resolveMcpCaller(
      h.db,
      { sub: session!.user.id, azp: 'c1', iat: Math.floor(Date.now() / 1000) },
      policy,
    );
    expect(r).toEqual({ ok: false, reason: 'user_inactive' });
  });
});
