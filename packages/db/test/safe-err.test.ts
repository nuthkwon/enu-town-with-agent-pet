import { DrizzleQueryError } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { safeErr } from '../src/safe-err';

const SECRET = '비밀 채팅 본문 SQA-4242';

/** What node-postgres throws for a failed statement (fields as in pg's DatabaseError). */
function pgError(message: string, extra: Record<string, unknown> = {}): Error {
  return Object.assign(new Error(message), { name: 'error', severity: 'ERROR', code: '22P02', ...extra });
}

describe('safeErr', () => {
  it('keeps the SQL text and codes of a failed Drizzle query but never its params or row values', () => {
    const cause = pgError(`invalid input syntax for type uuid: "${SECRET}"`, {
      detail: `Failing row contains (${SECRET}).`,
      where: SECRET,
      table: 'chat_messages',
      constraint: 'chat_messages_pkey',
    });
    const err = new DrizzleQueryError(
      'insert into "chat_messages" ("id", "body") values ($1, $2)',
      ['m1', SECRET],
      cause,
    );
    const out = safeErr(err);
    const text = JSON.stringify(out);
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain('params');
    expect(out).toMatchObject({
      name: 'DrizzleQueryError',
      query: 'insert into "chat_messages" ("id", "body") values ($1, $2)',
      causes: [
        {
          name: 'error',
          code: '22P02',
          table: 'chat_messages',
          constraint: 'chat_messages_pkey',
          message: 'invalid input syntax for type uuid: "…"',
        },
      ],
    });
    expect(out.at).toMatch(/safe-err\.test\.ts/);
  });

  it('keeps the first message line of other errors and survives odd inputs', () => {
    expect(safeErr(new Error('connect ECONNREFUSED 127.0.0.1:5432\nmore'))).toMatchObject({
      name: 'Error',
      message: 'connect ECONNREFUSED 127.0.0.1:5432',
    });
    expect(safeErr('boom')).toEqual({ name: 'string' });
    expect(safeErr(null)).toEqual({ name: 'object' });
    const loop: Error & { cause?: unknown } = new Error('loop');
    loop.cause = loop;
    expect(safeErr(loop).causes).toBeUndefined();
    // A duck-typed query error (another drizzle-orm copy) is treated the same way.
    const duck = Object.assign(new Error(`Failed query: select 1\nparams: ${SECRET}`), {
      query: 'select 1',
      params: [SECRET],
    });
    expect(JSON.stringify(safeErr(duck))).not.toContain(SECRET);
  });
});
