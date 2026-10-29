import {
  auditEvents,
  claudeLinks,
  newOpaqueId,
  petChannelTokens,
  petMessages,
  pets,
  privacyConsents,
  user,
  type DbHandle,
} from '@enu/db';
import {
  PRIVACY_NOTICE_VERSION,
  type OwnerPetMessageDto,
  type PetChannelPairOutput,
  type PetChannelPairingCodeDto,
  type PetChannelPollOutput,
  type PetChannelStatusDto,
} from '@enu/shared';
import { createTestUser } from '@enu/testing';
import { and, eq, ne } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as mcpRoute from '@/app/api/mcp/route';
import * as revokeRoute from '@/app/api/v1/me/claude-links/revoke/route';
import * as codesRoute from '@/app/api/v1/me/pet-channel/pairing-codes/route';
import * as statusRoute from '@/app/api/v1/me/pet-channel/status/route';
import * as messagesRoute from '@/app/api/v1/me/pets/[petId]/messages/route';
import * as petsRoute from '@/app/api/v1/me/pets/route';
import * as pairRoute from '@/app/api/v1/pet-channel/pair/route';
import * as pollRoute from '@/app/api/v1/pet-channel/poll/route';
import * as repliesRoute from '@/app/api/v1/pet-channel/replies/route';
import * as tokenRoute from '@/app/api/v1/pet-channel/token/route';
import { closeDb } from '@/server/db';
import { resetLiveness } from '@/server/pet-channel/liveness';
import { resetRateLimits } from '@/server/rate-limit';
import { ORIGIN, call, devLogin, freshDb, jsonOf } from './helpers';

let h: DbHandle;

beforeAll(async () => {
  h = await freshDb();
});
afterAll(async () => {
  await h.close();
  await closeDb();
});
beforeEach(async () => {
  await freshDb(h);
  resetRateLimits();
  resetLiveness();
});

async function owner() {
  const u = await createTestUser(h.db, { noticeVersion: PRIVACY_NOTICE_VERSION });
  const { cookie } = await devLogin(u.email);
  const [pet] = await h.db
    .select()
    .from(pets)
    .where(and(eq(pets.userId, u.id), eq(pets.isDefault, true)));
  return { ...u, cookie, petId: pet!.id };
}

async function pairingCode(cookie: string): Promise<PetChannelPairingCodeDto> {
  const res = await call(codesRoute.POST, '/api/v1/me/pet-channel/pairing-codes', { method: 'POST', cookie });
  expect(res.status, await res.clone().text()).toBe(201);
  return jsonOf<PetChannelPairingCodeDto>(res);
}

/** What `enu-pet pair <code>` sends: no cookie, no Origin, JSON only. */
const pair = (code: string, extra: Record<string, unknown> = {}) =>
  pairRoute.POST(
    new Request(`${ORIGIN}/api/v1/pet-channel/pair`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '10.0.0.7' },
      body: JSON.stringify({ code, platform: 'darwin', plugin_version: '0.1.0', ...extra }),
    }),
  );

async function paired(cookie: string): Promise<PetChannelPairOutput> {
  const { code } = await pairingCode(cookie);
  const res = await pair(code.toLowerCase());
  expect(res.status, await res.clone().text()).toBe(201);
  return jsonOf<PetChannelPairOutput>(res);
}

/** A channel request as the plugin sends it. */
function channel(
  handler: (req: Request) => Promise<Response>,
  path: string,
  token: string | null,
  body?: unknown,
  method = 'POST',
) {
  const headers = new Headers({ 'content-type': 'application/json' });
  if (token) headers.set('authorization', `Bearer ${token}`);
  return handler(
    new Request(`${ORIGIN}${path}`, {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    }),
  );
}

const poll = async (
  token: string,
  body: Record<string, unknown> = { wait_s: 0, plugin_version: '0.1.0' },
) => {
  const res = await channel(pollRoute.POST, '/api/v1/pet-channel/poll', token, body);
  expect(res.status, await res.clone().text()).toBe(200);
  return jsonOf<PetChannelPollOutput>(res);
};

const reply = (token: string, body: Record<string, unknown>) =>
  channel(repliesRoute.POST, '/api/v1/pet-channel/replies', token, body);

let clientSeq = 0;
async function send(cookie: string, petId: string, text: string) {
  const res = await call(messagesRoute.POST, `/api/v1/me/pets/${petId}/messages`, {
    method: 'POST',
    cookie,
    params: { petId },
    body: { text, client_msg_id: `channel-test-${++clientSeq}` },
  });
  expect(res.status, await res.clone().text()).toBe(201);
  return jsonOf<OwnerPetMessageDto>(res);
}

