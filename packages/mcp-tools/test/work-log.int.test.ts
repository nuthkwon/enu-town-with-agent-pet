import { profiles, workLogs, type DbHandle } from '@enu/db';
import { MCP_TOOL_NAMES, postWorkLogOutput, type PostWorkLogOutput } from '@enu/shared';
import { createTestUser, setupTestDb, truncateAll } from '@enu/testing';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MODES, callTool, errorPayload } from './harness';
import { PUBLIC_URL, THU_14, auditFor, listen, makeHarness, settle, type Harness, type Listener } from './int-helpers';

let handle: DbHandle;
beforeAll(async () => {
  handle = await setupTestDb();
});
afterAll(async () => {
  await handle.close();
});

const SUMMARY = '오전에 A사 견적서를 검토하고 오후에 배포 스크립트를 정리했습니다. 내일은 회의 자료를 준비합니다.';
const CHAT = '배포 자동화와 견적 검토 방법에 대해 이야기했습니다.';

describe.each(MODES)('post_work_log (%s)', (mode) => {
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

  async function post(userId: string, args: Record<string, unknown>) {
    const client = await h.client(userId);
    return callTool(client, MCP_TOOL_NAMES.postWorkLog, args);
  }
  async function postOk(userId: string, args: Record<string, unknown>): Promise<PostWorkLogOutput> {
    const out = await post(userId, args);
    expect(out.isError, out.texts.join('\n')).toBe(false);
    return postWorkLogOutput.parse(out.structured);
  }
  const rowOf = async (userId: string) => (await handle.db.select().from(workLogs).where(eq(workLogs.userId, userId)))[0];
  const profileOf = async (userId: string) => (await handle.db.select().from(profiles).where(eq(profiles.userId, userId)))[0];

  it('creates, updates and leaves unchanged; updates profile/link state, NOTIFY and audit', async () => {
    const me = await createTestUser(handle.db, { linkState: 'not_linked' });
    const created = await postOk(me.id, {
      summary: SUMMARY,
      tasks: [{ title: '견적서 검토', status: 'done', ref: 'ENU-123' }],
      blockers: ['스테이징 서버 권한 대기'],
      claude_chat_summary: CHAT,
      source_hint: 'interactive',
    });
    expect(created).toMatchObject({
      result: 'created',
      period_key: '2026-10-29',
      visibility: 'company',
      chat_summary_visibility: 'private',
    });
    expect(created.view_url).toBe(`${PUBLIC_URL}/me?log=${created.log_id}`);

    let row = await rowOf(me.id);
    expect(row).toMatchObject({
      id: created.log_id,
      periodKey: '2026-10-29',
      summary: SUMMARY,
      tasks: [{ title: '견적서 검토', status: 'done', ref: 'ENU-123' }],
      blockers: ['스테이징 서버 권한 대기'],
      claudeChatSummary: CHAT,
      visibilitySetBy: 'claude',
      source: 'claude_interactive',
      oauthClientId: 'https://claude.ai/oauth/client',
      claudeRevision: 1,
    });
    expect(row?.periodStart.toISOString()).toBe(THU_14);
    expect(row?.periodEnd.toISOString()).toBe(THU_14);
    expect(row?.claudeWrittenAt.toISOString()).toBe(THU_14);

    let profile = await profileOf(me.id);
    expect(profile?.linkState).toBe('linked');
    expect(profile?.lastWorkLogAt?.toISOString()).toBe(THU_14);
    expect(profile?.linkStateChangedAt?.toISOString()).toBe(THU_14);

    await listener.waitFor(() => listener.forUser(me.id).some((e) => e.type === 'work_log_changed'));
    expect(listener.forUser(me.id)).toEqual(
      expect.arrayContaining([
        { v: 1, type: 'link_state_changed', user_id: me.id, state: 'linked' },
        { v: 1, type: 'work_log_changed', user_id: me.id, log_id: created.log_id, visibility: 'company', created: true },
      ]),
    );

    // Later the same day: cumulative update, Claude lowers visibility.
    h.clock.advance(2 * 60 * 60 * 1000);
    listener.events.length = 0;
    const updated = await postOk(me.id, { summary: `${SUMMARY} 오후에는 버그 두 건을 고쳤습니다.`, visibility: 'private' });
    expect(updated).toMatchObject({ log_id: created.log_id, result: 'updated', visibility: 'private' });
    row = await rowOf(me.id);
    expect(row?.claudeRevision).toBe(2);
    expect(row?.periodStart.toISOString()).toBe(THU_14);
    expect(row?.periodEnd.toISOString()).toBe('2026-10-29T07:00:00.000Z');
    expect(row?.source).toBe('cowork_scheduled');
    expect(row?.tasks).toEqual([]);
    await listener.waitFor(() => listener.forUser(me.id).some((e) => e.type === 'work_log_changed'));
    expect(listener.forUser(me.id)).toEqual([
      { v: 1, type: 'work_log_changed', user_id: me.id, log_id: created.log_id, visibility: 'private', created: false },
    ]);

    // Same content again: unchanged, no NOTIFY, updated_at kept for the feed order.
    const before = await rowOf(me.id);
    h.clock.advance(60 * 60 * 1000);
    listener.events.length = 0;
    const same = await postOk(me.id, { summary: `${SUMMARY} 오후에는 버그 두 건을 고쳤습니다.`, visibility: 'private' });
    expect(same.result).toBe('unchanged');
    const after = await rowOf(me.id);
    expect(after?.updatedAt.toISOString()).toBe(before?.updatedAt.toISOString());
    expect(after?.claudeWrittenAt.toISOString()).toBe('2026-10-29T08:00:00.000Z');
    expect(after?.claudeRevision).toBe(2);
    profile = await profileOf(me.id);
    expect(profile?.lastWorkLogAt?.toISOString()).toBe('2026-10-29T08:00:00.000Z');
    await settle();
    expect(listener.forUser(me.id)).toEqual([]);

    const audits = await auditFor(handle.db, me.id);
    expect(audits.map((a) => a.action)).toEqual([
      'claude_link.create_on_tool_call',
      'work_log.create',
      'work_log.update',
      'work_log.update',
    ]);
    const createAudit = audits[1]!;
    expect(createAudit).toMatchObject({ actorType: 'claude', oauthClientId: 'https://claude.ai/oauth/client', targetId: created.log_id });
    expect(createAudit.metadata).toMatchObject({ result: 'created', summary_len: SUMMARY.length, tasks_count: 1, blockers_count: 1 });
    const allMetadata = JSON.stringify(audits.map((a) => a.metadata));
    for (const fragment of ['견적서', '배포', '스테이징', '이야기', 'ENU-123']) expect(allMetadata).not.toContain(fragment);
  });

  it('never raises visibility above the owner default', async () => {
    const me = await createTestUser(handle.db, { defaultLogVisibility: 'private', defaultChatSummaryVisibility: 'company' });
    const out = await postOk(me.id, { summary: SUMMARY, visibility: 'company', chat_summary_visibility: 'company' });
    // The chat summary is never more visible than the log itself is allowed to be (owner default caps both).
    expect(out.visibility).toBe('private');
    expect(out.chat_summary_visibility).toBe('company');
    const row = await rowOf(me.id);
    expect(row?.visibility).toBe('private');
  });

  it("keeps a visibility the owner chose (visibility_set_by='user')", async () => {
    const me = await createTestUser(handle.db, { defaultLogVisibility: 'company' });
    const created = await postOk(me.id, { summary: SUMMARY });
    await handle.db
      .update(workLogs)
      .set({ visibility: 'private', visibilitySetBy: 'user' })
      .where(eq(workLogs.id, created.log_id));
    h.clock.advance(60_000);
    const out = await postOk(me.id, { summary: `${SUMMARY} 추가 작업을 했습니다.`, visibility: 'company' });
    expect(out).toMatchObject({ result: 'updated', visibility: 'private' });
    const row = await rowOf(me.id);
    expect(row).toMatchObject({ visibility: 'private', visibilitySetBy: 'user', summary: `${SUMMARY} 추가 작업을 했습니다.` });
  });

  it('skips (without error) when the owner edited or deleted today’s log', async () => {
    const me = await createTestUser(handle.db);
    const created = await postOk(me.id, { summary: SUMMARY });
    await handle.db.update(workLogs).set({ editedByUser: true, summary: '내가 고친 기록' }).where(eq(workLogs.id, created.log_id));
    listener.events.length = 0;
    const edited = await post(me.id, { summary: '클로드의 새 요약입니다.' });
    expect(edited.isError).toBe(false);
    expect(edited.structured).toMatchObject({ result: 'skipped_user_edited', log_id: created.log_id });
    expect(edited.texts[0]).toContain('다시 시도하지 마세요');
    expect((await rowOf(me.id))?.summary).toBe('내가 고친 기록');

    await handle.db.update(workLogs).set({ deletedAt: new Date(THU_14) }).where(eq(workLogs.id, created.log_id));
    const deleted = await postOk(me.id, { summary: '클로드의 새 요약입니다.' });
    expect(deleted).toMatchObject({ result: 'skipped_user_deleted', log_id: created.log_id });
    const row = await rowOf(me.id);
    expect(row?.summary).toBe('내가 고친 기록');
    expect(row?.deletedAt).not.toBeNull();
    await settle();
    expect(listener.forUser(me.id).filter((e) => e.type === 'work_log_changed')).toEqual([]);
    const actions = (await auditFor(handle.db, me.id)).map((a) => a.action);
    expect(actions.slice(-2)).toEqual(['work_log.skipped', 'work_log.skipped']);
  });

  it('rejects personal data and links field by field and writes nothing', async () => {
    const me = await createTestUser(handle.db);
    const out = await post(me.id, {
      summary: '고객(010-1234-5678)에게 견적서를 보냈습니다.',
      tasks: [{ title: '자료 정리 https://example.com/doc', status: 'done' }],
      blockers: ['계좌 110-123-456789 확인 필요'],
    });
    expect(out.isError).toBe(true);
    expect(out.texts[0]).toMatch(/never edits your text/);
    const payload = errorPayload(out);
    expect(payload.error).toBe('validation_failed');
    expect(payload.problems).toEqual([
      { field: 'summary', reason: 'pii', detail: 'contains phone' },
      { field: 'tasks[0].title', reason: 'url' },
      { field: 'blockers[0]', reason: 'pii', detail: 'contains account' },
    ]);
    expect(await rowOf(me.id)).toBeUndefined();
    const profile = await profileOf(me.id);
    expect(profile?.lastWorkLogAt).toBeNull();
    expect(profile?.linkState).toBe('linked');
    const actions = (await auditFor(handle.db, me.id)).map((a) => a.action);
    expect(actions).not.toContain('work_log.create');
  });

  it('keys the log by the owner-local day', async () => {
    const me = await createTestUser(handle.db);
    h.clock.set('2026-10-29T23:40:00.000Z'); // Fri 08:40 KST
    const out = await postOk(me.id, { summary: SUMMARY });
    expect(out.period_key).toBe('2026-10-30');
  });
});
