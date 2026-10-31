'use client';

import { useEffect, useState, type CSSProperties } from 'react';
import {
  COMPANION_COLUMNS,
  COMPANION_EXPRESSIONS,
  COMPANION_FRAME,
  type CompanionExpression,
  SPRITE_PATHS,
} from '@/game/spriteSpec';
import s from '../den.module.css';

/** The companion sheet of a look (static file for base colours, the sprite API for tints; with the revision). */
function companionUrl(species: string, tint: string): string {
  return tint === 'base' ? SPRITE_PATHS.companion(species) : SPRITE_PATHS.petApi(`pc-${species}-${tint}`);
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const on = () => setReduced(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return reduced;
}

/**
 * The big pet of a room: one row of the companion sheet, stepped by a small ticker (paused while the tab is
 * hidden; with reduced motion only the first frame of each expression is shown).
 */
export function CompanionSprite({
  species,
  tint = 'base',
  expression,
  scale = 4,
  label,
}: {
  species: string;
  tint?: string;
  expression: CompanionExpression;
  scale?: number;
  label: string;
}) {
  const def = COMPANION_EXPRESSIONS[expression];
  const reduced = usePrefersReducedMotion();
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    setFrame(0);
    if (reduced || def.frames <= 1) return;
    let i = 0;
    const timer = setInterval(() => {
      if (document.hidden) return;
      i += 1;
      if (def.repeat === 0 && i >= def.frames) {
        clearInterval(timer);
        return;
      }
      setFrame(i % def.frames);
    }, 1000 / def.frameRate);
    return () => clearInterval(timer);
  }, [def, reduced]);

  const size = COMPANION_FRAME * scale;
  const style: CSSProperties = {
    width: size,
    height: size,
    backgroundImage: `url("${companionUrl(species, tint)}")`,
    backgroundSize: `${COMPANION_COLUMNS * size}px ${size}px`,
    backgroundPosition: `${-(def.start + frame) * size}px 0`,
  };
  return <span role="img" aria-label={label} className={s.companion} style={style} />;
}
