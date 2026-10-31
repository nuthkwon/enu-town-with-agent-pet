import { SPELLS, SPELL_OUTCOMES } from '@enu/shared';
import { describe, expect, it } from 'vitest';
import { BACKGROUND_GAP_MS, decideSfx } from './policy';

const ME = 'me';
const A = 'alice';
const B = 'bob';

describe('who hears a spell', () => {
  it('a third party never hears a spell between two colleagues, whatever became of it', () => {
    for (const spell of SPELLS)
      for (const outcome of SPELL_OUTCOMES)
        expect(
          decideSfx({ kind: 'spell', msg: { fromUserId: A, toUserId: B, spell, outcome } }, ME),
        ).toBeNull();
  });

  it('the caster hears the cast, the bounce or the combo', () => {
    const cast = (spell: (typeof SPELLS)[number], outcome: (typeof SPELL_OUTCOMES)[number]) =>
      decideSfx({ kind: 'spell', msg: { fromUserId: ME, toUserId: B, spell, outcome } }, ME);
    expect(cast('fireball', 'hit')).toBe('cast.fireball');
    expect(cast('zap', 'raid')).toBe('cast.zap');
    expect(cast('coffee', 'blocked')).toBe('spell.blocked');
    expect(cast('highfive', 'combo')).toBe('spell.combo');
  });

  it('the target hears the hit, the combo or the raid, and nothing through a shield', () => {
    const got = (spell: (typeof SPELLS)[number], outcome: (typeof SPELL_OUTCOMES)[number]) =>
      decideSfx({ kind: 'spell', msg: { fromUserId: A, toUserId: ME, spell, outcome } }, ME);
    for (const spell of SPELLS) expect(got(spell, 'hit')).toBe(`hit.${spell}`);
    expect(got('potion', 'blocked')).toBeNull();
    expect(got('highfive', 'combo')).toBe('spell.combo');
    expect(got('fireworks', 'raid')).toBe('spell.raid');
  });

  it('a spell at oneself is silent', () => {
    expect(
      decideSfx({ kind: 'spell', msg: { fromUserId: ME, toUserId: ME, spell: 'zap', outcome: 'hit' } }, ME),
    ).toBeNull();
  });
});

describe('the other sounds', () => {
  it('waves sound only for the two people involved', () => {
    expect(decideSfx({ kind: 'wave', fromUserId: ME, toUserId: B }, ME)).toBe('wave.out');
    expect(decideSfx({ kind: 'wave', fromUserId: A, toUserId: ME }, ME)).toBe('wave.in');
    expect(decideSfx({ kind: 'wave', fromUserId: A, toUserId: B }, ME)).toBeNull();
  });

  it('a DM ticks in its open thread and rings elsewhere; calls and my log notice sound', () => {
    expect(decideSfx({ kind: 'dm-in', threadOpen: true, tabVisible: true }, ME)).toBe('dm.tick');
    expect(decideSfx({ kind: 'dm-in', threadOpen: false, tabVisible: true }, ME)).toBe('dm.in');
    expect(decideSfx({ kind: 'ping-in' }, ME)).toBe('ping.in');
    expect(decideSfx({ kind: 'log-notice' }, ME)).toBe('log.notice');
    expect(decideSfx({ kind: 'mine', id: 'quest.done' }, ME)).toBe('quest.done');
  });

  it('only a call and a DM may ring in a background tab', () => {
    expect(Object.keys(BACKGROUND_GAP_MS).sort()).toEqual(['dm.in', 'ping.in']);
  });

  it('a DM to a hidden tab rings even with its thread open (once per background gap), never a dropped tick', () => {
    for (const threadOpen of [true, false]) {
      const id = decideSfx({ kind: 'dm-in', threadOpen, tabVisible: false }, ME);
      expect(id).toBe('dm.in');
      expect(BACKGROUND_GAP_MS[id!]).toBe(20_000);
    }
  });
});
