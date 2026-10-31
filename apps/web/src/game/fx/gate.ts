import { ActivityCode } from '@enu/protocol';

/**
 * When the town may draw presence effects (ADR 0008): arrivals and departures only in office hours, never in the
 * few seconds after the office opened or closed (everyone appears or fades at once then, which said nothing about
 * anyone), and at most a few per second.
 */
export class PresenceFxGate {
  private officeChangedAt = -Infinity;
  private recent: number[] = [];

  constructor(
    private readonly quietAfterOfficeMs = 4000,
    private readonly perSecond = 3,
  ) {}

  officeChanged(now: number): void {
    this.officeChangedAt = now;
  }

  allow(now: number, officeOpen: boolean | null): boolean {
    if (officeOpen !== true) return false;
    if (now - this.officeChangedAt < this.quietAfterOfficeMs) return false;
    this.recent = this.recent.filter((t) => now - t < 1000);
    if (this.recent.length >= this.perSecond) return false;
    this.recent.push(now);
    return true;
  }
}

/**
 * The aura someone wears: their own already-public activity drawn as a spell (focus mode as a shield bubble, a
 * break as mana motes). Office hours only, and only while they are drawn.
 */
export function auraFor(
  p: { shown: boolean; activity: number },
  officeOpen: boolean | null,
): 'aura/focus-shield' | 'aura/mana-rest' | null {
  if (officeOpen !== true || !p.shown) return null;
  if (p.activity === ActivityCode.Focus) return 'aura/focus-shield';
  if (p.activity === ActivityCode.Break) return 'aura/mana-rest';
  return null;
}

/**
 * Meetings that just became gathered (everyone seated at the table) since the last call. The first call only
 * learns what is already there, so a meeting in progress when the town opens is not celebrated.
 */
export class GatheringWatch {
  private known: Set<string> | null = null;

  update(gathered: Iterable<string>): string[] {
    const now = new Set(gathered);
    const fresh = this.known ? [...now].filter((id) => !this.known!.has(id)) : [];
    this.known = now;
    return fresh;
  }

  reset(): void {
    this.known = null;
  }
}
