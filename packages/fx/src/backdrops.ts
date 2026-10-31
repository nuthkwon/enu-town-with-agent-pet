import { DEFAULT_AVATAR } from '@enu/shared';
import {
  AVATAR_FEET_Y,
  AVATAR_FRAME,
  PET_GROUND_Y,
  paintTile,
  renderAvatarFrame,
  renderCompanionFrame,
  renderPetFrame,
} from '@enu/sprites';

/**
 * What an effect is looked at over: ENU Den's own scenes (not pixelfx's dark stone), and our own characters at
 * their real size, so "too big", "muddy on the floor" and "lost on a white card" show before anything ships.
 */

export type BackdropKind = 'floor' | 'wood' | 'night' | 'card' | 'page';

const NIGHT = { r: 0x22, g: 0x1a, b: 0x48, a: 0.4 }; // apps/web/src/game/stage.ts COLORS.night at 0.4

function fill(w: number, h: number, rgb: [number, number, number]): Uint8ClampedArray {
  const out = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) out.set([rgb[0], rgb[1], rgb[2], 255], i * 4);
  return out;
}

function tiled(w: number, h: number, tile: 'floor_carpet' | 'floor_wood'): Uint8ClampedArray {
  const t = paintTile(tile);
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const s = ((y % t.height) * t.width + (x % t.width)) * 4;
      const d = (y * w + x) * 4;
      out[d] = t.data[s]!;
      out[d + 1] = t.data[s + 1]!;
      out[d + 2] = t.data[s + 2]!;
      out[d + 3] = 255;
    }
  return out;
}

/** A backdrop of w × h opaque RGBA pixels. */
export function backdrop(kind: BackdropKind, w: number, h: number): Uint8ClampedArray {
  switch (kind) {
    case 'floor':
      return tiled(w, h, 'floor_carpet');
    case 'wood':
      return tiled(w, h, 'floor_wood');
    case 'night': {
      const out = tiled(w, h, 'floor_carpet');
      for (let i = 0; i < w * h; i++) {
        out[i * 4] = Math.round(out[i * 4]! * (1 - NIGHT.a) + NIGHT.r * NIGHT.a);
        out[i * 4 + 1] = Math.round(out[i * 4 + 1]! * (1 - NIGHT.a) + NIGHT.g * NIGHT.a);
        out[i * 4 + 2] = Math.round(out[i * 4 + 2]! * (1 - NIGHT.a) + NIGHT.b * NIGHT.a);
      }
      return out;
    }
    case 'card':
      return fill(w, h, [0xff, 0xff, 0xff]);
    case 'page':
      return fill(w, h, [0xf5, 0xf0, 0xff]);
  }
}

export interface StandIn {
  rgba: Uint8ClampedArray;
  w: number;
  h: number;
  /** The point of the stand-in that goes on the effect's anchor (its feet). */
  footX: number;
  footY: number;
}

function fromCanvas(c: { width: number; height: number; data: Uint8Array }): Uint8ClampedArray {
  return new Uint8ClampedArray(c.data.buffer.slice(c.data.byteOffset, c.data.byteOffset + c.data.byteLength));
}

/** Our default avatar, a pet and a pet-room companion, at 1 art pixel per pixel. */
export function standIn(kind: 'avatar' | 'pet' | 'companion'): StandIn {
  if (kind === 'avatar') {
    const c = renderAvatarFrame(DEFAULT_AVATAR, 'down', 'idle', 0);
    return { rgba: fromCanvas(c), w: c.width, h: c.height, footX: AVATAR_FRAME / 2, footY: AVATAR_FEET_Y };
  }
  if (kind === 'pet') {
    const c = renderPetFrame('cat', 'left', 'idle', 0);
    return { rgba: fromCanvas(c), w: c.width, h: c.height, footX: c.width / 2, footY: PET_GROUND_Y };
  }
  const c = renderCompanionFrame('cat', 'idle', 0);
  return { rgba: fromCanvas(c), w: c.width, h: c.height, footX: c.width / 2, footY: PET_GROUND_Y };
}

/** Alpha-composites `src` (sw × sh RGBA) onto `dst` (dw wide) at (x, y). */
export function over(
  dst: Uint8ClampedArray,
  dw: number,
  dh: number,
  src: Uint8ClampedArray,
  sw: number,
  sh: number,
  x: number,
  y: number,
): void {
  for (let yy = 0; yy < sh; yy++) {
    const ty = y + yy;
    if (ty < 0 || ty >= dh) continue;
    for (let xx = 0; xx < sw; xx++) {
      const tx = x + xx;
      if (tx < 0 || tx >= dw) continue;
      const s = (yy * sw + xx) * 4;
      const a = src[s + 3]! / 255;
      if (a === 0) continue;
      const d = (ty * dw + tx) * 4;
      for (let k = 0; k < 3; k++) dst[d + k] = Math.round(src[s + k]! * a + dst[d + k]! * (1 - a));
      dst[d + 3] = 255;
    }
  }
}
