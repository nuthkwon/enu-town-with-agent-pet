import type Phaser from 'phaser';
import type { Measure } from './logic/textLayout';

/** World/overlay split used by every view of the WorldScene. */
export interface Stage {
  readonly scene: Phaser.Scene;
  /** CSS font-family list for canvas text. */
  readonly font: string;
  /** Width function for `${PIXEL_FONT_SIZE}px ${font}`. */
  readonly measure: Measure;
  /** Registers a world-space object (zoomed main camera only). */
  world<T extends Phaser.GameObjects.GameObject>(obj: T): T;
  /** Registers a screen-space overlay object (unzoomed overlay camera only). */
  overlay<T extends Phaser.GameObjects.GameObject>(obj: T): T;
  /** World px -> overlay (screen) px, rounded to whole pixels. */
  toScreen(wx: number, wy: number): { x: number; y: number };
  readonly zoom: number;
  readonly viewWidth: number;
  readonly viewHeight: number;
}

export const TILE_PX = 32;
/** Where an avatar's feet rest inside its tile (px from the tile's top). */
export const AVATAR_FEET_IN_TILE = 29;

export const DEPTH = {
  floor: 0,
  walls: 1,
  furniture: 2,
  /** Entities and furniture-top tiles sort by their ground line on top of this base. */
  entities: 10,
  overlayDesk: 10_000,
  overlayTag: 20_000,
  overlayChat: 30_000,
  overlayPetBubble: 40_000,
} as const;

export function tileCenterX(tx: number): number {
  return tx * TILE_PX + TILE_PX / 2;
}

export function avatarFeetY(ty: number): number {
  return ty * TILE_PX + AVATAR_FEET_IN_TILE;
}

export const COLORS = {
  ink: 0x3b2f4a,
  inkCss: '#3b2f4a',
  white: 0xffffff,
  petBubbleFill: 0xfff7fc,
  petBubbleBorder: 0xe59ac9,
  petBubbleShade: 0xf6dcef,
  chatFill: 0xffffff,
  chatBorder: 0x8f7fb0,
  chipFill: 0x3b2f4a,
  plateFill: 0xfff8ec,
  plateBorder: 0xc9a77a,
  status: [0x6fcf8f, 0xa98bf5, 0xf3a26b, 0xb6b2c4] as readonly number[],
} as const;
