import { type RGBA, TRANSPARENT } from './color';

export interface OutlineOptions {
  /** Also outline across diagonals (thicker corners). Default false (clean 4-neighbour outline). */
  diagonal?: boolean;
  /** Pixels with alpha >= this count as solid. Default 128. */
  threshold?: number;
  /**
   * Picks the outline colour from the solid neighbour that caused it (lets outlines be tinted by the
   * fill they surround). Defaults to the constant `color`.
   */
  tint?: (neighbour: RGBA) => RGBA;
}

/**
 * Tiny RGBA raster used by every generator. Pure data (a Uint8Array) — no DOM, no Node APIs —
 * so the same code runs in Node (PNG export) and in the browser (canvas textures).
 */
export class Canvas {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array;

  constructor(width: number, height: number, data?: Uint8Array) {
    this.width = width;
    this.height = height;
    this.data = data ?? new Uint8Array(width * height * 4);
    if (this.data.length !== width * height * 4) throw new Error('canvas data size mismatch');
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  get(x: number, y: number): RGBA {
    if (!this.inBounds(x, y)) return TRANSPARENT;
    const i = (y * this.width + x) * 4;
    const d = this.data;
    return [d[i]!, d[i + 1]!, d[i + 2]!, d[i + 3]!];
  }

  alpha(x: number, y: number): number {
    if (!this.inBounds(x, y)) return 0;
    return this.data[(y * this.width + x) * 4 + 3]!;
  }

  /** Replaces a pixel (no blending). */
  set(x: number, y: number, c: RGBA): void {
    x = Math.round(x);
    y = Math.round(y);
    if (!this.inBounds(x, y)) return;
    const i = (y * this.width + x) * 4;
    this.data[i] = c[0];
    this.data[i + 1] = c[1];
    this.data[i + 2] = c[2];
    this.data[i + 3] = c[3];
  }

  /** Source-over alpha blend of `c` onto the pixel. */
  plot(x: number, y: number, c: RGBA): void {
    x = Math.round(x);
    y = Math.round(y);
    if (!this.inBounds(x, y) || c[3] === 0) return;
    if (c[3] === 255) {
      this.set(x, y, c);
      return;
    }
    const i = (y * this.width + x) * 4;
    const d = this.data;
    const sa = c[3] / 255;
    const da = d[i + 3]! / 255;
    const oa = sa + da * (1 - sa);
    if (oa <= 0) return;
    for (let k = 0; k < 3; k++) {
      d[i + k] = Math.round((c[k]! * sa + d[i + k]! * da * (1 - sa)) / oa);
    }
    d[i + 3] = Math.round(oa * 255);
  }

  /** Blends only where the destination is already painted (keeps silhouettes). */
  paintOver(x: number, y: number, c: RGBA): void {
    if (this.alpha(x, y) > 0) this.plot(x, y, c);
  }

  rect(x: number, y: number, w: number, h: number, c: RGBA): void {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) this.plot(xx, yy, c);
  }

  hline(x0: number, x1: number, y: number, c: RGBA): void {
    const [a, b] = x0 <= x1 ? [x0, x1] : [x1, x0];
    for (let x = a; x <= b; x++) this.plot(x, y, c);
  }

  vline(x: number, y0: number, y1: number, c: RGBA): void {
    const [a, b] = y0 <= y1 ? [y0, y1] : [y1, y0];
    for (let y = a; y <= b; y++) this.plot(x, y, c);
  }

  /** Bresenham line. */
  line(x0: number, y0: number, x1: number, y1: number, c: RGBA): void {
    let x = Math.round(x0);
    let y = Math.round(y0);
    const ex = Math.round(x1);
    const ey = Math.round(y1);
    const dx = Math.abs(ex - x);
    const dy = -Math.abs(ey - y);
    const sx = x < ex ? 1 : -1;
    const sy = y < ey ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      this.plot(x, y, c);
      if (x === ex && y === ey) break;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y += sy;
      }
    }
  }

  /**
   * Filled ellipse centred on (cx, cy) — use .5 centres for even sizes. A pixel is inside when its
   * centre lies within the ellipse.
   */
  ellipse(cx: number, cy: number, rx: number, ry: number, c: RGBA): void {
    const x0 = Math.floor(cx - rx);
    const x1 = Math.ceil(cx + rx);
    const y0 = Math.floor(cy - ry);
    const y1 = Math.ceil(cy + ry);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const nx = (x + 0.5 - cx) / rx;
        const ny = (y + 0.5 - cy) / ry;
        if (nx * nx + ny * ny <= 1) this.plot(x, y, c);
      }
    }
  }

  /** Calls `fn` for every pixel; a returned colour replaces the pixel. */
  map(fn: (x: number, y: number, c: RGBA) => RGBA | undefined): void {
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const r = fn(x, y, this.get(x, y));
        if (r) this.set(x, y, r);
      }
    }
  }

  /**
   * Adds a 1px outline in transparent pixels that touch a solid pixel. The result is computed from a
   * snapshot, so the outline never grows from itself.
   */
  outline(color: RGBA, opts: OutlineOptions = {}): void {
    const threshold = opts.threshold ?? 128;
    const src = this.clone();
    const n4 = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const;
    const n8 = [...n4, [1, 1], [-1, 1], [1, -1], [-1, -1]] as const;
    const neighbours = opts.diagonal ? n8 : n4;
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        if (src.alpha(x, y) >= threshold) continue;
        for (const [dx, dy] of neighbours) {
          if (src.alpha(x + dx, y + dy) >= threshold) {
            const c = opts.tint ? opts.tint(src.get(x + dx, y + dy)) : color;
            // Draw the outline under any faint pixel already there (e.g. translucent wings).
            const under = src.get(x, y);
            this.set(x, y, c);
            if (under[3] > 0) this.plot(x, y, under);
            break;
          }
        }
      }
    }
  }

  /** Composites `src` onto this canvas at (dx, dy). */
  blit(src: Canvas, dx: number, dy: number, opts: { flipX?: boolean; opacity?: number } = {}): void {
    const op = opts.opacity ?? 1;
    for (let y = 0; y < src.height; y++) {
      for (let x = 0; x < src.width; x++) {
        const c = src.get(opts.flipX ? src.width - 1 - x : x, y);
        if (c[3] === 0) continue;
        this.plot(dx + x, dy + y, op === 1 ? c : [c[0], c[1], c[2], Math.round(c[3] * op)]);
      }
    }
  }

  /** Copies a region into a new canvas. */
  crop(x: number, y: number, w: number, h: number): Canvas {
    const out = new Canvas(w, h);
    for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) out.set(xx, yy, this.get(x + xx, y + yy));
    return out;
  }

  clone(): Canvas {
    return new Canvas(this.width, this.height, new Uint8Array(this.data));
  }

  flipX(): Canvas {
    const out = new Canvas(this.width, this.height);
    for (let y = 0; y < this.height; y++)
      for (let x = 0; x < this.width; x++) out.set(this.width - 1 - x, y, this.get(x, y));
    return out;
  }

  /** Nearest-neighbour upscale by an integer factor. */
  scale(n: number): Canvas {
    const out = new Canvas(this.width * n, this.height * n);
    for (let y = 0; y < out.height; y++)
      for (let x = 0; x < out.width; x++) out.set(x, y, this.get(Math.floor(x / n), Math.floor(y / n)));
    return out;
  }

  /** True when at least one pixel is not fully transparent. */
  hasContent(): boolean {
    for (let i = 3; i < this.data.length; i += 4) if (this.data[i] !== 0) return true;
    return false;
  }
}
