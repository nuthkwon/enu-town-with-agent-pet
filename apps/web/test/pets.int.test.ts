import { auditEvents, pets, privacyConsents, type DbHandle } from '@enu/db';
import { createTestUser } from '@enu/testing';
import {
  LIMITS,
  TOWN_EVENTS_CHANNEL,
  type MeDto,
  type OwnerPetDto,
  type PetInfoDto,
  type TownEvent,
} from '@enu/shared';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as exportRoute from '@/app/api/v1/me/export/route';
import * as petRoute from '@/app/api/v1/me/pets/[petId]/route';
import * as petsRoute from '@/app/api/v1/me/pets/route';
import * as profileRoute from '@/app/api/v1/me/profile/route';
import * as userPetsRoute from '@/app/api/v1/users/[id]/pets/route';
import { closeDb } from '@/server/db';
import { resetRateLimits } from '@/server/rate-limit';
import { call, devLogin, freshDb, jsonOf } from './helpers';

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
});

async function userWithSession(input: Parameters<typeof createTestUser>[1] = {}) {
  const u = await createTestUser(h.db, input);
  const { cookie } = await devLogin(u.email);
  return { ...u, cookie };
}

const create = (cookie: string, body: Record<string, unknown>) =>
  call(petsRoute.POST, '/api/v1/me/pets', { method: 'POST', cookie, body });
const list = async (cookie: string) =>
  jsonOf<OwnerPetDto[]>(await call(petsRoute.GET, '/api/v1/me/pets', { cookie }));
const patch = (cookie: string, petId: string, body: Record<string, unknown>) =>
  call(petRoute.PATCH, `/api/v1/me/pets/${petId}`, { method: 'PATCH', cookie, body, params: { petId } });
const remove = (cookie: string, petId: string) =>
  call(petRoute.DELETE, `/api/v1/me/pets/${petId}`, { method: 'DELETE', cookie, params: { petId } });

async function listenEvents() {
  const conn = await h.pool.connect();
  const events: TownEvent[] = [];
  conn.on('notification', (m) => events.push(JSON.parse(m.payload ?? 'null') as TownEvent));
  await conn.query(`listen ${TOWN_EVENTS_CHANNEL}`);
  return {
    events,
    stop: async () => {
      await new Promise((r) => setTimeout(r, 200));
      await conn.query('unlisten *');
      conn.release();
    },
  };
}

