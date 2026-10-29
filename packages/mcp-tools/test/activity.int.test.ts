import { activityReports, profiles, type DbHandle } from '@enu/db';
import { MCP_TOOL_NAMES, getMyContextOutput, postActivityOutput, type PostActivityOutput } from '@enu/shared';
import { createTestUser, setupTestDb, truncateAll } from '@enu/testing';
import { eq, sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { activityRefHash } from '../src/index';
import { MODES, TEST_ACTIVITY_REF_KEY, callTool, errorPayload } from './harness';
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

const MIN = 60_000;
/** 2026-10-29 (KST) blocks: a 3-person meeting with a ref, a 1:1 without one, and an away afternoon. */
const MEETING = {
  start_at: '2026-10-29T10:00:00+09:00',
  end_at: '2026-10-29T11:00:00+09:00',
  kind: 'meeting',
  ref: 'GCAL:abc+123=@google.com',
};
const ONE_ON_ONE = {
  start_at: '2026-10-29T09:00:00+09:00',
  end_at: '2026-10-29T09:30:00+09:00',
  kind: 'meeting',
};
const AWAY = { start_at: '2026-10-29T16:00:00+09:00', end_at: '2026-10-30T00:00:00+09:00', kind: 'away' };

describe.each(MODES)('post_activity (%s)', (mode) => {
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
    return callTool(client, MCP_TOOL_NAMES.postActivity, args);
  }
  async function postOk(userId: string, args: Record<string, unknown>): Promise<PostActivityOutput> {
    const out = await post(userId, args);
    expect(out.isError, out.texts.join('\n')).toBe(false);
    return postActivityOutput.parse(out.structured);
  }
  const rowsOf = async (userId: string) =>
    handle.db
      .select()
      .from(activityReports)
      .where(eq(activityReports.userId, userId))
      .orderBy(activityReports.periodKey);
  const activityOf = async (userId: string) => {
    const client = await h.client(userId);
    const out = await callTool(client, MCP_TOOL_NAMES.getMyContext, { include: ['activity'] });
    expect(out.isError, out.texts.join('\n')).toBe(false);
    return getMyContextOutput.parse(out.structured).activity;
  };

  it('stores now and today’s blocks (sorted, deduplicated, refs hashed) and NOTIFYs activity_changed', async () => {
    const me = await createTestUser(handle.db, { shareActivity: true });
    const out = await post(me.id, {
      now: { kind: 'review', ref: 'jira:ENU-301' },
      schedule: [AWAY, MEETING, ONE_ON_ONE, MEETING],
      source_hint: 'interactive',
    });
    expect(out.isError, out.texts.join('\n')).toBe(false);
    expect(out.structured).toEqual({
      result: 'stored',
      period_key: '2026-10-29',
      now_until: new Date(Date.parse(THU_14) + 90 * MIN).toISOString(),
      schedule_blocks: 3,
      owner_status: null,
    });
    expect(out.texts[0]).toBe(
      "오늘(2026-10-29) 활동을 반영했어요: 지금 '검토 중'(15:30까지), 일정 블록 3개. 동료에게는 근무 시간에만 보여요.",
    );

    await listener.waitFor(() => listener.forUser(me.id).some((e) => e.type === 'activity_changed'));
    expect(listener.forUser(me.id).filter((e) => e.type === 'activity_changed')).toEqual([
      { v: 1, type: 'activity_changed', user_id: me.id },
    ]);
    // NOTIFY is delivered on commit, so the row is already there.
    const [row] = await rowsOf(me.id);
    const meetingHash = activityRefHash(TEST_ACTIVITY_REF_KEY, '2026-10-29', 'gcal:abc+123=@google.com');
    expect(row).toMatchObject({
      periodKey: '2026-10-29',
      nowKind: 'review',
      nowRefHash: activityRefHash(TEST_ACTIVITY_REF_KEY, '2026-10-29', 'jira:ENU-301'),
      source: 'claude_interactive',
      oauthClientId: 'https://claude.ai/oauth/client',
      schedule: [
        {
          start_at: '2026-10-29T00:00:00.000Z',
          end_at: '2026-10-29T00:30:00.000Z',
          kind: 'meeting',
          ref_hash: null,
        },
        {
          start_at: '2026-10-29T01:00:00.000Z',
          end_at: '2026-10-29T02:00:00.000Z',
          kind: 'meeting',
          ref_hash: meetingHash,
        },
        {
          start_at: '2026-10-29T07:00:00.000Z',
          end_at: '2026-10-29T15:00:00.000Z',
          kind: 'away',
          ref_hash: null,
        },
      ],
    });
    expect(row?.nowRefHash).toMatch(/^[0-9a-f]{32}$/);
    expect(row?.nowUntil?.toISOString()).toBe('2026-10-29T06:30:00.000Z');
    expect(
      (await linkRow(handle.db, me.id, 'https://claude.ai/oauth/client'))?.lastWriteAt?.toISOString(),
    ).toBe(THU_14);

    // The owner's Claude reads back kinds and has_ref, never the refs or their hashes.
    const activity = await activityOf(me.id);
    expect(activity).toEqual({
      sharing: true,
      now: { kind: 'review', has_ref: true, until: '2026-10-29T06:30:00.000Z' },
      schedule: [
        {
          start_at: '2026-10-29T00:00:00.000Z',
          end_at: '2026-10-29T00:30:00.000Z',
          kind: 'meeting',
          has_ref: false,
        },
        {
          start_at: '2026-10-29T01:00:00.000Z',
          end_at: '2026-10-29T02:00:00.000Z',
          kind: 'meeting',
          has_ref: true,
        },
        {
          start_at: '2026-10-29T07:00:00.000Z',
          end_at: '2026-10-29T15:00:00.000Z',
          kind: 'away',
          has_ref: false,
        },
      ],
      owner_status: null,
    });
  });

  it('replaces now on every call and the schedule only when sent; [] and null clear', async () => {
    const me = await createTestUser(handle.db, { shareActivity: true });
    await postOk(me.id, { now: { kind: 'work' }, schedule: [MEETING] });
    h.clock.advance(10 * MIN);
    const kept = await postOk(me.id, { now: { kind: 'docs', until: '2026-10-29T18:00:00+09:00' } });
    // until is capped at now + 120 min.
    expect(kept).toMatchObject({
      result: 'stored',
      schedule_blocks: 1,
      now_until: '2026-10-29T07:10:00.000Z',
    });
    let [row] = await rowsOf(me.id);
    expect(row).toMatchObject({ nowKind: 'docs', nowRefHash: null });
    expect(row?.schedule).toHaveLength(1);
    expect(row?.updatedAt.toISOString()).toBe('2026-10-29T05:10:00.000Z');

    const cleared = await postOk(me.id, { now: null, schedule: [] });
    expect(cleared).toMatchObject({ now_until: null, schedule_blocks: 0 });
    [row] = await rowsOf(me.id);
    expect(row).toMatchObject({ nowKind: null, nowRefHash: null, nowUntil: null, schedule: [] });
    expect(await rowsOf(me.id)).toHaveLength(1);
    const client = await h.client(me.id);
    const text = (await callTool(client, MCP_TOOL_NAMES.postActivity, { now: null })).texts[0];
    expect(text).toContain('지금 하는 일 없음, 일정 블록 0개');
  });

  it('stores nothing while sharing is off or not chosen (no row, no NOTIFY, audit without metadata)', async () => {
    for (const shareActivity of [null, false]) {
      const me = await createTestUser(handle.db, { shareActivity });
      const out = await post(me.id, { now: { kind: 'work', ref: 'jira:ENU-1' }, schedule: [MEETING] });
      expect(out.isError).toBe(false);
      expect(out.structured).toEqual({
        result: 'skipped_sharing_off',
        period_key: '2026-10-29',
        now_until: null,
        schedule_blocks: 0,
        owner_status: null,
      });
      expect(out.texts[0]).toContain('다시 보내지 마세요');
      expect(await rowsOf(me.id)).toEqual([]);
      const audits = await auditFor(handle.db, me.id);
      expect(audits.map((a) => [a.action, a.metadata])).toContainEqual(['activity.skipped', null]);
      expect((await linkRow(handle.db, me.id, 'https://claude.ai/oauth/client'))?.lastWriteAt).toBeNull();
      expect(await activityOf(me.id)).toEqual({
        sharing: false,
        now: null,
        schedule: [],
        owner_status: null,
      });
    }
    await settle();
    expect(listener.events.filter((e) => e.type === 'activity_changed')).toEqual([]);
  });

  it('rejects the whole call with field-level problems and saves nothing', async () => {
    const me = await createTestUser(handle.db, { shareActivity: true });
    const out = await post(me.id, {
      now: { kind: 'work', until: '2026-10-29T13:00:00+09:00' },
      schedule: [
        MEETING,
        { start_at: '2026-10-29T12:00:00+09:00', end_at: '2026-10-29T11:00:00+09:00', kind: 'focus' },
        { start_at: '2026-10-28T23:00:00+09:00', end_at: '2026-10-29T01:00:00+09:00', kind: 'focus' },
        { ...ONE_ON_ONE, kind: 'focus', ref: 'gcal:focus-1' },
      ],
    });
    expect(out.isError).toBe(true);
    expect(out.texts[0]).toMatch(/nothing was saved/);
    const payload = errorPayload(out);
    expect(payload.error).toBe('validation_failed');
    expect(payload.problems).toEqual([
      { field: 'now.until', reason: 'invalid_time', detail: 'until must be in the future' },
      { field: 'schedule[1].end_at', reason: 'invalid_time', detail: 'end_at must be after start_at' },
      {
        field: 'schedule[2]',
        reason: 'invalid_time',
        detail: 'blocks must lie within 2026-10-29 (Asia/Seoul); cut blocks at midnight',
      },
      { field: 'schedule[3].ref', reason: 'unsupported', detail: 'ref is only for meeting blocks' },
    ]);
    expect(await rowsOf(me.id)).toEqual([]);
    await settle();
    expect(listener.forUser(me.id).filter((e) => e.type === 'activity_changed')).toEqual([]);
  });

  it('never stores a raw ref; equal refs match within a day and differ across days', async () => {
    const me = await createTestUser(handle.db, { shareActivity: true });
    const peer = await createTestUser(handle.db, { shareActivity: true });
    await postOk(me.id, { now: { kind: 'review', ref: 'jira:ENU-301' }, schedule: [MEETING] });
    await postOk(peer.id, { now: { kind: 'work', ref: 'JIRA:ENU-301' } });
    h.clock.advance(24 * 60 * MIN);
    const friday = await postOk(me.id, { now: { kind: 'review', ref: 'jira:ENU-301' } });
    expect(friday.period_key).toBe('2026-10-30');

    const dump = await handle.db.execute<{ t: string }>(sql`select t::text as t from activity_reports t`);
    const text = dump.rows.map((r) => r.t).join('\n');
    for (const fragment of ['ENU-301', 'abc+123', 'google.com']) expect(text).not.toContain(fragment);

    const [thu, fri] = await rowsOf(me.id);
    const [peerThu] = await rowsOf(peer.id);
    // The scheme is case-insensitive: both Claudes reported the same work item on Thursday.
    expect(peerThu?.nowRefHash).toBe(thu?.nowRefHash);
    expect(fri?.nowRefHash).not.toBe(thu?.nowRefHash);
    expect(fri?.periodKey).toBe('2026-10-30');
  });

  it('returns the owner’s own status while it lasts', async () => {
    const me = await createTestUser(handle.db, { shareActivity: true });
    await handle.db
      .update(profiles)
      .set({ manualStatus: 'focus', manualStatusUntil: new Date('2026-10-29T06:00:00Z') })
      .where(eq(profiles.userId, me.id));
    const out = await post(me.id, { now: { kind: 'work' } });
    expect(out.structured?.owner_status).toEqual({ status: 'focus', until: '2026-10-29T06:00:00.000Z' });
    expect(out.texts[0]).toContain(
      "주인이 직접 '집중 모드'(~15:00)로 설정해 두어 그동안은 주인 설정이 보여요.",
    );
    expect((await activityOf(me.id))?.owner_status).toEqual({
      status: 'focus',
      until: '2026-10-29T06:00:00.000Z',
    });

    h.clock.set('2026-10-29T06:00:00Z');
    expect((await postOk(me.id, { now: null })).owner_status).toBeNull();
  });

  it('refuses the 21st call within an hour', async () => {
    const me = await createTestUser(handle.db, { shareActivity: true });
    for (let i = 0; i < 20; i++) {
      await postOk(me.id, { now: null });
      h.clock.advance(MIN);
    }
    const out = await post(me.id, { now: null });
    expect(out.isError).toBe(true);
    expect(errorPayload(out)).toMatchObject({ error: 'rate_limited', retry_after_seconds: 40 * 60 });
  });

  it('audits stored reports without any activity metadata', async () => {
    const me = await createTestUser(handle.db, { shareActivity: true });
    await postOk(me.id, { now: { kind: 'collab', ref: 'github:enu/hmi#42' }, schedule: [MEETING, AWAY] });
    const audits = await auditFor(handle.db, me.id);
    expect(audits.map((a) => a.action)).toEqual(['claude_link.create_on_tool_call', 'activity.post']);
    expect(audits[1]).toMatchObject({
      actorType: 'claude',
      oauthClientId: 'https://claude.ai/oauth/client',
      metadata: null,
    });
    expect(audits[1]?.targetType).toBeNull();
  });

  it('keys reports by the office day (APP_TIMEZONE), not the owner’s own time zone', async () => {
    const me = await createTestUser(handle.db, { shareActivity: true });
    await handle.db
      .update(profiles)
      .set({ timezone: 'America/Los_Angeles' })
      .where(eq(profiles.userId, me.id));
    // 2026-10-29 14:00 in Seoul is still 2026-10-28 in Los Angeles.
    const out = await postOk(me.id, { now: { kind: 'work' }, schedule: [MEETING] });
    expect(out).toMatchObject({ period_key: '2026-10-29', schedule_blocks: 1 });
    expect((await rowsOf(me.id)).map((r) => r.periodKey)).toEqual(['2026-10-29']);
  });

  it('never outlives turning sharing off, even when the two race', async () => {
    const me = await createTestUser(handle.db, { shareActivity: true });
    await postOk(me.id, { now: { kind: 'work' }, schedule: [MEETING] });
    expect(await rowsOf(me.id)).toHaveLength(1);

    // PATCH share_activity=false, held open: profile row locked, today's report deleted, not committed yet.
    const patch = await handle.pool.connect();
    try {
      await patch.query('begin');
      await patch.query('update profiles set share_activity = false where user_id = $1', [me.id]);
      await patch.query(`delete from activity_reports where user_id = $1 and period_key = '2026-10-29'`, [
        me.id,
      ]);

      const pending = post(me.id, { now: { kind: 'docs' }, schedule: [MEETING, AWAY] });
      // post_activity waits on the profile row lock.
      await vi.waitFor(
        async () => {
          const waiting = await handle.db.execute<{ n: number }>(
            sql`select count(*)::int as n from pg_stat_activity
                where datname = current_database() and wait_event_type = 'Lock' and query ilike '%for update%'`,
          );
          if ((waiting.rows[0]?.n ?? 0) < 1) throw new Error('post_activity is not waiting on the lock yet');
        },
        { timeout: 5000, interval: 25 },
      );
      await patch.query('commit');

      const out = await pending;
      expect(out.isError, out.texts.join('\n')).toBe(false);
      expect(out.structured).toMatchObject({ result: 'skipped_sharing_off', schedule_blocks: 0 });
    } finally {
      patch.release();
    }
    expect(await rowsOf(me.id)).toEqual([]);

    // Turning sharing back on the same day brings nothing back.
    await handle.db.update(profiles).set({ shareActivity: true }).where(eq(profiles.userId, me.id));
    expect(await activityOf(me.id)).toEqual({ sharing: true, now: null, schedule: [], owner_status: null });
  });
});
