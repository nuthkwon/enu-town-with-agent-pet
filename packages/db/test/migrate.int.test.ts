import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, type DbHandle } from '../src/client';
import { defaultMigrationsDir, runMigrations } from '../src/migrate';

/**
 * 0002_town_visualization and 0003_no_presence_traces on a database that already holds 0001-era data:
 * nearby chat (with recipients), a zoned room message, a stored position, a UUIDv7 work log and a bubble
 * delivery with its trigger. Runs in a scratch database derived from DATABASE_URL_TEST
 * (`<name>_migrate_test`) so the shared test database is never reset.
 */

const TEST_URL = process.env.DATABASE_URL_TEST ?? 'postgres://enu:enu@127.0.0.1:5432/enu_town_test';
const testName = new URL(TEST_URL).pathname.replace(/^\//, '');
if (!/_test$/.test(testName)) {
  throw new Error(`Refusing to run tests against "${testName}": database name must end with _test`);
}
const scratchName = `${testName.replace(/_test$/, '')}_migrate_test`;
const scratchUrl = (() => {
  const u = new URL(TEST_URL);
  u.pathname = `/${scratchName}`;
  return u.toString();
})();

let admin: DbHandle;
let h: DbHandle;
let tmp: string;

/** A copy of migrations/ whose journal stops after `keep` entries (the migrator reads only the journal). */
function truncatedMigrations(keep: number): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'enu-migrations-'));
  fs.cpSync(defaultMigrationsDir(), dir, { recursive: true });
  const journalPath = path.join(dir, 'meta', '_journal.json');
  const journal = JSON.parse(fs.readFileSync(journalPath, 'utf8')) as { entries: unknown[] };
  journal.entries = journal.entries.slice(0, keep);
  fs.writeFileSync(journalPath, JSON.stringify(journal, null, 2));
  return dir;
}

async function recreateScratch(): Promise<void> {
  await admin.pool.query(`drop database if exists "${scratchName}" with (force)`);
  await admin.pool.query(`create database "${scratchName}"`);
}

/** The pg error a statement fails with (node-postgres errors carry `code` and `constraint`). */
async function failure(sql: string, params: unknown[] = []): Promise<{ code?: string; constraint?: string }> {
  try {
    await h.pool.query(sql, params);
  } catch (e) {
    return e as { code?: string; constraint?: string };
  }
  throw new Error(`expected failure: ${sql}`);
}

const exists = async (relation: string) =>
  (await h.pool.query<{ r: string | null }>('select to_regclass($1) as r', [relation])).rows[0]?.r !== null;

beforeAll(async () => {
  admin = createDb(TEST_URL, { max: 1, applicationName: 'enu-town-migrate-test' });
  await recreateScratch();
  tmp = truncatedMigrations(2);
  await runMigrations(scratchUrl, tmp);
  h = createDb(scratchUrl, { max: 2, applicationName: 'enu-town-migrate-test' });
});

afterAll(async () => {
  await h?.close();
  await admin.pool.query(`drop database if exists "${scratchName}" with (force)`);
  await admin.close();
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
});

