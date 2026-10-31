import { desks, privacyConsents, profiles, user, type DbOrTx } from '@enu/db';
import {
  DEFAULT_AVATAR,
  LINK_STATES,
  MANUAL_STATUSES,
  PRIVACY_NOTICE_VERSION,
  avatarSpriteKey,
  type AvatarPreset,
  type LinkState,
  type ManualStatus,
} from '@enu/shared';
import { and, eq, isNull } from 'drizzle-orm';

/** Profile nudge preferences as stored (the scheduler adds holidays and env overrides). */
export interface ProfileNudgePrefs {
  nudgesEnabled: boolean;
  minIntervalMin: number;
  maxPerDay: number;
  quietStart: string;
  quietEnd: string;
}

/** Everything realtime needs about a person, re-read from the DB on auth, NOTIFY and resync. */
export interface UserSnapshot {
  userId: string;
  email: string;
  status: string;
  displayName: string;
  avatarKey: string;
  linkState: LinkState;
  timezone: string;
  team: string | null;
  statusText: string;
  deskId: string | null;
  nudgePrefs: ProfileNudgePrefs;
  /** The owner's own status; null when unset or not one of MANUAL_STATUSES (expiry is checked by readers). */
  manualStatus: ManualStatus | null;
  manualStatusUntil: Date | null;
  /** 활동 공유: null = not chosen = off. */
  shareActivity: boolean | null;
  /** 접속 표시. */
  showLive: boolean;
  onboardingCompletedAt: Date | null;
  /** A non-withdrawn `service` consent for the current PRIVACY_NOTICE_VERSION (same rule as MeDto.noticeAccepted). */
  noticeAccepted: boolean;
}

export function asLinkState(v: string): LinkState {
  return (LINK_STATES as readonly string[]).includes(v) ? (v as LinkState) : 'not_linked';
}

export function asManualStatus(v: string | null): ManualStatus | null {
  return v !== null && (MANUAL_STATUSES as readonly string[]).includes(v) ? (v as ManualStatus) : null;
}

export function avatarKeyOf(avatar: AvatarPreset | null | undefined): string {
  try {
    return avatarSpriteKey({ ...DEFAULT_AVATAR, ...(avatar ?? {}) });
  } catch {
    return avatarSpriteKey(DEFAULT_AVATAR);
  }
}

/** Columns shared by the single-user snapshot and the roster query. */
export const personColumns = {
  userId: user.id,
  status: user.status,
  displayName: profiles.displayName,
  avatar: profiles.avatar,
  linkState: profiles.linkState,
  statusText: profiles.statusText,
  shareActivity: profiles.shareActivity,
  showLive: profiles.showLive,
  acceptSpells: profiles.acceptSpells,
  manualStatus: profiles.manualStatus,
  manualStatusUntil: profiles.manualStatusUntil,
  onboardingCompletedAt: profiles.onboardingCompletedAt,
  deskId: desks.deskId,
};

/** Loads user + profile + assigned desk (null when the user or the profile row is missing). */
export async function loadUserSnapshot(db: DbOrTx, userId: string): Promise<UserSnapshot | null> {
  const rows = await db
    .select({
      ...personColumns,
      email: user.email,
      timezone: profiles.timezone,
      team: profiles.team,
      nudgesEnabled: profiles.nudgesEnabled,
      minIntervalMin: profiles.nudgeMinIntervalMin,
      maxPerDay: profiles.maxBubblesPerDay,
      quietStart: profiles.quietStart,
      quietEnd: profiles.quietEnd,
    })
    .from(user)
    .innerJoin(profiles, eq(profiles.userId, user.id))
    .leftJoin(desks, eq(desks.userId, user.id))
    .where(eq(user.id, userId))
    .limit(1);
  const r = rows[0];
  if (!r) return null;
  const [consent] = await db
    .select({ id: privacyConsents.id })
    .from(privacyConsents)
    .where(
      and(
        eq(privacyConsents.userId, userId),
        eq(privacyConsents.noticeVersion, PRIVACY_NOTICE_VERSION),
        eq(privacyConsents.scope, 'service'),
        isNull(privacyConsents.withdrawnAt),
      ),
    )
    .limit(1);
  const manualStatus = asManualStatus(r.manualStatus);
  return {
    userId: r.userId,
    email: r.email,
    status: r.status,
    displayName: r.displayName,
    avatarKey: avatarKeyOf(r.avatar),
    linkState: asLinkState(r.linkState),
    timezone: r.timezone,
    team: r.team,
    statusText: r.statusText ?? '',
    deskId: r.deskId ?? null,
    nudgePrefs: {
      nudgesEnabled: r.nudgesEnabled,
      minIntervalMin: r.minIntervalMin,
      maxPerDay: r.maxPerDay,
      quietStart: r.quietStart,
      quietEnd: r.quietEnd,
    },
    manualStatus,
    manualStatusUntil: manualStatus ? r.manualStatusUntil : null,
    shareActivity: r.shareActivity,
    showLive: r.showLive,
    onboardingCompletedAt: r.onboardingCompletedAt,
    noticeAccepted: Boolean(consent),
  };
}

/** True when the e-mail address belongs to the allowed Google Workspace domain. */
export function emailInDomain(email: string, domain: string): boolean {
  const at = email.lastIndexOf('@');
  if (at < 0) return false;
  return email.slice(at + 1).toLowerCase() === domain.trim().toLowerCase();
}
