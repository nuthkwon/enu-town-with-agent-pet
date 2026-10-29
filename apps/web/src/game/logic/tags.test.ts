import { describe, expect, it } from 'vitest';
import type { Box } from './plates';
import { TAG_DEFAULT, declutterTags, type TagCandidate } from './tags';

const TAG_W = 60;
const TAG_H = 16;

/** A person standing at screen (feetX, feetY): the tag over the head, or just under the feet. */
function person(id: string, feetX: number, feetY: number, isMe = false): TagCandidate {
  const above: Box = { x: feetX - TAG_W / 2, y: feetY - 40 - TAG_H, w: TAG_W, h: TAG_H };
  const below: Box = { x: feetX - TAG_W / 2, y: feetY + 3, w: TAG_W, h: TAG_H };
  return { id, isMe, feetX, feetY, above, below };
}

describe('declutterTags', () => {
  it('leaves tags that do not touch where they are', () => {
    const out = declutterTags([person('a', 100, 300), person('b', 300, 300), person('c', 100, 500)]);
    expect([...out.values()]).toEqual([TAG_DEFAULT, TAG_DEFAULT, TAG_DEFAULT]);
  });

  it('alternates above and below for people side by side (the meeting table), left to right', () => {
    // Four meeting chairs 48 px apart (zoom 1.5): neighbouring 60 px tags overlap.
    const row = ['d', 'b', 'a', 'c'].map((id) => person(id, { a: 100, b: 148, c: 196, d: 244 }[id]!, 600));
    const out = declutterTags(row);
    expect(out.get('a')).toEqual({ shift: 0, below: false });
    expect(out.get('b')).toEqual({ shift: 0, below: true });
    expect(out.get('c')).toEqual({ shift: 0, below: false });
    expect(out.get('d')).toEqual({ shift: 0, below: true });
  });

  it('moves a tag up when the spot under the feet is taken too', () => {
    // b's tag collides with a's above and, under its feet, with c's tag (placed first: c stands in front).
    const a = person('a', 100, 300);
    const b = person('b', 110, 300);
    const c = person('c', 110, 340);
    c.above = { ...b.below };
    const out = declutterTags([a, b, c]);
    expect(out.get('c')).toEqual(TAG_DEFAULT);
    expect(out.get('a')).toEqual(TAG_DEFAULT);
    expect(out.get('b')).toEqual({ shift: TAG_H + 2, below: false });
  });

  it('places my own tag first, so it keeps its spot over my head', () => {
    const out = declutterTags([person('other', 100, 300), person('me', 110, 300, true)]);
    expect(out.get('me')).toEqual(TAG_DEFAULT);
    expect(out.get('other')).toEqual({ shift: 0, below: true });
  });

  it('is independent of the input order', () => {
    const people = [
      person('a', 100, 600),
      person('b', 148, 600),
      person('c', 196, 600),
      person('d', 150, 640),
    ];
    const ref = declutterTags(people);
    const shuffled = declutterTags([people[2]!, people[0]!, people[3]!, people[1]!]);
    expect([...shuffled.entries()].sort()).toEqual([...ref.entries()].sort());
  });
});
