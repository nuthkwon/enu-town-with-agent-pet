import { expect, type BrowserContext, type Page } from '@playwright/test';
import { BASE_URL } from '../env';

/** Hot-update and reload messages of the `next dev` HMR socket (Next 16, Turbopack). */
const DEV_UPDATE_MESSAGES = new Set([
  'building',
  'built',
  'turbopack-message',
  'reloadPage',
  'serverComponentChanges',
  'serverOnlyChanges',
  'clientChanges',
  'middlewareChanges',
  'addedPage',
  'removedPage',
  'staticParamsChanged',
]);

/**
 * E2E runs against `next dev`, which compiles routes on first use and tells every open page about each
 * rebuild. With several pages open on a busy machine those updates turned into full-page reload loops,
 * dropping the town's realtime session mid-test. Tests never need hot updates: the HMR socket stays
 * connected (Turbopack registers chunks through it) but its update and reload messages are not passed on.
 */
export async function silenceDevReloads(context: BrowserContext): Promise<void> {
  await context.routeWebSocket(/\/_next\/(webpack-)?hmr/, (ws) => {
    const server = ws.connectToServer();
    server.onMessage((message) => {
      if (typeof message === 'string') {
        try {
          if (DEV_UPDATE_MESSAGES.has((JSON.parse(message) as { type?: string }).type ?? '')) return;
        } catch {
          // not JSON: pass it on
        }
      }
      ws.send(message);
    });
  });
}

/** Signs a browser context in through the development-only login endpoint. */
export async function devLogin(context: BrowserContext, email: string): Promise<void> {
  await silenceDevReloads(context);
  const res = await context.request.post(`${BASE_URL}/api/auth/dev/login`, {
    headers: { origin: BASE_URL, 'content-type': 'application/json' },
    data: { email },
  });
  expect(res.status(), await res.text()).toBe(200);
}

export async function openTown(page: Page): Promise<void> {
  await page.goto('/town');
  await expect(page).toHaveURL(/\/town/);
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 60_000 });
}

export async function userIdOf(context: BrowserContext): Promise<string> {
  const me = await context.request.get(`${BASE_URL}/api/v1/me`);
  expect(me.ok()).toBe(true);
  return ((await me.json()) as { userId: string }).userId;
}
