import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { devEmail } from '../env';
import { devLogin, openTown, userIdOf } from '../support/auth';
import { connectClaude, mcpClient, structured } from '../support/claude';
import { fxDrawn, plate, playerState, railRow, waitForTownState } from '../support/town';

/**
 * The owner decides (P6, D21): turning 활동 공유 off removes the Claude-derived activity from every
 * colleague's screen at once, and turning 접속 표시 off means opening the town no longer draws the owner
 * (only the name stays on the desk plate). A DM's paper plane is drawn only for its two participants.
 * Example roster (pseudonyms): R2b = 직원07 (owner), R3b = 직원10 (colleague), L2b = 직원05 (third).
 */

test.describe.configure({ mode: 'serial' });

const SEOUL_OFFSET_MS = 9 * 3600_000;
const DAY_MS = 86_400_000;

/** A focus block covering now, kept inside today's office day (Asia/Seoul), as post_activity requires. */
function focusBlockNow(): { start_at: string; end_at: string; kind: 'focus' } {
  const now = Date.now();
  const dayStart = Math.floor((now + SEOUL_OFFSET_MS) / DAY_MS) * DAY_MS - SEOUL_OFFSET_MS;
  const start = Math.max(dayStart, now - 10 * 60_000);
  const end = Math.min(dayStart + DAY_MS, now + 60 * 60_000);
  return { start_at: new Date(start).toISOString(), end_at: new Date(end).toISOString(), kind: 'focus' };
}

async function saveSettings(
  page: Page,
  toggleId: 'share-activity' | 'show-live',
  on: boolean,
): Promise<void> {
  await page.goto('/me?tab=settings');
  const input = page.locator(`#${toggleId}`);
  await expect(input).toBeAttached();
  if ((await input.isChecked()) !== on) await page.locator(`label[for="${toggleId}"]`).click();
  await expect(input).toBeChecked({ checked: on });
  await page.getByRole('button', { name: '저장', exact: true }).click();
  await expect(page.getByText('저장했어요')).toBeVisible();
}

let owner: BrowserContext;
let colleague: BrowserContext;
let ownerId: string;
let colleaguePage: Page;

test.beforeAll(async ({ browser }) => {
  owner = await browser.newContext();
  colleague = await browser.newContext();
  await devLogin(owner, devEmail('R2b'));
  await devLogin(colleague, devEmail('R3b'));
  ownerId = await userIdOf(owner);
});

test.afterAll(async () => {
  await owner?.close();
  await colleague?.close();
});

test('turning 활동 공유 off removes the Claude-derived activity within 2 s', async () => {
  test.setTimeout(180_000);
  const claude = await mcpClient((await connectClaude(owner)).token);
  const r = structured<{ result: string; schedule_blocks: number }>(
    await claude.callTool({ name: 'post_activity', arguments: { now: null, schedule: [focusBlockNow()] } }),
  );
  expect(r).toMatchObject({ result: 'stored', schedule_blocks: 1 });
  await claude.close().catch(() => undefined);

  colleaguePage = await colleague.newPage();
  await openTown(colleaguePage);
  await waitForTownState(colleaguePage);
  // The owner has not opened the town: the calendar focus block alone draws them at their desk.
  await expect(railRow(colleaguePage, '직원07')).toContainText('집중 모드 · 캘린더 일정');
  expect((await playerState(colleaguePage, ownerId))?.shown).toBe(true);

  const settings = await owner.newPage();
  await saveSettings(settings, 'share-activity', false);
  await expect
    .poll(async () => (await playerState(colleaguePage, ownerId))?.shown, { timeout: 2_000 })
    .toBe(false);
  await expect(railRow(colleaguePage, '직원07')).not.toContainText('캘린더 일정', { timeout: 1_000 });
  // Sharing off also drops the work-log label: only the name is left on the plate.
  expect((await plate(colleaguePage, 'R2b'))?.lines).toEqual(['직원07']);
  await settings.close();
});

test('with 접속 표시 off, opening the town no longer draws the owner: only the name on the plate', async () => {
  test.setTimeout(180_000);
  const town = await owner.newPage();
  await openTown(town);
  await waitForTownState(town);
  // 서로 보기: the open town draws the owner, with the online dot.
  await expect
    .poll(async () => (await playerState(colleaguePage, ownerId))?.online, { timeout: 10_000 })
    .toBe(true);
  await expect(railRow(colleaguePage, '직원07')).toContainText('ENU Den 접속');

  const settings = await owner.newPage();
  await saveSettings(settings, 'show-live', false);
  await settings.close();
  await town.reload();
  await waitForTownState(town);
  await town.waitForTimeout(1_500);
  const seen = await playerState(colleaguePage, ownerId);
  expect(seen).toMatchObject({ shown: false, online: false });
  expect(await plate(colleaguePage, 'R2b')).toEqual({ kind: 'hidden', lines: ['직원07'], online: false });
  await expect(railRow(colleaguePage, '직원07').getByRole('img', { name: '접속 중' })).toHaveCount(0);
  await town.close();
});

test('a DM paper plane is drawn for its two participants only', async ({ browser }) => {
  test.setTimeout(180_000);
  const ownerTown = await owner.newPage();
  await openTown(ownerTown);
  await waitForTownState(ownerTown);
  const third = await browser.newContext();
  await devLogin(third, devEmail('L2b'));
  const thirdPage = await third.newPage();
  await openTown(thirdPage);
  await waitForTownState(thirdPage);
  const before = await Promise.all([ownerTown, colleaguePage, thirdPage].map((p) => fxDrawn(p)));

  // The colleague is drawn (town open); the owner's plate anchors the plane while 접속 표시 is off.
  await railRow(colleaguePage, '직원07').click();
  await colleaguePage.getByRole('menuitem', { name: 'DM 보내기' }).click();
  const box = colleaguePage.getByRole('textbox', { name: /메시지 입력/ });
  await box.fill('E2E: 검토 자료 공유드려요');
  await box.press('Enter');
  await expect
    .poll(async () => (await fxDrawn(ownerTown)).plane, { timeout: 5_000 })
    .toBeGreaterThan(before[0]!.plane);
  await expect
    .poll(async () => (await fxDrawn(colleaguePage)).plane, { timeout: 5_000 })
    .toBeGreaterThan(before[1]!.plane);
  await thirdPage.waitForTimeout(1_500);
  expect((await fxDrawn(thirdPage)).plane).toBe(before[2]!.plane);
  await colleaguePage.keyboard.press('Escape');
  await third.close();
  await ownerTown.close();
});
