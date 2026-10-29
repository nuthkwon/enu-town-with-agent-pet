import {
  auditEvents,
  chatMessageRecipients,
  chatMessages,
  newId,
  nudgeDeliveries,
  petNudges,
  todos,
  workLogs,
  type DbHandle,
} from '@enu/db';
import { createTestUser, setupTestDb, truncateAll } from '@enu/testing';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { purgeRetention } from '../src/jobs/retention-purge';
import { DAY, HOUR, kst, plus, testEnv } from './helpers';

let h: DbHandle;
const env = testEnv(); // defaults: dm 90, room 30, work log 90, nudge 14, audit 365 days
const SEC = 1000;

beforeAll(async () => {
  h = await setupTestDb();
});
afterAll(async () => {
  await h.close();
});
beforeEach(async () => {
  await truncateAll(h.db);
});

// 2026-10-29 03:17 KST, when the daily run fires.
const NOW = kst(2026, 10, 29, 3, 17);
const before = (days: number, deltaMs = 0) => plus(NOW, -days * DAY + deltaMs);

async function users() {
  const a = await createTestUser(h.db);
  const b = await createTestUser(h.db);
  return { a: a.id, b: b.id, low: a.id < b.id ? a.id : b.id, high: a.id < b.id ? b.id : a.id };
}

async function chat(kind: 'dm' | 'room' | 'nearby', senderId: string, createdAt: Date, dm?: { low: string; high: string }) {
  const id = newId();
  await h.db.insert(chatMessages).values({
    id,
    kind,
    senderId,
    dmLow: dm?.low ?? null,
    dmHigh: dm?.high ?? null,
    body: '안녕하세요',
    clientMsgId: id,
    createdAt,
  });
  return id;
}

const remaining = <T extends { id: unknown }>(rows: T[]) => rows.map((r) => r.id);

