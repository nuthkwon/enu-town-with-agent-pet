import { ActivityCode } from '@enu/protocol';
import { describe, expect, it } from 'vitest';
import { GatheringWatch, PresenceFxGate, auraFor } from './gate';

describe('PresenceFxGate', () => {
  it('draws arrivals only in office hours, and not right after the office opened', () => {
    const g = new PresenceFxGate(4000, 3);
    expect(g.allow(0, false)).toBe(false);
    expect(g.allow(0, null)).toBe(false);
    g.officeChanged(10_000);
    expect(g.allow(12_000, true)).toBe(false);
    expect(g.allow(14_001, true)).toBe(true);
  });

  it('draws at most a few per second', () => {
    const g = new PresenceFxGate(0, 3);
    expect([0, 10, 20, 30].map((t) => g.allow(5000 + t, true))).toEqual([true, true, true, false]);
    expect(g.allow(6011, true)).toBe(true);
  });
});

describe('auraFor', () => {
  it('draws focus and breaks as auras, in office hours, while drawn', () => {
    expect(auraFor({ shown: true, activity: ActivityCode.Focus }, true)).toBe('aura/focus-shield');
    expect(auraFor({ shown: true, activity: ActivityCode.Break }, true)).toBe('aura/mana-rest');
    expect(auraFor({ shown: true, activity: ActivityCode.Meeting }, true)).toBeNull();
    expect(auraFor({ shown: false, activity: ActivityCode.Focus }, true)).toBeNull();
    expect(auraFor({ shown: true, activity: ActivityCode.Focus }, false)).toBeNull();
  });
});

describe('GatheringWatch', () => {
  it('celebrates only meetings that gather while watching', () => {
    const w = new GatheringWatch();
    expect(w.update(['m1'], true)).toEqual([]);
    expect(w.update(['m1', 'm2'], true)).toEqual(['m2']);
    expect(w.update([], true)).toEqual([]);
    expect(w.update(['m1'], true)).toEqual(['m1']);
    w.reset();
    expect(w.update(['m3'], true)).toEqual([]);
  });

  it('celebrates nothing until the office state is known, then only learns (rejoin)', () => {
    const w = new GatheringWatch();
    expect(w.update(['m1'], true)).toEqual([]);
    // A rejoin: the room is reset and the state has not arrived yet (nothing is drawn as gathered) ...
    expect(w.update([], null)).toEqual([]);
    // ... then it arrives with the meeting still in progress: it already existed, so no party circle.
    expect(w.update(['m1'], true)).toEqual([]);
    expect(w.update(['m1'], true)).toEqual([]);
  });

  it('does not celebrate a meeting already gathered when the office opens', () => {
    const w = new GatheringWatch();
    expect(w.update([], false)).toEqual([]);
    expect(w.update(['m1'], false)).toEqual([]);
    expect(w.update(['m1'], true)).toEqual([]);
    // Closing forgets it; opening again with the meeting still there is no new gathering either.
    expect(w.update([], false)).toEqual([]);
    expect(w.update(['m1'], true)).toEqual([]);
  });

  it('celebrates a meeting that gathers while the office is open, once', () => {
    const w = new GatheringWatch();
    expect(w.update([], true)).toEqual([]);
    expect(w.update(['m1'], true)).toEqual(['m1']);
    expect(w.update(['m1'], true)).toEqual([]);
  });

  it('learns a meeting that gathered while the tab was hidden instead of celebrating it late', () => {
    const w = new GatheringWatch();
    expect(w.update([], true)).toEqual([]);
    // The tab is hidden (the scene's loop stops): the scene forgets ...
    w.reset();
    // ... and its first frame back only learns the meeting that gathered meanwhile.
    expect(w.update(['m1'], true)).toEqual([]);
    expect(w.update(['m1', 'm2'], true)).toEqual(['m2']);
  });
});
