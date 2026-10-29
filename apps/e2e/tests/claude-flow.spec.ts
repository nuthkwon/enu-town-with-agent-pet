import { expect, test } from '@playwright/test';
import { BASE_URL, devEmail } from '../env';
import { devLogin, openTown, userIdOf } from '../support/auth';
import { connectClaude, mcpClient, structured } from '../support/claude';
import { petBubble, petState, playerState, playerTile, railRow, waitForTownState } from '../support/town';

/**
 * The core promise of ENU Town, end to end:
 * an employee's own Claude connects through the ENU Town consent screen, writes the day's work log
 * and a pet message over MCP; the pet shows that exact text to its owner only; a colleague sees the
 * work log (written by the owner's Claude) on the profile card; when both people's own Claudes report
 * the same work item, a third colleague sees the reviewer standing at the author's desk (mutual
 * corroboration, nobody steers); owner decisions win; revoking cuts Claude off.
 */

const NUDGE = 'E2E 테스트: 3시 회의 전에 검토 자료 확인해 볼까요?';
const SUMMARY = 'E2E 테스트로 HMI 화면 설계 리뷰와 SQA 검토 요청 사항을 정리했습니다.';

test('Claude writes; the owner sees the pet bubble, colleagues see the work log', async ({ browser }) => {
  test.setTimeout(240_000);
  const owner = await browser.newContext();
  const colleague = await browser.newContext();
  const third = await browser.newContext();
  await devLogin(owner, devEmail('L1b'));
  await devLogin(colleague, devEmail('L2a'));
  await devLogin(third, devEmail('L3a'));
  const ownerId = await userIdOf(owner);
  const colleagueId = await userIdOf(colleague);

  // 1. The owner's Claude connects through the real consent page.
  const { token } = await connectClaude(owner);
  const claude = await mcpClient(token);
  const tools = await claude.listTools();
  expect(tools.tools.map((t) => t.name).sort()).toEqual(
    ['get_my_context', 'post_activity', 'post_pet_nudges', 'post_work_log', 'upsert_todos'].sort(),
  );
  expect(JSON.stringify(tools)).not.toContain('requiresUserInteraction');

  const ctx = structured<{ me?: { email: string } }>(
    await claude.callTool({ name: 'get_my_context', arguments: { include: ['profile'] } }),
  );
  expect(ctx.me?.email).toBe(devEmail('L1b'));

  // 2. Claude writes today's log and a pet message. Personal data is rejected, never rewritten.
  const log = structured<{ log_id: string; result: string; visibility: string }>(
    await claude.callTool({
      name: 'post_work_log',
      arguments: {
        summary: SUMMARY,
        tasks: [{ title: 'HMI 화면 설계 리뷰', status: 'done', ref: 'ENU-301' }],
        claude_chat_summary: '설계 리뷰 체크리스트 구성 방법을 Claude와 논의했습니다.',
        source_hint: 'interactive',
      },
    }),
  );
  expect(['created', 'updated']).toContain(log.result);
  expect(log.visibility).toBe('company');

  const nudges = structured<{ accepted: number; rejected: { reason: string }[] }>(
    await claude.callTool({
      name: 'post_pet_nudges',
      arguments: { nudges: [{ text: NUDGE, priority: 1 }, { text: '010-1234-5678 로 연락하기' }] },
    }),
  );
  expect(nudges.accepted).toBe(1);
  expect(nudges.rejected.map((r) => r.reason)).toEqual(['pii']);

  // 3. The colleague sees the Claude-written log on the owner's profile card.
  const card = await (await colleague.request.get(`${BASE_URL}/api/v1/users/${ownerId}/card`)).json();
  expect(card.latestLog.summary).toBe(SUMMARY);
  expect(card.latestLog.provenanceLabel).toContain('Claude가 작성');

  // 4. The pet bubble: exact text, owner only (realtime runs with NUDGE_IGNORE_QUIET_HOURS in e2e).
  const ownerPage = await owner.newPage();
  const colleaguePage = await colleague.newPage();
  await openTown(ownerPage);
  await openTown(colleaguePage);
  // Drawn on the canvas (not just the hidden live region), and mirrored for screen readers.
  await expect.poll(async () => (await petBubble(ownerPage))?.text, { timeout: 45_000 }).toBe(NUDGE);
  await expect(ownerPage.getByRole('status').filter({ hasText: NUDGE })).toHaveCount(1);
  // The colleague's client never decodes the text (or even a sign that a bubble is up).
  await waitForTownState(colleaguePage);
  await colleaguePage.waitForTimeout(3_000);
  expect(await petState(colleaguePage, ownerId)).toEqual({
    bubbleId: '',
    bubbleText: '',
    bubbleUntil: 0,
    indicator: 0,
  });
  await expect(colleaguePage.getByText(NUDGE)).toHaveCount(0);
  await ownerPage.screenshot({ path: 'screenshots/owner-town.png' });
  await colleaguePage.screenshot({ path: 'screenshots/colleague-town.png' });

  // 4b. Same work item, reported by each person's own Claude: the reviewer stands at the author's desk.
  const colleagueClaude = await mcpClient((await connectClaude(colleague)).token);
  const thirdPage = await third.newPage();
  await openTown(thirdPage);
  await waitForTownState(thirdPage);
  const authorTile = await playerTile(thirdPage, ownerId);
  expect(authorTile, 'the author has the town open, so they are drawn').not.toBeNull();
  const stored = [
    structured<{ result: string; now_until: string | null }>(
      await claude.callTool({
        name: 'post_activity',
        arguments: { now: { kind: 'work', ref: 'jira:ENU-301' } },
      }),
    ),
    structured<{ result: string; now_until: string | null }>(
      await colleagueClaude.callTool({
        name: 'post_activity',
        arguments: { now: { kind: 'review', ref: 'jira:ENU-301' } },
      }),
    ),
  ];
  expect(stored.map((r) => r.result)).toEqual(['stored', 'stored']);
  // Within 5 s the third browser sees the reviewer on a visitor tile next to the author's seat ...
  await expect
    .poll(
      async () => {
        const at = await playerTile(thirdPage, colleagueId);
        return at && authorTile ? Math.abs(at.x - authorTile.x) + Math.abs(at.y - authorTile.y) : null;
      },
      { timeout: 5_000 },
    )
    .toBe(1);
  expect(await playerTile(thirdPage, ownerId)).toEqual(authorTile);
  // ... both in the same (opaque) group, and the team rail says what it is and where it comes from.
  const [a, b] = [await playerState(thirdPage, ownerId), await playerState(thirdPage, colleagueId)];
  expect(a?.groupId).toMatch(/^g/);
  expect(b?.groupId).toBe(a?.groupId);
  await expect(railRow(thirdPage, '직원04')).toContainText('검토 중 · Claude 보고');
  await expect(railRow(thirdPage, '직원02')).toContainText('개인 업무 · Claude 보고');
  await colleagueClaude.close().catch(() => undefined);

  // 5. Owner decisions win: making the log private hides it, and Claude cannot raise it again.
  const patch = await owner.request.patch(`${BASE_URL}/api/v1/me/work-logs/${log.log_id}`, {
    headers: { origin: BASE_URL },
    data: { visibility: 'private' },
  });
  expect(patch.status(), await patch.text()).toBe(200);
  const again = structured<{ visibility: string }>(
    await claude.callTool({
      name: 'post_work_log',
      arguments: { summary: `${SUMMARY} 오후 작업도 추가했습니다.`, visibility: 'company' },
    }),
  );
  expect(again.visibility).toBe('private');
  const hidden = await (await colleague.request.get(`${BASE_URL}/api/v1/users/${ownerId}/work-logs`)).json();
  expect(hidden.items.map((l: { id: string }) => l.id)).not.toContain(log.log_id);

  // 6. Revoking the connection cuts Claude off immediately.
  const revoke = await owner.request.post(`${BASE_URL}/api/v1/me/claude-links/revoke`, {
    headers: { origin: BASE_URL },
    data: {},
  });
  expect(revoke.status(), await revoke.text()).toBe(200);
  await new Promise((r) => setTimeout(r, 1100));
  const afterRevoke = await fetch(`${BASE_URL}/api/mcp`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
  });
  expect(afterRevoke.status).toBe(401);

  await claude.close().catch(() => undefined);
  await owner.close();
  await colleague.close();
  await third.close();
});