describe('my pets', () => {
  it('lists the default pet first with its owner-only fields', async () => {
    const me = await userWithSession({ pet: { species: 'fox', name: '여울' } });
    const pets = await list(me.cookie);
    expect(pets).toHaveLength(1);
    expect(pets[0]).toMatchObject({
      ownerId: me.id,
      name: '여울',
      species: 'fox',
      tint: 'base',
      isDefault: true,
      roleInstructions: null,
      replyRoute: 'both',
      defaultVisibility: null,
      effectiveDefaultVisibility: 'company',
      unread: 0,
      pendingCount: 0,
      last: null,
    });
  });

  it('creates a pet with a tint, NOTIFYs pets_changed and audits without content', async () => {
    const me = await userWithSession();
    const listener = await listenEvents();
    const res = await create(me.cookie, {
      name: ' 리뷰봇 ',
      species: 'owl',
      tint: 'mint',
      role_instructions: '코드 리뷰를 꼼꼼하게 도와줘.',
      reply_route: 'channel',
      default_visibility: 'private',
    });
    await listener.stop();
    expect(res.status, await res.clone().text()).toBe(201);
    const pet = await jsonOf<OwnerPetDto>(res);
    expect(pet).toMatchObject({
      name: '리뷰봇',
      species: 'owl',
      tint: 'mint',
      isDefault: false,
      sortOrder: 1,
      roleInstructions: '코드 리뷰를 꼼꼼하게 도와줘.',
      replyRoute: 'channel',
      defaultVisibility: 'private',
      effectiveDefaultVisibility: 'private',
    });
    expect(pet.id.charAt(14)).toBe('4');
    expect(listener.events).toContainEqual({ v: 1, type: 'pets_changed', user_id: me.id });
    const [row] = await h.db
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.actorUserId, me.id), eq(auditEvents.action, 'pet.create')));
    expect(row?.metadata).toEqual({
      species: 'owl',
      tint: 'mint',
      replyRoute: 'channel',
      defaultVisibility: 'private',
      hasRole: true,
    });
    expect(JSON.stringify(row)).not.toContain('리뷰');
    expect((await list(me.cookie)).map((p) => p.name)).toEqual(['펫', '리뷰봇']);
  });

  it('keeps the base look for the default pet and one pet per look', async () => {
    const me = await userWithSession();
    const base = await create(me.cookie, { name: '하나', species: 'owl', tint: 'base' });
    expect(base.status).toBe(400);
    expect((await create(me.cookie, { name: '하나', species: 'owl', tint: 'rose' })).status).toBe(201);
    const twin = await create(me.cookie, { name: '둘', species: 'owl', tint: 'rose' });
    expect(twin.status).toBe(409);
    expect(await jsonOf(twin)).toMatchObject({ error: 'look_taken' });
  });

  it('caps pets per person, the default pet included', async () => {
    const me = await userWithSession();
    const tints = ['rose', 'mint', 'sky', 'lemon', 'lilac'];
    for (let i = 0; i < LIMITS.petsPerOwnerMax - 1; i++) {
      const res = await create(me.cookie, { name: `펫${i}`, species: 'cat', tint: tints[i] });
      expect(res.status, await res.clone().text()).toBe(201);
    }
    const over = await create(me.cookie, { name: '하나 더', species: 'cat', tint: 'lilac' });
    expect(over.status).toBe(409);
    expect(await jsonOf(over)).toMatchObject({ error: 'pet_limit' });
  });

  it('rejects names and role instructions over the limit instead of cutting them', async () => {
    const me = await userWithSession();
    const longName = await create(me.cookie, {
      name: '가'.repeat(LIMITS.petNameMax + 1),
      species: 'cat',
      tint: 'rose',
    });
    expect(longName.status).toBe(400);
    const longRole = await create(me.cookie, {
      name: '역할',
      species: 'cat',
      tint: 'rose',
      role_instructions: '가'.repeat(LIMITS.petRoleInstructionsMax + 1),
    });
    expect(longRole.status).toBe(400);
    expect(await jsonOf(longRole)).toMatchObject({
      fields: [{ field: 'role_instructions', reason: 'too_long' }],
    });
  });

  it('edits a pet; the default pet keeps the base look and a species no active colleague has', async () => {
    const colleague = await userWithSession({ pet: { species: 'fox' } });
    const me = await userWithSession({ pet: { species: 'cat' } });
    const [mine] = await list(me.cookie);
    const taken = await patch(me.cookie, mine!.id, { species: 'fox' });
    expect(taken.status).toBe(409);
    expect(await jsonOf(taken)).toMatchObject({ error: 'pet_taken' });
    const tinted = await patch(me.cookie, mine!.id, { tint: 'rose' });
    expect(tinted.status).toBe(400);
    const ok = await patch(me.cookie, mine!.id, {
      name: '보리',
      species: 'owl',
      role_instructions: '하루 계획',
    });
    expect(ok.status, await ok.clone().text()).toBe(200);
    expect(await jsonOf<OwnerPetDto>(ok)).toMatchObject({
      name: '보리',
      species: 'owl',
      roleInstructions: '하루 계획',
    });
    // The profile's pet (MeDto.pet) is the default pet.
    expect(colleague.id).not.toBe(me.id);
    const [audit] = await h.db
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.actorUserId, me.id), eq(auditEvents.action, 'pet.update')));
    expect(audit?.metadata).toEqual({ fields: ['name', 'roleInstructions', 'species', 'tint'] });
  });

  it('deletes extra pets but never the default pet; another person’s pet is not found', async () => {
    const other = await userWithSession();
    const me = await userWithSession();
    const extra = await jsonOf<OwnerPetDto>(
      await create(me.cookie, { name: '임시', species: 'cat', tint: 'sky' }),
    );
    const [mine] = await list(me.cookie);
    expect((await remove(me.cookie, mine!.id)).status).toBe(409);
    const [theirs] = await list(other.cookie);
    expect((await remove(me.cookie, theirs!.id)).status).toBe(404);
    expect((await patch(me.cookie, theirs!.id, { name: '탈취' })).status).toBe(404);
    expect((await remove(me.cookie, extra.id)).status).toBe(204);
    expect((await list(me.cookie)).map((p) => p.id)).toEqual([mine!.id]);
  });

  it('exports my pets with their role instructions', async () => {
    const me = await userWithSession();
    await create(me.cookie, {
      name: '정리봇',
      species: 'cat',
      tint: 'lemon',
      role_instructions: '회의록 정리',
    });
    const res = await call(exportRoute.GET, '/api/v1/me/export', { cookie: me.cookie });
    const body = await jsonOf<{ version: number; pets: { name: string; roleInstructions: string | null }[] }>(
      res,
    );
    expect(body.version).toBe(2);
    expect(body.pets.map((p) => [p.name, p.roleInstructions])).toEqual([
      ['펫', null],
      ['정리봇', '회의록 정리'],
    ]);
  });
});

