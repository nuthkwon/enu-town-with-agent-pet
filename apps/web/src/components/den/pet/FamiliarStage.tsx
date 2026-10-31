'use client';

import type { OwnerPetDto } from '@enu/shared';
import { useEffect, useRef, useState } from 'react';
import { fxEntry, useFxLayer } from '@/components/fx/FxSprite';
import { Button, cx } from '@/components/ui';
import type { CompanionExpression } from '@/game/spriteSpec';
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
  // Read once, when the room opens: a later change of the URL never cuts the hatching short.
  const [hatchOnOpen] = useState(hatch);
  const [hatching, setHatching] = useState(hatchOnOpen);
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

  // A pet just made: the egg rocks, cracks and the familiar pops out at the burst. Cut short (the room closes, or
  // StrictMode runs the effect again), the egg goes and the familiar shows at once.
  useEffect(() => {
    if (!hatchOnOpen) return;
    const id = fxEntry(`pet/hatch--${pet.tint}`) ? `pet/hatch--${pet.tint}` : 'pet/hatch--base';
    const e = fxEntry(id);
    if (!e) {
      setHatching(false);
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
      setHatching(false);
      stop(id);
    };
    // Once, when the room opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pat = () => {
    play('pet/pat-heart', FEET, SCALE);
    playMine('pet.pat');
    setOverride({ expression: 'happy', until: Date.now() + 1200 });
    onPlayed();
  };
  const snack = () => {
    play('pet/munch', FEET, SCALE);
    playMine('pet.munch');
    setOverride({ expression: 'eat', until: Date.now() + 1500 });
    onPlayed();
  };
  const show = () => {
    const id = MINI_SPELLS[mini.current % MINI_SPELLS.length]!;
    mini.current += 1;
    play(id, FEET, SCALE);
    playMine('pet.spell');
    setOverride({ expression: 'cast', until: Date.now() + 1300 });
    onPlayed();
  };

  const expression = override?.expression ?? COMPANION_SPRITE[expr];
  return (
    <div className={s.familiar}>
      {/* The summoning circle under the familiar, everything else over it. */}
      <span className={cx(s.companionStage, s.familiarStage)} style={{ width: STAGE, height: STAGE }}>
        {fx.under}
        <button
          type="button"
          className={s.companionButton}
          style={{ opacity: hatching ? 0 : 1 }}
          onClick={pat}
          disabled={hatching}
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
        {fx.over}
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
