import { desks, loadHolidays, profiles, user, type DbOrTx } from '@enu/db';
import { APP_TIMEZONE_DEFAULT, LINK_STATES, teamLabel, type LinkState, type Visibility } from '@enu/shared';
import { eq } from 'drizzle-orm';
import { ToolError } from './result';

/** The caller's own profile data that every tool needs (timezone, defaults, link state). */
export interface OwnerContext {
  userId: string;
  email: string;
  displayName: string;
  timezone: string;
  deskId: string | null;
  /** Team label, 직위 and role (from the roster) so Claude writes role-appropriate logs. */
  team: string | null;
  title: string | null;
  role: string | null;
  defaultLogVisibility: Visibility;
  defaultChatSummaryVisibility: Visibility | null;
  shareDmsWithMyClaude: boolean;
  nudgesEnabled: boolean;
  nudgeMinIntervalMin: number;
  quietStart: string;
  quietEnd: string;
  linkState: LinkState;
  lastWorkLogAt: Date | null;
  holidays: Set<string>;
}

function validTimeZone(tz: string | null | undefined): string {
  if (!tz) return APP_TIMEZONE_DEFAULT;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return tz;
  } catch {
    return APP_TIMEZONE_DEFAULT;
  }
}

/** Loads the owner context or returns null when the user has no profile yet. */
export async function findOwnerContext(db: DbOrTx, userId: string): Promise<OwnerContext | null> {
  const [row] = await db
    .select({
      email: user.email,
      displayName: profiles.displayName,
      timezone: profiles.timezone,
      team: profiles.team,
      title: profiles.title,
      roleNote: profiles.roleNote,
      defaultLogVisibility: profiles.defaultLogVisibility,
      defaultChatSummaryVisibility: profiles.defaultChatSummaryVisibility,
      shareDmsWithMyClaude: profiles.shareDmsWithMyClaude,
      nudgesEnabled: profiles.nudgesEnabled,
      nudgeMinIntervalMin: profiles.nudgeMinIntervalMin,
      quietStart: profiles.quietStart,
      quietEnd: profiles.quietEnd,
      linkState: profiles.linkState,
      lastWorkLogAt: profiles.lastWorkLogAt,
    })
    .from(profiles)
    .innerJoin(user, eq(user.id, profiles.userId))
    .where(eq(profiles.userId, userId));
  if (!row) return null;
  const [desk] = await db.select({ deskId: desks.deskId }).from(desks).where(eq(desks.userId, userId)).limit(1);
  const holidays = await loadHolidays(db);
  return {
    userId,
    email: row.email,
    displayName: row.displayName,
    timezone: validTimeZone(row.timezone),
    deskId: desk?.deskId ?? null,
    team: teamLabel(row.team) || null,
    title: row.title,
    role: row.roleNote,
    defaultLogVisibility: row.defaultLogVisibility,
    defaultChatSummaryVisibility: row.defaultChatSummaryVisibility,
    shareDmsWithMyClaude: row.shareDmsWithMyClaude,
    nudgesEnabled: row.nudgesEnabled,
    nudgeMinIntervalMin: row.nudgeMinIntervalMin,
    quietStart: row.quietStart,
    quietEnd: row.quietEnd,
    linkState: (LINK_STATES as readonly string[]).includes(row.linkState) ? (row.linkState as LinkState) : 'not_linked',
    lastWorkLogAt: row.lastWorkLogAt,
    holidays,
  };
}

/** Like `findOwnerContext`, but a missing profile becomes a tool error Claude can explain. */
export async function loadOwnerContext(db: DbOrTx, userId: string): Promise<OwnerContext> {
  const owner = await findOwnerContext(db, userId);
  if (!owner) {
    throw new ToolError(
      'profile_missing',
      'ENU Town profile not found; ask the owner to sign in to ENU Town and finish onboarding first (ENU Town 첫 입장 설정이 필요합니다)',
    );
  }
  return owner;
}
