import { claudeLinks, newId, profiles, todos, workLogs, type DbHandle } from '@enu/db';
import { MCP_TOOL_NAMES } from '@enu/shared';
import { createTestUser, setupTestDb, truncateAll } from '@enu/testing';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { LINK_REVOKED_MESSAGE, NOT_AUTHENTICATED_MESSAGE } from '../src/index';
import { MODES, callTool, connectClient, createTestHandler, errorPayload, testDeps } from './harness';
import {
  PUBLIC_URL,
  THU_14,
  auditFor,
  linkRow,
  listen,
  makeHarness,
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

const CLIENT = 'https://claude.ai/oauth/client';

describe.each(MODES)('claude_links bookkeeping and auth defense (%s)', (mode) => {
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

  it('creates the link on the first call (consent fallback) and counts every call', async () => {
    const me = await createTestUser(handle.db, { linkState: 'not_linked' });
    const client = await h.client(me.id, CLIENT);
    expect((await callTool(client, MCP_TOOL_NAMES.getMyContext)).isError).toBe(false);

    let link = await linkRow(handle.db, me.id, CLIENT);
    expect(link).toMatchObject({
      toolCallCount: 1,
      lastToolName: 'get_my_context',
      lastWriteAt: null,
      revokedAt: null,
    });
    expect(link?.consentedAt.toISOString()).toBe(THU_14);
    expect(link?.firstToolCallAt?.toISOString()).toBe(THU_14);
    // A newly created active link makes the owner "linked" (and realtime is told).
    const [profile] = await handle.db.select().from(profiles).where(eq(profiles.userId, me.id));
    expect(profile?.linkState).toBe('linked');
    await listener.waitFor(() => listener.forUser(me.id).some((e) => e.type === 'link_state_changed'));
    expect((await auditFor(handle.db, me.id)).map((a) => a.action)).toEqual([
      'claude_link.create_on_tool_call',
    ]);

    h.clock.advance(10 * 60 * 1000);
    const write = await callTool(client, MCP_TOOL_NAMES.upsertTodos, {
      items: [{ external_ref: 'jira:ENU-1', title: '리뷰' }],
    });
    expect(write.isError).toBe(false);
    link = await linkRow(handle.db, me.id, CLIENT);
    expect(link).toMatchObject({ toolCallCount: 2, lastToolName: 'upsert_todos' });
    expect(link?.firstToolCallAt?.toISOString()).toBe(THU_14);
    expect(link?.lastToolCallAt?.toISOString()).toBe('2026-10-29T05:10:00.000Z');
    expect(link?.lastWriteAt?.toISOString()).toBe('2026-10-29T05:10:00.000Z');
    expect(link?.consentedAt.toISOString()).toBe(THU_14);

    // A rejected write is counted as a call but is not a write.
    h.clock.advance(60_000);
    const bad = await callTool(client, MCP_TOOL_NAMES.postWorkLog, { summary: 'https://example.com 정리' });
    expect(bad.isError).toBe(true);
    link = await linkRow(handle.db, me.id, CLIENT);
    expect(link).toMatchObject({ toolCallCount: 3, lastToolName: 'post_work_log' });
    expect(link?.lastWriteAt?.toISOString()).toBe('2026-10-29T05:10:00.000Z');
  });

  it('keeps an existing consented link and tracks a second client separately', async () => {
    const me = await createTestUser(handle.db, { linkState: 'linked' });
    const linkId = newId();
    await handle.db.insert(claudeLinks).values({
      id: linkId,
      userId: me.id,
      clientId: CLIENT,
      clientKind: 'claude_ai',
      consentedAt: new Date('2026-10-01T00:00:00Z'),
    });
    await callTool(await h.client(me.id, CLIENT), MCP_TOOL_NAMES.getMyContext);
    await callTool(await h.client(me.id, 'claude-code-local'), MCP_TOOL_NAMES.getMyContext);
    const link = await linkRow(handle.db, me.id, CLIENT);
    expect(link).toMatchObject({ id: linkId, clientKind: 'claude_ai', toolCallCount: 1 });
    expect(link?.consentedAt.toISOString()).toBe('2026-10-01T00:00:00.000Z');
    expect((await linkRow(handle.db, me.id, 'claude-code-local'))?.toolCallCount).toBe(1);
  });

  it('refuses every tool on a revoked link without touching data', async () => {
    const me = await createTestUser(handle.db, { linkState: 'not_linked' });
    await handle.db.insert(claudeLinks).values({
      id: newId(),
      userId: me.id,
      clientId: CLIENT,
      consentedAt: new Date('2026-10-01T00:00:00Z'),
      toolCallCount: 5,
      revokedAt: new Date('2026-10-28T00:00:00Z'),
      revokedReason: 'user_revoked',
    });
    const client = await h.client(me.id, CLIENT);
    const calls: [string, Record<string, unknown>][] = [
      [MCP_TOOL_NAMES.getMyContext, {}],
      [MCP_TOOL_NAMES.postWorkLog, { summary: '오늘은 문서를 정리했습니다.' }],
      [MCP_TOOL_NAMES.upsertTodos, { items: [{ external_ref: 'jira:ENU-1', title: '리뷰' }] }],
      [MCP_TOOL_NAMES.postPetNudges, { nudges: [{ text: '물 마셔요' }] }],
    ];
    for (const [name, args] of calls) {
      const out = await callTool(client, name, args);
      expect(out.isError, name).toBe(true);
      expect(out.texts[0]?.startsWith(LINK_REVOKED_MESSAGE), name).toBe(true);
      expect(errorPayload(out).error).toBe('link_revoked');
    }
    const link = await linkRow(handle.db, me.id, CLIENT);
    expect(link).toMatchObject({ toolCallCount: 5, revokedReason: 'user_revoked' });
    expect(await handle.db.select().from(workLogs).where(eq(workLogs.userId, me.id))).toEqual([]);
    expect(await handle.db.select().from(todos).where(eq(todos.userId, me.id))).toEqual([]);
  });

  it('answers "not authenticated" when the route passes no caller', async () => {
    const handler = createTestHandler(testDeps(handle.db, { publicUrl: PUBLIC_URL }));
    const client = await connectClient(handler, null, mode);
    const out = await callTool(client, MCP_TOOL_NAMES.getMyContext);
    expect(out.isError).toBe(true);
    expect(out.texts[0]?.split('\n')[0]).toBe(NOT_AUTHENTICATED_MESSAGE);
    expect(await handle.db.select().from(claudeLinks)).toEqual([]);
    await client.close();
    await handler.close();
  });

  it('rate-limits per user and tool (post_pet_nudges: 12 per hour)', async () => {
    const me = await createTestUser(handle.db);
    const client = await h.client(me.id, CLIENT);
    for (let i = 0; i < 12; i++) {
      const ok = await callTool(client, MCP_TOOL_NAMES.postPetNudges, { nudges: [{ text: `메시지 ${i}` }] });
      expect(ok.isError, ok.texts.join('\n')).toBe(false);
      h.clock.advance(60_000);
    }
    const limited = await callTool(client, MCP_TOOL_NAMES.postPetNudges, { nudges: [{ text: '하나 더' }] });
    expect(limited.isError).toBe(true);
    expect(errorPayload(limited)).toMatchObject({
      error: 'rate_limited',
      retry_after_seconds: 3600 - 12 * 60,
    });
    // Other tools still work.
    expect((await callTool(client, MCP_TOOL_NAMES.getMyContext)).isError).toBe(false);
    // The refused call never reached the link counter.
    expect((await linkRow(handle.db, me.id, CLIENT))?.toolCallCount).toBe(13);
  });
});
