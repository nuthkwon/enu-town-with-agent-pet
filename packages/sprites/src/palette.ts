import type { HairColor, OutfitColor, SkinTone } from '@enu/shared';
import { type RGBA, hex, mix } from './draw/color';

/**
 * Bright pastel "magical girl" palette. Outlines are a dark plum/navy, never pure black.
 */
export const INK = hex('#3b2a52'); // main outline
export const INK_SOFT = hex('#5b4673'); // inner lines
export const WHITE = hex('#ffffff');
export const CREAM = hex('#fff8f0');
export const CREAM_SHADE = hex('#eadcef');

export interface HairPalette {
  /** shadow, base, light, shine */
  dark: RGBA;
  base: RGBA;
  light: RGBA;
  shine: RGBA;
  /** Iris colour that matches the hair (eyes look coordinated). */
  eye: RGBA;
  eyeLight: RGBA;
}

const hair = (dark: string, base: string, light: string, shine: string, eye: string, eyeLight: string): HairPalette => ({
  dark: hex(dark),
  base: hex(base),
  light: hex(light),
  shine: hex(shine),
  eye: hex(eye),
  eyeLight: hex(eyeLight),
});

export const HAIR_PALETTES: Record<HairColor, HairPalette> = {
  black: hair('#2b2945', '#3f3c64', '#5a5a8e', '#8f95cf', '#4a5bc4', '#8fa6ff'),
  brown: hair('#55332a', '#7a4d39', '#9c6a4d', '#d1a17c', '#8a5536', '#d0915e'),
  chestnut: hair('#6e2c25', '#9c4433', '#c4654a', '#ee9f7c', '#a24a3a', '#ef8f6a'),
  blonde: hair('#d39a3e', '#f2c95e', '#fde494', '#fff6cf', '#3f8fd6', '#8ed0ff'),
  pink: hair('#d9649b', '#f78dbe', '#ffbcdb', '#ffe8f3', '#d24a8f', '#ff9fcf'),
  lavender: hair('#8467c9', '#a98fe6', '#cbbaf7', '#f0eaff', '#7a4fd6', '#c3a4ff'),
  teal: hair('#21868d', '#3cb7b5', '#7bdcd2', '#d2fff6', '#1b9a94', '#6fe3d6'),
  silver: hair('#8c90ad', '#b9bdd6', '#dadff0', '#ffffff', '#6a78c8', '#a9b8ff'),
};

export interface OutfitPalette {
  dark: RGBA;
  base: RGBA;
  light: RGBA;
  /** Trousers (male body) */
  pants: RGBA;
  pantsDark: RGBA;
  /** Shoes */
  shoe: RGBA;
  /** Small accent (ribbon / tie / buttons) */
  accent: RGBA;
}

const outfit = (
  dark: string,
  base: string,
  light: string,
  pants: string,
  pantsDark: string,
  shoe: string,
  accent: string,
): OutfitPalette => ({
  dark: hex(dark),
  base: hex(base),
  light: hex(light),
  pants: hex(pants),
  pantsDark: hex(pantsDark),
  shoe: hex(shoe),
  accent: hex(accent),
});

export const OUTFIT_PALETTES: Record<OutfitColor, OutfitPalette> = {
  rose: outfit('#e0577f', '#ff86ac', '#ffbdd2', '#5a5f92', '#43476f', '#c2426c', '#fff3a6'),
  sky: outfit('#4a95e0', '#72c2ff', '#b0e0ff', '#4f5689', '#3b4068', '#3f6fc0', '#ffd36e'),
  mint: outfit('#3cb489', '#6be0b3', '#aef2d5', '#56608f', '#41496f', '#2f8f75', '#ff9fc4'),
  lemon: outfit('#e2b23a', '#ffdc63', '#fff0aa', '#5b6696', '#434b73', '#d08a2f', '#7ec8ff'),
  lilac: outfit('#9a70e8', '#c29cff', '#dfcaff', '#535b8c', '#3e446b', '#7a52c8', '#ffd6f0'),
  coral: outfit('#e2644f', '#ff8d76', '#ffbcae', '#4f5689', '#3b4068', '#c24a3c', '#fff0a0'),
  navy: outfit('#323e7a', '#4b5ba8', '#7183cc', '#bfc3d9', '#9a9fbd', '#2c3368', '#ffd36e'),
  peach: outfit('#ea935f', '#ffbb8a', '#ffd9bc', '#58608f', '#424a72', '#c46f45', '#8fd8ff'),
};

export interface SkinPalette {
  base: RGBA;
  shade: RGBA;
  blush: RGBA;
}

export const SKIN_PALETTES: Record<SkinTone, SkinPalette> = {
  light: { base: hex('#ffe6d8'), shade: hex('#f4c3b0'), blush: hex('#ff8fae', 150) },
  warm: { base: hex('#fdd3b4'), shade: hex('#e9aa8a'), blush: hex('#ff7f99', 150) },
  tan: { base: hex('#dba27c'), shade: hex('#bd7f5d'), blush: hex('#ec6b80', 160) },
};

/** Fairy wing colours (always translucent). */
export const WING = {
  fill: hex('#e2f6ff', 175),
  fill2: hex('#ffd9f3', 185),
  edge: hex('#86bdf0', 230),
  edge2: hex('#f0a0d8', 235),
  shine: hex('#ffffff', 240),
};

export const SPARKLE = {
  core: hex('#ffffff'),
  gold: hex('#ffe680'),
  pink: hex('#ffb3e0'),
  blue: hex('#a8e6ff'),
};

/** Dark ink tinted towards a fill colour — gives softer, coloured outlines. */
export function inkFor(fill: RGBA): RGBA {
  return mix(INK, [fill[0], fill[1], fill[2], 255], 0.18);
}
