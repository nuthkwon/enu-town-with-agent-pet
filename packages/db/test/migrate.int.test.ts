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

const TEST_URL = process.env.DATABASE_URL_TEST ?? 'postgres://enu:enu@127.0.0.1:5432/enu_den_test';
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
  admin = createDb(TEST_URL, { max: 1, applicationName: 'enu-den-migrate-test' });
  await recreateScratch();
  tmp = truncatedMigrations(2);
  await runMigrations(scratchUrl, tmp);
  h = createDb(scratchUrl, { max: 2, applicationName: 'enu-den-migrate-test' });
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
    const journal = JSON.parse(
      fs.readFileSync(path.join(defaultMigrationsDir(), 'meta', '_journal.json'), 'utf8'),
    ) as { entries: unknown[] };
    expect(applied.rows[0]?.n).toBe(journal.entries.length);
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
    // 0004/0005: every profile got its default pet from the old single-pet columns, which are gone.
    expect(
      (await q('select user_id, name, species, tint, is_default, sort_order from pets order by user_id'))
        .rows,
    ).toEqual([
      { user_id: 'u-a', name: '펫', species: 'cat', tint: 'base', is_default: true, sort_order: 0 },
      { user_id: 'u-b', name: '펫', species: 'cat', tint: 'base', is_default: true, sort_order: 0 },
    ]);
    const petColumns = await q(
      `select column_name from information_schema.columns
        where table_name = 'profiles' and column_name in ('pet_species', 'pet_name')`,
    );
    expect(petColumns.rowCount).toBe(0);
    const petDefault = await q('select pet_chat_default_visibility as v from profiles order by user_id');
    expect(petDefault.rows).toEqual([{ v: 'company' }, { v: 'company' }]);
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
    await q(`insert into privacy_consents (id, user_id, notice_version, scope)
             values ('00000000-0000-7000-8000-0000000000c4', 'u-a', '2026-12', 'pet_chat_sharing')`);

    /** A pet of u-a with `extra` columns (name -> SQL expression). */
    const pet = (id: string, extra: Record<string, string>) => {
      const base: Record<string, string> = {
        id: `'${id}'`,
        user_id: `'u-a'`,
        name: `'코코'`,
        species: `'fox'`,
      };
      const all = { ...base, ...extra };
      return `insert into pets (${Object.keys(all).join(', ')}) values (${Object.values(all).join(', ')})`;
    };
    // The base look is the default pet's; an extra pet has a tint and the default pet has none.
    await violation('pets_default_tint_chk', pet('00000000-0000-4000-8000-0000000000a1', {}));
    await violation(
      'pets_default_tint_chk',
      pet('00000000-0000-4000-8000-0000000000a2', { tint: `'mint'`, is_default: 'true' }),
    );
    await violation(
      'pets_reply_route_chk',
      pet('00000000-0000-4000-8000-0000000000a3', { tint: `'mint'`, reply_route: `'email'` }),
    );
    await violation(
      'pets_role_len_chk',
      pet('00000000-0000-4000-8000-0000000000a4', { tint: `'mint'`, role_instructions: `''` }),
    );
    await q(pet('00000000-0000-4000-8000-0000000000a5', { tint: `'mint'` }));
    // One default pet per person, and one pet per look.
    expect(
      await failure(pet('00000000-0000-4000-8000-0000000000a6', { tint: `'base'`, is_default: 'true' })),
    ).toMatchObject({ code: '23505', constraint: 'pets_one_default_uidx' });
    expect(await failure(pet('00000000-0000-4000-8000-0000000000a7', { tint: `'mint'` }))).toMatchObject({
      code: '23505',
      constraint: 'pets_owner_look_uidx',
    });

    /** A message in pet a5 with `extra` columns (name -> SQL expression); the base row is an owner message. */
    const petMessage = (id: string, extra: Record<string, string>) => {
      const all: Record<string, string> = {
        id: `'${id}'`,
        pet_id: `'00000000-0000-4000-8000-0000000000a5'`,
        user_id: `'u-a'`,
        author: `'owner'`,
        body: `'오늘 할 일 정리해 줘'`,
        day_key: `'2026-10-29'`,
        visibility: `'company'`,
        visibility_set_by: `'owner'`,
        client_msg_id: `'${id.slice(-4)}'`,
        answer_state: `'pending'`,
        created_at: 'now()',
        ...extra,
      };
      const cols = Object.entries(all).filter(([, v]) => v !== 'omit');
      return `insert into pet_messages (${cols.map(([k]) => k).join(', ')})
              values (${cols.map(([, v]) => v).join(', ')})`;
    };
    const question = '00000000-0000-4000-8000-0000000000b0';
    /** A reply to `question` (every owner-only column left out). */
    const reply = (id: string, extra: Record<string, string>) =>
      petMessage(id, {
        author: `'pet'`,
        body: `'오전에는 견적서부터 봐요'`,
        visibility_set_by: `'claude'`,
        source: `'claude_code_channel'`,
        in_reply_to: `'${question}'`,
        reply_part: '1',
        client_msg_id: 'omit',
        answer_state: 'omit',
        ...extra,
      });
    await q(petMessage(question, {}));
    await violation(
      'pet_messages_author_chk',
      petMessage('00000000-0000-4000-8000-0000000000b1', {
        author: `'bot'`,
        client_msg_id: 'omit',
        answer_state: 'omit',
      }),
    );
    await violation(
      'pet_messages_body_len_chk',
      petMessage('00000000-0000-4000-8000-0000000000b2', { body: `''` }),
    );
    await violation(
      'pet_messages_set_by_chk',
      petMessage('00000000-0000-4000-8000-0000000000b3', { visibility_set_by: `'admin'` }),
    );
    await violation(
      'pet_messages_source_chk',
      petMessage('00000000-0000-4000-8000-0000000000b4', { source: `'claude_code'` }),
    );
    await violation(
      'pet_messages_source_chk',
      reply('00000000-0000-4000-8000-0000000000b5', { source: `'email'` }),
    );
    await violation(
      'pet_messages_owner_fields_chk',
      petMessage('00000000-0000-4000-8000-0000000000b6', { client_msg_id: 'omit' }),
    );
    await violation(
      'pet_messages_pet_fields_chk',
      reply('00000000-0000-4000-8000-0000000000b7', { reply_part: '4' }),
    );
    await violation(
      'pet_messages_pet_fields_chk',
      reply('00000000-0000-4000-8000-0000000000b8', { in_reply_to: 'omit' }),
    );
    await violation(
      'pet_messages_answer_chk',
      petMessage('00000000-0000-4000-8000-0000000000b9', { answer_state: `'done'` }),
    );
    await violation(
      'pet_messages_lane_chk',
      petMessage('00000000-0000-4000-8000-0000000000ba', { answered_lane: `'email'` }),
    );
    await violation(
      'pet_messages_claim_chk',
      petMessage('00000000-0000-4000-8000-0000000000bb', {
        claimed_by: `'00000000-0000-4000-8000-0000000000ff'`,
      }),
    );
    await violation(
      'pet_messages_claim_chk',
      petMessage('00000000-0000-4000-8000-0000000000bc', {
        claimed_by: `'00000000-0000-4000-8000-0000000000ff'`,
        claim_until: 'now()',
      }),
    );
    await violation(
      'pet_messages_unread_chk',
      petMessage('00000000-0000-4000-8000-0000000000bd', { unread: 'true' }),
    );
    // One message per idempotency key and one reply per part; deleting a question deletes its replies.
    expect(
      await failure(petMessage('00000000-0000-4000-8000-0000000000be', { client_msg_id: `'00b0'` })),
    ).toMatchObject({ code: '23505', constraint: 'pet_messages_owner_client_uidx' });
    await q(reply('00000000-0000-4000-8000-0000000000c0', { unread: 'true' }));
    expect(await failure(reply('00000000-0000-4000-8000-0000000000c1', {}))).toMatchObject({
      code: '23505',
      constraint: 'pet_messages_reply_part_uidx',
    });
    await q(`delete from pet_messages where id = '${question}'`);
    expect((await q('select count(*)::int as n from pet_messages')).rows).toEqual([{ n: 0 }]);

    // 0007: pet channel machines are Claude links of their own kind, with a known platform.
    await violation(
      'claude_links_kind_chk',
      `insert into claude_links (id, user_id, client_id, client_kind, consented_at)
       values ('00000000-0000-7000-8000-0000000000d1', 'u-a', 'x', 'telegram', now())`,
    );
    await q(`insert into claude_links (id, user_id, client_id, client_kind, consented_at)
             values ('00000000-0000-7000-8000-0000000000d2', 'u-a', 'enu-den-channel:1', 'claude_code_channel', now())`);
    const machine = (platform: string, hash: string) =>
      `insert into pet_channel_tokens (id, user_id, link_id, token_hash, label, platform, plugin_version, expires_at)
       values (gen_random_uuid(), 'u-a', '00000000-0000-7000-8000-0000000000d2', '${hash.repeat(64)}',
               'Claude Code', '${platform}', '0.1.0', now())`;
    await violation('pet_channel_tokens_platform_chk', machine('ios', 'a'));
    await q(machine('darwin', 'b'));
    expect(await failure(machine('linux', 'c'))).toMatchObject({
      code: '23505',
      constraint: 'pet_channel_tokens_link_uidx',
    });

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
