import { renderAvatarSheet } from '@enu/sprites';
import { ko } from '@/i18n/ko';
import { parseAvatarKey } from '@/lib/avatar-key';
import { HttpError } from '@/server/http';
import { route } from '@/server/route';
import { LruCache } from '@/server/sprite-cache';

/** Generated avatar sprite sheet (10 columns x 4 rows of 32x32) for a strictly validated key. */
export const runtime = 'nodejs';

const cache = new LruCache<Buffer>(128);

export const GET = route<{ key: string }>(async (_req, { key }) => {
  const k = key.endsWith('.png') ? key.slice(0, -4) : key;
  const preset = parseAvatarKey(k);
  if (!preset) throw new HttpError(400, 'invalid_avatar_key', ko.errors.invalidAvatarKey);
  let png = cache.get(k);
  if (!png) {
    png = renderAvatarSheet(preset);
    cache.set(k, png);
  }
  return new Response(new Uint8Array(png), {
    headers: {
      'content-type': 'image/png',
      'content-length': String(png.byteLength),
      'cache-control': 'public, max-age=31536000, immutable',
    },
  });
});
