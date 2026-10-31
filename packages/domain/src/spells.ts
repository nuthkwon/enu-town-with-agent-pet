import { SPELL_TIMING, type Spell, type SpellOutcome } from '@enu/shared';

/**
 * Spells (ADR 0008): what a cast becomes. Short-lived memory only — the server keeps it in RAM for at most a minute
 * and nothing about spells is stored, logged or counted for anyone. Pure: the caller passes the monotonic time.
 */

export interface SpellCast {
  from: string;
  to: string;
  spell: Spell;
  atMs: number;
}

export class SpellMemory {
  /** `${from}>${to}` → when that high-five was cast (a return within the window is a combo). */
  private readonly highfives = new Map<string, number>();
  /** Target → casts that landed on them in the last raid window. */
  private readonly landed = new Map<string, { from: string; atMs: number }[]>();
  /** Target → every cast at them in the last minute (room-wide protection). */
  private readonly incoming = new Map<string, number[]>();
  /** Target → when their last raid was (one per window). */
  private readonly raidAt = new Map<string, number>();

  constructor(private readonly timing = SPELL_TIMING) {}

  /** True when the target may receive one more spell now (at most `targetPerMinute` from the whole room). */
  allowTarget(to: string, nowMs: number): boolean {
    this.prune(nowMs);
    return (this.incoming.get(to)?.length ?? 0) < this.timing.targetPerMinute;
  }

  /**
   * Records an allowed cast and returns its outcome. `blocked` (the target's shield) wins and counts towards
   * nothing; a returned high-five is a combo; otherwise the cast lands, and the cast that brings the distinct
   * casters on one person within the window to `raidCasters` is a raid (once per window).
   */
  cast(c: SpellCast, blocked: boolean): SpellOutcome {
    this.prune(c.atMs);
    const incoming = this.incoming.get(c.to) ?? [];
    incoming.push(c.atMs);
    this.incoming.set(c.to, incoming);
    if (blocked) return 'blocked';

    if (c.spell === 'highfive') {
      const back = `${c.to}>${c.from}`;
      const at = this.highfives.get(back);
      if (at !== undefined && c.atMs - at <= this.timing.comboWindowMs) {
        this.highfives.delete(back);
        return 'combo';
      }
      this.highfives.set(`${c.from}>${c.to}`, c.atMs);
    }

    const landed = (this.landed.get(c.to) ?? []).filter((l) => l.from !== c.from);
    landed.push({ from: c.from, atMs: c.atMs });
    this.landed.set(c.to, landed);
    const last = this.raidAt.get(c.to);
    if (
      landed.length >= this.timing.raidCasters &&
      (last === undefined || c.atMs - last > this.timing.raidWindowMs)
    ) {
      this.raidAt.set(c.to, c.atMs);
      this.landed.delete(c.to);
      return 'raid';
    }
    return 'hit';
  }

  /** Forgets everything about a person (they left the roster). */
  forget(userId: string): void {
    this.landed.delete(userId);
    this.incoming.delete(userId);
    this.raidAt.delete(userId);
    for (const k of [...this.highfives.keys()])
      if (k.startsWith(`${userId}>`) || k.endsWith(`>${userId}`)) this.highfives.delete(k);
  }

  /** How many entries are held (tests: memory never grows past the windows). */
  get size(): number {
    return this.highfives.size + this.landed.size + this.incoming.size + this.raidAt.size;
  }

  private prune(nowMs: number): void {
    const { comboWindowMs, raidWindowMs } = this.timing;
    for (const [k, at] of this.highfives) if (nowMs - at > comboWindowMs) this.highfives.delete(k);
    for (const [k, list] of this.landed) {
      const keep = list.filter((l) => nowMs - l.atMs <= raidWindowMs);
      if (keep.length) this.landed.set(k, keep);
      else this.landed.delete(k);
    }
    for (const [k, list] of this.incoming) {
      const keep = list.filter((at) => nowMs - at <= 60_000);
      if (keep.length) this.incoming.set(k, keep);
      else this.incoming.delete(k);
    }
    for (const [k, at] of this.raidAt) if (nowMs - at > raidWindowMs) this.raidAt.delete(k);
  }
}
