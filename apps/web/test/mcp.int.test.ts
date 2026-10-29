import { createHash, randomBytes } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { protectedResourceMetadataUrl } from '@enu/auth';
import { auditEvents, claudeLinks, profiles, type DbHandle } from '@enu/db';
import { MCP_TOOL_NAMES } from '@enu/shared';
import { createTestUser } from '@enu/testing';
import { Client, StreamableHTTPClientTransport, type FetchLike } from '@modelcontextprotocol/client';
import { toNodeHandler } from 'better-auth/node';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as asRoute from '@/app/.well-known/oauth-authorization-server/[[...path]]/route';
import * as prmRoute from '@/app/.well-known/oauth-protected-resource/[[...path]]/route';
import * as oidcRoute from '@/app/.well-known/openid-configuration/[[...path]]/route';
import * as mcpRoute from '@/app/api/mcp/route';
import * as revokeRoute from '@/app/api/v1/me/claude-links/revoke/route';
import { getAuth } from '@/server/auth';
import { performConsent } from '@/server/consent';
import { closeDb } from '@/server/db';
import { ORIGIN, authGet, authPost, call, devLogin, freshDb } from './helpers';

/**
 * The connector end to end, in-process: discovery -> authorize (signed redirect to /consent)
 * -> consent decision (server-side provider call + claude_links) -> token -> MCP tools/list and
 * tools/call through @modelcontextprotocol/client -> revocation -> 401 invalid_token.
 * requireMcpAuth fetches our JWKS over HTTP, so a tiny local server exposes auth.handler and
 * INTERNAL_BASE_URL points at it. (Google and CIMD legs need the internet: not covered here.)
 */

const RESOURCE = `${ORIGIN}/api/mcp`;
const PRM_URL = `${ORIGIN}/.well-known/oauth-protected-resource/api/mcp`;
const REDIRECT = 'http://127.0.0.1:7777/callback';

let h: DbHandle;
let jwksServer: http.Server;

const b64url = (b: Buffer) => b.toString('base64url');

const inProcessFetch: FetchLike = async (url, init) => {
  const req = new Request(url, init);
  if (req.method === 'POST') return mcpRoute.POST(req);
  if (req.method === 'DELETE') return mcpRoute.DELETE(req);
  return mcpRoute.GET(req);
};

