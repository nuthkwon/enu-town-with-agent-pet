import { renderCompanionSheet, renderPetSheet } from '@enu/sprites';
import { ko } from '@/i18n/ko';
import { parsePetKey } from '@/lib/pet-key';
import { HttpError } from '@/server/http';
import { route } from '@/server/route';
import { LruCache } from '@/server/sprite-cache';

/**
 * Tinted pet sheets on demand: `pt-{species}-{tint}` (town, 12 x 2 frames) and `pc-{species}-{tint}` (companion,
 * 22 frames). Keys are strictly validated, so the cache holds at most 16 species x 6 tints x 2 kinds.
 */
export const runtime = 'nodejs';

const cache = new LruCache<Buffer>(192);

export const GET = route<{ key: string }>(async (_req, { key }) => {
  const k = key.endsWith('.png') ? key.slice(0, -4) : key;
  const ref = parsePetKey(k);
  if (!ref) throw new HttpError(400, 'invalid_pet_key', ko.errors.invalidPetKey);
  let png = cache.get(k);
  if (!png) {
    png =
      ref.kind === 'pt'
        ? renderPetSheet(ref.species, { tint: ref.tint })
        : renderCompanionSheet(ref.species, ref.tint);
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
