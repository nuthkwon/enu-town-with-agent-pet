import { Encoder, Reflection, StateView } from '@colyseus/schema';
import { describe, expect, it } from 'vitest';
import { ActivityCode, PlateNote, SourceCode } from '../src/constants';
import { OfficeState, Pet, Player } from '../src/state';

interface DecodedPlayer {
  shown?: boolean;
  online?: boolean;
  activity?: number;
  source?: number;
  until?: number;
  note?: number;
  groupId?: string;
  logPulse?: number;
  statusText?: string;
  status?: unknown;
  zoneId?: unknown;
}

interface Decoded {
  officeOpen?: boolean;
  players: Map<string, DecodedPlayer>;
  pets: Map<string, { bubbleText?: string; bubbleId?: string; indicator?: number; name?: string }>;
}

function setup() {
  const state = new OfficeState();
  state.players.set('alice', new Player({ id: 'alice', name: 'Alice', avatar: 'av' }));
  const alicePet = new Pet({ ownerId: 'alice', species: 'cat', name: '나비' });
  alicePet.bubbleText = '회의 전에 자료 확인해 볼까요?';
  alicePet.bubbleId = 'b1';
  alicePet.indicator = 1;
  state.pets.set('alice', alicePet);
  const bobPet = new Pet({ ownerId: 'bob', species: 'fox', name: '여름' });
  state.pets.set('bob', bobPet);

  const encoder = new Encoder(state);
  const reflection = Reflection.encode(encoder);
  // Reflection-based decoding mirrors what the browser SDK does (no schema classes on the client).
  const decodeFor = (view: StateView): Decoded => {
    const it = { offset: 0 };
    encoder.encodeAll(it);
    const buf = encoder.encodeAllView(view, it.offset, it);
    const decoder = Reflection.decode(reflection);
    decoder.decode(buf.slice());
    return decoder.state as unknown as Decoded;
  };
  const aliceView = new StateView();
  aliceView.add(alicePet);
  const bobView = new StateView();
  bobView.add(bobPet);
  return { state, decodeFor, aliceView, bobView };
}

describe('protocol state', () => {
  it('only the owner view decodes pet bubble text', () => {
    const { decodeFor, aliceView, bobView } = setup();
    const asAlice = decodeFor(aliceView);
    const asBob = decodeFor(bobView);
    expect(asAlice.pets.get('alice')?.bubbleText).toBe('회의 전에 자료 확인해 볼까요?');
    expect(asBob.pets.get('alice')?.name).toBe('나비');
    expect(asBob.pets.get('alice')?.bubbleText).toBeFalsy();
    expect(asBob.pets.get('alice')?.bubbleId).toBeFalsy();
    expect(asBob.pets.get('alice')?.indicator).toBe(1);
  });

  it('starts neutral: closed office, hidden members, no activity', () => {
    const { decodeFor, bobView } = setup();
    const asBob = decodeFor(bobView);
    expect(asBob.officeOpen).toBe(false);
    const alice = asBob.players.get('alice');
    expect(alice).toMatchObject({ shown: false, online: false, activity: 0, source: 0, until: 0, note: 0 });
    expect(alice?.groupId ?? '').toBe('');
  });

  it('encodes and decodes the director fields for every client alike', () => {
    const { state, decodeFor, aliceView, bobView } = setup();
    const until = Date.UTC(2026, 10, 2, 2, 0, 0);
    state.officeOpen = true;
    const alice = state.players.get('alice')!;
    alice.shown = true;
    alice.online = true;
    alice.activity = ActivityCode.Review;
    alice.source = SourceCode.Claude;
    alice.until = until;
    alice.note = PlateNote.None;
    alice.groupId = 'g1x2y3';
    alice.logPulse = 255;
    alice.statusText = '오후 외근';

    const expected = {
      shown: true,
      online: true,
      activity: ActivityCode.Review,
      source: SourceCode.Claude,
      until,
      note: PlateNote.None,
      groupId: 'g1x2y3',
      logPulse: 255,
      statusText: '오후 외근',
    };
    for (const view of [aliceView, bobView]) {
      const decoded = decodeFor(view);
      expect(decoded.officeOpen).toBe(true);
      expect(decoded.players.get('alice')).toMatchObject(expected);
    }
  });

  it('has no steering or location fields', () => {
    const { decodeFor, bobView } = setup();
    const alice = decodeFor(bobView).players.get('alice');
    expect(alice?.status).toBeUndefined();
    expect(alice?.zoneId).toBeUndefined();
  });
});
