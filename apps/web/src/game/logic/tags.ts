/**
 * Floating name tags never stack on top of each other (pure; screen px). Tags are placed me first, then
 * front to back (lower feet first), then left to right. A tag that would cover an already placed one
 * first tries the spot just under its feet: side by side (the meeting table, a crowded pantry) tags then
 * alternate above and below instead of piling up over the pets that hover behind their owners. Only when
 * that is taken too does it move up, one tag height at a time (at most three times).
 */
import { boxesOverlap, type Box } from './plates';

/** How a floating tag was decluttered: moved up by `shift` px, or put under the feet. */
export interface TagPlacement {
  shift: number;
  below: boolean;
}

export interface TagCandidate {
  id: string;
  isMe: boolean;
  feetX: number;
  feetY: number;
  /** The tag at its default spot over the head. */
  above: Box;
  /** The tag just under the feet. */
  below: Box;
}

export const TAG_DEFAULT: TagPlacement = Object.freeze({ shift: 0, below: false });
const MAX_SHIFTS = 3;
const STACK_GAP = 2;

export function declutterTags(candidates: readonly TagCandidate[]): Map<string, TagPlacement> {
  const order = [...candidates].sort((a, b) =>
    a.isMe !== b.isMe ? (a.isMe ? -1 : 1) : b.feetY - a.feetY || a.feetX - b.feetX,
  );
  const placed: Box[] = [];
  const hits = (r: Box) => placed.some((p) => boxesOverlap(p, r));
  const out = new Map<string, TagPlacement>();
  for (const c of order) {
    let place = TAG_DEFAULT;
    let rect = c.above;
    if (hits(c.above)) {
      if (!hits(c.below)) {
        place = { shift: 0, below: true };
        rect = c.below;
      } else {
        let shift = 0;
        for (let tries = 0; tries < MAX_SHIFTS; tries++) {
          shift += c.above.h + STACK_GAP;
          rect = { ...c.above, y: c.above.y - shift };
          if (!hits(rect)) break;
        }
        place = { shift, below: false };
      }
    }
    placed.push(rect);
    out.set(c.id, place);
  }
  return out;
}
