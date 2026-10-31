import type { SpellMsg } from '@enu/protocol';
import type { Spell } from '@enu/shared';
import { ko } from '@/i18n/ko';
import type { WorldPoint } from '../entities/Fx';
import { ANCHOR_ABOVE_FEET, anchorPoint, type FxPlayer } from './FxPlayer';
import { fxEntry } from './strips';

/** Colour of each spell's floating word (pastel on an ink outline). */
export const SPELL_COLORS: Record<Spell, string> = {
  fireball: '#ff9a6b',
  coffee: '#e2b07e',
  zap: '#9cc8ff',
  potion: '#7fe0a8',
  highfive: '#ffd95e',
  fireworks: '#ff9ed6',
};
const OUTCOME_COLORS = { blocked: '#c8b6ff', combo: '#ffe066', raid: '#fff3b0' } as const;

/** Wand charge before a spell leaves (ms). */
export const CHARGE_MS = 300;

export interface Caster {
  feet: WorldPoint;
  wand: WorldPoint;
}

export interface Target {
  feet: WorldPoint;
}

/** Where effect `id` goes on someone standing at `feet` (its baked anchor; `free` means the chest). */
export function spotOn(id: string, feet: WorldPoint): WorldPoint {
  const a = fxEntry(id)?.anchor ?? 'chest';
  return anchorPoint(feet, a === 'free' ? 'chest' : a);
}

const chestOf = (feet: WorldPoint): WorldPoint => ({ x: feet.x, y: feet.y - ANCHOR_ABOVE_FEET.chest });
const headOf = (feet: WorldPoint): WorldPoint => ({ x: feet.x, y: feet.y - ANCHOR_ABOVE_FEET.head - 6 });

/**
 * The show for one `spell` message, the same on every screen (spells are public like a wave): the charge at the
 * caster's wand, the spell itself, and what became of it. A bounce off a shield shows the shield instead of the
 * hit; a combo links the two with lightning; a raid adds the pillar of light. Words are onomatopoeia from ko.ts.
 */
export function playSpell(
  fx: FxPlayer,
  msg: Pick<SpellMsg, 'spell' | 'outcome'>,
  from: Caster | null,
  to: Target,
): void {
  const blocked = msg.outcome === 'blocked';
  const words = ko.magic.spells[msg.spell];
  const t = to.feet;
  // The shield takes the strike on its upper right: mirror it when the spell comes from the left.
  const fromLeft = from !== null && from.feet.x < t.x;

  const land = () => {
    if (blocked) {
      fx.play('spell/shield-block', spotOn('spell/shield-block', t), { groundY: t.y, flipX: fromLeft });
      fx.shout(ko.magic.outcome.blocked, headOf(t), OUTCOME_COLORS.blocked);
      return;
    }
    hit(fx, msg.spell, t, from);
    fx.shout(words.shout, headOf(t), SPELL_COLORS[msg.spell]);
    if (msg.outcome === 'combo' && from) {
      const mid = { x: (from.feet.x + t.x) / 2, y: (from.feet.y + t.y) / 2 - ANCHOR_ABOVE_FEET.chest };
      fx.chain(chestOf(from.feet), chestOf(t), Math.round(mid.x * 31 + mid.y));
      fx.play('spell/combo-burst', mid, { groundY: Math.max(from.feet.y, t.y) });
      fx.shout(ko.magic.outcome.combo, { x: mid.x, y: mid.y - 16 }, OUTCOME_COLORS.combo, 220);
    } else if (msg.outcome === 'raid') {
      fx.play('spell/raid-pillar', spotOn('spell/raid-pillar', t), { groundY: t.y, delayMs: 200 });
      fx.shout(ko.magic.outcome.raid, { x: t.x, y: t.y - 52 }, OUTCOME_COLORS.raid, 420);
    }
  };

  if (from) fx.play('spell/charge', from.wand, { groundY: from.feet.y });
  const launch = () => {
    const start = from?.wand ?? { x: t.x, y: t.y - 90 };
    switch (msg.spell) {
      case 'fireball':
        fx.fly('spell/fireball-fly', start, chestOf(t), { rotate: true, onArrive: land });
        break;
      case 'potion':
        fx.fly('spell/potion-fly', start, chestOf(t), { lift: 46, mirrorLeft: true, onArrive: land });
        break;
      case 'coffee':
        // The mug falls out of the sky and lands beside the target (away from the caster); the splash (or the
        // shield) answers its landing.
        if (blocked)
          fx.play('spell/coffee-fall', spotOn('spell/coffee-fall', t), { groundY: t.y, onDone: land });
        else fx.play('spell/coffee-fall', beside(t, from), { groundY: t.y, onDone: land });
        break;
      default:
        land();
    }
  };
  if (from) fx.after(CHARGE_MS, launch);
  else launch();
}

/** A spot on the floor beside the target, on the side away from the caster (where the coffee mug lands). */
function beside(t: WorldPoint, from: Caster | null): WorldPoint {
  const side = from && from.feet.x > t.x ? -1 : 1;
  return { x: t.x + side * 15, y: t.y + 1 };
}

/** The hit strips of each spell at the target. */
function hit(fx: FxPlayer, spell: Spell, t: WorldPoint, from: Caster | null): void {
  const at = (id: string, delayMs = 0) => fx.play(id, spotOn(id, t), { groundY: t.y, delayMs });
  switch (spell) {
    case 'fireball':
      at('spell/fireball-hit');
      break;
    case 'coffee':
      fx.play('spell/coffee-splash', beside(t, from), { groundY: t.y });
      break;
    case 'zap':
      at('spell/zap-strike');
      at('spell/zap-sparks', 260);
      break;
    case 'potion':
      at('spell/heal');
      break;
    case 'highfive':
      at('spell/highfive-hit');
      break;
    case 'fireworks':
      at('spell/fireworks');
      break;
  }
}
