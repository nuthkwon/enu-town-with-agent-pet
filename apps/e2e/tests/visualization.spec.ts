import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { devEmail } from '../env';
import { devLogin, openTown, userIdOf } from '../support/auth';
import {
  clickTile,
  fxDrawn,
  openMenuFromRail,
  plate,
  playerState,
  playerTile,
  rail,
  railRow,
  setMyStatus,
  spyRoomMessages,
  waitForTownState,
  zoom,
} from '../support/town';

/**
 * The town is a visualization, not a game (ADR 0004): nobody steers an avatar, the overview fits the
 * screen, and what colleagues see comes from each person's own status, the town being open and their own
 * Claude. Example roster (pseudonyms): L4a = 직원11, L4b = 직원12, L5a = 직원13, L5b = 직원14.
 */

/** Every message type the client may send now; `step` / `face` (steering) are gone. */
const CLIENT_MESSAGES = new Set([
  'presence',
  'status:set',
  'chat:send',
  'dm:send',
  'dm:read',
  'social:wave',
  'social:ping',
  'social:cast',
  'pet:bubble-seen',
]);

interface Person {
  context: BrowserContext;
  page: Page;
  userId: string;
}

test.describe.configure({ mode: 'serial' });

let a: Person;
let b: Person;
let c: Person;
let sentByA: string[] = [];

async function person(browser: Browser, deskId: string, spy = false): Promise<Person & { sent: string[] }> {
  const context = await browser.newContext();
  await devLogin(context, devEmail(deskId));
  const userId = await userIdOf(context);
  const page = await context.newPage();
  const sent = spy ? spyRoomMessages(page) : [];
  await openTown(page);
  await waitForTownState(page);
  return { context, page, userId, sent };
}

test.beforeAll(async ({ browser }) => {
  test.setTimeout(240_000);
  const pa = await person(browser, 'L4a', true);
  sentByA = pa.sent;
  a = pa;
  b = await person(browser, 'L4b');
  c = await person(browser, 'L5a');
  // Everyone with the town open is drawn ("서로 보기"), at their own desk.
  for (const p of [a, b, c]) {
    await expect
      .poll(async () => (await playerState(a.page, p.userId))?.shown, { timeout: 15_000 })
      .toBe(true);
  }
});

test.afterAll(async () => {
  for (const p of [a, b, c]) await p?.context.close();
});

test('keys and floor clicks never move anyone and send no movement', async () => {
  const before = await playerTile(a.page, a.userId);
  expect(before).not.toBeNull();
  // Focus the canvas with a click on the corridor floor (a floor click does nothing).
  await clickTile(a.page, 10, 10);
  for (const key of ['w', 'a', 's', 'd', 'ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight']) {
    await a.page.keyboard.press(key);
    await a.page.waitForTimeout(80);
  }
  await clickTile(a.page, 12, 6);
  await clickTile(a.page, 9, 14);
  await a.page.waitForTimeout(1_500);
  expect(sentByA.filter((t) => t === 'step' || t === 'face')).toEqual([]);
  expect(sentByA.filter((t) => !CLIENT_MESSAGES.has(t))).toEqual([]);
  expect(await playerTile(a.page, a.userId)).toEqual(before);
  // A floor click opens nothing.
  await expect(a.page.getByRole('menu')).toHaveCount(0);
});

test('a click inside a menu that lies over the map never reaches the map', async () => {
  await a.page.locator('[data-town-me]').click();
  const dialog = a.page.getByRole('dialog', { name: '내 상태' });
  await expect(dialog).toBeVisible();
  const box = (await dialog.boundingBox())!;
  const canvas = (await a.page.locator('canvas').first().boundingBox())!;
  const rects = await a.page.evaluate(() => window.__ENU_DEN_DEBUG__!.plateRects());
  const centre = (r: (typeof rects)[number]) => ({
    x: canvas.x + r.x + r.w / 2,
    y: canvas.y + r.y + r.h / 2,
  });
  const under = rects.find((r) => {
    const p = centre(r);
    return p.x > box.x + 8 && p.x < box.x + box.width - 8 && p.y > box.y + 8 && p.y < box.y + box.height - 8;
  });
  expect(under, 'at 1440x900 the status menu lies over a desk plate').toBeDefined();
  const p = centre(under!);
  await a.page.mouse.click(p.x, p.y);
  await a.page.waitForTimeout(500);
  await expect(dialog).toBeVisible();
  await expect(a.page.getByRole('menu')).toHaveCount(0);
  await a.page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});