const status = async (cookie: string) =>
  jsonOf<PetChannelStatusDto>(await call(statusRoute.GET, '/api/v1/me/pet-channel/status', { cookie }));

const auditsOf = (userId: string) =>
  h.db
    .select()
    .from(auditEvents)
    .where(and(eq(auditEvents.actorUserId, userId), ne(auditEvents.action, 'auth.sign_in')));

describe('pairing', () => {
  it('pairs a machine with a single-use code and links it like any Claude connection', async () => {
    const me = await owner();
    const code = await pairingCode(me.cookie);
    expect(code.code).toMatch(/^[2-9A-Z]{4}-[2-9A-Z]{4}$/);
    expect(code.command).toBe(`enu-pet pair ${code.code}`);
    const res = await pair(code.code, { label: '  내 맥북  ' });
    expect(res.status, await res.clone().text()).toBe(201);
    const out = await jsonOf<PetChannelPairOutput>(res);
    expect(out.token).toMatch(/^edc_[A-Za-z0-9_-]{43}$/);
    expect(out.owner_display_name).toBe(me.name);

    const [token] = await h.db.select().from(petChannelTokens).where(eq(petChannelTokens.userId, me.id));
    expect(token).toMatchObject({
      id: out.token_id,
      linkId: out.link_id,
      label: '내 맥북',
      platform: 'darwin',
    });
    // Only the hash is stored.
    expect(JSON.stringify(token)).not.toContain(out.token);
    const [link] = await h.db.select().from(claudeLinks).where(eq(claudeLinks.id, out.link_id));
    expect(link).toMatchObject({
      userId: me.id,
      clientKind: 'claude_code_channel',
      clientName: '내 맥북',
      clientId: `enu-den-channel:${out.token_id}`,
      revokedAt: null,
    });
    expect((await auditsOf(me.id)).map((a) => [a.action, a.metadata])).toEqual([
      ['pet_channel.pair', { platform: 'darwin', pluginVersion: '0.1.0' }],
    ]);

    // Used up, and the same answer for a used or an unknown code.
    const bodies = new Set<string>();
    for (const again of [code.code, 'ABCD-EFGH', 'zzzz-zzzz']) {
      const r = await pair(again);
      expect(r.status).toBe(400);
      bodies.add(await r.text());
    }
    expect(bodies.size).toBe(1);
  });

  it('keeps only the newest code, refuses non-JSON and stops at three machines', async () => {
    const me = await owner();
    const first = await pairingCode(me.cookie);
    const second = await pairingCode(me.cookie);
    expect((await pair(first.code)).status).toBe(400);
    const plain = await pairRoute.POST(
      new Request(`${ORIGIN}/api/v1/pet-channel/pair`, {
        method: 'POST',
        headers: { 'content-type': 'text/plain' },
        body: JSON.stringify({ code: second.code, platform: 'linux', plugin_version: '0.1.0' }),
      }),
    );
    expect(plain.status).toBe(415);
    expect((await pair(second.code)).status).toBe(201);
    await paired(me.cookie);
    await paired(me.cookie);
    const fourth = await pair((await pairingCode(me.cookie)).code);
    expect(fourth.status).toBe(409);
    expect(await jsonOf(fourth)).toMatchObject({ error: 'too_many_machines' });
  });

  it('asks for the privacy notice first', async () => {
    const me = await owner();
    const { code } = await pairingCode(me.cookie);
    await h.db.delete(privacyConsents).where(eq(privacyConsents.userId, me.id));
    const res = await pair(code);
    expect(res.status).toBe(403);
    expect(await jsonOf(res)).toMatchObject({ error: 'notice_required' });
  });
});

