/**
 * Channel meta values become attributes of the <channel> tag Claude reads, so owner-written text (a pet name) must
 * not be able to close the tag or add attributes: control characters and `"<>&` are dropped and the length capped.
 * Messages and role text go in the event content only, never in meta.
 */
export function sanitizeMetaValue(value: string, max = 40): string {
  let out = '';
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f || (code >= 0x80 && code < 0xa0)) continue;
    if (ch === '"' || ch === '<' || ch === '>' || ch === '&') continue;
    out += ch;
  }
  return [...out.trim()].slice(0, max).join('');
}

/** A short stable fingerprint of a pet's role text (to notice changes; never sent anywhere). */
export function roleFingerprint(text: string | null): string {
  let h = 0x811c9dc5;
  for (const ch of text ?? '') {
    h ^= ch.codePointAt(0) ?? 0;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${(text ?? '').length}:${h.toString(16)}`;
}
