import { nudgeDeliveries, petNudges, type Db } from '@enu/db';
import { bubbleDisplayMs, type Trigger } from '@enu/domain';
import { BubbleKind, Indicator } from '@enu/protocol';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Clock } from '../clock';
import type { Logger } from '../logger';
import type { Candidate } from './CandidateLoader';

/**
 * The pet fields a bubble touches. `bubble*` are `.view()`-tagged: only the owner receives them.
 * `indicator` is shared with everyone, so a bubble never sets it: bubbles start only while the owner's tab
 * is visible (and `glance` right when it becomes visible again), so any shared onset would tell colleagues
 * when the owner looks at the town (ADR 0004 D2). It stays `None`; the field is kept for the protocol.
 */
export interface BubblePet {
  bubbleId: string;
  bubbleKind: number;
  bubbleText: string;
  bubbleDueAt: number;
  bubbleUntil: number;
  indicator: number;
}

export interface ShownBubble {
  kind: Candidate['kind'];
  refId: string;
  /** Epoch ms (presenter clock) when the bubble disappears. */
  until: number;
}

export interface DeliveryRecord {
  userId: string;
  candidate: Candidate;
  /**
   * In-process only (tests, bookkeeping): never persisted. `join` / `glance` rows would be a history of when
   * the owner opened the town or came back to the tab (ADR 0004 P4). `dueKey` carries what the policy needs.
   */
  trigger: Trigger;
  dueKey: string | null;
  shownAt: Date;
}

/** Persistence of "this bubble was shown" (one transaction). */
export interface DeliveryStore {
  /** Returns false when the nudge is no longer showable (e.g. acked in the meantime). */
  recordShown(record: DeliveryRecord): Promise<boolean>;
}

export function createDbDeliveryStore(db: Db): DeliveryStore {
  return {
    async recordShown({ userId, candidate, dueKey, shownAt }) {
      return db.transaction(async (tx) => {
        if (candidate.kind === 'nudge') {
          const updated = await tx
            .update(petNudges)
            .set({ status: 'shown', showCount: sql`${petNudges.showCount} + 1`, lastShownAt: shownAt })
            .where(
              and(
                eq(petNudges.id, candidate.refId),
                eq(petNudges.userId, userId),
                inArray(petNudges.status, ['pending', 'shown', 'snoozed']),
              ),
            )
            .returning({ id: petNudges.id });
          if (updated.length === 0) return false;
        }
        await tx.insert(nudgeDeliveries).values({
          userId,
          nudgeId: candidate.kind === 'nudge' ? candidate.refId : null,
          todoId: candidate.kind === 'todo_due' ? candidate.refId : null,
          dueKey,
          shownAt,
        });
        return true;
      });
    },
  };
}

/**
 * Puts Claude's text in the owner's pet bubble and takes it down again.
 * The text is assigned verbatim: nothing is ever prepended or appended. System information such
 * as the due time travels separately in `bubbleDueAt` and is drawn as a chip outside the bubble.
 */
export class BubblePresenter {
  constructor(private readonly deps: { store: DeliveryStore; clock: Clock; logger?: Logger }) {}

  /**
   * Shows the bubble immediately (state is synced on the next patch) and records the delivery.
   * Resolves to false when the store reports the nudge vanished; the bubble is then taken down.
   */
  async show(
    pet: BubblePet,
    input: {
      userId: string;
      candidate: Candidate;
      trigger: Trigger;
      dueKey?: string | null;
    },
    onShown?: (bubble: ShownBubble) => void,
  ): Promise<boolean> {
    const { candidate } = input;
    const now = this.deps.clock.now();
    const until = now.getTime() + bubbleDisplayMs(candidate.text);
    pet.bubbleId = candidate.refId;
    pet.bubbleKind = candidate.kind === 'todo_due' ? BubbleKind.TodoDue : BubbleKind.Nudge;
    pet.bubbleText = candidate.text;
    pet.bubbleDueAt = candidate.dueAt ? candidate.dueAt.getTime() : 0;
    pet.bubbleUntil = until;
    // Shared with everyone: never `Dots` (see BubblePet).
    pet.indicator = Indicator.None;
    onShown?.({ kind: candidate.kind, refId: candidate.refId, until });
    try {
      const ok = await this.deps.store.recordShown({
        userId: input.userId,
        candidate,
        trigger: input.trigger,
        dueKey: input.dueKey ?? null,
        shownAt: now,
      });
      if (!ok && pet.bubbleId === candidate.refId) this.hide(pet);
      return ok;
    } catch (err) {
      this.deps.logger?.error(
        { err, userId: input.userId, refId: candidate.refId },
        'recording bubble delivery failed',
      );
      return true;
    }
  }

  hide(pet: BubblePet): void {
    pet.bubbleId = '';
    pet.bubbleKind = BubbleKind.Nudge;
    pet.bubbleText = '';
    pet.bubbleDueAt = 0;
    pet.bubbleUntil = 0;
    pet.indicator = Indicator.None;
  }
}
