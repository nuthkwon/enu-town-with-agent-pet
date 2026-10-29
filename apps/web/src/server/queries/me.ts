import { provisionProfile } from '@enu/auth';
import {
  defaultPetOf,
  activityReports,
  desks,
  privacyConsents,
  profiles,
  takenPetSpecies,
  type Db,
  type DbOrTx,
} from '@enu/db';
import {
  MANUAL_STATUSES,
  PRIVACY_NOTICE_VERSION,
  SCHEDULE_KINDS,
  VISIBILITIES,
  avatarSpriteKey,
  localDateKey,
  teamLabel,
  type ActivityTodayDto,
  type ManualStatus,
  type ManualStatusDto,
  type MeDto,
  type PetSpecies,
  type Visibility,
} from '@enu/shared';
import { and, eq, isNull } from 'drizzle-orm';
import { mcpResource } from '../auth';
import { asLinkState, asTeamId, normalizeAvatar, petOrDefault, type ProfileRow } from '../dto';
import { getEnv } from '../env';
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
export async function hasAcceptedNotice(
  db: DbOrTx,
  userId: string,
  version: string = PRIVACY_NOTICE_VERSION,
): Promise<boolean> {
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

/** The owner's hand-set status while it lasts (expired values are never returned). */
export function activeManualStatus(p: ProfileRow, now: Date): ManualStatusDto | null {
  if (!p.manualStatus || !p.manualStatusUntil || p.manualStatusUntil <= now) return null;
  if (!(MANUAL_STATUSES as readonly string[]).includes(p.manualStatus)) return null;
  return { status: p.manualStatus as ManualStatus, until: p.manualStatusUntil.toISOString() };
}

/**
 * The owner's own activity report for today's office day (APP_TIMEZONE): a `now` past its until is not
 * current any more. Refs are never returned, only whether a block had one.
 */
export async function loadActivityToday(
  db: DbOrTx,
  userId: string,
  now: Date,
  officeTimeZone: string,
): Promise<ActivityTodayDto | null> {
  const [row] = await db
    .select({
      nowKind: activityReports.nowKind,
      nowUntil: activityReports.nowUntil,
      schedule: activityReports.schedule,
    })
    .from(activityReports)
    .where(
      and(
        eq(activityReports.userId, userId),
        eq(activityReports.periodKey, localDateKey(now, officeTimeZone)),
      ),
    )
    .limit(1);
  if (!row) return null;
  return {
    now:
      row.nowKind && row.nowUntil && row.nowUntil > now
        ? { kind: row.nowKind, until: row.nowUntil.toISOString() }
        : null,
    schedule: row.schedule
      .filter((b) => (SCHEDULE_KINDS as readonly string[]).includes(b.kind))
      .map((b) => ({ startAt: b.start_at, endAt: b.end_at, kind: b.kind, hasRef: b.ref_hash !== null })),
  };
}

export interface MeContext {
  deskId: string | null;
  noticeAccepted: boolean;
  /** APP_TIMEZONE. */
  officeTimeZone: string;
  activityToday: ActivityTodayDto | null;
  takenPetSpecies: PetSpecies[];
  /** The default pet's look. */
  pet: { species: string; name: string } | null;
}

export function toMeDto(p: ProfileRow, viewer: Viewer, ctx: MeContext, now: Date): MeDto {
  const avatar = normalizeAvatar(p.avatar);
  const team = asTeamId(p.team);
  return {
    userId: viewer.userId,
    email: viewer.email,
    displayName: p.displayName,
    avatar,
    avatarKey: avatarSpriteKey(avatar),
    pet: petOrDefault(ctx.pet),
    deskId: ctx.deskId,
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
    shareActivity: p.shareActivity,
    showLive: p.showLive,
    officeTimeZone: ctx.officeTimeZone,
    manualStatus: activeManualStatus(p, now),
    activityToday: ctx.activityToday,
    takenPetSpecies: ctx.takenPetSpecies,
    noticeVersion: PRIVACY_NOTICE_VERSION,
    noticeAccepted: ctx.noticeAccepted,
    mcpUrl: mcpResource(),
  };
}

export async function buildMeDto(db: Db, viewer: Viewer, now = new Date()): Promise<MeDto> {
  const p = await ensureProfile(db, viewer);
  const officeTimeZone = getEnv().APP_TIMEZONE;
  const [deskId, noticeAccepted, activityToday, taken, pet] = await Promise.all([
    deskOf(db, viewer.userId),
    hasAcceptedNotice(db, viewer.userId),
    loadActivityToday(db, viewer.userId, now, officeTimeZone),
    takenPetSpecies(db, viewer.userId),
    defaultPetOf(db, viewer.userId),
  ]);
  return toMeDto(
    p,
    viewer,
    { deskId, noticeAccepted, officeTimeZone, activityToday, takenPetSpecies: taken, pet },
    now,
  );
}
