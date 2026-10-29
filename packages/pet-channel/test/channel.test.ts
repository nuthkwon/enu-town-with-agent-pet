import type { PetChannelPollOutput, PetChannelReplyInput } from '@enu/shared';
import { describe, expect, it } from 'vitest';
import { PetChannel, type ChannelEvent } from '../src/channel';
import { ChannelHttpError } from '../src/client';
import { NOTICES } from '../src/instructions';
import { roleFingerprint, sanitizeMetaValue } from '../src/meta';

const PET = '11111111-1111-4111-8111-111111111111';
const OTHER_PET = '22222222-2222-4222-8222-222222222222';
const M1 = '33333333-3333-4333-8333-333333333333';
const M2 = '44444444-4444-4444-8444-444444444444';

const pets = (role: string | null = '코드 리뷰를 도와줘.') => [
  {
    pet_id: PET,
    name: '코코',
    is_default: true,
    reply_route: 'both' as const,
    default_visibility: 'company' as const,
    role_instructions: role,
  },
  {
    pet_id: OTHER_PET,
    name: '리뷰"봇<',
    is_default: false,
    reply_route: 'channel' as const,
    default_visibility: 'private' as const,
    role_instructions: null,
  },
];

const message = (id: string, petId = PET, repliesSoFar = 0) => ({
  message_id: id,
  pet_id: petId,
  sent_at: '2026-10-29T21:05:00+09:00',
  text: `질문 ${id.slice(0, 4)}`,
  visibility: 'company' as const,
  replies_so_far: repliesSoFar,
});

const pollOut = (over: Partial<PetChannelPollOutput> = {}): PetChannelPollOutput => ({
  messages: [],
  pets: pets(),
  token_expires_at: '2027-01-27T00:00:00.000Z',
  ...over,
});

function harness(replyImpl?: (input: PetChannelReplyInput) => Promise<unknown>) {
  const events: ChannelEvent[] = [];
  const replies: PetChannelReplyInput[] = [];
  const client = {
    poll: async () => pollOut(),
    reply: async (input: PetChannelReplyInput) => {
      replies.push(input);
      return (replyImpl?.(input) ?? {
        result: 'created',
        message_id: 'r-1',
        visibility: 'company',
      }) as never;
    },
  };
  const channel = new PetChannel({
    client,
    reloadClient: () => null,
    emit: async (e) => {
      events.push(e);
    },
    now: () => new Date('2026-10-29T12:00:00.000Z'),
  });
  return { channel, events, replies };
}

const text = (r: { content: unknown[] }) => (r.content[0] as { text: string }).text;

describe('PetChannel.accept', () => {
  it("pushes each pet's role before its first message, once per message, with safe meta", async () => {
    const h = harness();
    await h.channel.accept(pollOut({ messages: [message(M1), message(M2, OTHER_PET)] }));
    await h.channel.accept(pollOut({ messages: [message(M1)] }));
    expect(h.events.map((e) => [e.meta.kind, e.meta.pet_id, e.meta.message_id ?? null])).toEqual([
      ['pet_role', PET, null],
      ['message', PET, M1],
      ['pet_role', OTHER_PET, null],
      ['message', OTHER_PET, M2],
    ]);
    expect(h.events[0]).toEqual({
      content: '코드 리뷰를 도와줘.',
      meta: { kind: 'pet_role', pet_id: PET, pet_name: '코코', default_visibility: 'company' },
    });
    expect(h.events[1]).toEqual({
      content: '질문 3333',
      meta: {
        kind: 'message',
        pet_id: PET,
        pet_name: '코코',
        message_id: M1,
        sent_at: '2026-10-29T21:05:00+09:00',
        visibility: 'company',
      },
    });
    expect(h.events[2]).toMatchObject({ content: '(역할 지시문 없음)', meta: { pet_name: '리뷰봇' } });
  });

  it('pushes a changed role again, and warns once when the token is about to expire', async () => {
    const h = harness();
    await h.channel.accept(pollOut({ messages: [message(M1)] }));
    await h.channel.accept(pollOut({ pets: pets('말투는 짧게.') }));
    await h.channel.accept(
      pollOut({ pets: pets('말투는 짧게.'), token_expires_at: '2026-11-01T00:00:00.000Z' }),
    );
    await h.channel.accept(
      pollOut({ pets: pets('말투는 짧게.'), token_expires_at: '2026-11-01T00:00:00.000Z' }),
    );
    expect(h.events.map((e) => [e.meta.kind, e.content])).toEqual([
      ['pet_role', '코드 리뷰를 도와줘.'],
      ['message', '질문 3333'],
      ['pet_role', '말투는 짧게.'],
      ['notice', NOTICES.expiring_soon],
    ]);
  });
});

