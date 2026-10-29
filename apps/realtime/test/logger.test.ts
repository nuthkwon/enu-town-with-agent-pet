import { Writable } from 'node:stream';
import { DrizzleQueryError } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createLogger } from '../src/logger';

describe('realtime logger', () => {
  it('logs a failed chat insert without the chat body (DrizzleQueryError params never reach the output)', () => {
    const lines: string[] = [];
    const sink = new Writable({
      write(chunk: Buffer, _enc, done) {
        lines.push(chunk.toString('utf8'));
        done();
      },
    });
    const logger = createLogger({ LOG_LEVEL: 'info', NODE_ENV: 'production' }, 'enu-realtime', sink);
    const secret = 'SECRET CHAT BODY 비밀';
    const err = new DrizzleQueryError(
      'insert into "chat_messages" ("id", "sender_id", "body") values ($1, $2, $3)',
      ['m1', 'u1', secret],
      Object.assign(new Error('canceling statement due to statement timeout'), {
        code: '57014',
        severity: 'ERROR',
      }),
    );
    logger.error({ err, type: 'chat:send', userId: 'u1' }, 'message handler failed');
    const out = lines.join('');
    expect(out).toContain('message handler failed');
    expect(out).toContain('57014');
    expect(out).toContain('insert into');
    expect(out).not.toContain(secret);
    expect(out).not.toContain('params');
  });
});
