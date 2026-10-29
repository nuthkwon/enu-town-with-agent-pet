import {
  newId,
  oauthAccessToken,
  oauthClient,
  oauthClientAssertion,
  oauthRefreshToken,
  session,
  verification,
  type DbHandle,
} from '@enu/db';
import { createTestUser, setupTestDb, truncateAll } from '@enu/testing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { cleanupAuth } from '../src/jobs/auth-cleanup';
import { DAY, HOUR, kst, plus } from './helpers';

let h: DbHandle;
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

// 2026-10-29 03:47 KST, when the daily run fires.
const NOW = kst(2026, 10, 29, 3, 47);
const CLIENT = 'https://claude.ai/oauth/mcp-client-metadata.json';

const ids = async (table: typeof session | typeof verification | typeof oauthAccessToken | typeof oauthRefreshToken | typeof oauthClientAssertion) =>
  (await h.db.select({ id: table.id }).from(table)).map((r) => r.id).sort();

describe('auth.cleanup', () => {
  it('deletes expired sessions, verifications, access tokens and client assertions', async () => {
    const u = await createTestUser(h.db);
    await h.db.insert(oauthClient).values({ id: newId(), clientId: CLIENT, redirectUris: ['https://claude.ai/api/mcp/auth_callback'] });

    await h.db.insert(session).values([
      { id: 's-expired', token: 't1', userId: u.id, expiresAt: plus(NOW, -SEC) },
      { id: 's-valid', token: 't2', userId: u.id, expiresAt: plus(NOW, DAY) },
    ]);
    await h.db.insert(verification).values([
      { id: 'v-expired', identifier: 'state', value: 'x', expiresAt: plus(NOW, -SEC) },
      { id: 'v-valid', identifier: 'state', value: 'y', expiresAt: plus(NOW, 10 * 60 * SEC) },
    ]);
    await h.db.insert(oauthAccessToken).values([
      { id: 'a-expired', token: 'at1', clientId: CLIENT, userId: u.id, sessionId: 's-expired', expiresAt: plus(NOW, -SEC), scopes: ['openid'] },
      { id: 'a-valid', token: 'at2', clientId: CLIENT, userId: u.id, sessionId: 's-expired', expiresAt: plus(NOW, HOUR), scopes: ['openid'] },
      { id: 'a-no-expiry', token: 'at3', clientId: CLIENT, userId: u.id, scopes: ['openid'] },
    ]);
    await h.db.insert(oauthClientAssertion).values([
      { id: 'c-expired', expiresAt: plus(NOW, -SEC) },
      { id: 'c-valid', expiresAt: plus(NOW, 5 * 60 * SEC) },
    ]);

    const s = await cleanupAuth(h.db, NOW);
    expect(s).toEqual({ sessions: 1, verifications: 1, accessTokens: 1, refreshTokens: 0, clientAssertions: 1 });
    expect(await ids(session)).toEqual(['s-valid']);
    expect(await ids(verification)).toEqual(['v-valid']);
    expect(await ids(oauthAccessToken)).toEqual(['a-no-expiry', 'a-valid']);
    expect(await ids(oauthClientAssertion)).toEqual(['c-valid']);

    // The surviving token lost its (deleted) session link instead of being removed.
    const [valid] = await h.db.select().from(oauthAccessToken).where(sql`${oauthAccessToken.id} = 'a-valid'`);
    expect(valid!.sessionId).toBeNull();
  });

  it('keeps expired or revoked refresh tokens for 7 days, then deletes them (and their access tokens)', async () => {
    const u = await createTestUser(h.db);
    await h.db.insert(oauthClient).values({ id: newId(), clientId: CLIENT, redirectUris: ['https://claude.ai/api/mcp/auth_callback'] });
    const rt = (id: string, extra: Partial<typeof oauthRefreshToken.$inferInsert>) => ({
      id,
      token: `tok-${id}`,
      clientId: CLIENT,
      userId: u.id,
      scopes: ['openid', 'offline_access'],
      ...extra,
    });
    await h.db.insert(oauthRefreshToken).values([
      rt('r-expired-8d', { expiresAt: plus(NOW, -8 * DAY) }),
      rt('r-expired-6d', { expiresAt: plus(NOW, -6 * DAY) }),
      rt('r-revoked-8d', { expiresAt: plus(NOW, 20 * DAY), revoked: plus(NOW, -(7 * DAY + SEC)) }),
      rt('r-revoked-1d', { expiresAt: plus(NOW, 20 * DAY), revoked: plus(NOW, -DAY) }),
      rt('r-valid', { expiresAt: plus(NOW, 20 * DAY) }),
    ]);
    await h.db.insert(oauthAccessToken).values([
      { id: 'a-of-revoked', token: 'at-r', clientId: CLIENT, userId: u.id, refreshId: 'r-revoked-8d', expiresAt: plus(NOW, HOUR), scopes: ['openid'] },
      { id: 'a-of-valid', token: 'at-v', clientId: CLIENT, userId: u.id, refreshId: 'r-valid', expiresAt: plus(NOW, HOUR), scopes: ['openid'] },
    ]);

    const s = await cleanupAuth(h.db, NOW, { batchSize: 1 });
    expect(s.refreshTokens).toBe(2);
    expect(await ids(oauthRefreshToken)).toEqual(['r-expired-6d', 'r-revoked-1d', 'r-valid']);
    expect(await ids(oauthAccessToken)).toEqual(['a-of-valid']);

    expect(await cleanupAuth(h.db, NOW)).toEqual({
      sessions: 0,
      verifications: 0,
      accessTokens: 0,
      refreshTokens: 0,
      clientAssertions: 0,
    });
  });

  it('compares the zone-less Better Auth timestamps as UTC regardless of the session TimeZone', async () => {
    const u = await createTestUser(h.db);
    // Written the way Better Auth (drizzle adapter) writes them: UTC wall clock.
    await h.db.insert(session).values([
      { id: 's-just-expired', token: 'k1', userId: u.id, expiresAt: plus(NOW, -SEC) },
      { id: 's-just-valid', token: 'k2', userId: u.id, expiresAt: plus(NOW, SEC) },
    ]);
    await h.db.transaction(async (tx) => {
      await tx.execute(sql`set local timezone = 'Asia/Seoul'`);
      expect((await cleanupAuth(tx, NOW)).sessions).toBe(1);
    });
    expect(await ids(session)).toEqual(['s-just-valid']);
  });
});
