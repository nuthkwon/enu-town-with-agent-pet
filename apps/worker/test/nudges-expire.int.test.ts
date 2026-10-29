import { newId, petNudges, type DbHandle } from '@enu/db';
import { createTestUser, setupTestDb, truncateAll } from '@enu/testing';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { expireNudges } from '../src/jobs/nudges-expire';
import { DAY, HOUR, MIN, kst, listenTownEvents, plus, type EventListener } from './helpers';

let h: DbHandle;
let listener: EventListener;

beforeAll(async () => {
  h = await setupTestDb();
});
afterAll(async () => {
  await h.close();
});
beforeEach(async () => {
  await truncateAll(h.db);
  listener = await listenTownEvents();
});
afterEach(async () => {
  await listener.close();
});

// Thursday 2026-10-29 14:00 KST
const NOW = kst(2026, 10, 29, 14, 0);

type NudgeSeed = Partial<typeof petNudges.$inferInsert> & { userId: string };

async function seed(n: NudgeSeed): Promise<string> {
  const id = newId();
  await h.db.insert(petNudges).values({
    id,
    text: '오늘 회고 잊지 마세요',
    showAfter: plus(NOW, -DAY),
    expiresAt: plus(NOW, 5 * HOUR),
    ...n,
  });
  return id;
}

async function statusOf(id: string) {
  const [row] = await h.db.select().from(petNudges).where(eq(petNudges.id, id));
  return row!;
}

describe('nudges.expire', () => {
  it('applies the expiry, exhaustion and snooze transitions and notifies each affected owner once', async () => {
    const a = await createTestUser(h.db);
    const b = await createTestUser(h.db);
    const c = await createTestUser(h.db);

    const pastExpiry = await seed({ userId: a.id, expiresAt: plus(NOW, -MIN) });
    const exactExpiry = await seed({
      userId: a.id,
      status: 'shown',
      showCount: 1,
      lastShownAt: plus(NOW, -HOUR),
      expiresAt: NOW,
    });
    const exhausted = await seed({
      userId: a.id,
      status: 'shown',
      showCount: 2,
      maxShows: 2,
      lastShownAt: plus(NOW, -(2 * HOUR + MIN)),
    });
    const exhaustedRecent = await seed({
      userId: a.id,
      status: 'shown',
      showCount: 2,
      maxShows: 2,
      lastShownAt: plus(NOW, -(2 * HOUR - MIN)),
    });
    const shownOnce = await seed({
      userId: a.id,
      status: 'shown',
      showCount: 1,
      maxShows: 2,
      lastShownAt: plus(NOW, -3 * HOUR),
    });
    const acked = await seed({
      userId: a.id,
      status: 'acked',
      expiresAt: plus(NOW, -HOUR),
      showAfter: plus(NOW, -DAY),
    });

    const snoozeOver = await seed({ userId: b.id, status: 'snoozed', snoozedUntil: plus(NOW, -MIN) });
    const snoozeEndsNow = await seed({ userId: b.id, status: 'snoozed', snoozedUntil: NOW });
    const stillSnoozed = await seed({ userId: b.id, status: 'snoozed', snoozedUntil: plus(NOW, 10 * MIN) });
    const snoozedButExpired = await seed({
      userId: b.id,
      status: 'snoozed',
      snoozedUntil: plus(NOW, -MIN),
      expiresAt: plus(NOW, -MIN),
    });

    const untouched = await seed({ userId: c.id, expiresAt: plus(NOW, MIN) });

    const summary = await expireNudges(h.db, NOW);
    expect(summary).toEqual({ expired: 3, exhausted: 1, unsnoozed: 2, notifiedUsers: 2 });

    expect((await statusOf(pastExpiry)).status).toBe('expired');
    expect((await statusOf(exactExpiry)).status).toBe('expired');
    expect((await statusOf(exhausted)).status).toBe('expired');
    expect((await statusOf(exhaustedRecent)).status).toBe('shown');
    expect((await statusOf(shownOnce)).status).toBe('shown');
    expect((await statusOf(acked)).status).toBe('acked');
    expect((await statusOf(snoozeOver)).status).toBe('pending');
    expect((await statusOf(snoozeEndsNow)).status).toBe('pending');
    expect((await statusOf(stillSnoozed)).status).toBe('snoozed');
    expect((await statusOf(snoozedButExpired)).status).toBe('expired');
    expect((await statusOf(untouched)).status).toBe('pending');

    // The text is never touched.
    expect((await statusOf(pastExpiry)).text).toBe('오늘 회고 잊지 마세요');

    const events = await listener.waitFor([a.id, b.id, c.id], 2);
    await listener.settle([a.id, b.id, c.id]);
    expect(listener.forUsers([a.id, b.id, c.id])).toHaveLength(2);
    expect(events).toEqual(
      expect.arrayContaining([
        { v: 1, type: 'nudges_changed', user_id: a.id },
        { v: 1, type: 'nudges_changed', user_id: b.id },
      ]),
    );
  });

  it('is idempotent: a second run changes nothing and sends no NOTIFY', async () => {
    const a = await createTestUser(h.db);
    await seed({ userId: a.id, expiresAt: plus(NOW, -MIN) });
    expect((await expireNudges(h.db, NOW)).expired).toBe(1);
    await listener.waitFor([a.id], 1);
    listener.clear();

    expect(await expireNudges(h.db, NOW)).toEqual({
      expired: 0,
      exhausted: 0,
      unsnoozed: 0,
      notifiedUsers: 0,
    });
    expect(await listener.settle([a.id])).toHaveLength(0);
  });

  it('sends nothing when no nudge changes', async () => {
    const a = await createTestUser(h.db);
    await seed({ userId: a.id });
    expect((await expireNudges(h.db, NOW)).notifiedUsers).toBe(0);
    expect(await listener.settle([a.id])).toHaveLength(0);
  });
});
