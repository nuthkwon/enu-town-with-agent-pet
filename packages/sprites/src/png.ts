import { PNG } from 'pngjs';
import { Canvas } from './draw/canvas';

/**
 * Encodes a canvas as an RGBA PNG. Deterministic: fixed filter/deflate settings and no
 * timestamps/text chunks, so identical pixels always give identical bytes.
 */
export function encodePng(c: Canvas): Buffer {
  const png = new PNG({ width: c.width, height: c.height, colorType: 6, inputColorType: 6, bitDepth: 8 });
  png.data = Buffer.from(c.data.buffer, c.data.byteOffset, c.data.byteLength);
  return PNG.sync.write(png, { colorType: 6, inputColorType: 6, deflateLevel: 9, filterType: -1 });
}

/** Decodes a PNG (used by tests and previews). */
export function decodePng(buf: Buffer): Canvas {
  const png = PNG.sync.read(buf);
  return new Canvas(png.width, png.height, new Uint8Array(png.data));
}
