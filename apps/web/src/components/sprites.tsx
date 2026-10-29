import { avatarSpriteKey, type AvatarPreset } from '@enu/shared';
import type { CSSProperties, ReactNode } from 'react';
import { ko } from '@/i18n/ko';
import s from './sprites.module.css';

/**
 * Sprite previews drawn from the generated sheets (see packages/sprites spec):
 *   avatar: 10 columns x 4 rows of 32x32 (row 0 = facing down/front, columns 0-3 = idle)
 *   pet:    12 columns x 2 rows of 24x24 (row 0 = facing left, columns 0-3 = idle hover)
 * Frames are scaled with nearest-neighbour (image-rendering: pixelated).
 */
const AVATAR = { frame: 32, columns: 10, rows: 4 } as const;
const PET = { frame: 24, columns: 12, rows: 2 } as const;

function sheetStyle(url: string, frame: number, columns: number, rows: number, scale: number): CSSProperties {
  const size = frame * scale;
  return {
    width: size,
    height: size,
    backgroundImage: `url("${url}")`,
    backgroundSize: `${columns * size}px ${rows * size}px`,
    backgroundPosition: '0 0',
    ['--frame' as string]: `${size}px`,
  };
}

export function AvatarSprite({
  preset,
  scale = 4,
  animate = false,
  label,
}: {
  preset: AvatarPreset;
  scale?: number;
  animate?: boolean;
  label?: string;
}) {
  const url = `/api/sprites/avatar/${avatarSpriteKey(preset)}`;
  return (
    <span
      role="img"
      aria-label={label ?? ko.common.avatar}
      className={animate ? `${s.sprite} ${s.animated}` : s.sprite}
      style={sheetStyle(url, AVATAR.frame, AVATAR.columns, AVATAR.rows, scale)}
    />
  );
}

export function PetSprite({
  species,
  scale = 3,
  animate = false,
  label,
}: {
  species: string;
  scale?: number;
  animate?: boolean;
  label?: string;
}) {
  const url = `/assets/sprites/pets/${encodeURIComponent(species)}.png`;
  return (
    <span
      role="img"
      aria-label={label ?? species}
      className={animate ? `${s.sprite} ${s.animated}` : s.sprite}
      style={sheetStyle(url, PET.frame, PET.columns, PET.rows, scale)}
    />
  );
}

/** Round pastel pedestal for a featured sprite. */
export function SpriteStage({ size, children }: { size: number; children: ReactNode }) {
  return (
    <span className={s.stage} style={{ width: size, height: size, paddingBottom: Math.round(size * 0.1) }}>
      {children}
    </span>
  );
}
