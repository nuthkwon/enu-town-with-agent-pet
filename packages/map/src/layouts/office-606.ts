import type { DeskId, ZoneId } from '@enu/shared';

/**
 * 대덕비즈센터 A동 606호 — floor plan provided by the team (14 seats).
 * Top = balcony (innermost), bottom = office entrance, centre column = aisle.
 * This is the source for the *initial* Tiled map (`pnpm map:gen`); after that the
 * generated `.tmj` is the source of truth and can be edited in Tiled.
 *
 * Legend
 *   R railing   , balcony deck   W window wall   D balcony glass door   E entrance door   # wall
 *   . carpet    : aisle runner   d desk          ^ v < chair (seat facing up/down/left)
 *   P partition (대표석)   C cabinet   L plant   B whiteboard
 *   m meeting floor   T meeting table   h meeting chair (open meeting area, no partition)
 *   p pantry floor    F fridge   M microwave   K counter
 *   s server floor    S server rack   x server room door (closed)
 */
export const OFFICE_606_ASCII = [
  'RRRRRRRRRRRRRRRRRRRRRR', // 0
  'R,,,,,,,,,,,,,,,,,,,,R', // 1  balcony
  'R,,,,,,,,,,,,,,,,,,,,R', // 2
  'WWWWWWWWWWWWWWWWWWDDWW', // 3  window wall, balcony door at x18-19 (to the CEO's right)
  '#L.......::::.......L#', // 4  walkway (aisle -> balcony door / CEO seat)
  '#.dv..vd.::::.P.dd..L#', // 5  L1a L1b (facing down), desk returns | CEO desk + return (to his right)
  '#.dddddd.::::.P.d<..C#', // 6  L1 desks                       | R1 CEO chair facing left (toward L1b)
  '#.dddddd.::::.PPPPPPP#', // 7  L2 desks (joined with L1)      | partition
  '#.d^..^d.::::.dddddd.#', // 8  L2a L2b (facing up), returns   | R2 desks
  '#........::::.d^..^d.#', // 9  back-to-back gap               | R2a R2b (facing up), returns
  '#.dv..vd.::::........#', // 10 L3a L3b (facing down), returns | back-to-back gap
  '#.dddddd.::::.....vd.#', // 11 L3 desks                       | R3b (facing down), return
  '#.dddddd.::::.CCCddd.#', // 12 L4 desks (joined with L3)      | storage (R3a spot) + R3b desk
  '#.d^..^d.::::........#', // 13 L4a L4b (facing up), returns
  '#........::::LppppppF#', // 14 back-to-back gap               | pantry: fridge
  '#.dv..vd.::::pppppppM#', // 15 L5a L5b (facing down), returns | microwave
  '#.dddddd.::::ppppppKK#', // 16 L5 desks                       | counter
  '#.......L::::#########', // 17                                | server room wall
  '#mmhhhhmm::::#sSsSsSs#', // 18 meeting area                   | server room
  '#mhTTTThm::::xsSsSsSs#', // 19                                | server door (closed)
  '#mhTTTThm::::#sSsSsSs#', // 20
  '#Bmhhhhmm::::#sssssss#', // 21
  '##########EE##########', // 22 entrance at x10-11
] as const;

export const OFFICE_606_WIDTH = 22;
export const OFFICE_606_HEIGHT = 23;

export type Facing = 'up' | 'down' | 'left' | 'right';

export interface DeskSpec {
  deskId: DeskId;
  kind: 'desk' | 'ceo';
  facing: Facing;
  /** Seat (chair) tile where the owner spawns and sits. */
  seatX: number;
  seatY: number;
  /** Desk surface rectangle in tiles (inclusive start, width/height). */
  deskX: number;
  deskY: number;
  deskW: number;
  deskH: number;
  /** One-tile return next to the seat that makes the desk L-shaped (ㄱ자 책상). */
  wing?: { x: number; y: number };
}

const L = (deskId: DeskId, col: 'a' | 'b', seatY: number, deskY: number, facing: Facing): DeskSpec => ({
  deskId,
  kind: 'desk',
  facing,
  seatX: col === 'a' ? 3 : 6,
  seatY,
  deskX: col === 'a' ? 2 : 5,
  deskY,
  deskW: 3,
  deskH: 1,
  // returns on the outer ends, so each pair sits in the inner corners of mirrored ㄱ shapes
  wing: { x: col === 'a' ? 2 : 7, y: seatY },
});

/**
 * Seat ids: L{row}{a = wall side, b = aisle side}, R{row}{a = aisle side, b = wall side}, R1 = CEO.
 * Confirmed: L2a↔L3a, L4a↔L5a, R2b↔R3b sit back to back; R1 faces left toward L1b.
 */
export const OFFICE_606_DESKS: readonly DeskSpec[] = [
  L('L1a', 'a', 5, 6, 'down'),
  L('L1b', 'b', 5, 6, 'down'),
  L('L2a', 'a', 8, 7, 'up'),
  L('L2b', 'b', 8, 7, 'up'),
  L('L3a', 'a', 10, 11, 'down'),
  L('L3b', 'b', 10, 11, 'down'),
  L('L4a', 'a', 13, 12, 'up'),
  L('L4b', 'b', 13, 12, 'up'),
  L('L5a', 'a', 15, 16, 'down'),
  L('L5b', 'b', 15, 16, 'down'),
  // the CEO desk runs north-south in front of the chair (he faces L1b) with a return on his right
  {
    deskId: 'R1',
    kind: 'ceo',
    facing: 'left',
    seatX: 17,
    seatY: 6,
    deskX: 16,
    deskY: 5,
    deskW: 1,
    deskH: 2,
    wing: { x: 17, y: 5 },
  },
  {
    deskId: 'R2a',
    kind: 'desk',
    facing: 'up',
    seatX: 15,
    seatY: 9,
    deskX: 14,
    deskY: 8,
    deskW: 3,
    deskH: 1,
    wing: { x: 14, y: 9 },
  },
  {
    deskId: 'R2b',
    kind: 'desk',
    facing: 'up',
    seatX: 18,
    seatY: 9,
    deskX: 17,
    deskY: 8,
    deskW: 3,
    deskH: 1,
    wing: { x: 19, y: 9 },
  },
  {
    deskId: 'R3b',
    kind: 'desk',
    facing: 'down',
    seatX: 18,
    seatY: 11,
    deskX: 17,
    deskY: 12,
    deskW: 3,
    deskH: 1,
    wing: { x: 19, y: 11 },
  },
];

export interface ZoneSpec {
  zoneId: ZoneId;
  x: number;
  y: number;
  w: number;
  h: number;
  walkable: boolean;
}

export const OFFICE_606_ZONES: readonly ZoneSpec[] = [
  { zoneId: 'balcony', x: 1, y: 1, w: 20, h: 2, walkable: true },
  { zoneId: 'ceo', x: 15, y: 4, w: 6, h: 3, walkable: true },
  { zoneId: 'pantry', x: 13, y: 14, w: 8, h: 3, walkable: true },
  { zoneId: 'server', x: 14, y: 18, w: 7, h: 4, walkable: false },
  { zoneId: 'meeting', x: 1, y: 18, w: 8, h: 4, walkable: true },
];

/** Default spawn (just inside the entrance) for people without an assigned seat. */
export const OFFICE_606_SPAWN = { x: 10, y: 21, w: 2, h: 1 } as const;
