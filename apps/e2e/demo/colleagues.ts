import { expect, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { BASE_URL, devEmail } from '../env';
import { devLogin, userIdOf } from '../support/auth';
import { setMyStatus } from '../support/town';

/**
 * The pseudonymous colleagues of the demo videos: each one a small browser window of their own (below 1280 px the
 * messenger mounts no town canvas, so a dozen colleagues cost the machine little while still being drawn in the
 * recorded town). Whatever they do, they do from their own screen.
 */

let clockOffsetMs = 0;

/** Follows the demo stack's clock (it may run shifted to office hours); returns the offset in ms. */
export async function followServerClock(): Promise<number> {
  const health = await fetch(`${BASE_URL}/api/healthz`);
  clockOffsetMs = new Date(health.headers.get('date') ?? Date.now()).getTime() - Date.now();
  if (Math.abs(clockOffsetMs) < 120_000) clockOffsetMs = 0;
  return clockOffsetMs;
}

/** The server's "now" (ms). */
export function serverNow(): number {
  return Date.now() + clockOffsetMs;
}

/** Moves a page's clock to the server's. */
export async function shifted(page: Page): Promise<void> {
  if (clockOffsetMs) await page.clock.setSystemTime(new Date(Date.now() + clockOffsetMs));
}

export interface Colleague {
  ctx: BrowserContext;
  page: Page;
  name: string;
  id: string;
}

/** Signs a colleague in; their messenger opens now, or later with `arrive` (they show up in the town then). */
export async function colleague(
  browser: Browser,
  desk: string,
  name: string,
  opts: { open?: boolean } = {},
): Promise<Colleague> {
  const ctx = await browser.newContext({ viewport: { width: 1000, height: 700 } });
  await devLogin(ctx, devEmail(desk));
  const id = await userIdOf(ctx);
  const page = await ctx.newPage();
  page.setDefaultTimeout(30_000);
  await shifted(page);
  const c = { ctx, page, name, id };
  if (opts.open !== false) await arrive(c);
  return c;
}

/** Opens the colleague's messenger (their session starts: the town draws them). */
export async function arrive(c: Colleague): Promise<void> {
  await c.page.goto('/all');
  await expect(c.page.getByRole('navigation', { name: '대화 목록' })).toBeVisible({ timeout: 90_000 });
}

/** Sets a colleague's own status in the town's status menu (off camera), then back to the messenger. */
export async function statusOf(c: Colleague, option: string, duration: string): Promise<void> {
  await c.page.goto('/town');
  await expect(c.page.locator('canvas').first()).toBeVisible({ timeout: 90_000 });
  await setMyStatus(c.page, option, duration);
  await arrive(c);
}

/** Opens someone's page in a colleague's messenger (a client-side move: the session stays connected). */
export async function openPerson(c: Colleague, to: { id: string; name: string }): Promise<void> {
  if (c.page.url().endsWith(`/people/${to.id}`)) return;
  await c.page
    .getByRole('navigation', { name: '대화 목록' })
    .getByRole('link', { name: new RegExp(`^${to.name}`) })
    .first()
    .click();
  await expect(c.page).toHaveURL(new RegExp(`/people/${to.id}$`));
}

/** Opens the colleague's spellbook for `to` and returns the (enabled) button of `spell`, ready to click. */
export async function readyCast(
  from: Colleague,
  to: { id: string; name: string },
  spell: string,
): Promise<Locator> {
  await openPerson(from, to);
  const dialog = from.page.getByRole('dialog', { name: `${to.name}님에게 마법 쓰기` });
  if (!(await dialog.isVisible())) await from.page.getByRole('button', { name: /마법/ }).click();
  const button = dialog.getByRole('button', { name: spell });
  await expect(button).toBeEnabled({ timeout: 20_000 });
  return button;
}

/** A colleague casts from their own screen: the 마법 button on the target's page in the messenger. */
export async function castFrom(
  from: Colleague,
  to: { id: string; name: string },
  spell: string,
): Promise<void> {
  await (await readyCast(from, to, spell)).click();
}