describe('retention.purge', () => {
  it('deletes chat strictly older than the DM / room cutoffs (recipients cascade)', async () => {
    const u = await users();
    const dm = { low: u.low, high: u.high };
    const dmOld = await chat('dm', u.a, before(90, -SEC), dm);
    const dmAtCutoff = await chat('dm', u.a, before(90), dm);
    const dmNew = await chat('dm', u.a, before(90, SEC), dm);
    const dm60 = await chat('dm', u.a, before(60), dm); // older than the room cutoff but a DM
    const roomOld = await chat('room', u.a, before(30, -SEC));
    const roomNew = await chat('room', u.a, before(30, SEC));
    const nearbyOld = await chat('nearby', u.b, before(30, -SEC));
    const nearbyNew = await chat('nearby', u.b, before(30, SEC));
    await h.db.insert(chatMessageRecipients).values([
      { messageId: nearbyOld, userId: u.a },
      { messageId: nearbyNew, userId: u.a },
    ]);

    const s = await purgeRetention(h.db, NOW, env);
    expect(s.dmMessages).toBe(1);
    expect(s.roomMessages).toBe(2);

    const left = remaining(await h.db.select({ id: chatMessages.id }).from(chatMessages));
    expect(left.sort()).toEqual([dmAtCutoff, dmNew, dm60, roomNew, nearbyNew].sort());
    expect(left).not.toContain(dmOld);
    expect(left).not.toContain(roomOld);
    const recipients = await h.db.select().from(chatMessageRecipients);
    expect(recipients.map((r) => r.messageId)).toEqual([nearbyNew]);
  });

  it('deletes in batches until nothing is left', async () => {
    const u = await users();
    for (let i = 0; i < 5; i++) await chat('room', u.a, before(40, -i * SEC));
    const keep = await chat('room', u.a, before(1));
    const s = await purgeRetention(h.db, NOW, env, { batchSize: 2 });
    expect(s.roomMessages).toBe(5);
    expect(remaining(await h.db.select({ id: chatMessages.id }).from(chatMessages))).toEqual([keep]);
  });

  it('deletes work logs by local period key, scrubs soft-deleted ones and purges them after 30 days', async () => {
    const u = await users();
    // Work-log cutoff = NOW - 90d = 2026-07-31 03:17 KST -> period keys before 2026-07-31 go.
    const log = async (userId: string, periodKey: string, extra: Partial<typeof workLogs.$inferInsert> = {}) => {
      const id = newId();
      const start = new Date(`${periodKey}T00:00:00+09:00`);
      await h.db.insert(workLogs).values({
        id,
        userId,
        periodKey,
        periodStart: start,
        periodEnd: plus(start, DAY),
        summary: '배포 준비',
        tasks: [{ title: '릴리스 노트', status: 'done' }],
        blockers: ['리뷰 대기'],
        claudeChatSummary: '요약',
        visibility: 'company',
        source: 'cowork_scheduled',
        claudeWrittenAt: plus(start, 10 * HOUR),
        ...extra,
      });
      return id;
    };
    const expiredKey = await log(u.a, '2026-07-30');
    const cutoffDay = await log(u.a, '2026-07-31');
    const recent = await log(u.a, '2026-10-28');
    const softOld = await log(u.b, '2026-10-01', { deletedAt: before(30, -SEC) });
    const softRecent = await log(u.b, '2026-10-02', { deletedAt: before(29), updatedAt: before(29) });
    const softAtLimit = await log(u.b, '2026-10-03', { deletedAt: before(30) });

    const s = await purgeRetention(h.db, NOW, env);
    expect(s.workLogs).toBe(1);
    expect(s.softDeletedWorkLogsPurged).toBe(1);
    expect(s.softDeletedWorkLogsScrubbed).toBe(2);

    const rows = await h.db.select().from(workLogs);
    const byId = new Map(rows.map((r) => [r.id, r]));
    expect([...byId.keys()].sort()).toEqual([cutoffDay, recent, softRecent, softAtLimit].sort());
    expect(byId.has(expiredKey)).toBe(false);
    expect(byId.has(softOld)).toBe(false);

    const scrubbed = byId.get(softRecent)!;
    expect(scrubbed).toMatchObject({ summary: null, tasks: [], blockers: [], claudeChatSummary: null });
    expect(scrubbed.updatedAt.toISOString()).toBe(before(29).toISOString());
    expect(byId.get(recent)!.summary).toBe('배포 준비');

    // Second run: nothing left to scrub.
    expect((await purgeRetention(h.db, NOW, env)).softDeletedWorkLogsScrubbed).toBe(0);
  });

  it('deletes terminal nudges and deliveries past the nudge cutoff, keeping active ones', async () => {
    const u = await users();
    const nudge = async (status: string, at: Date) => {
      const id = newId();
      await h.db.insert(petNudges).values({
        id,
        userId: u.a,
        text: '물 마시기',
        status,
        showAfter: at,
        expiresAt: plus(at, HOUR),
        createdAt: at,
      });
      return id;
    };
    const ackedOld = await nudge('acked', before(15));
    const supersededOld = await nudge('superseded', before(20));
    const dismissedOld = await nudge('dismissed', before(14, -2 * HOUR));
    const expiredNew = await nudge('expired', before(13));
    const pendingOld = await nudge('pending', before(20)); // nudges.expire's job, not retention's
    // Created before the cutoff but still live past it -> kept.
    const longLived = newId();
    await h.db.insert(petNudges).values({
      id: longLived,
      userId: u.a,
      text: '장기 알림',
      status: 'acked',
      showAfter: before(16),
      expiresAt: before(10),
      createdAt: before(16),
    });

    const delivery = async (nudgeId: string | null, shownAt: Date) => {
      const [row] = await h.db
        .insert(nudgeDeliveries)
        .values({ userId: u.a, nudgeId, trigger: 'join', shownAt })
        .returning({ id: nudgeDeliveries.id });
      return row!.id;
    };
    const dOld = await delivery(ackedOld, before(14, -SEC));
    const dAtCutoff = await delivery(expiredNew, before(14));
    const dNew = await delivery(expiredNew, before(14, SEC));

    const s = await purgeRetention(h.db, NOW, env);
    expect(s.nudges).toBe(3);
    expect(s.nudgeDeliveries).toBe(1);

    const left = (await h.db.select({ id: petNudges.id }).from(petNudges)).map((r) => r.id).sort();
    expect(left).toEqual([expiredNew, pendingOld, longLived].sort());
    expect([ackedOld, supersededOld, dismissedOld].some((id) => left.includes(id))).toBe(false);
    const deliveries = (await h.db.select({ id: nudgeDeliveries.id }).from(nudgeDeliveries)).map((r) => r.id).sort();
    expect(deliveries).toEqual([dAtCutoff, dNew].sort());
    expect(deliveries).not.toContain(dOld);
  });

  it('deletes audit events older than a year and closed to-dos untouched for 30 days', async () => {
    const u = await users();
    const [oldAudit] = await h.db
      .insert(auditEvents)
      .values({ actorType: 'user', actorUserId: u.a, action: 'test.old', occurredAt: before(365, -SEC) })
      .returning({ id: auditEvents.id });
    const [keptAudit] = await h.db
      .insert(auditEvents)
      .values({ actorType: 'user', actorUserId: u.a, action: 'test.kept', occurredAt: before(365, SEC) })
      .returning({ id: auditEvents.id });

    const todo = async (status: string, updatedAt: Date) => {
      const id = newId();
      await h.db.insert(todos).values({ id, userId: u.a, externalRef: `ref:${id}`, title: '보고서', status, updatedAt });
      return id;
    };
    const doneOld = await todo('done', before(30, -SEC));
    const dismissedOld = await todo('dismissed', before(45));
    const doneRecent = await todo('done', before(29));
    const openOld = await todo('open', before(200));
    const snoozedOld = await todo('snoozed', before(200));

    const s = await purgeRetention(h.db, NOW, env);
    expect(s.auditEvents).toBe(1);
    expect(s.todos).toBe(2);

    const audits = await h.db.select().from(auditEvents);
    const ids = audits.map((a) => a.id);
    expect(ids).toContain(keptAudit!.id);
    expect(ids).not.toContain(oldAudit!.id);
    // The run itself is audited with counts only.
    const run = audits.find((a) => a.action === 'retention.purge');
    expect(run).toMatchObject({ actorType: 'system', metadata: expect.objectContaining({ auditEvents: 1, todos: 2 }) });

    const left = (await h.db.select({ id: todos.id }).from(todos)).map((r) => r.id).sort();
    expect(left).toEqual([doneRecent, openOld, snoozedOld].sort());
    expect(left).not.toContain(doneOld);
    expect(left).not.toContain(dismissedOld);
  });

  it('honours RETENTION_* overrides', async () => {
    const u = await users();
    const dm = { low: u.low, high: u.high };
    const m = await chat('dm', u.a, before(8), dm);
    const s = await purgeRetention(h.db, NOW, testEnv({ RETENTION_DM_DAYS: '7' }));
    expect(s.dmMessages).toBe(1);
    expect(await h.db.select().from(chatMessages).where(eq(chatMessages.id, m))).toHaveLength(0);
  });
});
