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

/* ------------------------------------------------------------------ work overview (ADR 0007) */

export interface FeedLogFields extends LogVisibilityFields {
  editedByUser: boolean;
}

export interface FeedAuthorState extends AuthorState {
  /** Accepted the current privacy notice (MCP writes do not require it; the feed does). */
  noticeAccepted: boolean;
}

/**
 * A work-log feed entry may be listed: its log is one any colleague may read, the owner has not edited it (their
 * edits remove the entries), and the author is active and accepted the current notice. The same for every viewer,
 * the owner included.
 */
export function canListWorkLogEntry(log: FeedLogFields, author: FeedAuthorState): boolean {
  return canViewLog(ANY_COLLEAGUE, log, author) && !log.editedByUser && author.noticeAccepted;
}

/**
 * The one exception to `canViewLogTimestamps`: the feed may show `HH:MM` for a write from today's office day, made
 * in office hours, by an author who shares activity (the log sparkle's condition). Checked when read, so turning
 * sharing off drops the times at once.
 */
export function canShowWorkLogEntryTime(
  entry: { dayKey: string; inOfficeHours: boolean },
  todayKey: string,
  author: { active: boolean; shareActivity: boolean | null },
): boolean {
  return entry.dayKey === todayKey && entry.inOfficeHours && canShareActivity(author, author);
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

/*
 * Pets and pet conversations (ADR 0005, docs/design/messenger-spec.md §3). Pet names and looks are company-visible
 * (they are drawn in the town); everything else about a pet room is decided here.
 */

export interface PetOwnership {
  ownerId: string;
}

/** A pet (its name and look) is shown while its owner's account is active; the owner always sees their own. */
export function canViewPet(viewer: Viewer, pet: PetOwnership, author: AuthorState): boolean {
  return viewer.userId === pet.ownerId || author.active;
}

/** Only the owner talks to their pets: colleagues never message someone's pet. */
export function canChatWithPet(viewer: Viewer, pet: PetOwnership, author: AuthorState): boolean {
  return viewer.userId === pet.ownerId && author.active;
}

/**
 * Role instructions, reply route, defaults, exact times, reply source, answer and claim state, unread counts, the
 * channel state, nudges and to-dos: the owner's alone (admins see what colleagues see).
 */
export function canViewPetPrivateFields(viewer: Viewer, ownerId: string): boolean {
  return viewer.userId === ownerId;
}

export interface PetMessageVisibilityFields {
  ownerId: string;
  author: 'owner' | 'pet';
  visibility: Visibility;
}

/**
 * A colleague sees a company message of an active author; a pet reply only while the message it answers is also
 * company. The parent is checked when reading, so hiding a question hides its replies at once. `parent` is null
 * only for owner messages.
 */
export function canViewPetMessage(
  viewer: Viewer,
  m: PetMessageVisibilityFields,
  parent: { visibility: Visibility } | null,
  author: AuthorState,
): boolean {
  if (viewer.userId === m.ownerId) return true;
  if (!author.active || m.visibility !== 'company') return false;
  if (m.author === 'owner') return true;
  return parent !== null && parent.visibility === 'company';
}

/** A pet's default: its own setting, else the owner's profile default. */
export function petDefaultVisibility(petDefault: Visibility | null, profileDefault: Visibility): Visibility {
  return petDefault ?? profileDefault;
}

/** The owner chooses freely per message; omitted means the pet's default. */
export function petMessageVisibility(requested: Visibility | undefined, petDefault: Visibility): Visibility {
  return requested ?? petDefault;
}

/** Claude only lowers: a reply is never more visible than the pet's default or the message it answers. */
export function petReplyVisibility(
  requested: Visibility | undefined,
  petDefault: Visibility,
  question: Visibility,
): Visibility {
  const base = minVisibility(petDefault, question);
  return requested ? minVisibility(requested, base) : base;
}

/** The SQL pre-filter for pet messages a colleague may see; rows must still pass `canViewPetMessage`. */
export const COLLEAGUE_VISIBLE_PET_MESSAGE_VISIBILITY: Visibility = 'company';