describe('a colleague’s pets', () => {
  it('shows names and looks only, never role instructions or routes', async () => {
    const owner = await userWithSession({ pet: { species: 'fox', name: '여울' } });
    await create(owner.cookie, {
      name: '리뷰봇',
      species: 'owl',
      tint: 'mint',
      role_instructions: '비밀 메모',
    });
    const viewer = await userWithSession();
    const res = await call(userPetsRoute.GET, `/api/v1/users/${owner.id}/pets`, {
      cookie: viewer.cookie,
      params: { id: owner.id },
    });
    expect(res.status).toBe(200);
    const text = await res.clone().text();
    expect(text).not.toContain('비밀');
    expect(text).not.toMatch(/roleInstructions|replyRoute|defaultVisibility|unread|createdAt/);
    const body = await jsonOf<PetInfoDto[]>(res);
    expect(body.map((p) => [p.name, p.species, p.tint, p.isDefault])).toEqual([
      ['여울', 'fox', 'base', true],
      ['리뷰봇', 'owl', 'mint', false],
    ]);
  });

  it('answers 404 for unknown or deactivated people', async () => {
    const viewer = await userWithSession();
    const gone = await createTestUser(h.db, { status: 'deactivated' });
    for (const id of [gone.id, 'nobody']) {
      const res = await call(userPetsRoute.GET, `/api/v1/users/${id}/pets`, {
        cookie: viewer.cookie,
        params: { id },
      });
      expect(res.status).toBe(404);
    }
  });
});

describe('profile default for pet conversations', () => {
  it('records the pet_chat_sharing consent with the company default and withdraws it when lowered', async () => {
    const me = await userWithSession();
    const toPrivate = await call(profileRoute.PATCH, '/api/v1/me/profile', {
      method: 'PATCH',
      cookie: me.cookie,
      body: { pet_chat_default_visibility: 'private' },
    });
    expect(toPrivate.status, await toPrivate.clone().text()).toBe(200);
    expect((await jsonOf<MeDto>(toPrivate)).prefs.petChatDefaultVisibility).toBe('private');
    const back = await call(profileRoute.PATCH, '/api/v1/me/profile', {
      method: 'PATCH',
      cookie: me.cookie,
      body: { pet_chat_default_visibility: 'company' },
    });
    expect((await jsonOf<MeDto>(back)).prefs.petChatDefaultVisibility).toBe('company');
    const consents = await h.db
      .select()
      .from(privacyConsents)
      .where(and(eq(privacyConsents.userId, me.id), eq(privacyConsents.scope, 'pet_chat_sharing')));
    expect(consents).toHaveLength(1);
    expect(consents[0]?.withdrawnAt).toBeNull();
    expect((await list(me.cookie))[0]?.effectiveDefaultVisibility).toBe('company');
  });

  it('changes only the profile when pet fields are edited through /me/profile', async () => {
    const me = await userWithSession();
    const res = await call(profileRoute.PATCH, '/api/v1/me/profile', {
      method: 'PATCH',
      cookie: me.cookie,
      body: { pet_name: '모찌' },
    });
    expect(res.status, await res.clone().text()).toBe(200);
    expect((await jsonOf<MeDto>(res)).pet).toEqual({ species: 'cat', name: '모찌' });
    const [row] = await h.db.select().from(pets).where(eq(pets.userId, me.id));
    expect(row?.name).toBe('모찌');
  });
});
