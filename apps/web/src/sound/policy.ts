import type { SpellMsg } from '@enu/protocol';
import type { SfxId } from '@enu/sfx';

/**
 * Who hears what (ADR 0008, effects-spec "Sounds"): a sound plays only for what I did and for what was addressed
 * to me. A third party sees a spell or a wave between colleagues but never hears it (606호 is one room), a spell
 * that bounced off a shield makes no sound for its target, and pet bubbles are silent. Pure, so the table is
 * tested as a whole: the caller passes what it sees (an open DM thread, whether the tab is visible).
 */
export type SfxEvent =
  | { kind: 'spell'; msg: Pick<SpellMsg, 'fromUserId' | 'toUserId' | 'spell' | 'outcome'> }
  | { kind: 'wave'; fromUserId: string; toUserId: string }
  /** `pinged` reaches only its target. */
  | { kind: 'ping-in' }
  /**
   * A DM to me: a tick while I am reading its thread (open, in a visible tab), else the ring. A hidden tab is not
   * reading, so it rings even with the thread open (once per `BACKGROUND_GAP_MS`).
   */
  | { kind: 'dm-in'; threadOpen: boolean; tabVisible: boolean }
  /** My own Claude published my work log (only I get the notice). */
  | { kind: 'log-notice' }
  /** Something I just did myself (a click, my familiar, my quest). */
  | { kind: 'mine'; id: SfxId };

export function decideSfx(e: SfxEvent, meId: string): SfxId | null {
  switch (e.kind) {
    case 'spell': {
      const { fromUserId, toUserId, spell, outcome } = e.msg;
      if (fromUserId === toUserId) return null;
      if (fromUserId === meId) {
        if (outcome === 'blocked') return 'spell.blocked';
        if (outcome === 'combo') return 'spell.combo';
        return `cast.${spell}`;
      }
      if (toUserId === meId) {
        if (outcome === 'blocked') return null;
        if (outcome === 'combo') return 'spell.combo';
        if (outcome === 'raid') return 'spell.raid';
        return `hit.${spell}`;
      }
      return null;
    }
    case 'wave':
      if (e.fromUserId === e.toUserId) return null;
      if (e.fromUserId === meId) return 'wave.out';
      if (e.toUserId === meId) return 'wave.in';
      return null;
    case 'ping-in':
      return 'ping.in';
    case 'dm-in':
      return e.threadOpen && e.tabVisible ? 'dm.tick' : 'dm.in';
    case 'log-notice':
      return 'log.notice';
    case 'mine':
      return e.id;
  }
}

/**
 * With the tab in the background only a call and a DM ring, at most once per this many ms (the user chose this;
 * everything else waits for the person to look). `dm.tick` is not here: a hidden tab gets `dm.in` from `decideSfx`.
 */
export const BACKGROUND_GAP_MS: Partial<Record<SfxId, number>> = { 'ping.in': 10_000, 'dm.in': 20_000 };