describe('migrations 0002_town_visualization and 0003_no_presence_traces', () => {
  it('drops nearby chat, recipients, positions and zone ids, keeping room chat and profiles', async () => {
    const q = (sql: string, params: unknown[] = []) => h.pool.query(sql, params);
    for (const id of ['u-a', 'u-b']) {
      await q(`insert into "user" (id, name, email, email_verified) values ($1, $2, $3, true)`, [
        id,
        id,
        `${id}@enu-tech.co.kr`,
      ]);
      await q(`insert into profiles (user_id, display_name, avatar) values ($1, $2, '{}'::jsonb)`, [id, id]);
    }
    await q(`insert into chat_messages (id, kind, sender_id, body, client_msg_id, zone_id)
             values ('00000000-0000-7000-8000-000000000001', 'nearby', 'u-a', '근처 대화', 'c1', 'pantry'),
                    ('00000000-0000-7000-8000-000000000002', 'room', 'u-b', '전체 대화', 'c2', 'pantry')`);
    await q(`insert into chat_message_recipients (message_id, user_id)
             values ('00000000-0000-7000-8000-000000000001', 'u-a'),
                    ('00000000-0000-7000-8000-000000000001', 'u-b')`);
    await q(
      `insert into user_presence (user_id, x, y, zone_id, last_seen_at) values ('u-a', 3, 4, 'pantry', now())`,
    );
    await q(`insert into privacy_consents (id, user_id, notice_version, scope)
             values ('00000000-0000-7000-8000-0000000000c1', 'u-a', '2026-10', 'service')`);
    // A UUIDv7 work log (its first 48 bits are the write time) and a delivery that recorded its trigger.
    const v7LogId = '019a2c4e-8000-7000-8000-000000000001';
    await q(
      `insert into work_logs (id, user_id, period_key, period_start, period_end, visibility, source,
                                    claude_written_at)
             values ($1, 'u-a', '2026-10-28', now(), now(), 'company', 'cowork_scheduled', now())`,
      [v7LogId],
    );
    await q(`insert into nudge_deliveries (user_id, trigger, due_key, shown_at)
             values ('u-a', 'glance', null, now()), ('u-a', 'due', 't1:5', now())`);

    await runMigrations(scratchUrl);

    const applied = await q('select count(*)::int as n from drizzle.__drizzle_migrations');
    expect(applied.rows[0]?.n).toBe(4);
    // 0003: no trigger column any more (rows stay), and work logs are re-keyed with random v4 ids.
    const trigger = await q(
      `select 1 from information_schema.columns where table_name = 'nudge_deliveries' and column_name = 'trigger'`,
    );
    expect(trigger.rowCount).toBe(0);
    expect((await q('select due_key from nudge_deliveries order by id')).rows).toEqual([
      { due_key: null },
      { due_key: 't1:5' },
    ]);
    const logs = (await q('select id from work_logs')).rows as { id: string }[];
    expect(logs).toHaveLength(1);
    expect(logs[0]?.id).not.toBe(v7LogId);
    expect(logs[0]?.id.charAt(14)).toBe('4');
    const chat = await q('select id, kind, body from chat_messages order by id');
    expect(chat.rows).toEqual([
      { id: '00000000-0000-7000-8000-000000000002', kind: 'room', body: '전체 대화' },
    ]);
    expect(await exists('chat_message_recipients')).toBe(false);
    expect(await exists('user_presence')).toBe(false);
    expect(await exists('activity_reports')).toBe(true);
    const zone = await q(
      `select 1 from information_schema.columns where table_name = 'chat_messages' and column_name = 'zone_id'`,
    );
    expect(zone.rowCount).toBe(0);
    // Existing profiles: sharing not chosen (off), 접속 표시 on, no manual status.
    const profiles = await q(
      'select share_activity, show_live, manual_status, manual_status_until from profiles order by user_id',
    );
    expect(profiles.rows).toEqual([
      { share_activity: null, show_live: true, manual_status: null, manual_status_until: null },
      { share_activity: null, show_live: true, manual_status: null, manual_status_until: null },
    ]);
    expect((await q('select scope from privacy_consents')).rows).toEqual([{ scope: 'service' }]);
  });

  it('enforces the new CHECKs', async () => {
    const q = (sql: string, params: unknown[] = []) => h.pool.query(sql, params);
    const violation = async (constraint: string, sql: string, params: unknown[] = []) => {
      expect(await failure(sql, params), constraint).toMatchObject({ code: '23514', constraint });
    };

    await violation(
      'chat_messages_no_nearby_chk',
      `insert into chat_messages (id, kind, sender_id, body, client_msg_id)
       values ('00000000-0000-7000-8000-000000000003', 'nearby', 'u-a', '다시 근처', 'c3')`,
    );
    await violation(
      'profiles_manual_status_chk',
      `update profiles set manual_status = 'sleeping',
      manual_status_until = now() where user_id = 'u-a'`,
    );
    await violation(
      'profiles_manual_status_pair_chk',
      `update profiles set manual_status = 'focus' where user_id = 'u-a'`,
    );
    await violation(
      'profiles_manual_status_pair_chk',
      `update profiles set manual_status_until = now() where user_id = 'u-a'`,
    );
    await q(`update profiles set manual_status = 'away', manual_status_until = now(), share_activity = true,
             show_live = false where user_id = 'u-a'`);

    await violation(
      'privacy_consents_scope_chk',
      `insert into privacy_consents (id, user_id, notice_version, scope)
       values ('00000000-0000-7000-8000-0000000000c2', 'u-a', '2026-11', 'location')`,
    );
    await q(`insert into privacy_consents (id, user_id, notice_version, scope)
             values ('00000000-0000-7000-8000-0000000000c3', 'u-a', '2026-11', 'activity_sharing')`);

    /** An activity report for u-b with `extra` columns (name -> SQL expression). */
    const report = (extra: Record<string, string>, source = "'cowork_scheduled'") => {
      const cols = ['user_id', 'period_key', 'source', ...Object.keys(extra)].join(', ');
      const values = [`'u-b'`, `'2026-10-29'`, source, ...Object.values(extra)].join(', ');
      return `insert into activity_reports (${cols}) values (${values})`;
    };
    await violation('activity_now_kind_chk', report({ now_kind: `'sleep'`, now_until: 'now()' }));
    await violation('activity_now_pair_chk', report({ now_kind: `'work'` }));
    await violation('activity_now_pair_chk', report({ now_until: 'now()' }));
    await violation('activity_now_ref_chk', report({ now_ref_hash: '$1' }), ['a'.repeat(32)]);
    await violation('activity_schedule_chk', report({ schedule: `'{}'::jsonb` }));
    await violation('activity_schedule_chk', report({ schedule: '$1::jsonb' }), [
      JSON.stringify(Array.from({ length: 17 }, () => ({ kind: 'focus' }))),
    ]);
    await violation('activity_source_chk', report({}, `'web'`));

    const block = {
      start_at: '2026-10-29T01:00:00.000Z',
      end_at: '2026-10-29T02:00:00.000Z',
      kind: 'meeting',
      ref_hash: null,
    };
    await q(
      report(
        { now_kind: `'review'`, now_until: 'now()', now_ref_hash: '$1', schedule: '$2::jsonb' },
        `'claude_code'`,
      ),
      ['b'.repeat(32), JSON.stringify([block])],
    );
    // One report per user and office day.
    expect(await failure(report({}))).toMatchObject({
      code: '23505',
      constraint: 'activity_reports_pk',
    });
    // Reports go with their owner.
    await q(`delete from "user" where id = 'u-b'`);
    expect((await q('select count(*)::int as n from activity_reports')).rows[0]?.n).toBe(0);
  });
});
