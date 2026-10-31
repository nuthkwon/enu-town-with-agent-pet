import { auditEvents, notifyTown, profiles } from '@enu/db';
import { ActivityCode, type ErrorMsg, type SpellMsg } from '@enu/protocol';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as roster from '../src/infra/roster';
import {
  AFTER_HOURS,
  joinAs,
  makeUser,
  serverRoom,
  sleep,
  startHarness,
  waitFor,
  type Harness,
  type Joined,
} from './helpers/server';

/** Spells (ADR 0008): public like the wave, with shield, combo, raid and the 마법 받지 않기 opt-out. */

// The room's own loader, passed through; one test holds a profile reload half-way.
vi.mock('../src/infra/roster', async (importOriginal) => {
  const actual = await importOriginal<typeof roster>();
  return { ...actual, loadRosterMember: vi.fn(actual.loadRosterMember) };
});

const PORT = 3317;
let h: Harness;

beforeAll(async () => {
  h = await startHarness(PORT);
});
afterAll(async () => {
  await h?.close();
});
beforeEach(async () => {
  await h.reset();
});

const SEATS = { a: 'L1a', b: 'L1b', c: 'R2a', d: 'L4a', e: 'L4b', f: 'R3b', g: 'L2a', i: 'L2b' } as const;
type Who = keyof typeof SEATS;

async function people(
  keys: Who[] = ['a', 'b', 'c', 'd', 'e', 'f'],
  opts: Partial<Record<Who, { acceptSpells?: boolean }>> = {},
) {
  const u = {} as Record<Who, { id: string; name: string }>;
  const j = {} as Record<Who, Joined>;
  for (const k of keys)
    u[k] = await makeUser(h, { name: `사람${k.toUpperCase()}`, deskId: SEATS[k], ...opts[k] });
  for (const k of keys) j[k] = await joinAs(h, u[k].id);
  await waitFor(
    () => keys.every((x) => keys.every((y) => j[x].room.state.players.get(u[y].id)?.shown === true)),
    { message: 'everyone shown' },
  );
  return { u, j };
}

const spells = (j: Joined) => j.inbox.of<SpellMsg>('spell');
const cast = (from: Joined, toUserId: string, spell: string) =>
  from.room.send('social:cast', { toUserId, spell });
const errorOf = (j: Joined) => j.inbox.waitFor<ErrorMsg>('error', (e: ErrorMsg) => e.type === 'social:cast');

