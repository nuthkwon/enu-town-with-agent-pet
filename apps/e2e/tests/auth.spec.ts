import { expect, test } from '@playwright/test';
import { BASE_URL } from '../env';

test.describe('access control', () => {
  test('town requires sign-in', async ({ page }) => {
    await page.goto('/town');
    await expect(page).toHaveURL(/\/sign-in/);
    await expect(page.getByRole('button', { name: /Google/ })).toBeVisible();
  });

  test('only the company domain can sign in', async ({ request }) => {
    const res = await request.post(`${BASE_URL}/api/auth/dev/login`, {
      headers: { origin: BASE_URL },
      data: { email: 'someone@gmail.com' },
    });
    expect(res.status()).toBe(403);
  });

  test('REST API rejects anonymous callers', async ({ request }) => {
    expect((await request.get(`${BASE_URL}/api/v1/me`)).status()).toBe(401);
  });

  test('MCP endpoint challenges with protected resource metadata', async ({ request }) => {
    const res = await request.post(`${BASE_URL}/api/mcp`, { data: {} });
    expect(res.status()).toBe(401);
    const challenge = res.headers()['www-authenticate'] ?? '';
    expect(challenge).toContain(
      `resource_metadata="${BASE_URL}/.well-known/oauth-protected-resource/api/mcp"`,
    );
    const prm = await (await request.get(`${BASE_URL}/.well-known/oauth-protected-resource/api/mcp`)).json();
    expect(prm.resource).toBe(`${BASE_URL}/api/mcp`);
    const as = await (
      await request.get(`${BASE_URL}/.well-known/oauth-authorization-server/api/auth`)
    ).json();
    expect(as.code_challenge_methods_supported).toContain('S256');
  });
});