beforeAll(async () => {
  h = await freshDb();
  jwksServer = http.createServer(toNodeHandler(getAuth()));
  await new Promise<void>((resolve) => jwksServer.listen(0, '127.0.0.1', resolve));
  process.env.INTERNAL_BASE_URL = `http://127.0.0.1:${(jwksServer.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => jwksServer.close(() => resolve()));
  await h.close();
  await closeDb();
});

beforeEach(async () => {
  await freshDb(h);
});

async function createLoopbackClient(): Promise<string> {
  const admin = await createTestUser(h.db, { role: 'admin', email: 'oauth-admin@enu-tech.co.kr' });
  const { cookie } = await devLogin(admin.email);
  const created = await getAuth().api.adminCreateOAuthClient({
    headers: new Headers({ cookie }),
    body: {
      client_name: 'Claude Code (test)',
      redirect_uris: [REDIRECT],
      token_endpoint_auth_method: 'none',
      application_type: 'native',
    },
  });
  return (created as { client_id: string }).client_id;
}

async function authorize(cookie: string, clientId: string) {
  const verifier = b64url(randomBytes(32));
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: REDIRECT,
    scope: 'openid profile email offline_access',
    state: 'st-1',
    code_challenge: b64url(createHash('sha256').update(verifier).digest()),
    code_challenge_method: 'S256',
    resource: RESOURCE,
  });
  const res = await authGet(
    new Request(`${ORIGIN}/api/auth/oauth2/authorize?${params}`, {
      headers: { cookie, accept: 'application/json' },
    }),
  );
  const location =
    res.status === 302 ? res.headers.get('location')! : ((await res.json()) as { url: string }).url;
  return { consentUrl: new URL(location, ORIGIN), verifier };
}

describe('OAuth discovery for the connector', () => {
  it('serves PRM and AS metadata from Better Auth and a matching 401 challenge', async () => {
    const prmRes = await prmRoute.GET(new Request(PRM_URL));
    expect(prmRes.status).toBe(200);
    const prm = (await prmRes.json()) as { resource: string; authorization_servers: string[] };
    expect(prm.resource).toBe(RESOURCE);
    expect(prm.authorization_servers).toEqual([`${ORIGIN}/api/auth`]);
    expect(protectedResourceMetadataUrl(prm.resource)).toBe(PRM_URL);
    expect((await prmRoute.GET(new Request(`${ORIGIN}/.well-known/oauth-protected-resource`))).status).toBe(
      200,
    );

    const asRes = await asRoute.GET(
      new Request(`${ORIGIN}/.well-known/oauth-authorization-server/api/auth`),
      {
        params: Promise.resolve({ path: ['api', 'auth'] }),
      },
    );
    expect(asRes.status).toBe(200);
    const as = (await asRes.json()) as Record<string, unknown>;
    expect(as.issuer).toBe(`${ORIGIN}/api/auth`);
    expect(as.code_challenge_methods_supported).toContain('S256');
    expect(as.token_endpoint_auth_methods_supported).toContain('none');
    expect(as.scopes_supported).toEqual(expect.arrayContaining(['offline_access']));
    expect(as.registration_endpoint).toBeUndefined();
    const other = await asRoute.GET(new Request(`${ORIGIN}/.well-known/oauth-authorization-server/x`), {
      params: Promise.resolve({ path: ['x'] }),
    });
    expect(other.status).toBe(404);
    const oidc = await oidcRoute.GET(new Request(`${ORIGIN}/.well-known/openid-configuration/api/auth`), {
      params: Promise.resolve({ path: ['api', 'auth'] }),
    });
    expect(oidc.status).toBe(200);
    expect(((await oidc.json()) as { issuer: string }).issuer).toBe(`${ORIGIN}/api/auth`);

    const unauth = await mcpRoute.POST(
      new Request(RESOURCE, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{"jsonrpc":"2.0","id":1,"method":"tools/list"}',
      }),
    );
    expect(unauth.status).toBe(401);
    const challenge = unauth.headers.get('www-authenticate') ?? '';
    expect(challenge).toContain(`resource_metadata="${PRM_URL}"`);

    const bogus = await mcpRoute.POST(
      new Request(RESOURCE, {
        method: 'POST',
        headers: { authorization: 'Bearer not-a-jwt', 'content-type': 'application/json' },
        body: '{}',
      }),
    );
    expect(bogus.status).toBe(401);

    expect((await mcpRoute.GET(new Request(RESOURCE))).status).toBe(405);
  });
});

describe('authorize -> consent -> token -> MCP', () => {
  it('connects an employee’s Claude and serves the four tools until revoked', async () => {
    const clientId = await createLoopbackClient();
    const member = await createTestUser(h.db, { name: '연결러' });
    const { cookie } = await devLogin(member.email);

    const { consentUrl, verifier } = await authorize(cookie, clientId);
    expect(consentUrl.pathname).toBe('/consent');
    expect(consentUrl.searchParams.get('sig')).toBeTruthy();

    const tampered = new URLSearchParams(consentUrl.search);
    tampered.set('redirect_uri', 'https://evil.example/cb');
    expect(
      await performConsent({
        headers: new Headers({ cookie, origin: ORIGIN }),
        accept: true,
        rawQuery: tampered.toString(),
      }),
    ).toEqual({
      kind: 'invalid',
    });
    expect(
      await performConsent({
        headers: new Headers({ origin: ORIGIN }),
        accept: true,
        rawQuery: consentUrl.search,
      }),
    ).toMatchObject({
      kind: 'sign_in',
    });

    const outcome = await performConsent({
      headers: new Headers({ cookie, origin: ORIGIN, 'user-agent': 'vitest' }),
      accept: true,
      rawQuery: `${consentUrl.search}&enu_error=failed`,
    });
    expect(outcome.kind).toBe('redirect');
    const callback = new URL((outcome as { url: string }).url);
    expect(`${callback.origin}${callback.pathname}`).toBe(REDIRECT);
    expect(callback.searchParams.get('state')).toBe('st-1');
    const code = callback.searchParams.get('code');
    expect(code).toBeTruthy();

    const [link] = await h.db.select().from(claudeLinks).where(eq(claudeLinks.userId, member.id));
    expect(link).toMatchObject({
      clientId,
      clientName: 'Claude Code (test)',
      clientKind: 'claude_code',
      redirectHost: '127.0.0.1',
      revokedAt: null,
    });
    const [profile] = await h.db.select().from(profiles).where(eq(profiles.userId, member.id));
    expect(profile?.linkState).toBe('linked');

    const tokenRes = await authPost(
      new Request(`${ORIGIN}/api/auth/oauth2/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code: code!,
          redirect_uri: REDIRECT,
          client_id: clientId,
          code_verifier: verifier,
          resource: RESOURCE,
        }),
      }),
    );
    expect(tokenRes.status, await tokenRes.clone().text()).toBe(200);
    const token = (await tokenRes.json()) as { access_token: string; refresh_token?: string };

    for (const mode of ['legacy', 'auto'] as const) {
      const client = new Client({ name: 'enu-test', version: '0.0.1' }, { versionNegotiation: { mode } });
      const transport = new StreamableHTTPClientTransport(new URL(RESOURCE), {
        fetch: inProcessFetch,
        requestInit: { headers: { Authorization: `Bearer ${token.access_token}` } },
      });
      await client.connect(transport);
      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name).sort()).toEqual(Object.values(MCP_TOOL_NAMES).sort());
      const ctx = await client.callTool({ name: MCP_TOOL_NAMES.getMyContext, arguments: {} });
      expect(ctx.isError).toBeFalsy();
      expect((ctx.structuredContent as { me?: { email: string } }).me?.email).toBe(member.email);
      await client.close();
    }

    const [touched] = await h.db.select().from(claudeLinks).where(eq(claudeLinks.userId, member.id));
    expect(touched?.toolCallCount).toBeGreaterThanOrEqual(2);

    // Revoking from /me invalidates tokens that were issued before the revocation.
    await new Promise((r) => setTimeout(r, 1100));
    const revoke = await call(revokeRoute.POST, '/api/v1/me/claude-links/revoke', {
      method: 'POST',
      cookie,
      body: {},
    });
    expect(await revoke.json()).toEqual({ revoked: 1 });
    const after = await mcpRoute.POST(
      new Request(RESOURCE, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token.access_token}`,
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      }),
    );
    expect(after.status).toBe(401);
    const header = after.headers.get('www-authenticate') ?? '';
    expect(header).toContain('error="invalid_token"');
    expect(header).toContain(`resource_metadata="${PRM_URL}"`);
  });

  it('records a denial and sends access_denied back to the client', async () => {
    const clientId = await createLoopbackClient();
    const member = await createTestUser(h.db);
    const { cookie } = await devLogin(member.email);
    const { consentUrl } = await authorize(cookie, clientId);
    const outcome = await performConsent({
      headers: new Headers({ cookie, origin: ORIGIN }),
      accept: false,
      rawQuery: consentUrl.search,
    });
    expect(outcome.kind).toBe('redirect');
    const back = new URL((outcome as { url: string }).url);
    expect(back.searchParams.get('error')).toBe('access_denied');
    expect(back.searchParams.get('code')).toBeNull();
    const links = await h.db.select().from(claudeLinks).where(eq(claudeLinks.userId, member.id));
    expect(links).toHaveLength(0);
    const audits = await h.db
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.actorUserId, member.id), eq(auditEvents.action, 'oauth.consent_denied')));
    expect(audits).toHaveLength(1);
  });
});
