/**
 * Types for ENU Den's effects. An effect is a pixelfx-contract module (`packages/fx/effects/<group>/<name>.js`):
 * `meta` plus `draw(p, t, o)` (pure) or `create(o)` (simulated). ENU Den adds `meta.den`.
 */

/** Where an effect plays: the Phaser town, or the messenger (CSS strips) in the pet room or anywhere else. */
export type FxSurface = 'town' | 'ui' | 'pet';

/** Town placement: the point on a person the effect's origin sits on (see `ANCHOR_ABOVE_FEET`). */
export type FxAnchor = 'feet' | 'chest' | 'head' | 'free';

export interface DenMeta {
  surface: FxSurface;
  /** Drawn under the person (floor rings, auras) or over them. Default 'over'. */
  depth?: 'under' | 'over';
  /** Town only: where the origin goes on a person. Default 'feet'. */
  anchor?: FxAnchor;
  /** Who stands in the preview: our avatar, a pet, the pet-room companion, or nobody. */
  stand?: 'avatar' | 'pet' | 'companion' | 'none';
  /** UI only: CSS scale the messenger plays the strip at (whole numbers stay crisp). Default 2. */
  scale?: number;
  /** Baked variants (e.g. one per pet tint): name → options merged over `meta.options`. */
  variants?: Record<string, Record<string, unknown>>;
  /** The pixelfx library effect this one was adapted from (`<category>/<name>`), if any. */
  from?: string;
}

export interface FxMeta {
  name: string;
  desc: string;
  tags: string[];
  size: [number, number];
  origin: [number, number];
  duration: number;
  loop: boolean;
  fps: number;
  bg: string;
  options: Record<string, unknown>;
  actor?: number;
  den?: DenMeta;
}

export interface FxModule {
  meta: FxMeta;
  draw?: (...args: unknown[]) => void;
  drawBack?: (...args: unknown[]) => void;
  create?: (...args: unknown[]) => unknown;
}

export interface LoadedFx {
  id: string;
  file: string;
  mod: FxModule;
  meta: FxMeta;
}

export interface RenderedFrame {
  t: number;
  /** RGBA over pixelfx's preview backdrop. */
  color: Uint8ClampedArray;
  /** RGBA over transparency: what a sprite strip holds (light baked in as colour with alpha). */
  clear: Uint8ClampedArray;
}

export interface Rendered {
  w: number;
  h: number;
  fps: number;
  n: number;
  frames: RenderedFrame[];
  margin: number;
}

export interface RenderOptions {
  fps?: number;
  seed?: number;
  bg?: string;
  margin?: number;
  actor?: boolean;
  options?: Record<string, unknown>;
}

/** One baked strip, as the web app reads it from `catalog.gen.ts`. */
export interface FxCatalogEntry {
  /** URL of the strip PNG with a content hash (`?v=`), so a changed strip is never served from cache. */
  url: string;
  /** Frame size (px). */
  w: number;
  h: number;
  frames: number;
  fps: number;
  loop: boolean;
  /** The effect's origin inside a frame (px). */
  pivot: readonly [number, number];
  surface: FxSurface;
  depth: 'under' | 'over';
  anchor: FxAnchor;
  /** UI display scale. */
  scale: number;
}