describe('the channel token', () => {
  it('is accepted only by the channel routes', async () => {
    const me = await owner();
    const { token } = await paired(me.cookie);
    const mcp = await mcpRoute.POST(
      new Request(`${ORIGIN}/api/mcp`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: '{"jsonrpc":"2.0","id":1,"method":"tools/list"}',
      }),
    );
    expect(mcp.status).toBe(401);
    const cookieRoute = await petsRoute.GET(
      new Request(`${ORIGIN}/api/v1/me/pets`, { headers: { authorization: `Bearer ${token}` } }),
      { params: Promise.resolve({}) },
    );
    expect(cookieRoute.status).toBe(401);
    for (const bad of [null, 'edc_short', `${token}x`, token.replace('edc_', 'xyz_')]) {
      const res = await channel(pollRoute.POST, '/api/v1/pet-channel/poll', bad, {
        wait_s: 0,
        plugin_version: '0.1.0',
      });
      expect(res.status, String(bad)).toBe(401);
      expect(await jsonOf(res)).toMatchObject({ error: 'invalid_token' });
    }
  });

  it('stops working when revoked, expired or its owner leaves', async () => {
    const me = await owner();
    const a = await paired(me.cookie);
    const b = await paired(me.cookie);
    const c = await paired(me.cookie);
    const refusal = async (token: string) => {
      const res = await channel(pollRoute.POST, '/api/v1/pet-channel/poll', token, {
        wait_s: 0,
        plugin_version: '0.1.0',
      });
      return [res.status, ((await res.json()) as { error: string }).error];
    };
    const revoked = await call(revokeRoute.POST, '/api/v1/me/claude-links/revoke', {
      method: 'POST',
      cookie: me.cookie,
      body: { link_id: a.link_id },
    });
    expect(revoked.status).toBe(200);
    expect(await refusal(a.token)).toEqual([401, 'token_revoked']);

    await h.db
      .update(petChannelTokens)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(petChannelTokens.id, b.token_id));
    expect(await refusal(b.token)).toEqual([401, 'token_expired']);

    await h.db.update(user).set({ status: 'deactivated' }).where(eq(user.id, me.id));
    expect(await refusal(c.token)).toEqual([401, 'user_inactive']);
  });

  it('unpairs itself and gives back what it held', async () => {
    const me = await owner();
    const { token, link_id } = await paired(me.cookie);
    const q = await send(me.cookie, me.petId, '채널이 잡을 질문');
    expect((await poll(token)).messages.map((m) => m.message_id)).toEqual([q.id]);
    const res = await channel(tokenRoute.DELETE, '/api/v1/pet-channel/token', token, undefined, 'DELETE');
    expect(res.status).toBe(204);
    const [row] = await h.db.select().from(petMessages).where(eq(petMessages.id, q.id));
    expect(row).toMatchObject({ answerState: 'pending', claimedBy: null, claimUntil: null });
    const [link] = await h.db.select().from(claudeLinks).where(eq(claudeLinks.id, link_id));
    expect(link?.revokedAt).not.toBeNull();
    expect(await status(me.cookie)).toEqual({ paired: false, live: false, machines: [] });
  });
});

