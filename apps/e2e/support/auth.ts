import { expect, type BrowserContext, type Page } from '@playwright/test';
import { BASE_URL } from '../env';

/** Signs a browser context in through the development-only login endpoint. */
export async function devLogin(context: BrowserContext, email: string): Promise<void> {
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
