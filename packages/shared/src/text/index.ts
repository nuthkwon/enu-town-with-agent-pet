/**
 * Text hygiene for anything written by Claude or users. We only normalize in ways
 * that never change meaning (NFC, invisible/control characters); policy violations
 * are reported back for Claude to rewrite rather than being silently edited.
 */

// C0 controls except \n and \t, DEL, C1 controls.
const charRange = (from: number, to: number) => `${String.fromCharCode(from)}-${String.fromCharCode(to)}`;
const CONTROL_CHARS = new RegExp(`[${charRange(0x00, 0x08)}${charRange(0x0b, 0x1f)}${charRange(0x7f, 0x9f)}]`, 'g');
// Zero-width and bidi override/isolate characters, BOM.
const INVISIBLE_CHARS = new RegExp(
  `[${charRange(0x200b, 0x200f)}${charRange(0x202a, 0x202e)}${charRange(0x2066, 0x2069)}${String.fromCharCode(0xfeff)}]`,
  'g',
);

export function normalizeText(input: string): string {
  return input
    .normalize('NFC')
    .replace(/\r\n?/g, '\n')
    .replace(CONTROL_CHARS, '')
    .replace(INVISIBLE_CHARS, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Single-line variant (chat, nudges, titles): newlines and tabs collapse to spaces. */
export function normalizeLine(input: string): string {
  return normalizeText(input).replace(/\s*\n\s*/g, ' ').replace(/\t/g, ' ').replace(/ {2,}/g, ' ');
}

const segmenter = typeof Intl !== 'undefined' && 'Segmenter' in Intl ? new Intl.Segmenter('ko', { granularity: 'grapheme' }) : null;

/** User-perceived character count (Korean syllables, emoji sequences count as 1). */
export function graphemeLength(input: string): number {
  if (!segmenter) return [...input].length;
  let n = 0;
  for (const _ of segmenter.segment(input)) n++;
  return n;
}

export function truncateGraphemes(input: string, max: number, ellipsis = '…'): string {
  if (graphemeLength(input) <= max) return input;
  if (!segmenter) return [...input].slice(0, Math.max(0, max - 1)).join('') + ellipsis;
  const out: string[] = [];
  for (const s of segmenter.segment(input)) {
    if (out.length >= max - 1) break;
    out.push(s.segment);
  }
  return out.join('') + ellipsis;
}

const URL_PATTERN = /\b(?:https?:\/\/|www\.)\S+/i;

export function containsUrl(input: string): boolean {
  return URL_PATTERN.test(input);
}

export type PiiKind = 'rrn' | 'card' | 'phone' | 'account';

// Korean resident registration number: YYMMDD-[1-8]XXXXXX
const RRN = /\b\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\s?-?\s?[1-8]\d{6}\b/;
// Korean mobile phone numbers.
const PHONE = /\b01[016789][-.\s]?\d{3,4}[-.\s]?\d{4}\b/;
// Bank-account-like digit groups (e.g. 123-456789-01-234); dates like 2026-10-29 are excluded by digit count.
const ACCOUNT = /\b\d{2,6}(?:-\d{2,6}){2,3}\b/g;
const CARD_CANDIDATE = /\b(?:\d[ -]?){13,19}\b/g;

function luhnValid(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return digits.length >= 13 && sum % 10 === 0;
}

/** Detects personal data patterns that must never be published (returns the kinds found). */
export function detectPii(input: string): PiiKind[] {
  const found = new Set<PiiKind>();
  if (RRN.test(input)) found.add('rrn');
  if (PHONE.test(input)) found.add('phone');
  for (const m of input.matchAll(CARD_CANDIDATE)) {
    if (luhnValid(m[0].replace(/[ -]/g, ''))) found.add('card');
  }
  if (!found.has('card') && !found.has('rrn') && !found.has('phone')) {
    for (const m of input.matchAll(ACCOUNT)) {
      if (m[0].replace(/-/g, '').length >= 10) found.add('account');
    }
  }
  return [...found];
}