describe('poll and replies', () => {
  it('hands each message to one machine, with the pets and their role instructions', async () => {
    const me = await owner();
    await h.db.update(pets).set({ roleInstructions: '코드 리뷰를 도와줘.' }).where(eq(pets.id, me.petId));
    const one = await paired(me.cookie);
    const two = await paired(me.cookie);
    const q = await send(me.cookie, me.petId, '이 PR 같이 볼래?');

    const first = await poll(one.token);
    expect(first.messages).toEqual([
      {
        message_id: q.id,
        pet_id: me.petId,
        sent_at: expect.stringMatching(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\+09:00$/),
        text: '이 PR 같이 볼래?',
        visibility: 'company',
        replies_so_far: 0,
      },
    ]);
    expect(first.pets).toEqual([
      expect.objectContaining({
        pet_id: me.petId,
        is_default: true,
        role_instructions: '코드 리뷰를 도와줘.',
      }),
    ]);
    // Held by the first machine: not again for it (unless it restarts), never for the second.
    expect((await poll(one.token)).messages).toEqual([]);
    expect((await poll(two.token)).messages).toEqual([]);
    expect(
      (await poll(one.token, { wait_s: 0, plugin_version: '0.1.0', include_held: true })).messages.map(
        (m) => m.message_id,
      ),
    ).toEqual([q.id]);
    const [row] = await h.db.select().from(petMessages).where(eq(petMessages.id, q.id));
    expect(row).toMatchObject({ answerState: 'claimed', claimedBy: one.token_id });
    expect(row!.claimUntil!.getTime()).toBeGreaterThan(Date.now() + 9 * 60_000);
  });

  it('writes nothing for an empty poll and never audits polls or replies', async () => {
    const me = await owner();
    const { token, link_id } = await paired(me.cookie);
    const linkBefore = await h.db.select().from(claudeLinks).where(eq(claudeLinks.id, link_id));
    const auditBefore = (await auditsOf(me.id)).length;
    expect(await poll(token)).toMatchObject({ messages: [] });
    expect(await h.db.select().from(claudeLinks).where(eq(claudeLinks.id, link_id))).toEqual(linkBefore);
    expect(await h.db.select().from(petMessages)).toEqual([]);

    const q = await send(me.cookie, me.petId, '질문');
    await poll(token);
    expect((await reply(token, { in_reply_to: q.id, text: '답이에요' })).status).toBe(201);
    expect((await auditsOf(me.id)).length).toBe(auditBefore);
  });

  it('wakes a parked poll as soon as the owner writes', async () => {
    const me = await owner();
    const { token } = await paired(me.cookie);
    const started = Date.now();
    const parked = poll(token, { wait_s: 20, plugin_version: '0.1.0' });
    await new Promise((r) => setTimeout(r, 300));
    const q = await send(me.cookie, me.petId, '지금 볼 수 있어?');
    const out = await parked;
    expect(out.messages.map((m) => m.message_id)).toEqual([q.id]);
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it('stores replies verbatim at any hour, by part, and reports a deleted question', async () => {
    const me = await owner();
    const { token, token_id } = await paired(me.cookie);
    const q = await send(me.cookie, me.petId, '긴 설명 부탁해');
    await poll(token);
    const part1 = await reply(token, { in_reply_to: q.id, text: '첫 부분이에요.' });
    expect(part1.status, await part1.clone().text()).toBe(201);
    expect(await jsonOf(part1)).toMatchObject({ result: 'created', visibility: 'company' });
    const again = await reply(token, { in_reply_to: q.id, text: '다른 글', part: 1 });
    expect(again.status).toBe(200);
    expect(await jsonOf(again)).toMatchObject({ result: 'duplicate' });
    expect((await reply(token, { in_reply_to: q.id, text: '둘째 부분이에요.', part: 2 })).status).toBe(201);
    const rejected = await reply(token, { in_reply_to: q.id, text: 'https://example.com 참고', part: 3 });
    expect(rejected.status).toBe(422);
    expect(await jsonOf(rejected)).toMatchObject({ error: 'url' });

    const replies = await h.db
      .select()
      .from(petMessages)
      .where(eq(petMessages.inReplyTo, q.id))
      .orderBy(petMessages.replyPart);
    expect(replies.map((r) => [r.replyPart, r.body, r.source, r.unread])).toEqual([
      [1, '첫 부분이에요.', 'claude_code_channel', true],
      [2, '둘째 부분이에요.', 'claude_code_channel', true],
    ]);
    const [question] = await h.db.select().from(petMessages).where(eq(petMessages.id, q.id));
    expect(question).toMatchObject({ answerState: 'answered', answeredLane: 'channel', claimedBy: null });
    expect(token_id).toBeTruthy();

    const gone = await send(me.cookie, me.petId, '지울 질문');
    await h.db.delete(petMessages).where(eq(petMessages.id, gone.id));
    const skipped = await reply(token, { in_reply_to: gone.id, text: '답' });
    expect(await jsonOf(skipped)).toEqual({
      result: 'skipped_owner_deleted',
      message_id: null,
      visibility: null,
    });
    expect((await reply(token, { in_reply_to: newOpaqueId(), text: '답' })).status).toBe(200);
  });

  it('respects a pet that answers only in check-ins', async () => {
    const me = await owner();
    const { token } = await paired(me.cookie);
    await h.db.update(pets).set({ replyRoute: 'checkin' }).where(eq(pets.id, me.petId));
    const q = await send(me.cookie, me.petId, '체크인 때 답해 줘');
    expect((await poll(token)).messages).toEqual([]);
    const res = await reply(token, { in_reply_to: q.id, text: '지금 답할게요' });
    expect(res.status).toBe(422);
    expect(await jsonOf(res)).toMatchObject({ error: 'route_not_allowed' });
  });
});

describe('status', () => {
  it('tells only the owner whether a machine is listening', async () => {
    const me = await owner();
    expect(await status(me.cookie)).toEqual({ paired: false, live: false, machines: [] });
    const { token, link_id } = await paired(me.cookie);
    expect(await status(me.cookie)).toMatchObject({
      paired: true,
      live: false,
      machines: [{ linkId: link_id, label: 'Claude Code (macOS)', platform: 'darwin' }],
    });
    await poll(token);
    expect(await status(me.cookie)).toMatchObject({ paired: true, live: true });
    const colleague = await owner();
    expect(await status(colleague.cookie)).toEqual({ paired: false, live: false, machines: [] });
  });
});