describe('PetChannel.reply', () => {
  it('numbers the parts of an answer and summarizes the result', async () => {
    const h = harness();
    await h.channel.accept(pollOut({ messages: [message(M1, PET, 1)] }));
    const r = await h.channel.reply({ pet_id: PET, in_reply_to: M1.toUpperCase(), text: '이어서 답할게요.' });
    expect(r.isError).toBeUndefined();
    expect(text(r)).toContain("펫 '코코' 대화방에 답을 올렸어요");
    await h.channel.reply({
      pet_id: PET,
      in_reply_to: M1,
      text: '마지막 부분이에요.',
      visibility: 'private',
    });
    expect(h.replies).toEqual([
      { in_reply_to: M1, part: 2, text: '이어서 답할게요.' },
      { in_reply_to: M1, part: 3, text: '마지막 부분이에요.', visibility: 'private' },
    ]);
    const fourth = await h.channel.reply({ pet_id: PET, in_reply_to: M1, text: '더' });
    expect(fourth.isError).toBe(true);
    expect(h.replies).toHaveLength(2);
  });

  it('refuses a message of another pet without calling ENU Den', async () => {
    const h = harness();
    await h.channel.accept(pollOut({ messages: [message(M1)] }));
    const r = await h.channel.reply({ pet_id: OTHER_PET, in_reply_to: M1, text: '답' });
    expect(r.isError).toBe(true);
    expect(h.replies).toEqual([]);
  });

  it('tells Claude to rewrite text problems and not to retry everything else', async () => {
    const reasons = ['pii', 'already_answered'];
    const h = harness(async () => {
      throw new ChannelHttpError(422, reasons.shift()!, undefined, undefined);
    });
    await h.channel.accept(pollOut({ messages: [message(M1)] }));
    const rewrite = await h.channel.reply({ pet_id: PET, in_reply_to: M1, text: '010-1234-5678' });
    expect(rewrite.isError).toBe(true);
    expect(text(rewrite)).toContain('다시 써서');
    expect(text(rewrite)).toContain('"reason":"pii"');
    const final = await h.channel.reply({ pet_id: PET, in_reply_to: M1, text: '답' });
    expect(text(final)).toContain('다시 보내지 마세요');
  });

  it('reports a deleted question and never shows the token in status', async () => {
    const h = harness(async () => ({ result: 'skipped_owner_deleted', message_id: null, visibility: null }));
    await h.channel.accept(pollOut({ messages: [message(M1)] }));
    expect(text(await h.channel.reply({ pet_id: PET, in_reply_to: M1, text: '답' }))).toContain('지워서');
    const status = text(h.channel.status());
    expect(status).toContain('"paired":true');
    expect(status).not.toMatch(/edc_/);
  });
});

describe('PetChannel.run', () => {
  it('asks for held messages first, then waits; a 401 stops polling with one notice', async () => {
    const polls: boolean[] = [];
    const events: ChannelEvent[] = [];
    let n = 0;
    const channel = new PetChannel({
      client: {
        poll: async (input) => {
          polls.push(input.include_held);
          n += 1;
          if (n === 1) return pollOut({ messages: [message(M1)] });
          if (n === 2) throw new TypeError('fetch failed');
          if (n === 3) return pollOut();
          throw new ChannelHttpError(401, 'token_revoked', undefined, undefined);
        },
        reply: async () => ({ result: 'created', message_id: null, visibility: null }),
      },
      reloadClient: () => null,
      emit: async (e) => {
        events.push(e);
      },
      // The unpaired wait is the first sleep after the 401: stop there.
      sleep: async () => {
        if (n >= 4) channel.stop();
      },
      random: () => 0.5,
    });
    await channel.run();
    expect(polls).toEqual([true, false, false, false]);
    expect(events.map((e) => e.meta.code ?? e.meta.kind)).toEqual(['pet_role', 'message', 'unpaired']);
    expect(channel.paired).toBe(false);
  });
});

describe('meta helpers', () => {
  it('drops tag-breaking characters and caps the length', () => {
    const bell = String.fromCharCode(7);
    expect(sanitizeMetaValue(`코코" kind="x<y>&z${bell}`, 40)).toBe('코코 kind=xyz');
    expect(sanitizeMetaValue('가'.repeat(30), 20)).toBe('가'.repeat(20));
  });

  it('fingerprints role text stably', () => {
    expect(roleFingerprint('a')).toBe(roleFingerprint('a'));
    expect(roleFingerprint('a')).not.toBe(roleFingerprint('b'));
    expect(roleFingerprint(null)).toBe(roleFingerprint(''));
  });
});
