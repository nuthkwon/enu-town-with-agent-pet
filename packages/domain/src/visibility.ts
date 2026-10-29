import type { Visibility } from '@enu/shared';
import type { ActivityName, ActivitySource, PlateNoteName, ResolvedActivity } from './activity';

/**
 * The only place that decides who may see a work log (and its Claude chat summary), and what
 * colleagues see of a person in the town (`projectForColleagues`).
 */

const RANK: Record<Visibility, number> = { private: 0, company: 1 };

/** The more restrictive of two visibilities. */
export function minVisibility(a: Visibility, b: Visibility): Visibility {
  return RANK[a] <= RANK[b] ? a : b;
}

export interface LogVisibilityFields {
  ownerId: string;
  visibility: Visibility;
  chatSummaryVisibility: Visibility;
  deletedAt: Date | null;
}

export interface Viewer {
  userId: string;
}

export interface AuthorState {
  active: boolean;
}

export function canViewLog(viewer: Viewer, log: LogVisibilityFields, author: AuthorState): boolean {
  if (log.deletedAt) return false;
  if (viewer.userId === log.ownerId) return true;
  return author.active && log.visibility === 'company';
}

/** The chat summary is never more visible than the log it belongs to. */
export function canViewChatSummary(viewer: Viewer, log: LogVisibilityFields, author: AuthorState): boolean {
  if (!canViewLog(viewer, log, author)) return false;
  if (viewer.userId === log.ownerId) return true;
  return minVisibility(log.visibility, log.chatSummaryVisibility) === 'company';
}

/**
 * Claude may lower visibility but never raise it above the owner's default.
 * An unset chat-summary default means the owner has not opted in -> private.
 */
export function effectiveVisibility(
  requested: Visibility | undefined,
  ownerDefault: Visibility | null,
): Visibility {
  const base: Visibility = ownerDefault ?? 'private';
  return requested ? minVisibility(requested, base) : base;
}

/** Viewer that is "any active colleague" (never equals an owner id). */
export const ANY_COLLEAGUE: Viewer = { userId: '' };

/**
 * The SQL pre-filter for logs `ANY_COLLEAGUE` may see: not deleted and this visibility. Aggregates over
 * other people's logs (the admin console's "last log" date: admins see what colleagues see) use it and
 * then still pass `canViewLog(ANY_COLLEAGUE, …)` for the author's account state.
 */
export const COLLEAGUE_VISIBLE_LOG_VISIBILITY: Visibility = 'company';

/**
 * Claude-derived activity (calendar blocks, now reports, log-derived labels and sparkle) may be shown.
 * Only an explicit opt-in counts; `null` (not chosen yet) is off.
 */
export function canShareActivity(owner: { shareActivity: boolean | null }, author: AuthorState): boolean {
  return author.active && owner.shareActivity === true;
}

/** Having the town open may draw the owner and their online dot (접속 표시). */
export function canShowLive(owner: { showLive: boolean }): boolean {
  return owner.showLive;
}

/** Exact work-log timestamps (claudeWrittenAt, updatedAt, userEditedAt) are for the owner only. */
export function canViewLogTimestamps(viewer: Viewer, ownerId: string): boolean {
  return viewer.userId === ownerId;
}

export interface ProjectionCtx {
  officeOpen: boolean;
  /** Socket open now (no grace, no onDrop hold) ∧ canShowLive(owner). */
  connected: boolean;
  /** canShareActivity(owner, author). */
  share: boolean;
  /** The owner's 상태 문구 ('' if none). */
  statusText: string;
}

export interface ColleagueProjection {
  shown: boolean;
  online: boolean;
  note: PlateNoteName;
  activity: ActivityName;
  source: ActivitySource;
  until: Date | null;
  statusText: string;
  groupKey: ResolvedActivity['groupKey'];
}

/** What everyone sees of everyone while the office is closed. */
export const NEUTRAL_PROJECTION: ColleagueProjection = Object.freeze({
  shown: false,
  online: false,
  note: 'none',
  activity: 'none',
  source: 'none',
  until: null,
  statusText: '',
  groupKey: null,
});

/** The only function that decides what colleagues (and, alike, the owner) see in the shared town state. */
export function projectForColleagues(r: ResolvedActivity, c: ProjectionCtx): ColleagueProjection {
  if (!c.officeOpen) return NEUTRAL_PROJECTION;
  // 부재 never reveals its end time or where it came from.
  const absent = r.note === 'absent';
  return {
    shown: r.shown,
    // No grace: a ping to an online person always reaches an open socket.
    online: c.connected && r.shown,
    note: r.note,
    activity: r.activity,
    source: absent ? 'none' : r.source,
    until: absent ? null : r.until,
    statusText: r.shown || r.note === 'away' ? c.statusText : '',
    // A group may only contain members who all share.
    groupKey: c.share ? r.groupKey : null,
  };
}
