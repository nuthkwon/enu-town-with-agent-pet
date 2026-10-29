import { desks, profiles, user, type DbOrTx } from '@enu/db';
import { DEFAULT_AVATAR, LINK_STATES, avatarSpriteKey, type AvatarPreset, type LinkState } from '@enu/shared';
import { eq } from 'drizzle-orm';

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
  petSpecies: string;
  petName: string;
  linkState: LinkState;
  timezone: string;
  team: string | null;
  statusText: string;
  deskId: string | null;
  nudgePrefs: ProfileNudgePrefs;
}

function asLinkState(v: string): LinkState {
  return (LINK_STATES as readonly string[]).includes(v) ? (v as LinkState) : 'not_linked';
}

function avatarKeyOf(avatar: AvatarPreset | null | undefined): string {
  try {
    return avatarSpriteKey({ ...DEFAULT_AVATAR, ...(avatar ?? {}) });
  } catch {
    return avatarSpriteKey(DEFAULT_AVATAR);
  }
}

/** Loads user + profile + assigned desk (null when the user or the profile row is missing). */
export async function loadUserSnapshot(db: DbOrTx, userId: string): Promise<UserSnapshot | null> {
  const rows = await db
    .select({
      userId: user.id,
      email: user.email,
      status: user.status,
      displayName: profiles.displayName,
      avatar: profiles.avatar,
      petSpecies: profiles.petSpecies,
      petName: profiles.petName,
      linkState: profiles.linkState,
      timezone: profiles.timezone,
      team: profiles.team,
      statusText: profiles.statusText,
      nudgesEnabled: profiles.nudgesEnabled,
      minIntervalMin: profiles.nudgeMinIntervalMin,
      maxPerDay: profiles.maxBubblesPerDay,
      quietStart: profiles.quietStart,
      quietEnd: profiles.quietEnd,
      deskId: desks.deskId,
    })
    .from(user)
    .innerJoin(profiles, eq(profiles.userId, user.id))
    .leftJoin(desks, eq(desks.userId, user.id))
    .where(eq(user.id, userId))
    .limit(1);
  const r = rows[0];
  if (!r) return null;
  return {
    userId: r.userId,
    email: r.email,
    status: r.status,
    displayName: r.displayName,
    avatarKey: avatarKeyOf(r.avatar),
    petSpecies: r.petSpecies,
    petName: r.petName,
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
  };
}

/** Current desk assignment for each of the given users (users without a desk are absent). */
export async function loadDeskAssignments(db: DbOrTx): Promise<Map<string, string>> {
  const rows = await db.select({ deskId: desks.deskId, userId: desks.userId }).from(desks);
  const out = new Map<string, string>();
  for (const r of rows) if (r.userId) out.set(r.userId, r.deskId);
  return out;
}

/** True when the e-mail address belongs to the allowed Google Workspace domain. */
export function emailInDomain(email: string, domain: string): boolean {
  const at = email.lastIndexOf('@');
  if (at < 0) return false;
  return email.slice(at + 1).toLowerCase() === domain.trim().toLowerCase();
}