describe('spells', () => {
  it('a spell is broadcast to everyone, caster and target included, and nothing is stored', async () => {
    const { u, j } = await people();
    const before = (await h.db.select().from(auditEvents)).length;
    cast(j.a, u.c.id, 'fireball');
    const msg = { fromUserId: u.a.id, toUserId: u.c.id, spell: 'fireball', outcome: 'hit' };
    for (const k of ['a', 'b', 'c', 'd', 'e', 'f'] as const)
      expect(await j[k].inbox.waitFor<SpellMsg>('spell')).toEqual(msg);
    expect((await h.db.select().from(auditEvents)).length).toBe(before);
    // one spell per target per 15 s for each caster
    cast(j.a, u.c.id, 'coffee');
    expect(await errorOf(j.a)).toEqual({ code: 'RATE_LIMITED', type: 'social:cast' });
  });

  it('refuses oneself, unknown spells, people who turned spells off, hidden people and after hours', async () => {
    const { u, j } = await people(['a', 'b', 'c'], { b: { acceptSpells: false } });
    cast(j.a, u.a.id, 'potion');
    expect(await errorOf(j.a)).toEqual({ code: 'INVALID_PAYLOAD', type: 'social:cast' });
    cast(j.a, u.b.id, 'potion');
    await waitFor(() => j.a.inbox.of<ErrorMsg>('error').some((e) => e.code === 'NOT_ACCEPTED'), {
      message: 'NOT_ACCEPTED',
    });
    j.a.room.send('social:cast', { toUserId: u.c.id, spell: 'meteor' });
    await waitFor(() =>
      j.a.inbox.of<ErrorMsg>('error').some((e) => e.code === 'INVALID_PAYLOAD' && e.type === 'social:cast'),
    );
    // someone who never opened the town is not shown
    const away = await makeUser(h, { name: '안열음', deskId: 'L3a' });
    cast(j.c, away.id, 'fireworks');
    await waitFor(() => j.c.inbox.of<ErrorMsg>('error').some((e) => e.code === 'NOT_SHOWN'), {
      message: 'hidden',
    });
    // after hours nothing is cast
    h.clock.set(AFTER_HOURS);
    serverRoom(h, j.a).evaluateNow();
    await waitFor(() => j.a.room.state.officeOpen === false);
    cast(j.c, u.a.id, 'zap');
    await waitFor(() => j.c.inbox.of<ErrorMsg>('error').filter((e) => e.code === 'NOT_SHOWN').length === 2, {
      message: 'after hours',
    });
    await sleep(150);
    for (const k of ['a', 'b', 'c'] as const) expect(spells(j[k])).toEqual([]);
  });

  it('turning spells off (profile_changed) takes effect at once', async () => {
    const { u, j } = await people(['a', 'b', 'c']);
    await h.db.update(profiles).set({ acceptSpells: false }).where(eq(profiles.userId, u.b.id));
    await notifyTown(h.db, { v: 1, type: 'profile_changed', user_id: u.b.id });
    await waitFor(() => !serverRoom(h, j.a).townDirector.acceptsSpells(u.b.id), { message: 'reloaded' });
    cast(j.a, u.b.id, 'highfive');
    await waitFor(() => j.a.inbox.of<ErrorMsg>('error').some((e) => e.code === 'NOT_ACCEPTED'));
  });

  it('a status change while that reload is under way keeps both: the new status and spells off', async () => {
    const { u, j } = await people(['a', 'b']);
    const actual = await vi.importActual<typeof roster>('../src/infra/roster');
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    let state: 'armed' | 'holding' | 'done' = 'armed';
    vi.mocked(roster.loadRosterMember).mockImplementation(async (db, userId) => {
      const snap = await actual.loadRosterMember(db, userId);
      if (state === 'armed' && userId === u.b.id) {
        state = 'holding';
        await held;
      }
      return snap;
    });
    try {
      await h.db.update(profiles).set({ acceptSpells: false }).where(eq(profiles.userId, u.b.id));
      await notifyTown(h.db, { v: 1, type: 'profile_changed', user_id: u.b.id });
      // The reload has read 마법 받지 않기 and is still on its way when B's status is saved.
      await waitFor(() => state === 'holding', { message: 'profile reload under way' });
      j.b.room.send('status:set', { status: 'focus', duration: '30m' });
      await waitFor(() => j.a.room.state.players.get(u.b.id)?.activity === ActivityCode.Focus, {
        message: 'b in focus',
      });
    } finally {
      state = 'done';
      release();
      vi.mocked(roster.loadRosterMember).mockImplementation(actual.loadRosterMember);
    }
    const director = serverRoom(h, j.a).townDirector;
    await waitFor(() => !director.acceptsSpells(u.b.id), { message: 'spells off' });
    await sleep(150); // the held reload has finished as well: it must not bring the old status back
    expect(director.projected(u.b.id)?.activity).toBe('focus');
    cast(j.a, u.b.id, 'zap');
    await waitFor(() => j.a.inbox.of<ErrorMsg>('error').some((e) => e.code === 'NOT_ACCEPTED'), {
      message: 'NOT_ACCEPTED',
    });
  });

  it('bounces off the shield of someone in focus mode, for everyone to see', async () => {
    const { u, j } = await people(['a', 'b', 'c']);
    j.b.room.send('status:set', { status: 'focus', duration: '30m' });
    await waitFor(() => j.a.room.state.players.get(u.b.id)?.activity === 2, { message: 'b in focus' });
    cast(j.a, u.b.id, 'zap');
    const msg = { fromUserId: u.a.id, toUserId: u.b.id, spell: 'zap', outcome: 'blocked' };
    for (const k of ['a', 'b', 'c'] as const)
      expect(await j[k].inbox.waitFor<SpellMsg>('spell')).toEqual(msg);
  });

  it('a high-five returned within 10 s is a combo', async () => {
    const { u, j } = await people(['a', 'b', 'c']);
    cast(j.a, u.b.id, 'highfive');
    await j.c.inbox.waitFor<SpellMsg>('spell');
    cast(j.b, u.a.id, 'highfive');
    await waitFor(() => spells(j.c).length === 2);
    expect(spells(j.c)[1]).toEqual({
      fromUserId: u.b.id,
      toUserId: u.a.id,
      spell: 'highfive',
      outcome: 'combo',
    });
  });

  it('three different casters on one person within a minute make a raid; the room caps what one person receives', async () => {
    const { u, j } = await people(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'i']);
    const casters = ['a', 'b', 'd', 'e', 'f', 'g', 'i'] as const;
    const outcomes: string[] = [];
    for (const k of casters) {
      cast(j[k], u.c.id, 'fireworks');
      await waitFor(
        () =>
          spells(j.c).length === outcomes.length + 1 ||
          j[k].inbox.of<ErrorMsg>('error').some((e) => e.type === 'social:cast'),
        { message: `cast by ${k}` },
      );
      if (spells(j.c).length === outcomes.length + 1) outcomes.push(spells(j.c).at(-1)!.outcome);
    }
    expect(outcomes).toEqual(['hit', 'hit', 'raid', 'hit', 'hit', 'hit']);
    // the seventh spell at the same person within a minute is refused
    expect(j.i.inbox.of<ErrorMsg>('error')).toContainEqual({ code: 'RATE_LIMITED', type: 'social:cast' });
  });
});
