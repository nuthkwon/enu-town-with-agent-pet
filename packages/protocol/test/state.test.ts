import { Encoder, Reflection, StateView } from '@colyseus/schema';
import { describe, expect, it } from 'vitest';
import { OfficeState, Pet, Player } from '../src/state';

describe('protocol state', () => {
  it('only the owner view decodes pet bubble text', () => {
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
    const decodeFor = (view: StateView) => {
      const it = { offset: 0 };
      encoder.encodeAll(it);
      const buf = encoder.encodeAllView(view, it.offset, it);
      const decoder = Reflection.decode(reflection);
      decoder.decode(buf.slice());
      return decoder.state as unknown as {
        pets: Map<string, { bubbleText?: string; indicator?: number; name?: string }>;
      };
    };
    const aliceView = new StateView();
    aliceView.add(alicePet);
    const bobView = new StateView();
    bobView.add(bobPet);

    const asAlice = decodeFor(aliceView);
    const asBob = decodeFor(bobView);
    expect(asAlice.pets.get('alice')?.bubbleText).toBe('회의 전에 자료 확인해 볼까요?');
    expect(asBob.pets.get('alice')?.name).toBe('나비');
    expect(asBob.pets.get('alice')?.bubbleText).toBeFalsy();
    expect(asBob.pets.get('alice')?.indicator).toBe(1);
  });
});
