import { type BackdropKind, backdrop, over, standIn } from './backdrops';
import type { ResolvedDen } from './effects';
import { fxlib } from './pixelfx';
import type { LoadedFx, Rendered } from './types';

/**
 * Contact sheets to LOOK at (pixelfx's method): every row is the same frames over one of ENU Den's scenes, with our
 * own avatar, pet or companion standing on the effect's anchor, zoomed so single pixels read; then the frames at
 * their real size, because that is what people see.
 */

const SHEET_BG = [40, 32, 56, 255];
const LABEL = [200, 190, 225];
const DIM = [150, 138, 176];

export function backdropsFor(den: ResolvedDen): BackdropKind[] {
  return den.surface === 'town' ? ['floor', 'wood', 'night'] : ['card', 'page'];
}

/** One frame composed over a backdrop with the stand-in placed on the effect's anchor. */
export function composeFrame(
  fx: LoadedFx,
  den: ResolvedDen,
  r: Rendered,
  i: number,
  kind: BackdropKind,
): Uint8ClampedArray {
  const { w, h } = r;
  const out = backdrop(kind, w, h);
  const frame = r.frames[i]!.clear;
  const s = den.stand === 'none' ? null : standIn(den.stand);
  const lift = den.anchor === 'chest' ? 14 : den.anchor === 'head' ? 27 : 0;
  const [ox, oy] = fx.meta.origin;
  const place = () => {
    if (!s) return;
    over(out, w, h, s.rgba, s.w, s.h, Math.round(ox - s.footX), Math.round(oy + lift - s.footY));
  };
  if (den.depth === 'under') {
    over(out, w, h, frame, w, h, 0, 0);
    place();
  } else {
    place();
    over(out, w, h, frame, w, h, 0, 0);
  }
  return out;
}

export function contactSheet(
  fx: LoadedFx,
  den: ResolvedDen,
  r: Rendered,
  opts: { all?: boolean; zoom?: number } = {},
): Buffer {
  const { w, h, n } = r;
  const idx = fxlib.pickFrames(n, opts.all ? 400 : 12);
  const k = opts.zoom ?? (Math.max(w, h) <= 48 ? 4 : Math.max(w, h) <= 96 ? 3 : 2);
  const kinds = backdropsFor(den);
  const pad = 8;
  const label = 14;
  const cols = Math.min(idx.length, Math.max(1, Math.floor(1800 / (w * k + pad))));
  const rowsPerKind = Math.ceil(idx.length / cols);
  const cellH = h * k + label + pad;
  const actualH = h * 2 + label + pad * 2;
  const head = 44;
  const sheetW = pad + cols * (w * k + pad);
  const sheetH = head + kinds.length * (rowsPerKind * cellH + label) + actualH + pad;
  const img = fxlib.canvas(Math.max(sheetW, 640), sheetH, SHEET_BG);
  const m = fx.meta;
  img.text(
    `${fx.id}  ${w}x${h}  ${m.duration}S  ${n}F @${r.fps}  ${m.loop ? 'LOOP' : 'ONE-SHOT'}  ${den.surface.toUpperCase()}`,
    pad,
    8,
    3,
    LABEL,
  );
  img.text(
    `DEPTH ${den.depth.toUpperCase()}  ANCHOR ${den.anchor.toUpperCase()}  STAND ${den.stand.toUpperCase()}  ZOOM ${k}X`,
    pad,
    28,
    2,
    DIM,
  );
  let y = head;
  for (const kind of kinds) {
    img.text(kind.toUpperCase(), pad, y, 2, LABEL);
    y += label;
    idx.forEach((fi, j) => {
      const x = pad + (j % cols) * (w * k + pad);
      const yy = y + Math.floor(j / cols) * cellH;
      img.text(`${fi} ${r.frames[fi]!.t.toFixed(2)}`, x, yy, 2, DIM);
      img.paste(fxlib.upscale(composeFrame(fx, den, r, fi, kind), w, h, k), w * k, h * k, x, yy + label);
    });
    y += rowsPerKind * cellH;
  }
  // real size (1x and 2x) over the first scene: what people actually see
  img.text('ACTUAL SIZE 1X / 2X', pad, y, 2, LABEL);
  y += label;
  let x = pad;
  for (const fi of idx.slice(0, Math.min(idx.length, 8))) {
    const f = composeFrame(fx, den, r, fi, kinds[0]!);
    img.paste(f, w, h, x, y + h / 2);
    img.paste(fxlib.upscale(f, w, h, 2), w * 2, h * 2, x + w + 4, y);
    x += w * 3 + 12;
    if (x + w * 3 > img.w) break;
  }
  return img.png();
}

/** The frames composed over the surface's first scene, for GIF/MP4 previews. */
export function previewFrames(fx: LoadedFx, den: ResolvedDen, r: Rendered): Rendered {
  const kind = backdropsFor(den)[0]!;
  return {
    ...r,
    frames: r.frames.map((f, i) => ({ ...f, color: composeFrame(fx, den, r, i, kind) })),
  };
}
