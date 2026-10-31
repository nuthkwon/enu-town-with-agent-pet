'use client';

import type { OwnerPetDto } from '@enu/shared';
import { useEffect, useRef, useState } from 'react';
import { fxEntry, useFxLayer } from '@/components/fx/FxSprite';
import { Button } from '@/components/ui';
import { COMPANION_EXPRESSIONS, type CompanionExpression } from '@/game/spriteSpec';
import { ko } from '@/i18n/ko';
import { playMine } from '@/sound/engine';
import { COMPANION_SPRITE, type CompanionExpr } from '../model/companionState';
import { CompanionSprite } from './CompanionSprite';
import s from '../den.module.css';

const SCALE = 4;
const STAGE = 112;
/** The companion's feet inside the stage (the 96 px sprite sits bottom-centre; its feet are at y 22 of 24). */
const FEET = { x: STAGE / 2, y: STAGE - 8 };
const MINI_SPELLS = ['pet/mini-fire', 'pet/mini-ice', 'pet/mini-star', 'pet/mini-zap'] as const;

/** A sheet expression if this sheet has it (older cached sheets may not have eat/cast yet). */
function pose(name: string, fallback: CompanionExpression): CompanionExpression {
  return (name in COMPANION_EXPRESSIONS ? name : fallback) as CompanionExpression;
}

/**
 * My familiar in its room (owner only, nothing is sent or stored): pat it, give it a snack, ask for a little
 * spell show (pictures only: a pet never says anything ENU Den made up), watch it hatch the first time, see the
 * summoning circle when my Claude's reply arrives and the zzz while nothing can answer.
 */
export function FamiliarStage({
  pet,
  expr,
  replySignal,
  hatch,
  onHatched,
  onPlayed,
}: {
  pet: OwnerPetDto;
  expr: CompanionExpr;
  /** Bumps when a fresh reply from my Claude arrives. */
  replySignal: number;
  /** Play the hatching (a pet just created). */
  hatch: boolean;
  onHatched: () => void;
  /** The familiar enjoyed something (the room makes it happy for a moment). */
  onPlayed: () => void;
}) {
  const fx = useFxLayer();
  const [override, setOverride] = useState<{ expression: CompanionExpression; until: number } | null>(null);
  const [hatching, setHatching] = useState(false);
  const mini = useRef(0);
  const { play, stop } = fx;

  useEffect(() => {
    if (!override) return;
    const timer = setTimeout(() => setOverride(null), Math.max(0, override.until - Date.now()));
    return () => clearTimeout(timer);
  }, [override]);

  // The summoning circle under the familiar when my Claude's reply lands.
  useEffect(() => {
    if (replySignal === 0) return;
    play('pet/summon-reply', FEET, SCALE);
    playMine('pet.reply');
  }, [replySignal, play]);

  // Asleep: a slow line of z's for as long as it sleeps.
  useEffect(() => {
    if (expr !== 'sleeping' || hatching) return;
    play('pet/zzz', FEET, SCALE);
    return () => stop('pet/zzz');
  }, [expr, hatching, play, stop]);

  // A pet just made: the egg rocks, cracks and the familiar pops out at the burst.
  useEffect(() => {
    if (!hatch) return;
    const id = fxEntry(`pet/hatch--${pet.tint}`) ? `pet/hatch--${pet.tint}` : 'pet/hatch--base';
    const e = fxEntry(id);
    if (!e) {
      onHatched();
      return;
    }
    setHatching(true);
    play(id, FEET, SCALE);
    playMine('pet.hatch');
    const total = (e.frames / e.fps) * 1000;
    const reveal = setTimeout(() => setHatching(false), total * 0.62);
    const done = setTimeout(onHatched, total);
    return () => {
      clearTimeout(reveal);
      clearTimeout(done);
    };
    // Only when a hatching starts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hatch]);

  const pat = () => {
    play('pet/pat-heart', FEET, SCALE);
    playMine('pet.pat');
    setOverride({ expression: pose('happy', 'happy'), until: Date.now() + 1200 });
    onPlayed();
  };
  const snack = () => {
    play('pet/munch', FEET, SCALE);
    playMine('pet.munch');
    setOverride({ expression: pose('eat', 'happy'), until: Date.now() + 1500 });
    onPlayed();
  };
  const show = () => {
    const id = MINI_SPELLS[mini.current % MINI_SPELLS.length]!;
    mini.current += 1;
    play(id, FEET, SCALE);
    playMine('pet.spell');
    setOverride({ expression: pose('cast', 'happy'), until: Date.now() + 1300 });
    onPlayed();
  };

  const expression = override?.expression ?? COMPANION_SPRITE[expr];
  return (
    <div className={s.familiar}>
      <span className={s.companionStage} style={{ width: STAGE, height: STAGE, position: 'relative' }}>
        <button
          type="button"
          className={s.companionButton}
          style={{ opacity: hatching ? 0 : 1 }}
          onClick={pat}
          aria-label={ko.magic.familiar.patLabel(pet.name)}
          title={ko.magic.familiar.pat}
        >
          <CompanionSprite
            species={pet.species}
            tint={pet.tint}
            expression={expression}
            scale={SCALE}
            label={ko.den.companion.img(pet.name, ko.den.companion.expr[expr])}
          />
        </button>
        {fx.layer}
      </span>
      <div className={s.familiarBar} role="group" aria-label={ko.magic.familiar.playLabel}>
        <Button size="sm" variant="ghost" onClick={snack} disabled={hatching}>
          {ko.magic.familiar.snack}
        </Button>
        <Button size="sm" variant="ghost" onClick={show} disabled={hatching}>
          {ko.magic.familiar.show}
        </Button>
      </div>
    </div>
  );
}
