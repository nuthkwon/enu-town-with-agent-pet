/**
 * 32-bit FNV-1a over UTF-16 code units (equal to the byte-wise hash for ASCII input).
 * Used for short, stable, opaque ids such as group ids; it is not a cryptographic hash.
 */
export function fnv1a32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
