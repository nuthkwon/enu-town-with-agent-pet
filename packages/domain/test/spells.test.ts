import { describe, expect, it } from 'vitest';
import { SpellMemory } from '../src/spells';

const S = 1000;

describe('SpellMemory', () => {
  it('lands a spell, and a shield blocks it without counting towards a raid', () => {
    const m = new SpellMemory();
    expect(m.cast({ from: 'a', to: 'b', spell: 'fireball', atMs: 0 }, false)).toBe('hit');
    expect(m.cast({ from: 'c', to: 'b', spell: 'coffee', atMs: S }, true)).toBe('blocked');
    expect(m.cast({ from: 'd', to: 'b', spell: 'zap', atMs: 2 * S }, false)).toBe('hit');
  });

  it('makes a combo of a high-five returned within 10 s, once', () => {
    const m = new SpellMemory();
    expect(m.cast({ from: 'a', to: 'b', spell: 'highfive', atMs: 0 }, false)).toBe('hit');
    expect(m.cast({ from: 'b', to: 'a', spell: 'highfive', atMs: 9 * S }, false)).toBe('combo');
    // the combo is used up: a third high-five starts over
    expect(m.cast({ from: 'a', to: 'b', spell: 'highfive', atMs: 10 * S }, false)).toBe('hit');
  });

  it('does not make a combo after 10 s, of the same direction, or of another spell', () => {
    const m = new SpellMemory();
    m.cast({ from: 'a', to: 'b', spell: 'highfive', atMs: 0 }, false);
    expect(m.cast({ from: 'b', to: 'a', spell: 'highfive', atMs: 11 * S }, false)).toBe('hit');
    const n = new SpellMemory();
    n.cast({ from: 'a', to: 'b', spell: 'highfive', atMs: 0 }, false);
    expect(n.cast({ from: 'a', to: 'b', spell: 'highfive', atMs: S }, false)).toBe('hit');
    expect(n.cast({ from: 'b', to: 'a', spell: 'potion', atMs: 2 * S }, false)).toBe('hit');
  });

  it('turns the third different caster within a minute into a raid, once per window', () => {
    const m = new SpellMemory();
    expect(m.cast({ from: 'a', to: 'z', spell: 'fireball', atMs: 0 }, false)).toBe('hit');
    expect(m.cast({ from: 'a', to: 'z', spell: 'coffee', atMs: S }, false)).toBe('hit'); // same caster
    expect(m.cast({ from: 'b', to: 'z', spell: 'potion', atMs: 2 * S }, false)).toBe('hit');
    expect(m.cast({ from: 'c', to: 'z', spell: 'zap', atMs: 3 * S }, false)).toBe('raid');
    expect(m.cast({ from: 'd', to: 'z', spell: 'zap', atMs: 4 * S }, false)).toBe('hit');
    expect(m.cast({ from: 'e', to: 'z', spell: 'zap', atMs: 5 * S }, false)).toBe('hit');
    expect(m.cast({ from: 'f', to: 'z', spell: 'zap', atMs: 6 * S }, false)).toBe('hit');
  });

  it('does not raid on casters spread over more than a minute', () => {
    const m = new SpellMemory();
    m.cast({ from: 'a', to: 'z', spell: 'fireball', atMs: 0 }, false);
    m.cast({ from: 'b', to: 'z', spell: 'fireball', atMs: 30 * S }, false);
    expect(m.cast({ from: 'c', to: 'z', spell: 'fireball', atMs: 61 * S }, false)).toBe('hit');
  });

  it('lets one person receive at most 6 spells a minute from the whole room', () => {
    const m = new SpellMemory();
    for (let i = 0; i < 6; i++) {
      expect(m.allowTarget('z', i * S)).toBe(true);
      m.cast({ from: `p${i}`, to: 'z', spell: 'fireworks', atMs: i * S }, i % 2 === 0);
    }
    expect(m.allowTarget('z', 7 * S)).toBe(false);
    expect(m.allowTarget('y', 7 * S)).toBe(true);
    expect(m.allowTarget('z', 61 * S)).toBe(true);
  });

  it('forgets everything after the windows pass, and on forget()', () => {
    const m = new SpellMemory();
    m.cast({ from: 'a', to: 'b', spell: 'highfive', atMs: 0 }, false);
    m.cast({ from: 'c', to: 'b', spell: 'fireball', atMs: 0 }, false);
    expect(m.size).toBeGreaterThan(0);
    m.allowTarget('x', 120 * S);
    expect(m.size).toBe(0);
    m.cast({ from: 'a', to: 'b', spell: 'highfive', atMs: 200 * S }, false);
    m.forget('a');
    m.forget('b');
    expect(m.size).toBe(0);
  });
});
