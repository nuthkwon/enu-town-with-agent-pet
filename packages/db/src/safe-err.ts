import { DrizzleQueryError } from 'drizzle-orm';

/** One error of a cause chain, reduced to what is safe to log. */
export interface SafeErrorPart {
  name: string;
  /** pg SQLSTATE / Node system error code. */
  code?: string;
  /** SQL text of a failed Drizzle query: `$n` placeholders only, never the bound values. */
  query?: string;
  /** pg structured fields (identifiers only, no values). */
  constraint?: string;
  table?: string;
  column?: string;
  /** First line of the message: never Drizzle's `params:`, and quoted values of a pg error are masked. */
  message?: string;
  /** First stack frame. */
  at?: string;
}

export interface SafeError extends SafeErrorPart {
  causes?: SafeErrorPart[];
}

const MAX_CAUSES = 4;
const MAX_TEXT = 500;

function isDrizzleQueryError(e: object): e is DrizzleQueryError {
  return e instanceof DrizzleQueryError || ('query' in e && 'params' in e);
}

/** node-postgres DatabaseError: has a 5-character SQLSTATE and a severity. */
function isPgError(e: object): boolean {
  const code = (e as { code?: unknown }).code;
  return typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code) && 'severity' in e;
}

const str = (v: unknown): string | undefined =>
  typeof v === 'string' && v !== '' ? v.slice(0, MAX_TEXT) : typeof v === 'number' ? String(v) : undefined;

function firstFrame(stack: unknown): string | undefined {
  if (typeof stack !== 'string') return undefined;
  const frame = stack.split('\n').find((l) => /^\s+at /.test(l));
  return frame ? frame.trim().slice(0, MAX_TEXT) : undefined;
}

function part(e: unknown): SafeErrorPart {
  if (!e || typeof e !== 'object') return { name: typeof e };
  const err = e as { name?: unknown; message?: unknown; stack?: unknown; code?: unknown };
  const out: SafeErrorPart = { name: str(err.name) ?? 'Error' };
  const code = str(err.code);
  if (code) out.code = code;
  if (isDrizzleQueryError(e)) {
    // `message` and `params` hold every bound value (chat bodies, Claude-written text, names).
    out.name = 'DrizzleQueryError';
    const q = str((e as { query?: unknown }).query);
    if (q) out.query = q;
  } else {
    let message = typeof err.message === 'string' ? (err.message.split('\n')[0] ?? '') : '';
    message = message.replace(/\bparams:.*$/s, '');
    if (isPgError(e)) {
      // e.g. `invalid input syntax for type uuid: "…"`; `detail` / `where` (row values) are never read.
      message = message.replace(/"[^"]*"/g, '"…"');
      for (const k of ['constraint', 'table', 'column'] as const) {
        const v = str((e as Record<string, unknown>)[k]);
        if (v) out[k] = v;
      }
    }
    if (message) out.message = message.slice(0, MAX_TEXT);
  }
  const at = firstFrame(err.stack);
  if (at) out.at = at;
  return out;
}

/**
 * Error serializer for logs (pino `serializers.err`, and every `console.error` of a server route).
 * Drizzle wraps a failed query in `DrizzleQueryError`, whose message and `params` carry all bound values,
 * so a DB hiccup would otherwise write chat bodies, Claude's work-log text or names into the container
 * logs. Walks the `cause` chain and keeps names, codes, SQL text and the first stack frame only.
 */
export function safeErr(e: unknown): SafeError {
  const head: SafeError = part(e);
  const causes: SafeErrorPart[] = [];
  const seen = new Set<unknown>([e]);
  let cur = e && typeof e === 'object' ? (e as { cause?: unknown }).cause : undefined;
  while (cur !== undefined && cur !== null && !seen.has(cur) && causes.length < MAX_CAUSES) {
    seen.add(cur);
    causes.push(part(cur));
    cur = typeof cur === 'object' ? (cur as { cause?: unknown }).cause : undefined;
  }
  if (causes.length) head.causes = causes;
  return head;
}
