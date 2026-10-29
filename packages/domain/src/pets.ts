import { LIMITS, PET_CHANNEL } from '@enu/shared';
import type { PetAnswerState, PetReplyRejection, PetReplyRoute, PetReplySource, PetTint } from '@enu/shared';

/**
 * Pets (ADR 0005, docs/design/messenger-spec.md §3): how many a person may have, which looks are allowed, and who
 * may answer an owner message. Pure: callers pass `now`.
 */

export function canCreatePet(currentCount: number): boolean {
  return currentCount < LIMITS.petsPerOwnerMax;
}

export interface PetLook {
  species: string;
  tint: PetTint;
}

export type PetLookProblem =
  /** A default pet always has the base look. */
  | 'default_must_be_base'
  /** The base look is reserved for default pets. */
  | 'base_reserved'
  /** Another active member's default pet already has this species. */
  | 'pet_taken'
  /** One of my other pets already looks like this. */
  | 'look_taken';

/**
 * The base look identifies a person on the map, so each active member's default pet has a different species (the
 * old "every employee has a different pet" rule). Extra pets reuse any species with a tint, unique per owner.
 */
export function petLookProblems(
  next: PetLook & { isDefault: boolean },
  ctx: { ownOtherLooks: readonly PetLook[]; othersDefaultSpecies: ReadonlySet<string> },
): PetLookProblem[] {
  const problems: PetLookProblem[] = [];
  if (next.isDefault) {
    if (next.tint !== 'base') problems.push('default_must_be_base');
    if (ctx.othersDefaultSpecies.has(next.species)) problems.push('pet_taken');
  } else if (next.tint === 'base') {
    problems.push('base_reserved');
  }
  if (ctx.ownOtherLooks.some((l) => l.species === next.species && l.tint === next.tint))
    problems.push('look_taken');
  return problems;
}

/** The two ways the owner's Claude answers: the local Claude Code channel, or the connector (scheduled or not). */
export type PetLane = 'channel' | 'connector';

export function laneOf(source: PetReplySource): PetLane {
  return source === 'claude_code_channel' ? 'channel' : 'connector';
}

export function routeAllows(route: PetReplyRoute, lane: PetLane): boolean {
  if (route === 'both') return true;
  return route === 'channel' ? lane === 'channel' : lane === 'connector';
}

/** The answer bookkeeping of one owner message (owner-only columns of `pet_messages`). */
export interface PetQuestionState {
  answerState: PetAnswerState;
  answeredLane: PetLane | null;
  replyCount: number;
  claimedBy: string | null;
  claimUntil: Date | null;
  createdAt: Date;
}

/** A Claude Code channel is holding the message (it was pushed into a session and its lease has not run out). */
export function isClaimLive(q: Pick<PetQuestionState, 'claimedBy' | 'claimUntil'>, now: Date): boolean {
  return q.claimedBy !== null && q.claimUntil !== null && q.claimUntil > now;
}

export function claimUntil(now: Date): Date {
  return new Date(now.getTime() + PET_CHANNEL.claimTtlMin * 60_000);
}

/**
 * A poll by channel token `tokenId` may (re)deliver the message: the route admits the channel, it is not answered,
 * nobody else holds it, and it is recent enough to still be worth pushing into a session.
 */
export function isChannelDeliverable(
  q: PetQuestionState,
  route: PetReplyRoute,
  tokenId: string,
  now: Date,
): boolean {
  if (!routeAllows(route, 'channel') || q.answerState === 'answered') return false;
  if (isClaimLive(q, now) && q.claimedBy !== tokenId) return false;
  return now.getTime() - q.createdAt.getTime() <= PET_CHANNEL.deliverMaxAgeHours * 3_600_000;
}

/** `get_my_context.pet_inbox` lists the message: the route admits the connector, unanswered, not held live. */
export function isConnectorListable(q: PetQuestionState, route: PetReplyRoute, now: Date): boolean {
  return routeAllows(route, 'connector') && q.answerState !== 'answered' && !isClaimLive(q, now);
}

/**
 * When a message gets its first answer, earlier messages of the same pet that nobody else is holding are answered
 * too: the reply covers them (the owner wrote them in a row), and the connector must not answer them much later.
 */
export function isClosedByLaterAnswer(q: PetQuestionState, tokenId: string | null, now: Date): boolean {
  if (q.answerState === 'answered') return false;
  return !isClaimLive(q, now) || (tokenId !== null && q.claimedBy === tokenId);
}

export interface ReplyAttempt {
  lane: PetLane;
  /** The channel token answering; null on the connector lane. */
  tokenId: string | null;
  part: number;
  /** `checkinSkipReason(now, ownerTz, holidays) === null`: the connector answers only in office hours (D8). */
  inOfficeHours: boolean;
}

export type ReplyAdmission =
  | { ok: true; kind: 'create'; firstAnswer: boolean }
  /** This part was stored before: nothing new is written and Claude's text is never overwritten. */
  | { ok: true; kind: 'duplicate' }
  | { ok: false; reason: PetReplyRejection; detail?: string };

/** Whether a reply part may be stored for an owner message (`q` is null when the message is unknown or not mine). */
export function decideReplyAdmission(
  q: PetQuestionState | null,
  route: PetReplyRoute,
  attempt: ReplyAttempt,
  now: Date,
): ReplyAdmission {
  if (!q) return { ok: false, reason: 'unknown_message' };
  if (!routeAllows(route, attempt.lane)) {
    return {
      ok: false,
      reason: 'route_not_allowed',
      detail:
        route === 'channel'
          ? 'this pet answers only through Claude Code'
          : 'this pet answers only in check-ins',
    };
  }
  if (attempt.lane === 'connector' && !attempt.inOfficeHours) {
    return {
      ok: false,
      reason: 'outside_office_hours',
      detail: 'connector replies only during office hours',
    };
  }
  // The other lane's answer is never this caller's duplicate: it was not this caller's text.
  if (q.answerState === 'answered' && q.answeredLane !== null && q.answeredLane !== attempt.lane) {
    return { ok: false, reason: 'already_answered' };
  }
  if (attempt.part <= q.replyCount) return { ok: true, kind: 'duplicate' };
  if (isClaimLive(q, now) && (attempt.lane === 'connector' || q.claimedBy !== attempt.tokenId)) {
    return { ok: false, reason: 'already_answered', detail: 'held by a Claude Code channel' };
  }
  if (attempt.part > q.replyCount + 1) {
    return { ok: false, reason: 'unknown_message', detail: `send part ${q.replyCount + 1} first` };
  }
  return { ok: true, kind: 'create', firstAnswer: q.replyCount === 0 };
}
