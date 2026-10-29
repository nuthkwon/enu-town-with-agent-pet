import { EFFECT_COLUMNS, EFFECT_FRAME, EFFECT_FRAMES, EFFECT_ROWS, SPRITE_PATHS, type EffectName } from '@/game/spriteSpec';
import s from './town.module.css';

/** One 16x16 frame of the effects sheet (the same icons the map draws), scaled with nearest-neighbour. */
export function EffectIcon({ name, size = 16, label }: { name: EffectName; size?: number; label?: string }) {
  const frame = EFFECT_FRAMES[name];
  const col = frame % EFFECT_COLUMNS;
  const row = Math.floor(frame / EFFECT_COLUMNS);
  const scale = size / EFFECT_FRAME;
  return (
    <span
      className={s.fxIcon}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      style={{
        width: size,
        height: size,
        backgroundImage: `url("${SPRITE_PATHS.effects}")`,
        backgroundSize: `${EFFECT_COLUMNS * EFFECT_FRAME * scale}px ${EFFECT_ROWS * EFFECT_FRAME * scale}px`,
        backgroundPosition: `-${col * size}px -${row * size}px`,
      }}
    />
  );
}
