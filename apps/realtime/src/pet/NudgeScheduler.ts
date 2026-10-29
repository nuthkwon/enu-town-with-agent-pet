import { selectBubble, type PolicyTiming, type Selection } from '@enu/domain';
import { localDateKey, type LinkState } from '@enu/shared';
import type { Clock } from '../clock';
import type { Logger } from '../logger';
import type { BubblePet, BubblePresenter, ShownBubble } from './BubblePresenter';
import type { Candidate, CandidateLoader, OwnerSnapshot } from './CandidateLoader';

/** Room callbacks the scheduler needs (it never touches room state other than the owner's pet). */
export interface SchedulerHooks {
  pet(userId: string): BubblePet | null;
  /** The owner's resolved activity is focus or meeting (the director's `resolved(id).dnd`). */
  doNotDisturb(userId: string): boolean;
  /** The town's office hours (`state.officeOpen`); while closed every pet is quiet. */
  officeOpen(): boolean;
}

export interface OwnerState {
  userId: string;
  joinedAt: Date;
  tabVisible: boolean;
  uiBusy: boolean;
  /** When the tab was last hidden (null while visible). */
  hiddenSince: Date | null;
  /** How long the tab was hidden before it last became visible again (0 if never hidden). */
  lastHiddenMs: number;
  linkState: LinkState;
  flags: { joinFired: boolean; glanceArmed: boolean; firedDueKeys: Set<string> };
  active: ShownBubble | null;
  snapshot: OwnerSnapshot | null;
  /** Bumped on every reload so a slow, stale load never overwrites a newer one. */
  loadSeq: number;
  showing: boolean;
}

export interface NudgeSchedulerDeps {
  loader: Pick<CandidateLoader, 'load' | 'isStillShowable'>;
  presenter: BubblePresenter;
  clock: Clock;
  timing: PolicyTiming;
  hooks: SchedulerHooks;
  logger?: Logger;
}

/**
 * Decides, per connected owner, when one of their Claude-authored texts appears in the pet bubble.
 * The rules live in `selectBubble` (@enu/domain); this class only feeds it presence/history and
 * applies the result through BubblePresenter.
 */
export class NudgeScheduler {
  private readonly owners = new Map<string, OwnerState>();
  private ticking = false;

  constructor(private readonly deps: NudgeSchedulerDeps) {}

  get size(): number {
    return this.owners.size;
  }

  state(userId: string): OwnerState | undefined {
    return this.owners.get(userId);
  }

  async join(userId: string, init: { linkState: LinkState }): Promise<void> {
    const now = this.deps.clock.now();
    // The Pet outlives sessions: a replaced (or crashed) session may have left a bubble on it, and a fresh
    // OwnerState (active = null) would never expire it, so the old text would play again.
    const pet = this.deps.hooks.pet(userId);
    if (pet) this.deps.presenter.hide(pet);
    this.owners.set(userId, {
      userId,
      joinedAt: now,
      tabVisible: true,
      uiBusy: false,
      hiddenSince: null,
      lastHiddenMs: 0,
      linkState: init.linkState,
      flags: { joinFired: false, glanceArmed: false, firedDueKeys: new Set() },
      active: null,
      snapshot: null,
      loadSeq: 0,
      showing: false,
    });
    await this.reload(userId);
  }

  /** The owner's last session ended: take any bubble down first (the Pet stays in the room). */
  leave(userId: string): void {
    this.hide(userId); // needs the owner entry, so it runs before the delete
    this.owners.delete(userId);
  }

  /**
   * Tab visibility (owner-only, never shown to anyone). Coming back after being hidden for at least
   * `glanceHiddenMs` arms one `glance`; a shorter absence disarms it.
   */
  setPresence(userId: string, visible: boolean, uiBusy: boolean): void {
    const s = this.owners.get(userId);
    if (!s) return;
    const now = this.deps.clock.now();
    if (!visible && s.tabVisible) s.hiddenSince = now;
    if (visible && !s.tabVisible) {
      s.lastHiddenMs = s.hiddenSince ? Math.max(0, now.getTime() - s.hiddenSince.getTime()) : 0;
      s.hiddenSince = null;
      s.flags.glanceArmed = s.lastHiddenMs >= this.deps.timing.glanceHiddenMs;
    }
    s.tabVisible = visible;
    s.uiBusy = uiBusy;
  }

  setLinkState(userId: string, linkState: LinkState): void {
    const s = this.owners.get(userId);
    if (!s) return;
    s.linkState = linkState;
    if (linkState === 'not_linked') this.hide(userId);
  }

  /** Re-reads candidates/history/prefs and takes down a bubble whose nudge or to-do went away. */
  async reload(userId: string): Promise<void> {
    const s = this.owners.get(userId);
    if (!s) return;
    const seq = ++s.loadSeq;
    const snapshot = await this.deps.loader.load(userId);
    const cur = this.owners.get(userId);
    if (cur !== s || s.loadSeq !== seq || !snapshot) return;
    s.snapshot = mergeSnapshot(s.snapshot, snapshot);
    for (const key of snapshot.history.firedDueKeys) s.flags.firedDueKeys.add(key);
    if (s.active) {
      const active = s.active;
      const ok = await this.deps.loader.isStillShowable(active, this.deps.clock.now());
      if (!ok && this.owners.get(userId) === s && s.active === active) this.hide(userId);
    }
  }

