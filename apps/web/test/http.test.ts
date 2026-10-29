import * as z from 'zod';
import { describe, expect, it } from 'vitest';
import {
  HttpError,
  apiError,
  assertSameOrigin,
  decodeCursor,
  encodeCursor,
  errorResponse,
  json,
  paginate,
  parseBody,
  parseLimit,
  uuidParam,
} from '@/server/http';
import { LruCache } from '@/server/sprite-cache';

const ORIGIN = 'http://localhost:3000';
const ID = '0199b8a4-5c3e-7b2a-9d41-123456789abc';

describe('json / apiError', () => {
  it('sets no-store unless told otherwise', async () => {
    const r = json({ a: 1 });
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect(await r.json()).toEqual({ a: 1 });
    expect(json({}, { headers: { 'cache-control': 'public' } }).headers.get('cache-control')).toBe('public');
  });

  it('builds the ApiError shape', async () => {
    const r = apiError(400, 'invalid_body', '확인', [{ field: 'x', reason: 'too_big' }]);
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ error: 'invalid_body', message: '확인', fields: [{ field: 'x', reason: 'too_big' }] });
    expect(await apiError(404, 'not_found').json()).toEqual({ error: 'not_found' });
  });

  it('maps HttpError and hides unexpected errors', async () => {
    const known = errorResponse(new HttpError(405, 'method_not_allowed', 'nope', undefined, { allow: 'GET' }));
    expect(known.status).toBe(405);
    expect(known.headers.get('allow')).toBe('GET');
    const original = console.error;
    console.error = () => {};
    const unknown = errorResponse(new Error('db password is hunter2'));
    console.error = original;
    expect(unknown.status).toBe(500);
    expect(JSON.stringify(await unknown.json())).not.toContain('hunter2');
  });
});

describe('parseBody', () => {
  const schema = z.object({ name: z.string().min(1).max(3), n: z.number().int() });
  const req = (body: string) => new Request(`${ORIGIN}/x`, { method: 'POST', body });

  it('returns parsed data', async () => {
    expect(await parseBody(req('{"name":"ab","n":2}'), schema)).toEqual({ name: 'ab', n: 2 });
  });

  it('rejects invalid JSON with 400 invalid_json', async () => {
    await expect(parseBody(req('{nope'), schema)).rejects.toMatchObject({ status: 400, code: 'invalid_json' });
  });

  it('reports field-level reasons', async () => {
    const err = (await parseBody(req('{"name":"abcd","n":1.5}'), schema).catch((e: unknown) => e)) as HttpError;
    expect(err).toBeInstanceOf(HttpError);
    expect(err.status).toBe(400);
    expect(err.fields).toEqual(
      expect.arrayContaining([
        { field: 'name', reason: 'too_big' },
        { field: 'n', reason: 'invalid_type' },
      ]),
    );
  });

  it('rejects oversized bodies with 413', async () => {
    await expect(parseBody(req(JSON.stringify({ name: 'x'.repeat(70_000) })), schema)).rejects.toMatchObject({ status: 413 });
  });
});

describe('assertSameOrigin', () => {
  const r = (method: string, headers: Record<string, string>) => new Request(`${ORIGIN}/api/v1/me/profile`, { method, headers });

  it('ignores safe methods', () => {
    expect(() => assertSameOrigin(r('GET', { origin: 'https://evil.example' }), ORIGIN)).not.toThrow();
  });

  it('accepts the exact origin and same-origin fetch metadata', () => {
    expect(() => assertSameOrigin(r('PATCH', { origin: ORIGIN }), ORIGIN)).not.toThrow();
    expect(() => assertSameOrigin(r('POST', { 'sec-fetch-site': 'same-origin' }), `${ORIGIN}/`)).not.toThrow();
  });

  it('rejects other origins, null origins and missing metadata', () => {
    const cases: Record<string, string>[] = [{ origin: 'https://evil.example' }, { origin: 'null' }, { 'sec-fetch-site': 'cross-site' }, {}];
    for (const headers of cases) {
      expect(() => assertSameOrigin(r('POST', headers), ORIGIN)).toThrow(HttpError);
    }
    expect(() => assertSameOrigin(r('DELETE', { origin: 'http://localhost:3001' }), ORIGIN)).toThrow(/허용되지/);
  });
});

describe('cursors', () => {
  it('round-trips micros and date cursors', () => {
    const c1 = { k: '1761700000123456', id: ID };
    expect(decodeCursor(encodeCursor(c1), 'micros')).toEqual(c1);
    const c2 = { k: '2026-10-29', id: ID };
    expect(decodeCursor(encodeCursor(c2), 'date')).toEqual(c2);
    expect(decodeCursor(null, 'date')).toBeNull();
    expect(decodeCursor('', 'date')).toBeNull();
  });

  it('is opaque base64url', () => {
    expect(encodeCursor({ k: '2026-10-29', id: ID })).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('rejects tampered or mismatched cursors with 400', () => {
    const bad = [
      'not base64!',
      Buffer.from('{"k":1}').toString('base64url'),
      encodeCursor({ k: '2026-10-29', id: 'x' }),
      encodeCursor({ k: "2026-10-29'; drop table", id: ID }),
      encodeCursor({ k: '1761700000123456', id: ID }),
    ];
    for (const raw of bad) expect(() => decodeCursor(raw, 'date')).toThrow(HttpError);
    expect(() => decodeCursor(encodeCursor({ k: '2026-10-29', id: ID }), 'micros')).toThrow(HttpError);
  });

  it('paginates limit+1 rows', () => {
    const rows = [1, 2, 3].map((n) => ({ n, id: ID }));
    const page = paginate(rows, 2, (r) => ({ k: String(r.n), id: r.id }));
    expect(page.items.map((r) => r.n)).toEqual([1, 2]);
    expect(decodeCursor(page.nextCursor, 'micros')).toEqual({ k: '2', id: ID });
    expect(paginate(rows, 3, (r) => ({ k: String(r.n), id: r.id })).nextCursor).toBeNull();
  });

  it('clamps limits', () => {
    const u = (q: string) => new URL(`${ORIGIN}/x${q}`);
    expect(parseLimit(u(''), 20, 50)).toBe(20);
    expect(parseLimit(u('?limit=5'), 20, 50)).toBe(5);
    expect(parseLimit(u('?limit=500'), 20, 50)).toBe(50);
    expect(parseLimit(u('?limit=-1'), 20, 50)).toBe(20);
    expect(parseLimit(u('?limit=abc'), 20, 50)).toBe(20);
  });

  it('uuidParam treats non-uuids as not found', () => {
    expect(uuidParam(ID.toUpperCase())).toBe(ID);
    expect(() => uuidParam('1 or 1=1')).toThrow(HttpError);
    expect(() => uuidParam(undefined)).toThrow(HttpError);
  });
});

describe('LruCache', () => {
  it('evicts the least recently used entry', () => {
    const c = new LruCache<number>(2);
    c.set('a', 1);
    c.set('b', 2);
    expect(c.get('a')).toBe(1);
    c.set('c', 3);
    expect(c.get('b')).toBeUndefined();
    expect(c.get('a')).toBe(1);
    expect(c.get('c')).toBe(3);
    expect(c.size).toBe(2);
  });
});
