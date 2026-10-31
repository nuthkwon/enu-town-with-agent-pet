// ENU Den house palette and small shared shapes for effects (ADR 0008).
//
// Ramps run dark to bright and start at the plum ink of the pixel art (#3b2a52), so effects sit on the town's
// pastel floors and the messenger's white cards the way the avatars do. Pass one as `options.palette` and index it
// with `fit(o.palette, n)`: any ramp length works.

export const DEN = {
  lavender: ['#3b2a52', '#5b4673', '#7457d6', '#a78bfa', '#cbb8ff', '#efe9ff', '#ffffff'],
  pink: ['#3b2a52', '#a8306e', '#d94f93', '#ff8fbf', '#ffc7de', '#fde8f3', '#ffffff'],
  mint: ['#3b2a52', '#1d8f68', '#43c08f', '#8be8c0', '#aef2d5', '#defaee', '#ffffff'],
  lemon: ['#3b2a52', '#a86a12', '#f2b53c', '#ffe170', '#fde68a', '#fff7d6', '#ffffff'],
  sky: ['#3b2a52', '#3f74c4', '#5aa8e6', '#9fdcff', '#b0e0ff', '#e3f1ff', '#ffffff'],
  coral: ['#3b2a52', '#c24a3c', '#e2644f', '#ff8a80', '#ffbcae', '#ffe5eb', '#ffffff'],
  /** Translucent puffs and smoke: no ink at the dark end, so a cloud never reads as dirt on a pastel floor. */
  puff: ['#5b4673', '#8f82ab', '#b9b0cf', '#d9d2ea', '#eeeaf6', '#ffffff'],
  /** The cheer fireball: warm, comic, never a real fire. */
  ember: ['#3b2a52', '#8c2f39', '#d9483b', '#ff7a3d', '#ffb347', '#ffe08a', '#ffffff'],
  /** Coffee, crema and steam. */
  coffee: ['#3b2a52', '#5a3a2e', '#8b5a3c', '#b98257', '#dcb48a', '#f3e2c7', '#ffffff'],
  /** Praise lightning: violet root, sky body, lemon-white core. */
  volt: ['#3b2a52', '#5a4fc4', '#7aa8ff', '#b8e0ff', '#fff3a0', '#fffbe0', '#ffffff'],
};

/** Pet tint → ramp, for per-tint variants (hatch). */
export const TINT_RAMP = {
  base: DEN.lavender,
  rose: DEN.pink,
  mint: DEN.mint,
  sky: DEN.sky,
  lemon: DEN.lemon,
  lilac: DEN.lavender,
};

/** Where the town places an effect's origin on a person (px above the feet), as AvatarView does. */
export const ANCHOR_ABOVE_FEET = { feet: 0, chest: 14, head: 27 };

/** A 7×6 heart, row by row ('#' fill, '.' empty): `p.sprite(HEART, { '#': '#ff8fbf' }, x, y)`, or `{ tint: c }`. */
export const HEART = ['.##.##.', '#######', '#######', '.#####.', '..###..', '...#...'];

/** A 5×5 four-point glint. */
export const GLINT = ['..#..', '..#..', '#####', '..#..', '..#..'];