  hide(userId: string): void {
    const s = this.owners.get(userId);
    if (!s) return;
    s.active = null;
    const pet = this.deps.hooks.pet(userId);
    if (pet) this.deps.presenter.hide(pet);
  }

  /** Takes down bubbles whose display time is over (called from the room's fast loop). */
  expire(): void {
    const nowMs = this.deps.clock.now().getTime();
    for (const s of this.owners.values()) {
      if (s.active && nowMs >= s.active.until) this.hide(s.userId);
    }
  }

  /** Optional client hint that the owner saw the bubble; only clears it once it has expired. */
  seen(userId: string, bubbleId: string): void {
    const s = this.owners.get(userId);
    if (!s?.active || s.active.refId !== bubbleId) return;
    if (this.deps.clock.now().getTime() >= s.active.until) this.hide(userId);
  }

  /** One scheduling pass over every connected owner. */
  async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const officeOpen = this.deps.hooks.officeOpen();
      for (const s of [...this.owners.values()]) {
        // Forced quiet after hours: a bubble left over from before closing goes away too.
        if (!officeOpen && s.active) this.hide(s.userId);
        try {
          await this.tickOwner(s);
        } catch (err) {
          this.deps.logger?.error({ err, userId: s.userId }, 'nudge scheduler tick failed');
        }
      }
    } finally {
      this.ticking = false;
    }
  }

  evaluate(userId: string): Selection | null {
    const s = this.owners.get(userId);
    if (!s?.snapshot) return null;
    return this.select(s, this.deps.clock.now());
  }

  private select(s: OwnerState, now: Date): Selection {
    const snap = s.snapshot as OwnerSnapshot;
    const dayKey = localDateKey(now, snap.prefs.timeZone);
    const shownToday = snap.history.dayKey === dayKey ? snap.history.shownToday : 0;
    return selectBubble({
      now,
      prefs: snap.prefs,
      presence: {
        linkState: s.linkState,
        tabVisible: s.tabVisible,
        uiBusy: s.uiBusy,
        doNotDisturb: this.deps.hooks.doNotDisturb(s.userId),
        officeOpen: this.deps.hooks.officeOpen(),
        joinedAt: s.joinedAt,
        lastHiddenMs: s.lastHiddenMs,
        hasActiveBubble: s.active !== null || s.showing,
      },
      history: { lastShownAt: snap.history.lastShownAt, shownToday },
      flags: s.flags,
      candidates: snap.candidates,
      timing: this.deps.timing,
    });
  }

  private async tickOwner(s: OwnerState): Promise<void> {
    if (!s.snapshot || s.showing) return;
    const now = this.deps.clock.now();
    const sel = this.select(s, now);
    if (!sel.show) return;
    const pet = this.deps.hooks.pet(s.userId);
    if (!pet) return;

    const candidate = sel.candidate as Candidate;
    const snap = s.snapshot;
    // Book-keeping first, so the next tick sees the new history even before the DB write lands.
    if (sel.trigger === 'join') s.flags.joinFired = true;
    if (sel.trigger === 'glance') s.flags.glanceArmed = false;
    if (sel.trigger === 'due' && sel.dueKey) s.flags.firedDueKeys.add(sel.dueKey);
    const dayKey = localDateKey(now, snap.prefs.timeZone);
    snap.history = {
      lastShownAt: now,
      shownToday: (snap.history.dayKey === dayKey ? snap.history.shownToday : 0) + 1,
      dayKey,
      firedDueKeys: snap.history.firedDueKeys,
    };
    candidate.shownCount += 1;

    s.showing = true;
    try {
      const ok = await this.deps.presenter.show(
        pet,
        {
          userId: s.userId,
          candidate,
          trigger: sel.trigger,
          dueKey: sel.dueKey ?? null,
        },
        (bubble) => {
          if (this.owners.get(s.userId) === s) s.active = bubble;
        },
      );
      if (!ok) {
        if (s.active?.refId === candidate.refId) s.active = null;
        snap.candidates = snap.candidates.filter((c) => c !== candidate);
      }
    } finally {
      s.showing = false;
    }
  }
}

/** Keeps in-memory progress that a concurrent reload may not have seen committed yet. */
function mergeSnapshot(prev: OwnerSnapshot | null, next: OwnerSnapshot): OwnerSnapshot {
  if (!prev) return next;
  const shown = new Map(prev.candidates.map((c) => [`${c.kind}:${c.refId}`, c.shownCount]));
  for (const c of next.candidates) {
    const before = shown.get(`${c.kind}:${c.refId}`);
    if (before !== undefined && before > c.shownCount) c.shownCount = before;
  }
  const sameDay = prev.history.dayKey === next.history.dayKey;
  const lastPrev = prev.history.lastShownAt?.getTime() ?? -Infinity;
  const lastNext = next.history.lastShownAt?.getTime() ?? -Infinity;
  return {
    candidates: next.candidates,
    prefs: next.prefs,
    history: {
      dayKey: next.history.dayKey,
      firedDueKeys: next.history.firedDueKeys,
      shownToday: sameDay
        ? Math.max(prev.history.shownToday, next.history.shownToday)
        : next.history.shownToday,
      lastShownAt: lastPrev > lastNext ? prev.history.lastShownAt : next.history.lastShownAt,
    },
  };
}
