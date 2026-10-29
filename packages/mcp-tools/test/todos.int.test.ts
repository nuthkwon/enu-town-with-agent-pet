import { newId, todos, type DbHandle } from '@enu/db';
import { LIMITS, MCP_TOOL_NAMES, upsertTodosOutput, type UpsertTodosOutput } from '@enu/shared';
import { createTestUser, setupTestDb, truncateAll } from '@enu/testing';
import { and, eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MODES, callTool, errorPayload } from './harness';
import {
  THU_14,
  auditFor,
  linkRow,
  listen,
  makeHarness,
  settle,
  type Harness,
  type Listener,
} from './int-helpers';

let handle: DbHandle;
beforeAll(async () => {
  handle = await setupTestDb();
});
afterAll(async () => {
  await handle.close();
});

describe.each(MODES)('upsert_todos (%s)', (mode) => {
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

  async function upsert(userId: string, items: Record<string, unknown>[]) {
    const client = await h.client(userId);
    return callTool(client, MCP_TOOL_NAMES.upsertTodos, { items });
  }
  async function upsertOk(userId: string, items: Record<string, unknown>[]): Promise<UpsertTodosOutput> {
    const out = await upsert(userId, items);
    expect(out.isError, out.texts.join('\n')).toBe(false);
    return upsertTodosOutput.parse(out.structured);
  }
  const rowsOf = async (userId: string) =>
    handle.db.select().from(todos).where(eq(todos.userId, userId)).orderBy(todos.externalRef);
  const rowByRef = async (userId: string, ref: string) =>
    (
      await handle.db
        .select()
        .from(todos)
        .where(and(eq(todos.userId, userId), eq(todos.externalRef, ref)))
    )[0];

  it('creates new to-dos, then updates and counts unchanged ones', async () => {
    const me = await createTestUser(handle.db);
    const first = await upsertOk(me.id, [
      {
        external_ref: 'gcal:evt1',
        title: '주간 회의 자료  준비',
        due_at: '2026-10-29T16:00:00+09:00',
        priority: 1,
      },
      {
        external_ref: 'jira:ENU-7',
        title: '배포 스크립트 정리',
        due_date: '2026-10-30',
        note: '참고: https://wiki.example/deploy',
      },
      { external_ref: 'gmail:th-9', title: '견적서 회신', status: 'done' },
    ]);
    expect(first).toMatchObject({ created: 3, updated: 0, unchanged: 0, skipped_user_controlled: 0 });
    expect(first.items.map((i) => [i.external_ref, i.status])).toEqual([
      ['gcal:evt1', 'open'],
      ['jira:ENU-7', 'open'],
      ['gmail:th-9', 'done'],
    ]);
    const evt = await rowByRef(me.id, 'gcal:evt1');
    expect(evt).toMatchObject({
      id: first.items[0]!.todo_id,
      title: '주간 회의 자료 준비',
      priority: 1,
      status: 'open',
      statusSource: 'claude',
      dueDate: null,
      oauthClientId: 'https://claude.ai/oauth/client',
      completedAt: null,
    });
    expect(evt?.dueAt?.toISOString()).toBe('2026-10-29T07:00:00.000Z');
    expect(evt?.lastSeenByClaudeAt?.toISOString()).toBe(THU_14);
    expect(await rowByRef(me.id, 'jira:ENU-7')).toMatchObject({
      dueDate: '2026-10-30',
      dueAt: null,
      note: '참고: https://wiki.example/deploy',
    });
    expect((await rowByRef(me.id, 'gmail:th-9'))?.completedAt?.toISOString()).toBe(THU_14);
    await listener.waitFor(() => listener.forUser(me.id).some((e) => e.type === 'todos_changed'));

    h.clock.advance(30 * 60 * 1000);
    listener.events.length = 0;
    const before = await rowByRef(me.id, 'jira:ENU-7');
    const second = await upsertOk(me.id, [
      {
        external_ref: 'gcal:evt1',
        title: '주간 회의 자료 준비',
        due_at: '2026-10-29T16:00:00+09:00',
        priority: 1,
        status: 'done',
      },
      {
        external_ref: 'jira:ENU-7',
        title: '배포 스크립트 정리',
        due_date: '2026-10-30',
        note: '참고: https://wiki.example/deploy',
      },
      { external_ref: 'gmail:th-9', title: '견적서 회신', status: 'open' },
    ]);
    expect(second).toMatchObject({ created: 0, updated: 2, unchanged: 1, skipped_user_controlled: 0 });
    const evt2 = await rowByRef(me.id, 'gcal:evt1');
    expect(evt2?.status).toBe('done');
    expect(evt2?.completedAt?.toISOString()).toBe('2026-10-29T05:30:00.000Z');
    const reopened = await rowByRef(me.id, 'gmail:th-9');
    expect(reopened).toMatchObject({ status: 'open', completedAt: null });
    const after = await rowByRef(me.id, 'jira:ENU-7');
    expect(after?.updatedAt.toISOString()).toBe(before?.updatedAt.toISOString());
    expect(after?.lastSeenByClaudeAt?.toISOString()).toBe('2026-10-29T05:30:00.000Z');
    await listener.waitFor(() => listener.forUser(me.id).length > 0);
    expect(listener.forUser(me.id)).toEqual([{ v: 1, type: 'todos_changed', user_id: me.id }]);

    // Nothing changed at all: no NOTIFY.
    listener.events.length = 0;
    const third = await upsertOk(me.id, [{ external_ref: 'gmail:th-9', title: '견적서 회신' }]);
    expect(third).toMatchObject({ created: 0, updated: 0, unchanged: 1 });
    await settle();
    expect(listener.forUser(me.id)).toEqual([]);

    expect(
      (await linkRow(handle.db, me.id, 'https://claude.ai/oauth/client'))?.lastWriteAt?.toISOString(),
    ).toBe('2026-10-29T05:30:00.000Z');
    const audit = (await auditFor(handle.db, me.id)).filter((a) => a.action === 'todos.upsert');
    expect(audit).toHaveLength(3);
    expect(JSON.stringify(audit.map((a) => a.metadata))).not.toContain('견적서');
  });

  it("applies Claude's status only to Claude-controlled rows and never resurrects dismissed ones", async () => {
    const me = await createTestUser(handle.db);
    await handle.db.insert(todos).values([
      {
        id: newId(),
        userId: me.id,
        externalRef: 'jira:ENU-1',
        title: '사용자가 완료',
        status: 'done',
        statusSource: 'user',
      },
      {
        id: newId(),
        userId: me.id,
        externalRef: 'jira:ENU-2',
        title: '사용자가 닫음',
        status: 'dismissed',
        statusSource: 'user',
      },
      {
        id: newId(),
        userId: me.id,
        externalRef: 'jira:ENU-3',
        title: '미룸',
        status: 'snoozed',
        statusSource: 'user',
      },
      {
        id: newId(),
        userId: me.id,
        externalRef: 'jira:ENU-4',
        title: '클로드가 닫음',
        status: 'dismissed',
        statusSource: 'claude',
      },
    ]);
    const out = await upsertOk(me.id, [
      { external_ref: 'jira:ENU-1', title: '사용자가 완료 (제목 변경)', status: 'open' },
      { external_ref: 'jira:ENU-2', title: '사용자가 닫음', status: 'open' },
      { external_ref: 'jira:ENU-3', title: '미룸', status: 'open' },
      { external_ref: 'jira:ENU-4', title: '클로드가 닫음', status: 'done' },
    ]);
    expect(out).toMatchObject({ created: 0, updated: 1, unchanged: 3, skipped_user_controlled: 3 });
    expect(out.items.map((i) => i.status)).toEqual(['done', 'dismissed', 'snoozed', 'dismissed']);
    const rows = await rowsOf(me.id);
    expect(rows.map((r) => [r.externalRef, r.status, r.statusSource, r.title])).toEqual([
      ['jira:ENU-1', 'done', 'user', '사용자가 완료 (제목 변경)'],
      ['jira:ENU-2', 'dismissed', 'user', '사용자가 닫음'],
      ['jira:ENU-3', 'snoozed', 'user', '미룸'],
      ['jira:ENU-4', 'dismissed', 'claude', '클로드가 닫음'],
    ]);
    // Claude's "done" on a user-snoozed item is ignored too.
    const done = await upsertOk(me.id, [{ external_ref: 'jira:ENU-3', title: '미룸', status: 'done' }]);
    expect(done).toMatchObject({ skipped_user_controlled: 1, unchanged: 1 });
    expect((await rowByRef(me.id, 'jira:ENU-3'))?.status).toBe('snoozed');
  });

  it('rejects the whole batch with item-level reasons and writes nothing', async () => {
    const me = await createTestUser(handle.db);
    const out = await upsert(me.id, [
      { external_ref: 'jira:ENU-1', title: '정상 항목' },
      { external_ref: 'jira:ENU-2', title: '링크 https://example.com 확인' },
      { external_ref: 'jira:ENU-3', title: '정상', note: '주민번호 900101-1234567' },
    ]);
    expect(out.isError).toBe(true);
    expect(errorPayload(out)).toMatchObject({
      error: 'validation_failed',
      problems: [
        { index: 1, field: 'title', reason: 'url' },
        { index: 2, field: 'note', reason: 'pii' },
      ],
    });
    expect(await rowsOf(me.id)).toEqual([]);
  });

  it(`enforces at most ${LIMITS.todosOpenMax} open to-dos`, async () => {
    const me = await createTestUser(handle.db);
    await handle.db.insert(todos).values(
      Array.from({ length: LIMITS.todosOpenMax - 1 }, (_, i) => ({
        id: newId(),
        userId: me.id,
        externalRef: `seed:${i}`,
        title: `할 일 ${i}`,
      })),
    );
    const out = await upsert(me.id, [
      { external_ref: 'new:1', title: '새 할 일 1' },
      { external_ref: 'new:2', title: '새 할 일 2' },
    ]);
    expect(out.isError).toBe(true);
    expect(errorPayload(out).error).toBe('open_todo_limit');
    expect((await rowsOf(me.id)).length).toBe(LIMITS.todosOpenMax - 1);
    // Completing one while adding one keeps the count within the cap.
    const ok = await upsertOk(me.id, [
      { external_ref: 'new:1', title: '새 할 일 1' },
      { external_ref: 'new:2', title: '새 할 일 2', status: 'done' },
    ]);
    expect(ok.created).toBe(2);
  });
});
