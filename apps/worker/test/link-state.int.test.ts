import { claudeLinks, krHolidays, newId, profiles, type DbHandle } from '@enu/db';
import { createTestUser, setupTestDb, truncateAll } from '@enu/testing';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { refreshLinkStates, safeTimeZone } from '../src/jobs/link-state';
import { DAY, HOUR, kst, listenTownEvents, plus, testEnv, type EventListener } from './helpers';

let h: DbHandle;
let listener: EventListener;
const env = testEnv();

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

async function link(userId: string, consentedAt: Date, revokedAt: Date | null = null, clientId = `client-${newId()}`) {
  await h.db.insert(claudeLinks).values({ id: newId(), userId, clientId, consentedAt, revokedAt });
}

async function setProfile(userId: string, values: Partial<typeof profiles.$inferInsert>) {
  await h.db.update(profiles).set(values).where(eq(profiles.userId, userId));
}

async function profileOf(userId: string) {
  const [p] = await h.db.select().from(profiles).where(eq(profiles.userId, userId));
  return p!;
}

describe('claude.link-state', () => {
  it('keeps a Friday log linked over the weekend and turns stale on Tuesday', async () => {
    const u = await createTestUser(h.db, { linkState: 'linked' });
    await link(u.id, kst(2026, 10, 20, 9));
    await setProfile(u.id, { lastWorkLogAt: kst(2026, 10, 30, 17) }); // Friday 17:00

    for (const now of [kst(2026, 10, 31, 10), kst(2026, 11, 1, 22), kst(2026, 11, 2, 10)]) {
      const s = await refreshLinkStates(h.db, now, env); // Sat, Sun, Mon
      expect(s.changed).toBe(0);
    }
    expect((await profileOf(u.id)).linkState).toBe('linked');
    expect(await listener.settle([u.id])).toHaveLength(0);

    const tuesday = kst(2026, 11, 3, 0, 5); // just after midnight: Monday is now the previous business day
    const s = await refreshLinkStates(h.db, tuesday, env);
    expect(s.changes).toEqual([{ userId: u.id, from: 'linked', to: 'stale' }]);
    const p = await profileOf(u.id);
    expect(p.linkState).toBe('stale');
    expect(p.linkStateChangedAt?.toISOString()).toBe(tuesday.toISOString());
    expect(await listener.waitFor([u.id], 1)).toEqual([
      { v: 1, type: 'link_state_changed', user_id: u.id, state: 'stale' },
    ]);
  });

  it('skips holidays when looking for the previous business day', async () => {
    const u = await createTestUser(h.db, { linkState: 'linked' });
    await link(u.id, kst(2026, 10, 20, 9));
    await setProfile(u.id, { lastWorkLogAt: kst(2026, 10, 30, 17) }); // Friday
    await h.db.insert(krHolidays).values({ date: '2026-11-02', name: '테스트 휴일' }); // Monday off

    expect((await refreshLinkStates(h.db, kst(2026, 11, 3, 10), env)).changed).toBe(0);
    expect((await refreshLinkStates(h.db, kst(2026, 11, 4, 10), env)).changes).toEqual([
      { userId: u.id, from: 'linked', to: 'stale' },
    ]);
  });

  it('marks a user whose only link was revoked as not_linked', async () => {
    const u = await createTestUser(h.db, { linkState: 'linked' });
    const now = kst(2026, 10, 29, 14);
    await link(u.id, plus(now, -2 * DAY), plus(now, -HOUR));
    await setProfile(u.id, { lastWorkLogAt: plus(now, -2 * HOUR) });

    const s = await refreshLinkStates(h.db, now, env);
    expect(s.changes).toEqual([{ userId: u.id, from: 'linked', to: 'not_linked' }]);
    expect((await profileOf(u.id)).linkState).toBe('not_linked');
    expect(await listener.waitFor([u.id], 1)).toEqual([
      { v: 1, type: 'link_state_changed', user_id: u.id, state: 'not_linked' },
    ]);
  });

  it('uses only non-revoked links (latest active consent) and links new connections', async () => {
    const now = kst(2026, 10, 29, 14); // Thursday
    // Revoked recent link + old active link and no logs -> stale.
    const old = await createTestUser(h.db, { linkState: 'linked' });
    await link(old.id, plus(now, -HOUR), plus(now, -30 * 60_000));
    await link(old.id, kst(2026, 10, 19, 9));
    // Fresh consent, no log yet -> linked.
    const fresh = await createTestUser(h.db, { linkState: 'not_linked' });
    await link(fresh.id, plus(now, -HOUR));
    // Two active links: the latest consent counts.
    const multi = await createTestUser(h.db, { linkState: 'stale' });
    await link(multi.id, kst(2026, 10, 1, 9));
    await link(multi.id, kst(2026, 10, 28, 9));

    const s = await refreshLinkStates(h.db, now, env);
    expect(s.checked).toBe(3);
    expect(new Map(s.changes.map((c) => [c.userId, c.to]))).toEqual(
      new Map([
        [old.id, 'stale'],
        [fresh.id, 'linked'],
        [multi.id, 'linked'],
      ]),
    );
    expect(await listener.waitFor([old.id, fresh.id, multi.id], 3)).toHaveLength(3);

    listener.clear();
    expect((await refreshLinkStates(h.db, now, env)).changed).toBe(0);
    expect(await listener.settle([old.id, fresh.id, multi.id])).toHaveLength(0);
  });

  it('ignores deactivated users and falls back to APP_TIMEZONE for an invalid profile timezone', async () => {
    const now = kst(2026, 10, 29, 14);
    const gone = await createTestUser(h.db, { status: 'deactivated', linkState: 'linked' });
    const odd = await createTestUser(h.db, { linkState: 'not_linked' });
    await setProfile(odd.id, { timezone: 'Not/AZone' });
    await link(odd.id, plus(now, -HOUR));

    const s = await refreshLinkStates(h.db, now, env);
    expect(s.checked).toBe(1);
    expect(s.changes).toEqual([{ userId: odd.id, from: 'not_linked', to: 'linked' }]);
    expect((await profileOf(gone.id)).linkState).toBe('linked');
  });
});

describe('safeTimeZone', () => {
  it('keeps valid zones and falls back otherwise', () => {
    expect(safeTimeZone('Asia/Seoul', 'UTC')).toBe('Asia/Seoul');
    expect(safeTimeZone('Not/AZone', 'Asia/Seoul')).toBe('Asia/Seoul');
    expect(safeTimeZone(null, 'Asia/Seoul')).toBe('Asia/Seoul');
  });
});
