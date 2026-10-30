import { expect, test } from '@playwright/test';
import { BASE_URL, devEmail } from '../env';
import { devLogin } from '../support/auth';
import { connectClaude, mcpClient, structured } from '../support/claude';

/**
 * The work overview (ADR 0007): what a Claude writes to a company work log shows in the feed under the town, and
 * 크게 보기 opens the popup with the town, the feed and four widgets over a translucent backdrop. Only one town canvas
 * exists at a time. Example roster (pseudonyms): L1a writes through their Claude, R2a watches (seats no other spec
 * opens the town with: the visualization spec relies on 직원14 never having opened it).
 */

const SUMMARY = 'E2E 업무 현황: 인증 심사 증적 목록을 정리했습니다.';
const TASK = 'E2E 심사 증적 정리';
const BLOCKER = 'E2E 공급사 회신 대기';
/** An ISO date-time anywhere in a payload. */
const ISO_TIME = /\d{4}-\d{2}-\d{2}T\d\d:/;

test('a Claude write shows in the feed; 크게 보기 opens the overview popup', async ({ browser }) => {
  test.setTimeout(240_000);
  const author = await browser.newContext();
  const viewer = await browser.newContext();
  await devLogin(author, devEmail('L1a'));
  await devLogin(viewer, devEmail('R2a'));

  const claude = await mcpClient((await connectClaude(author)).token);
  const log = structured<{ result: string; visibility: string }>(
    await claude.callTool({
      name: 'post_work_log',
      arguments: {
        summary: SUMMARY,
        tasks: [{ title: TASK, status: 'in_progress' }],
        blockers: [BLOCKER],
        source_hint: 'interactive',
      },
    }),
  );
  expect(log.visibility).toBe('company');

  // The API never carries an ISO time, a sequence or a source.
  for (const path of ['/api/v1/overview/feed', '/api/v1/overview/today']) {
    const res = await viewer.request.get(`${BASE_URL}${path}`);
    expect(res.status()).toBe(200);
    const raw = await res.text();
    expect(raw).toContain(SUMMARY);
    expect(raw).not.toMatch(ISO_TIME);
    for (const key of ['"seq"', 'writtenAt', '"source"']) expect(raw).not.toContain(key);
  }

  const page = await viewer.newPage();
  await page.goto('/');
  const town = page.getByRole('complementary', { name: '타운' });
  await expect(town.locator('canvas').first()).toBeVisible({ timeout: 60_000 });
  const feed = town.getByRole('region', { name: '사내 업무 현황' });
  await expect(feed.getByText(`요약: ${SUMMARY}`)).toBeVisible();
  await expect(feed.getByText(`막힘: ${BLOCKER}`)).toBeVisible();

  const expand = feed.getByRole('button', { name: '크게 보기' });
  await expand.click();
  const dialog = page.getByRole('dialog', { name: '사내 업무 현황' });
  await expect(dialog).toBeVisible();
  for (const name of ['지금 타운', '팀별 작업 상태 합계', '막힌 점 모아 보기', '팀별 오늘 현황'])
    await expect(dialog.getByRole('heading', { name })).toBeVisible();
  await expect(dialog.getByRole('region', { name: '막힌 점 모아 보기' }).getByText(BLOCKER)).toBeVisible();
  // One Phaser game at a time: the popup has the canvas, the panel a placeholder.
  await expect(dialog.locator('canvas').first()).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('canvas')).toHaveCount(1);
  await expect(town.getByText('타운을 크게 보는 중이에요.')).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(expand).toBeFocused();
  await expect(town.locator('canvas').first()).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('canvas')).toHaveCount(1);

  await author.close();
  await viewer.close();
});
