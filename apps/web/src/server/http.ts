import type { ApiError } from '@enu/shared';
import type * as z from 'zod';
import { ko } from '@/i18n/ko';

/** Small HTTP toolkit for the route handlers (JSON, errors, body parsing, CSRF, cursors). */

export interface FieldIssue {
  field: string;
  reason: string;
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message?: string,
    readonly fields?: FieldIssue[],
    readonly headers?: Record<string, string>,
  ) {
    super(message ?? code);
    this.name = 'HttpError';
  }
}

/** JSON response; API responses are never cached unless the caller says otherwise. */
export function json<T>(data: T, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  if (!headers.has('cache-control')) headers.set('cache-control', 'no-store');
  return Response.json(data, { ...init, headers });
}

export function apiError(
  status: number,
  error: string,
  message?: string,
  fields?: FieldIssue[],
  headers?: Record<string, string>,
): Response {
  const body: ApiError = { error, ...(message ? { message } : {}), ...(fields && fields.length ? { fields } : {}) };
  return json(body, { status, headers });
}

export function errorResponse(e: unknown): Response {
  if (e instanceof HttpError) return apiError(e.status, e.code, e.message === e.code ? undefined : e.message, e.fields, e.headers);
  console.error('[enu-town] unhandled route error', e);
  return apiError(500, 'internal_error', ko.errors.internal);
}

export const notFound = (message: string = ko.errors.notFound) => new HttpError(404, 'not_found', message);

/** Maximum JSON body for REST writes (the largest is a full work-log edit). */
export const MAX_JSON_BODY_BYTES = 64 * 1024;

/** Reads and validates a JSON body: 400 with field-level reasons on failure. */
export async function parseBody<S extends z.ZodType>(req: Request, schema: S): Promise<z.output<S>> {
  const text = await req.text();
  if (Buffer.byteLength(text, 'utf8') > MAX_JSON_BODY_BYTES) throw new HttpError(413, 'payload_too_large', ko.errors.tooLarge);
  let raw: unknown;
  try {
    raw = text.trim() ? JSON.parse(text) : {};
  } catch {
    throw new HttpError(400, 'invalid_json', ko.errors.invalidJson);
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    throw new HttpError(
      400,
      'invalid_body',
      ko.errors.invalidBody,
      result.error.issues.map((i) => ({ field: i.path.map(String).join('.') || '(body)', reason: i.code })),
    );
  }
  return result.data;
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF guard for cookie-authenticated writes: the Origin header must equal PUBLIC_URL's origin.
 * Browsers that omit Origin on same-origin requests still send Sec-Fetch-Site: same-origin.
 */
export function assertSameOrigin(req: Request, expectedOrigin: string): void {
  if (SAFE_METHODS.has(req.method.toUpperCase())) return;
  const expected = new URL(expectedOrigin).origin;
  const origin = req.headers.get('origin');
  if (origin !== null) {
    if (origin === expected) return;
    throw new HttpError(403, 'bad_origin', ko.errors.badOrigin);
  }
  if (req.headers.get('sec-fetch-site') === 'same-origin') return;
  throw new HttpError(403, 'bad_origin', ko.errors.badOrigin);
}

/* ---------------------------------------------------------------------------------------------
 * Keyset cursors. A cursor is an opaque base64url JSON pair [key, id], where key is either the
 * row timestamp in epoch microseconds (Postgres precision, so no row is skipped) or a
 * YYYY-MM-DD period key, and id is the row's UUID tie-breaker.
 * ------------------------------------------------------------------------------------------- */

export type CursorKind = 'micros' | 'date';
export interface Cursor {
  k: string;
  id: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MICROS_RE = /^\d{1,19}$/;

export function isUuid(v: string): boolean {
  return UUID_RE.test(v);
}

export function encodeCursor(c: Cursor): string {
  return Buffer.from(JSON.stringify([c.k, c.id]), 'utf8').toString('base64url');
}

/** Decodes a cursor (null when absent); throws 400 invalid_cursor when malformed. */
export function decodeCursor(raw: string | null | undefined, kind: CursorKind): Cursor | null {
  if (raw === null || raw === undefined || raw === '') return null;
  const bad = () => new HttpError(400, 'invalid_cursor', ko.errors.invalidCursor);
  if (raw.length > 200 || !/^[A-Za-z0-9_-]+$/.test(raw)) throw bad();
  let v: unknown;
  try {
    v = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    throw bad();
  }
  if (!Array.isArray(v) || v.length !== 2 || typeof v[0] !== 'string' || typeof v[1] !== 'string') throw bad();
  const [k, id] = v as [string, string];
  if (!(kind === 'micros' ? MICROS_RE : DATE_RE).test(k) || !isUuid(id)) throw bad();
  return { k, id };
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

/** Given `limit + 1` fetched rows, returns the page and the cursor of its last row. */
export function paginate<T>(rows: readonly T[], limit: number, cursorOf: (row: T) => Cursor): Page<T> {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows.slice();
  const last = items[items.length - 1];
  return { items, nextCursor: hasMore && last !== undefined ? encodeCursor(cursorOf(last)) : null };
}

/** `?limit=` clamped to [1, max]; default when absent or invalid. */
export function parseLimit(url: URL, def = 20, max = 50): number {
  const raw = url.searchParams.get('limit');
  if (!raw) return def;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) return def;
  return Math.min(n, max);
}

/** Path ids are UUIDs; anything else is simply "not found" (never a 500 from a bad cast). */
export function uuidParam(v: string | undefined): string {
  if (!v || !isUuid(v)) throw new HttpError(404, 'not_found', ko.errors.notFound);
  return v.toLowerCase();
}