test('no walking to people and no nearby chat', async () => {
  const menu = await openMenuFromRail(a.page, '직원12');
  // 8 items, then the spellbook's six spells (ADR 0008).
  await expect(menu.getByRole('menuitem')).toHaveCount(14);
  await expect(menu.getByText('옆으로 가기')).toHaveCount(0);
  await a.page.keyboard.press('Escape');
  await expect(a.page.getByRole('menu')).toHaveCount(0);
  await expect(a.page.getByText('근처', { exact: false })).toHaveCount(0);
});

test('the overview fits a maximized 1080p browser at 1.5 and a 1440x900 laptop at 1', async () => {
  await a.page.setViewportSize({ width: 1920, height: 950 });
  await expect(rail(a.page)).toBeVisible();
  await expect.poll(() => zoom(a.page)).toBe(1.5);
  const canvas = await a.page.locator('canvas').first().boundingBox();
  const rects = await a.page.evaluate(() => window.__ENU_DEN_DEBUG__!.plateRects());
  expect(rects).toHaveLength(14);
  for (const r of rects) {
    expect(r.x, r.deskId).toBeGreaterThanOrEqual(0);
    expect(r.y, r.deskId).toBeGreaterThanOrEqual(0);
    expect(r.x + r.w, r.deskId).toBeLessThanOrEqual(canvas!.width);
    expect(r.y + r.h, r.deskId).toBeLessThanOrEqual(canvas!.height);
  }
  await a.page.setViewportSize({ width: 1440, height: 900 });
  await expect.poll(() => zoom(a.page)).toBe(1);
});

test('a member who has not opened the town has no online dot and cannot be called', async () => {
  const row = railRow(a.page, '직원14');
  await expect(row).toBeVisible();
  await expect(row.getByRole('img', { name: '접속 중' })).toHaveCount(0);
  expect((await plate(a.page, 'L5b'))?.online).toBe(false);
  const menu = await openMenuFromRail(a.page, '직원14');
  await expect(menu.getByRole('menuitem', { name: '부르기' })).toBeDisabled();
  await expect(menu.getByRole('menuitem', { name: /손 흔들기/ })).toBeDisabled();
  await expect(menu.getByText('지금 화면에 없어서 할 수 없어요')).toBeVisible();
  await a.page.keyboard.press('Escape');
  // Someone with the town open does have the dot (and can be called).
  await expect(railRow(a.page, '직원12').getByRole('img', { name: '접속 중' })).toHaveCount(1);
});

test('my status is what colleagues see: 집중 모드 · 직접 설정, and 자동 clears it', async () => {
  await setMyStatus(a.page, '집중 모드', '30분');
  await expect(railRow(b.page, '직원11')).toContainText('집중 모드 · 직접 설정', { timeout: 5_000 });
  await expect(railRow(b.page, '직원11')).toContainText(/~\d{2}:\d{2}/);
  await setMyStatus(a.page, '자동 (일정·Claude·업무 기록 기준)');
  await expect(railRow(b.page, '직원11')).not.toContainText('직접 설정', { timeout: 5_000 });
  await expect(railRow(b.page, '직원11')).toContainText('ENU Den 접속');
});

test('자리 비움 hides the avatar; the desk plate reads 자리 비움 · ~HH:MM', async () => {
  await setMyStatus(a.page, '자리 비움');
  await expect.poll(async () => (await playerState(b.page, a.userId))?.shown, { timeout: 5_000 }).toBe(false);
  await expect
    .poll(async () => (await plate(b.page, 'L4a'))?.lines)
    .toEqual(['직원11', expect.stringMatching(/^자리 비움 · ~\d{2}:\d{2}$/)]);
  expect((await playerState(b.page, a.userId))?.online).toBe(false);
  await setMyStatus(a.page, '자동 (일정·Claude·업무 기록 기준)');
  await expect.poll(async () => (await playerState(b.page, a.userId))?.shown, { timeout: 5_000 }).toBe(true);
});

test('a wave is shown to everyone, a third browser included', async () => {
  const before = await fxDrawn(c.page);
  const menu = await openMenuFromRail(a.page, '직원12');
  await menu.getByRole('menuitem', { name: /손 흔들기/ }).click();
  await expect
    .poll(async () => (await fxDrawn(c.page)).wave, { timeout: 5_000 })
    .toBeGreaterThan(before.wave);
  await expect(b.page.getByText('직원11님이 나에게 손을 흔들었어요')).toBeVisible();
});
