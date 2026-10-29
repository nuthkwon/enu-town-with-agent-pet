import { createHash, randomBytes } from 'node:crypto';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { expect, type BrowserContext } from '@playwright/test';
import { BASE_URL, devEmail } from '../env';
import { devLogin } from './auth';

/**
 * Plays the role of an employee's Claude: registers a public OAuth client (stand-in for Claude's
 * CIMD identity), runs authorize -> ENU Town consent page (clicked in the browser) -> token,
 * then talks to /api/mcp with the MCP SDK client like a Cowork scheduled task would.
 */
const REDIRECT = 'http://127.0.0.1:7777/callback';
const b64url = (b: Buffer) => b.toString('base64url');

export async function connectClaude(context: BrowserContext): Promise<{ token: string; clientId: string }> {
  // Manually managed clients are admin-only (the real Claude registers itself through CIMD).
  const browser = context.browser();
  if (!browser) throw new Error('connectClaude needs a browser-backed context');
  const admin = await browser.newContext();
  await devLogin(admin, devEmail('R1'));
  const created = await admin.request.post(`${BASE_URL}/api/auth/oauth2/create-client`, {
    headers: { origin: BASE_URL },
    data: {
      client_name: 'Claude (e2e)',
      redirect_uris: [REDIRECT],
      token_endpoint_auth_method: 'none',
      application_type: 'native',
    },
  });
  expect(created.status(), await created.text()).toBeLessThan(300);
  const clientId = ((await created.json()) as { client_id: string }).client_id;
  await admin.close();

  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash('sha256').update(verifier).digest());
  const resource = `${BASE_URL}/api/mcp`;
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: REDIRECT,
    scope: 'openid profile email offline_access',
    state: 'e2e',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    resource,
  });

  const page = await context.newPage();
  let code: string | null = null;
  await page.route('http://127.0.0.1:7777/**', async (route) => {
    code = new URL(route.request().url()).searchParams.get('code');
    await route.fulfill({ status: 200, body: 'ok' });
  });
  await page.goto(`${BASE_URL}/api/auth/oauth2/authorize?${params}`);
  await expect(page).toHaveURL(/\/consent/);
  await expect(page.getByText('dev.', { exact: false }).first()).toBeVisible();
  await page.getByRole('button', { name: /허용|연결/ }).first().click();
  await expect.poll(() => code, { timeout: 20_000 }).not.toBeNull();
  await page.close();

  const tokenRes = await context.request.post(`${BASE_URL}/api/auth/oauth2/token`, {
    form: {
      grant_type: 'authorization_code',
      code: code!,
      redirect_uri: REDIRECT,
      client_id: clientId,
      code_verifier: verifier,
      resource,
    },
  });
  expect(tokenRes.status(), await tokenRes.text()).toBe(200);
  const token = ((await tokenRes.json()) as { access_token: string }).access_token;
  return { token, clientId };
}

export async function mcpClient(token: string): Promise<Client> {
  const client = new Client({ name: 'claude-e2e', version: '0.0.1' });
  const transport = new StreamableHTTPClientTransport(new URL(`${BASE_URL}/api/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  });
  await client.connect(transport);
  return client;
}

export function structured<T>(result: unknown): T {
  const r = result as { isError?: boolean; structuredContent?: unknown; content?: { text?: string }[] };
  expect(r.isError, JSON.stringify(r.content)).toBeFalsy();
  return r.structuredContent as T;
}
