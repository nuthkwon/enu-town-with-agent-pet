import { newId, petNudges, todos, type DbHandle } from '@enu/db';
import { LIMITS, MCP_TOOL_NAMES, postPetNudgesOutput, type PostPetNudgesOutput } from '@enu/shared';
import { createTestUser, setupTestDb, truncateAll } from '@enu/testing';
import { and, eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MODES, callTool } from './harness';
import { THU_14, THU_21, auditFor, listen, makeHarness, type Harness, type Listener } from './int-helpers';

let handle: DbHandle;
beforeAll(async () => {
  handle = await setupTestDb();
});
afterAll(async () => {
  await handle.close();
});

const ZWSP = String.fromCharCode(0x200b);
const at = (iso: string) => new Date(iso);

describe.each(MODES)('post_pet_nudges (%s)', (mode) => {
  let h: Harness;
  let listener: Listener;
  beforeEach(async () => {
    await truncateAll(handle.db);
    h = makeHarness(handle.db, mode);
    listener = await listen(handle);
  });
  afterEach(async () => {
    await listener.stop();
    await h.close();
  });

  async function post(userId: string, args: Record<string, unknown>): Promise<PostPetNudgesOutput> {
    const client = await h.client(userId);
    const out = await callTool(client, MCP_TOOL_NAMES.postPetNudges, args);
    expect(out.isError, out.texts.join('\n')).toBe(false);
    return postPetNudgesOutput.parse(out.structured);
  }
  const nudgesOf = async (userId: string) =>
    handle.db
      .select()
      .from(petNudges)
      .where(eq(petNudges.userId, userId))
      .orderBy(petNudges.createdAt, petNudges.id);
  const existing = (userId: string, over: Partial<typeof petNudges.$inferInsert>) => ({
    id: newId(),
    userId,
    text: '이전 메시지',
    showAfter: at('2026-10-29T01:00:00Z'),
    expiresAt: at('2026-10-29T10:00:00Z'),
    createdAt: at('2026-10-29T01:00:00Z'),
    ...over,
  });

  it('accepts nudges, stores the normalized text exactly and explains delivery', async () => {
    const me = await createTestUser(handle.db);
    const todoId = newId();
    await handle.db
      .insert(todos)
      .values({ id: todoId, userId: me.id, externalRef: 'gcal:evt1', title: '주간 회의' });
    const out = await post(me.id, {
      nudges: [
        { text: `  4시 주간 회의${ZWSP} 자료   챙기셨나요?  `, priority: 1, todo_external_ref: 'gcal:evt1' },
        { text: '오늘도 화이팅이에요!', kind: 'checkin', show_after: '2026-10-29T15:00:00+09:00' },
      ],
    });
    expect(out).toMatchObject({ accepted: 2, superseded: 0, rejected: [] });
    expect(out.delivery_note).toContain('본인에게만');
    expect(out.delivery_note).toContain('19:30');

    const rows = await nudgesOf(me.id);
    expect(rows.map((r) => r.text)).toEqual(['4시 주간 회의 자료 챙기셨나요?', '오늘도 화이팅이에요!']);
    expect(rows[0]).toMatchObject({
      kind: 'reminder',
      priority: 1,
      todoId,
      status: 'pending',
      showCount: 0,
      maxShows: 2,
      oauthClientId: 'https://claude.ai/oauth/client',
    });
    expect(rows[0]?.showAfter.toISOString()).toBe(THU_14);
    expect(rows[0]?.expiresAt.toISOString()).toBe('2026-10-29T10:00:00.000Z'); // 19:00 KST
    expect(rows[1]).toMatchObject({ kind: 'checkin', priority: 2 });
    expect(rows[1]?.showAfter.toISOString()).toBe('2026-10-29T06:00:00.000Z');
    await listener.waitFor(() => listener.forUser(me.id).some((e) => e.type === 'nudges_changed'));
    // (The fallback link creation on this first call also flips not_linked -> linked.)
    expect(listener.forUser(me.id).filter((e) => e.type !== 'link_state_changed')).toEqual([
      { v: 1, type: 'nudges_changed', user_id: me.id },
    ]);
    const audit = (await auditFor(handle.db, me.id)).find((a) => a.action === 'pet_nudges.post');
    expect(audit?.metadata).toMatchObject({ submitted: 2, accepted: 2, inserted: 2 });
    expect(JSON.stringify(audit?.metadata)).not.toContain('회의');
  });

  it('rejects single nudges with reasons and keeps the rest', async () => {
    const me = await createTestUser(handle.db);
    const out = await post(me.id, {
      nudges: [
        { text: `${ZWSP}  ` },
        { text: '010-1234-5678로 연락 주세요' },
        { text: '자료는 https://example.com 에 있어요' },
        { text: '다음 주에 봐요', show_after: '2026-11-10T10:00:00+09:00' },
        {
          text: '이상한 시간',
          show_after: '2026-10-29T16:00:00+09:00',
          expires_at: '2026-10-29T15:00:00+09:00',
        },
      ],
    });
    expect(out.accepted).toBe(0);
    expect(out.rejected).toEqual([
      { index: 0, reason: 'empty' },
      { index: 1, reason: 'pii', detail: 'contains phone' },
      { index: 2, reason: 'url' },
      { index: 3, reason: 'invalid_time', detail: 'show_after must be within 7 days' },
      { index: 4, reason: 'invalid_time', detail: 'expires_at must be after show_after' },
    ]);
    expect(out.delivery_note).toContain('다시 써서');
    const second = await post(me.id, {
      nudges: [{ text: '회의 준비해요', todo_external_ref: 'gcal:missing' }, { text: '물 한 잔 마셔요' }],
    });
    expect(second.accepted).toBe(1);
    expect(second.rejected).toEqual([
      {
        index: 0,
        reason: 'unknown_todo',
        detail: 'no to-do with this todo_external_ref; call upsert_todos first',
      },
    ]);
    expect((await nudgesOf(me.id)).map((r) => r.text)).toEqual(['물 한 잔 마셔요']);
  });

  it('supersedes only not-yet-shown nudges (pending/snoozed) unless replace_pending=false', async () => {
    const me = await createTestUser(handle.db);
    await handle.db
      .insert(petNudges)
      .values([
        existing(me.id, { text: 'pending', status: 'pending' }),
        existing(me.id, { text: 'snoozed', status: 'snoozed' }),
        existing(me.id, { text: 'shown', status: 'shown', showCount: 1 }),
        existing(me.id, { text: 'acked', status: 'acked' }),
        existing(me.id, { text: 'dismissed', status: 'dismissed' }),
      ]);
    const keep = await post(me.id, { nudges: [{ text: '추가 메시지' }], replace_pending: false });
    expect(keep).toMatchObject({ accepted: 1, superseded: 0 });

    const out = await post(me.id, { nudges: [{ text: '새 메시지' }] });
    expect(out).toMatchObject({ accepted: 1, superseded: 3 });
    expect(out.delivery_note).toContain('3개는 이번 메시지로 대체');
    const status = Object.fromEntries((await nudgesOf(me.id)).map((r) => [r.text, r.status]));
    expect(status).toEqual({
      pending: 'superseded',
      snoozed: 'superseded',
      shown: 'shown',
      acked: 'acked',
      dismissed: 'dismissed',
      '추가 메시지': 'superseded',
      '새 메시지': 'pending',
    });

    // A batch where everything is rejected supersedes nothing.
    const rejected = await post(me.id, { nudges: [{ text: 'www.example.com' }] });
    expect(rejected).toMatchObject({ accepted: 0, superseded: 0 });
    expect((await nudgesOf(me.id)).find((r) => r.text === '새 메시지')?.status).toBe('pending');
  });

  it('updates in place by dedupe_key and never resurrects acked/dismissed ones', async () => {
    const me = await createTestUser(handle.db);
    const shownId = newId();
    const ackedId = newId();
    await handle.db.insert(petNudges).values([
      existing(me.id, {
        id: shownId,
        text: '예전 문구',
        status: 'shown',
        showCount: 2,
        dedupeKey: 'standup',
      }),
      existing(me.id, { id: ackedId, text: '확인한 문구', status: 'acked', dedupeKey: 'lunch' }),
      existing(me.id, { text: '다른 대기', status: 'pending' }),
    ]);
    const out = await post(me.id, {
      nudges: [
        { text: '스탠드업 10분 전이에요', dedupe_key: 'standup', priority: 1 },
        { text: '점심 먹을 시간이에요', dedupe_key: 'lunch' },
      ],
    });
    expect(out).toMatchObject({ accepted: 1, superseded: 1, rejected: [] });
    expect(out.delivery_note).toContain('nudges[1]');
    const rows = await nudgesOf(me.id);
    expect(rows).toHaveLength(3);
    const shown = rows.find((r) => r.id === shownId);
    expect(shown).toMatchObject({
      text: '스탠드업 10분 전이에요',
      status: 'pending',
      showCount: 0,
      priority: 1,
    });
    expect(shown?.showAfter.toISOString()).toBe(THU_14);
    expect(rows.find((r) => r.id === ackedId)).toMatchObject({ text: '확인한 문구', status: 'acked' });
    expect(rows.find((r) => r.text === '다른 대기')?.status).toBe('superseded');

    // Same dedupe_key twice in one batch: the later one wins, one row.
    const twice = await post(me.id, {
      nudges: [
        { text: '첫 번째', dedupe_key: 'new-key' },
        { text: '두 번째', dedupe_key: 'new-key' },
      ],
    });
    expect(twice.accepted).toBe(2);
    const keyed = await handle.db
      .select()
      .from(petNudges)
      .where(and(eq(petNudges.userId, me.id), eq(petNudges.dedupeKey, 'new-key')));
    expect(keyed.map((r) => r.text)).toEqual(['두 번째']);
  });

  it(`caps new nudges at ${LIMITS.nudgesPerDayMax} per local day`, async () => {
    const me = await createTestUser(handle.db);
    await handle.db
      .insert(petNudges)
      .values(
        Array.from({ length: LIMITS.nudgesPerDayMax - 1 }, (_, i) =>
          existing(me.id, { text: `오늘 ${i}`, status: 'expired', createdAt: at('2026-10-28T15:30:00Z') }),
        ),
      );
    // Created yesterday (local): does not count.
    await handle.db
      .insert(petNudges)
      .values(existing(me.id, { text: '어제', status: 'expired', createdAt: at('2026-10-28T14:59:00Z') }));
    const out = await post(me.id, { nudges: [{ text: '마지막 하나' }, { text: '한도 초과' }] });
    expect(out.accepted).toBe(1);
    expect(out.rejected).toEqual([
      { index: 1, reason: 'daily_limit', detail: `at most ${LIMITS.nudgesPerDayMax} nudges per local day` },
    ]);
  });

  it('tells Claude when nudges cannot be shown before they expire', async () => {
    const me = await createTestUser(handle.db);
    h.clock.set(THU_21);
    const out = await post(me.id, { nudges: [{ text: '내일 아침 회의 잊지 마세요' }] });
    expect(out.accepted).toBe(1);
    // 21:00 -> default expiry moves to 19:00 next business day; first visible time 08:30 Friday.
    expect(out.delivery_note).toContain('10월 30일(금) 08:30');
    const [row] = await nudgesOf(me.id);
    expect(row?.expiresAt.toISOString()).toBe('2026-10-30T10:00:00.000Z');
  });
});
