import type { Visibility } from '@enu/shared';

/** The only place that decides who may see a work log (and its Claude chat summary). */

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
export function effectiveVisibility(requested: Visibility | undefined, ownerDefault: Visibility | null): Visibility {
  const base: Visibility = ownerDefault ?? 'private';
  return requested ? minVisibility(requested, base) : base;
}
