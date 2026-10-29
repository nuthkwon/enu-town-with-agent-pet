/**
 * Where each desk's name plate sits (pure; world px). Plates are drawn in screen space, so their size
 * does not grow with the zoom: at the overview zoom 1 a desk is only 96 px wide and the team desks are
 * joined back to back. The layout therefore:
 *  - puts the one-line plate (seated owner, or a name only) on the desk row next to the desk's return
 *    (the ㄱ-shaped wing), away from the seat, so the activity icon over the head never covers it;
 *  - puts the card of a hidden owner (2-3 lines) on the empty seat, nudged away from the desk, so the pet
 *    perched on the desk in front of the seat stays visible (spec §5.7); it keeps the card from crossing
 *    into a neighbouring desk (`minX`/`maxX`), letting it grow toward the aisle or the wall.
 *  - R1 (a desk the owner sits beside, inside the CEO room): the plate sits on top of the desk and the
 *    card above the chair, both clear of the room's glass wall and of the perched pet.
 */
import type { DeskInfo, OfficeWorld } from '@enu/map';

const T = 32;
/** Gap (px) between the plate edge and the anchor. */
const EDGE = 3;
/** World px a hidden owner's card sits off the seat centre, away from the desk (and the perched pet). */
const CARD_OFFSET = 6;

export type PlateAlign = 'left' | 'right' | 'center';
/** Which edge of a card sits on its anchor's y ('center': its middle). */
export type CardAlignY = 'center' | 'bottom';

export interface PlateLayout {
  deskId: string;
  /** One-line plate: world anchor and which edge of the plate sits on it. */
  pill: { x: number; y: number; align: PlateAlign };
  /** Card of a hidden owner: world anchor (x = its middle; y per `alignY`). */
  card: { x: number; y: number; alignY: CardAlignY };
  /** World x the plate must not cross because a neighbouring desk starts there (null = free). */
  minX: number | null;
  maxX: number | null;
  /** The seat tile: the owner is "at the desk" while their Player stands here. */
  seat: { x: number; y: number };
}

function isOtherDesk(world: OfficeWorld, desk: DeskInfo, x: number, y: number): boolean {
  const d = world.deskAtTile(x, y);
  return d !== null && d.deskId !== desk.deskId;
}

export function plateLayout(world: OfficeWorld, desk: DeskInfo): PlateLayout {
  const r = desk.tileRect;
  const seat = { x: desk.seatX, y: desk.seatY };
  const seatCx = seat.x * T + T / 2;
  const deskCx = (r.x + r.w / 2) * T;
  const rowCy = (r.y + r.h / 2) * T;
  const vertical = desk.facing === 'up' || desk.facing === 'down';

  let pill: PlateLayout['pill'];
  let card: PlateLayout['card'];
  if (vertical) {
    const leftBlocked = !world.isWalkable(seat.x - 1, seat.y);
    const rightBlocked = !world.isWalkable(seat.x + 1, seat.y);
    if (leftBlocked && !rightBlocked) pill = { x: seat.x * T - EDGE, y: rowCy, align: 'right' };
    else if (rightBlocked && !leftBlocked) pill = { x: (seat.x + 1) * T + EDGE, y: rowCy, align: 'left' };
    else pill = { x: deskCx, y: rowCy, align: 'center' };
    // On the empty seat, a little away from the desk: the pet perches on the desk tile the seat faces.
    const away = desk.facing === 'down' ? -CARD_OFFSET : CARD_OFFSET;
    card = { x: deskCx, y: seat.y * T + T / 2 + away, alignY: 'center' };
  } else {
    // A desk the owner sits beside (R1): the plate on top of the desk (the chair's bottom edge is the
    // room's glass wall), the card standing on the chair's top edge (the pet perches on the desk beside it).
    pill = { x: deskCx, y: r.y * T - 9, align: 'center' };
    card = { x: seatCx, y: seat.y * T + 2, alignY: 'bottom' };
  }

  const minX = isOtherDesk(world, desk, r.x - 1, r.y) ? r.x * T : null;
  const maxX = isOtherDesk(world, desk, r.x + r.w, r.y) ? (r.x + r.w) * T : null;
  return { deskId: desk.deskId, pill, card, minX, maxX, seat };
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Screen box of a one-line plate of size w x h whose anchor is at screen (ax, ay). */
export function pillBox(ax: number, ay: number, align: PlateAlign, w: number, h: number): Box {
  const x = align === 'left' ? ax : align === 'right' ? ax - w : ax - w / 2;
  return { x: Math.round(x), y: Math.round(ay - h / 2), w, h };
}

/**
 * Screen box of a card of size w x h whose anchor is at screen (ax, ay) (x = its middle, y per `alignY`),
 * pushed inside [minSx, maxSx] (screen x of the neighbouring desks; null = no limit on that side).
 */
export function cardBox(
  ax: number,
  ay: number,
  alignY: CardAlignY,
  w: number,
  h: number,
  minSx: number | null,
  maxSx: number | null,
): Box {
  let x = ax - w / 2;
  if (maxSx !== null && x + w > maxSx - EDGE) x = maxSx - EDGE - w;
  if (minSx !== null && x < minSx + EDGE) x = minSx + EDGE;
  const y = alignY === 'bottom' ? ay - h : ay - h / 2;
  return { x: Math.round(x), y: Math.round(y), w, h };
}

export function boxesOverlap(a: Box, b: Box): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}
