/**
 * Typed facade over the vendored pixelfx JavaScript (never edited; see vendor/pixelfx/VENDORED.md). Node tooling
 * only: the web app imports nothing from here, just the generated catalog.
 */
import * as core from '../vendor/pixelfx/src/core/index.js';
import * as lib from '../vendor/pixelfx/tools/lib/fxlib.mjs';
import type { FxModule, LoadedFx, Rendered, RenderOptions } from './types';

/** A pixelfx frame: `color` (opaque, dithered or translucent pixels) and `light` (additive glow), 0xAABBGGRR. */
export interface Frame {
  w: number;
  h: number;
  ox: number;
  oy: number;
  color: Uint32Array;
  light: Uint32Array;
}

export interface Painter {
  place(x: number, y: number, flip?: boolean, angle?: number): Painter;
  put(sx: number, sy: number, c: unknown, a?: number): void;
}

export interface FxInstance {
  readonly t: number;
  options: Record<string, unknown>;
  update(dt: number): void;
  draw(frame: Frame, layer?: 'back' | 'front'): void;
  stop(): void;
  done(): boolean;
}

export interface Canvas {
  w: number;
  h: number;
  data: Uint8ClampedArray;
  paste(src: Uint8ClampedArray, sw: number, sh: number, x: number, y: number): void;
  text(str: string, x: number, y: number, k?: number, rgb?: number[], font?: string): void;
  rect(x: number, y: number, w: number, h: number, rgba: number[]): void;
  png(): Buffer;
}

interface Core {
  createFrame(w: number, h: number, ox?: number, oy?: number): Frame;
  clearFrame(f: Frame): Frame;
  painterFor(f: Frame): Painter & { place(x: number, y: number, flip?: boolean, angle?: number): Painter };
  createFx(mod: FxModule, o?: Record<string, unknown>): FxInstance;
  resolveOptions(meta: FxModule['meta'], o?: Record<string, unknown>): Record<string, unknown>;
  stockActor(scale?: number): unknown;
  Painter: { prototype: Painter };
  BACKDROPS: string[];
  hex(h: string): number;
  luma(c: number): number;
}

interface Lib {
  allIds(dir?: string): string[];
  resolveIds(patterns: string[], dir?: string): string[];
  loadEffect(id: string, dir?: string): Promise<LoadedFx>;
  renderFrames(fx: LoadedFx, opts?: RenderOptions): Rendered;
  contactSheet(
    fx: LoadedFx,
    r: Rendered,
    opts?: { max?: number; width?: number; title?: string; zoom?: number },
  ): Buffer;
  writeVideo(file: string, r: Rendered, k: number, opts?: { loops?: number }): boolean;
  canvas(w: number, h: number, fill?: number[]): Canvas;
  upscale(rgba: Uint8ClampedArray, w: number, h: number, k: number): Uint8ClampedArray;
  pickFrames(n: number, max?: number): number[];
  save(file: string, buf: Buffer | string): string;
  textWidth(str: string, font?: string): number;
}

export const px = core as unknown as Core;
export const fxlib = lib as unknown as Lib;
