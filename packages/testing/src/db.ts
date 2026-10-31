import { DEFAULT_AVATAR, PRIVACY_NOTICE_VERSION, type AvatarPreset } from '@enu/shared';
import {
  createDb,
  insertDefaultPet,
  newId,
  privacyConsents,
  profiles,
  user,
  type Db,
  type DbHandle,
} from '@enu/db';
import { runMigrations } from '@enu/db/migrate';
import { sql } from 'drizzle-orm';

export const TEST_DB_URL = process.env.DATABASE_URL_TEST ?? 'postgres://enu:enu@127.0.0.1:5432/enu_den_test';

function assertTestDatabase(url: string): void {
  const name = new URL(url).pathname.replace(/^\//, '');
  if (!/_test$|_e2e$/.test(name)) {
    throw new Error(`Refusing to run tests against "${name}": database name must end with _test or _e2e`);
  }
}

let migrated = false;

/** Migrates (once per process) and connects to the test database. */
export async function setupTestDb(): Promise<DbHandle> {
  assertTestDatabase(TEST_DB_URL);
  if (!migrated) {
    await runMigrations(TEST_DB_URL);
    migrated = true;
  }
  return createDb(TEST_DB_URL, { max: 4, applicationName: 'enu-den-test' });
}

/**
 * Empties every table (auth + app) between tests. Pass `keep` for rows seeded once at startup,
 * e.g. ['oauth_resource', 'jwks'] when a Better Auth instance outlives the test.
 */
export async function truncateAll(db: Db, opts: { keep?: readonly string[] } = {}): Promise<void> {
  const rows = await db.execute<{ tablename: string }>(
    sql`select tablename from pg_tables where schemaname = 'public'`,
  );
  const keep = new Set(opts.keep ?? []);
  const names = rows.rows
    .filter((r) => !keep.has(r.tablename))
    .map((r) => `"${r.tablename}"`)
    .join(', ');
  if (names) await db.execute(sql.raw(`truncate table ${names} restart identity cascade`));
}

export interface TestUserInput {
  name?: string;
  email?: string;
  hd?: string;
  status?: 'active' | 'deactivated';
  role?: 'member' | 'admin';
  avatar?: AvatarPreset;
  defaultLogVisibility?: 'private' | 'company';
  defaultChatSummaryVisibility?: 'private' | 'company' | null;
  shareDmsWithMyClaude?: boolean;
  linkState?: 'not_linked' | 'linked' | 'stale';
  /** 활동 공유 (`profiles.share_activity`). Default: the column default, null = not chosen = off. */
  shareActivity?: boolean | null;
  /** 접속 표시 (`profiles.show_live`). Default: the column default, true. */
  showLive?: boolean;
  /** `profiles.accept_spells` (마법 받지 않기 when false). Default: the column default, true. */
  acceptSpells?: boolean;
  /** Sets `onboarding_completed_at` (default true; the town roster only holds onboarded users). */
  onboarded?: boolean;
  /**
   * Records a `service` consent for this privacy notice version (e.g. PRIVACY_NOTICE_VERSION, which the
   * realtime ticket requires). Default null: no consent row, like a user who has not finished /welcome.
   */
  noticeVersion?: string | null;
  /** The default pet every profile has (species uniqueness is the app's rule, not the DB's). */
  pet?: { species?: string; name?: string };
}

let counter = 0;

/** Inserts a user + profile directly (bypassing Better Auth) and returns the id. */
export async function createTestUser(
  db: Db,
  input: TestUserInput = {},
): Promise<{ id: string; email: string; name: string }> {
  counter += 1;
  const id = newId();
  const name = input.name ?? `테스트${counter}`;
  const email = input.email ?? `user${counter}.${id.slice(-6)}@enu-tech.co.kr`;
  await db.insert(user).values({
    id,
    name,
    email,
    emailVerified: true,
    hd: input.hd ?? 'enu-tech.co.kr',
    status: input.status ?? 'active',
    role: input.role ?? 'member',
  });
  await db.insert(profiles).values({
    userId: id,
    displayName: name,
    avatar: input.avatar ?? DEFAULT_AVATAR,
    defaultLogVisibility: input.defaultLogVisibility ?? 'company',
    defaultChatSummaryVisibility: input.defaultChatSummaryVisibility ?? null,
    shareDmsWithMyClaude: input.shareDmsWithMyClaude ?? false,
    linkState: input.linkState ?? 'not_linked',
    shareActivity: input.shareActivity ?? null,
    showLive: input.showLive ?? true,
    acceptSpells: input.acceptSpells ?? true,
    onboardingCompletedAt: input.onboarded === false ? null : new Date(),
  });
  await insertDefaultPet(db, {
    userId: id,
    name: input.pet?.name ?? '펫',
    species: input.pet?.species ?? 'cat',
  });
  const consents = [
    ...(input.noticeVersion ? [{ scope: 'service', noticeVersion: input.noticeVersion }] : []),
    // Turning sharing on records its consent, as onboarding and PATCH /me/profile do.
    ...(input.shareActivity === true
      ? [{ scope: 'activity_sharing', noticeVersion: input.noticeVersion ?? PRIVACY_NOTICE_VERSION }]
      : []),
  ];
  if (consents.length) {
    await db.insert(privacyConsents).values(consents.map((c) => ({ id: newId(), userId: id, ...c })));
  }
  return { id, email, name };
}
