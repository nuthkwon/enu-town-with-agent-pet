import { DEFAULT_AVATAR, type AvatarPreset } from '@enu/shared';
import { createDb, newId, profiles, user, type Db, type DbHandle } from '@enu/db';
import { runMigrations } from '@enu/db/migrate';
import { sql } from 'drizzle-orm';

export const TEST_DB_URL = process.env.DATABASE_URL_TEST ?? 'postgres://enu:enu@127.0.0.1:5432/enu_town_test';

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
  return createDb(TEST_DB_URL, { max: 4, applicationName: 'enu-town-test' });
}

/** Empties every table (auth + app) between tests. */
export async function truncateAll(db: Db): Promise<void> {
  const rows = await db.execute<{ tablename: string }>(
    sql`select tablename from pg_tables where schemaname = 'public'`,
  );
  const names = rows.rows.map((r) => `"${r.tablename}"`).join(', ');
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
}

let counter = 0;

/** Inserts a user + profile directly (bypassing Better Auth) and returns the id. */
export async function createTestUser(db: Db, input: TestUserInput = {}): Promise<{ id: string; email: string; name: string }> {
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
    onboardingCompletedAt: new Date(),
  });
  return { id, email, name };
}
