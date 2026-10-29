import { provisionProfile } from '@enu/auth';
import { desks, privacyConsents, profiles, type Db, type DbOrTx } from '@enu/db';
import { PRIVACY_NOTICE_VERSION, VISIBILITIES, avatarSpriteKey, teamLabel, type MeDto, type Visibility } from '@enu/shared';
import { and, eq, isNull } from 'drizzle-orm';
import { mcpResource } from '../auth';
import { asLinkState, asTeamId, normalizeAvatar, type ProfileRow } from '../dto';
import type { Viewer } from '../session';

export async function loadProfile(db: DbOrTx, userId: string): Promise<ProfileRow | undefined> {
  const [p] = await db.select().from(profiles).where(eq(profiles.userId, userId)).limit(1);
  return p;
}

/** The viewer's profile, provisioning it on the fly if the sign-up hook did not create it. */
export async function ensureProfile(db: Db, viewer: Viewer): Promise<ProfileRow> {
  const existing = await loadProfile(db, viewer.userId);
  if (existing) return existing;
  await provisionProfile(db, { id: viewer.userId, name: viewer.name, email: viewer.email });
  const created = await loadProfile(db, viewer.userId);
  if (!created) throw new Error('profile provisioning failed');
  return created;
}

export async function deskOf(db: DbOrTx, userId: string): Promise<string | null> {
  const [d] = await db.select({ deskId: desks.deskId }).from(desks).where(eq(desks.userId, userId)).limit(1);
  return d?.deskId ?? null;
}

/** True when the user accepted the current privacy notice (service scope) and did not withdraw. */
export async function hasAcceptedNotice(db: DbOrTx, userId: string, version: string = PRIVACY_NOTICE_VERSION): Promise<boolean> {
  const [c] = await db
    .select({ id: privacyConsents.id })
    .from(privacyConsents)
    .where(
      and(
        eq(privacyConsents.userId, userId),
        eq(privacyConsents.noticeVersion, version),
        eq(privacyConsents.scope, 'service'),
        isNull(privacyConsents.withdrawnAt),
      ),
    )
    .limit(1);
  return Boolean(c);
}

const asVisibility = (v: string | null): Visibility | null =>
  v && (VISIBILITIES as readonly string[]).includes(v) ? (v as Visibility) : null;

export function toMeDto(p: ProfileRow, viewer: Viewer, deskId: string | null, noticeAccepted: boolean): MeDto {
  const avatar = normalizeAvatar(p.avatar);
  const team = asTeamId(p.team);
  return {
    userId: viewer.userId,
    email: viewer.email,
    displayName: p.displayName,
    avatar,
    avatarKey: avatarSpriteKey(avatar),
    pet: { species: p.petSpecies, name: p.petName },
    deskId,
    team,
    teamLabel: teamLabel(team),
    title: p.title ?? null,
    roleNote: p.roleNote ?? null,
    statusText: p.statusText ?? null,
    timezone: p.timezone,
    linkState: asLinkState(p.linkState),
    lastWorkLogAt: p.lastWorkLogAt ? p.lastWorkLogAt.toISOString() : null,
    isAdmin: viewer.isAdmin,
    onboardingCompleted: Boolean(p.onboardingCompletedAt),
    prefs: {
      defaultLogVisibility: asVisibility(p.defaultLogVisibility) ?? 'company',
      defaultChatSummaryVisibility: asVisibility(p.defaultChatSummaryVisibility),
      shareDmsWithMyClaude: p.shareDmsWithMyClaude,
      nudgesEnabled: p.nudgesEnabled,
      nudgeMinIntervalMin: p.nudgeMinIntervalMin,
      maxBubblesPerDay: p.maxBubblesPerDay,
      quietStart: p.quietStart,
      quietEnd: p.quietEnd,
    },
    noticeVersion: PRIVACY_NOTICE_VERSION,
    noticeAccepted,
    mcpUrl: mcpResource(),
  };
}

export async function buildMeDto(db: Db, viewer: Viewer): Promise<MeDto> {
  const p = await ensureProfile(db, viewer);
  const [deskId, accepted] = await Promise.all([deskOf(db, viewer.userId), hasAcceptedNotice(db, viewer.userId)]);
  return toMeDto(p, viewer, deskId, accepted);
}
