import type { TileName } from '@enu/shared';
import { Canvas } from '../draw/canvas';
import { type RGBA, hex, lighten, mix, withAlpha } from '../draw/color';
import { tileNoise } from '../draw/noise';
import { INK } from '../palette';

/**
 * Office tiles (32x32, top-down 3/4 view, pastel). Floors and walls are opaque and tile seamlessly;
 * furniture / wall-overlay tiles are transparent around the object (the map stacks them on a floor
 * layer: floor -> walls -> furniture -> furniture-top).
 */
const S = 32;

const C = {
  ink: INK,
  inkSoft: hex('#6b5a8a'),
  shadow: hex('#3b2a52', 46),
  shadowSoft: hex('#3b2a52', 28),
  white: hex('#ffffff'),
  // floors
  carpet: hex('#dcd9f3'),
  carpetDark: hex('#d5d2ef'),
  carpetLight: hex('#e2e0f6'),
  runner: hex('#f7d8e4'),
  runnerDark: hex('#f0c7d7'),
  runnerSpeck: hex('#f3d0dd'),
  runnerLight: hex('#fbe4ec'),
  wood: hex('#f5dab5'),
  woodAlt: hex('#f0cfa4'),
  woodSeam: hex('#d2aa82'),
  woodLight: hex('#fbe9cf'),
  woodGrain: hex('#e9c497'),
  tileA: hex('#fff8f1'),
  tileB: hex('#fde4ea'),
  grout: hex('#ead6d6'),
  meeting: hex('#d3efe6'),
  meetingDark: hex('#c8e9de'),
  meetingLight: hex('#dcf4ec'),
  server: hex('#d5dbef'),
  serverEdge: hex('#b6bfdd'),
  serverLight: hex('#e7ebf8'),
  serverHole: hex('#b1bbd9'),
  // walls
  wallTrim: hex('#efeaff'),
  wallCap: hex('#c8bdeb'),
  wallCapDark: hex('#b8abe0'),
  wallCapLight: hex('#dbd3f5'),
  wallFace: hex('#ece6fa'),
  wallFaceDark: hex('#e1d9f3'),
  wallBase: hex('#a596cf'),
  wallBaseLight: hex('#c0b4e3'),
  frame: hex('#f7f4ff'),
  frameShade: hex('#d2c9ee'),
  glassTop: hex('#b9e4ff'),
  glassBottom: hex('#dff4ff'),
  glassStreak: hex('#ffffff', 150),
  cloud: hex('#ffffff', 200),
  // furniture
  deskTop: hex('#f8ead8'),
  deskTopLight: hex('#fdf5ea'),
  deskGrain: hex('#efdcc5'),
  deskFront: hex('#e2c4a6'),
  deskFrontDark: hex('#cfac8c'),
  ceoTop: hex('#efc9a2'),
  ceoLight: hex('#f7dcbd'),
  ceoSeam: hex('#c99872'),
  ceoFront: hex('#ddaf86'),
  ceoGrain: hex('#e6bb92'),
  seat: hex('#c6b3f2'),
  seatLight: hex('#dccdfb'),
  seatDark: hex('#a691de'),
  metal: hex('#9d97b8'),
  metalDark: hex('#7c7598'),
  fabric: hex('#bfe6e2'),
  fabricDark: hex('#a6d6d1'),
  fabricLight: hex('#d6f3ef'),
  partFrame: hex('#f4f1fb'),
  partFrameDark: hex('#c8bfe2'),
  table: hex('#fdf0e1'),
  tableGrain: hex('#f6e2cc'),
  tableSeam: hex('#e6cdb3'),
  tableShade: hex('#ece6fa'),
  cushion: hex('#ffc2d6'),
  cushionLight: hex('#ffdbe7'),
  cushionDark: hex('#f29fbd'),
  fridge: hex('#e4eefc'),
  fridgeTop: hex('#f4f8ff'),
  fridgeShade: hex('#c9d8f2'),
  counterTop: hex('#fbf9ff'),
  counterTopShade: hex('#e8e3f6'),
  counterFront: hex('#bfe9da'),
  counterFrontDark: hex('#a2dac6'),
  micro: hex('#ffd9e6'),
  microDark: hex('#f2b6cb'),
  microGlass: hex('#5d5a86'),
  rack: hex('#555b8f'),
  rackTop: hex('#7177aa'),
  rackDark: hex('#41467a'),
  rackSlot: hex('#3a3e6c'),
  ledGreen: hex('#7dffb4'),
  ledBlue: hex('#86dcff'),
  ledPink: hex('#ff9fd6'),
  ledAmber: hex('#ffd36e'),
  ledDim: hex('#6a70a3'),
  door: hex('#cfd6ee'),
  doorDark: hex('#b2bbdc'),
  doorLight: hex('#e6eaf8'),
  entrance: hex('#c8eedf'),
  entranceDark: hex('#a9dcc8'),
  entranceLight: hex('#e1f8ef'),
  gold: hex('#ffd36e'),
  goldDark: hex('#e6ad3c'),
  cabinet: hex('#ddd3f5'),
  cabinetTop: hex('#f1ecfd'),
  cabinetDark: hex('#c4b7ea'),
  pot: hex('#ffb8a4'),
  potDark: hex('#ec9580'),
  potLight: hex('#ffd6ca'),
  leaf: hex('#86dba6'),
  leafDark: hex('#56b884'),
  leafLight: hex('#bdf2cf'),
  flower: hex('#ff9fc8'),
  board: hex('#ffffff'),
  boardFrame: hex('#cfc7ea'),
  boardFrameDark: hex('#a99ed4'),
  markerPink: hex('#ff7fb0'),
  markerBlue: hex('#6fb6ff'),
  markerMint: hex('#4fcf9f'),
  monitorCase: hex('#e3def3'),
  monitorCaseDark: hex('#c3bbe0'),
  screen: hex('#bfe7ff'),
  screenLight: hex('#e6f7ff'),
  screenDark: hex('#8fc8f0'),
  bezel: hex('#5c587f'),
};

type Painter = (c: Canvas) => void;

/* ---------- helpers ---------- */

function fill(c: Canvas, x: number, y: number, w: number, h: number, col: RGBA): void {
  c.rect(x, y, w, h, col);
}

/** Filled rectangle with clipped corners (r = 1 or 2). */
function round(c: Canvas, x: number, y: number, w: number, h: number, col: RGBA, r = 1): void {
  for (let yy = 0; yy < h; yy++) {
    for (let xx = 0; xx < w; xx++) {
      const dx = Math.min(xx, w - 1 - xx);
      const dy = Math.min(yy, h - 1 - yy);
      if (r >= 1 && dx === 0 && dy === 0) continue;
      if (r >= 2 && dx + dy < 2) continue;
      c.plot(x + xx, y + yy, col);
    }
  }
}

/** Soft elliptical drop shadow. */
function shadow(c: Canvas, cx: number, cy: number, rx: number, ry: number): void {
  const s = new Canvas(S, S);
  s.ellipse(cx, cy, rx, ry, C.shadow);
  // only paint where nothing opaque is (shadow sits under the object)
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) if (s.alpha(x, y) && c.alpha(x, y) < 200) c.plot(x, y, s.get(x, y));
}

/** Draws `paint` on a scratch canvas, outlines it with ink, then composites. */
function outlined(c: Canvas, paint: (o: Canvas) => void, diagonal = false): void {
  const o = new Canvas(S, S);
  paint(o);
  o.outline(C.ink, { diagonal });
  c.blit(o, 0, 0);
}

function texture(c: Canvas, base: RGBA, dark: RGBA, light: RGBA, seed: number, density = 0.07): void {
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const n = tileNoise(x, y, seed);
      c.set(x, y, n < density ? dark : n > 1 - density * 0.7 ? light : base);
    }
  }
}

/* ---------- floors ---------- */

const floorCarpet: Painter = (c) => {
  texture(c, C.carpet, C.carpetDark, C.carpetLight, 11, 0.05);
  // a faint woven diagonal every 4px
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) if ((x + y) % 8 === 0 && tileNoise(x, y, 3) < 0.5) c.set(x, y, C.carpetDark);
};

const floorRunner: Painter = (c) => {
  texture(c, C.runner, C.runnerSpeck, C.runnerLight, 21, 0.04);
  // small diamonds on a 16px lattice, offset every other row -> seamless
  const diamond = (cx: number, cy: number): void => {
    c.set(cx, cy - 2, C.runnerDark);
    c.set(cx - 1, cy - 1, C.runnerDark);
    c.set(cx + 1, cy - 1, C.runnerDark);
    c.set(cx - 2, cy, C.runnerDark);
    c.set(cx + 2, cy, C.runnerDark);
    c.set(cx - 1, cy + 1, C.runnerDark);
    c.set(cx + 1, cy + 1, C.runnerDark);
    c.set(cx, cy + 2, C.runnerDark);
    c.set(cx, cy, C.runnerLight);
  };
  diamond(8, 8);
  diamond(24, 24);
  c.set(24, 8, C.runnerLight);
  c.set(8, 24, C.runnerLight);
};

const floorWood: Painter = (c) => {
  // 4 planks of 8px, joints staggered so the pattern wraps every 32px
  const joints = [5, 21, 13, 29];
  for (let p = 0; p < 4; p++) {
    const y0 = p * 8;
    for (let y = y0; y < y0 + 8; y++) {
      for (let x = 0; x < S; x++) {
        const plank = x < joints[p]! ? 0 : 1;
        const base = (p + plank) % 2 ? C.woodAlt : C.wood;
        let col = base;
        if (y === y0) col = C.woodLight;
        if (y === y0 + 7) col = C.woodSeam;
        else if (tileNoise(x >> 2, y, 40 + p) < 0.12 && y > y0 + 1) col = C.woodGrain;
        c.set(x, y, col);
      }
    }
    c.vline(joints[p]!, y0 + 1, y0 + 6, C.woodSeam);
    c.set(joints[p]! + 1, y0 + 1, C.woodLight);
  }
};

const floorTile: Painter = (c) => {
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const checker = (Math.floor(x / 16) + Math.floor(y / 16)) % 2;
      let col = checker ? C.tileB : C.tileA;
      if (x % 16 === 0 || y % 16 === 0) col = C.grout;
      else if ((x % 16 === 1 || y % 16 === 1) && !(x % 16 === 15 || y % 16 === 15)) col = lighten(col, 0.5);
      c.set(x, y, col);
    }
  }
  // tiny shine on each tile
  for (const [x, y] of [
    [3, 3],
    [19, 19],
  ] as const) {
    c.set(x, y, C.white);
    c.set(x + 1, y, C.white);
    c.set(x, y + 1, C.white);
  }
};

const floorMeeting: Painter = (c) => {
  texture(c, C.meeting, C.meetingDark, C.meetingLight, 31, 0.05);
  // soft dotted grid every 8px
  for (let y = 4; y < S; y += 8) for (let x = 4; x < S; x += 8) c.set(x, y, C.meetingDark);
};

const floorServer: Painter = (c) => {
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const lx = x % 16;
      const ly = y % 16;
      let col = C.server;
      if (lx === 15 || ly === 15) col = C.serverEdge;
      else if (lx === 0 || ly === 0) col = C.serverLight;
      else if (lx % 3 === 2 && ly % 3 === 2 && lx > 2 && ly > 2 && lx < 14 && ly < 14) col = C.serverHole;
      c.set(x, y, col);
    }
  }
};

/* ---------- walls & openings ---------- */

/**
 * Wall seen from above: soft lilac blocks (32x16, staggered) with a light top/left trim and a darker
 * bottom/right edge. Seamless in both directions, so vertical and horizontal wall runs both read well.
 */
function wallBase(c: Canvas): void {
  for (let y = 0; y < S; y++) {
    const course = y < 16 ? 0 : 1;
    const ly = y % 16;
    for (let x = 0; x < S; x++) {
      const lx = (x - course * 16 + S) % S;
      let col = tileNoise(x, y, 51) < 0.05 ? C.wallCapDark : C.wallCap;
      if (ly === 0 || ly === 1) col = C.wallTrim;
      else if (ly === 2) col = C.wallCapLight;
      else if (ly === 15) col = C.wallBase;
      else if (ly === 14) col = C.wallCapDark;
      if (lx === 0) col = ly === 0 || ly === 1 ? C.wallCapLight : C.wallBase;
      else if (lx === 1 && ly > 1 && ly < 14) col = C.wallCapLight;
      c.set(x, y, col);
    }
  }
}

const wall: Painter = (c) => wallBase(c);

function glass(c: Canvas, x0: number, y0: number, w: number, h: number): void {
  for (let y = y0; y < y0 + h; y++) {
    const t = (y - y0) / Math.max(1, h - 1);
    fill(c, x0, y, w, 1, mix(C.glassTop, C.glassBottom, t));
  }
}

const windowTile: Painter = (c) => {
  // frame
  fill(c, 0, 0, S, 32, C.frame);
  fill(c, 0, 0, S, 1, C.frameShade);
  glass(c, 2, 3, 28, 22);
  // little cloud reflection
  const cloud = (cx: number, cy: number): void => {
    c.hline(cx - 3, cx + 3, cy, C.cloud);
    c.hline(cx - 2, cx + 1, cy - 1, C.cloud);
    c.hline(cx - 1, cx, cy - 2, C.cloud);
  };
  cloud(10, 9);
  // diagonal streaks
  for (let i = 0; i < 9; i++) {
    c.plot(17 + i, 22 - i, C.glassStreak);
    c.plot(18 + i, 22 - i, C.glassStreak);
  }
  for (let i = 0; i < 5; i++) c.plot(24 + i, 22 - i, C.glassStreak);
  // inner frame shading
  fill(c, 2, 3, 28, 1, C.frameShade);
  c.vline(2, 3, 24, withAlpha(C.frameShade, 160));
  // mullions at the tile edges (half on each side -> 4px when repeated)
  c.vline(0, 1, 26, C.frameShade);
  c.vline(31, 1, 26, C.frameShade);
  // sill
  fill(c, 0, 25, S, 1, C.frameShade);
  fill(c, 0, 26, S, 2, C.white);
  fill(c, 0, 28, S, 2, C.wallBaseLight);
  fill(c, 0, 30, S, 2, C.wallBase);
};

const doorGlass: Painter = (c) => {
  fill(c, 0, 0, S, 32, C.frame);
  fill(c, 0, 0, S, 1, C.frameShade);
  glass(c, 3, 3, 26, 27);
  // streaks
  for (let i = 0; i < 10; i++) {
    c.plot(8 + i, 20 - i, C.glassStreak);
    c.plot(9 + i, 20 - i, C.glassStreak);
  }
  // frame shading + edges
  c.vline(0, 1, 31, C.frameShade);
  c.vline(31, 1, 31, C.frameShade);
  fill(c, 3, 3, 26, 1, C.frameShade);
  // push bar
  fill(c, 6, 16, 20, 2, C.white);
  fill(c, 6, 18, 20, 1, C.frameShade);
  c.set(5, 16, C.frameShade);
  c.set(26, 16, C.frameShade);
  // threshold
  fill(c, 0, 30, S, 2, C.frameShade);
  // sparkle on the glass
  c.set(22, 7, C.white);
  c.set(21, 8, C.white);
  c.set(23, 8, C.white);
  c.set(22, 9, C.white);
};

const doorEntrance: Painter = (c) => {
  wallBase(c);
  // frame
  fill(c, 2, 4, 28, 28, C.frame);
  fill(c, 2, 4, 28, 1, C.frameShade);
  // door leaf
  fill(c, 4, 6, 24, 26, C.entrance);
  fill(c, 4, 6, 24, 1, C.entranceLight);
  c.vline(4, 6, 31, C.entranceLight);
  c.vline(27, 6, 31, C.entranceDark);
  // round window
  const w = new Canvas(S, S);
  w.ellipse(16, 13, 5, 4.5, C.glassTop);
  w.ellipse(16, 13.5, 3.5, 3, C.glassBottom);
  w.outline(C.entranceDark);
  c.blit(w, 0, 0);
  c.set(14, 11, C.white);
  c.set(15, 11, C.white);
  // panel insets
  round(c, 7, 21, 18, 9, C.entranceDark);
  round(c, 8, 22, 16, 7, C.entrance);
  // push bar (symmetric so a pair reads as double doors)
  fill(c, 8, 19, 16, 1, C.gold);
  fill(c, 8, 20, 16, 1, C.goldDark);
  c.vline(1, 4, 31, C.frameShade);
  c.vline(30, 4, 31, C.frameShade);
};

const railing: Painter = (c) => {
  outlined(c, (o) => {
    // balusters
    for (const x of [3, 11, 19, 27]) {
      fill(o, x, 12, 2, 14, C.frame);
      o.set(x + 1, 13, C.frameShade);
      o.vline(x + 1, 14, 25, C.frameShade);
    }
    // bottom rail and hand rail run across the whole tile
    fill(o, 0, 25, S, 2, C.frameShade);
    fill(o, 0, 8, S, 4, C.frame);
    fill(o, 0, 8, S, 1, C.white);
    fill(o, 0, 11, S, 1, C.frameShade);
  });
  // glass panel hint between balusters
  for (let y = 12; y < 24; y++)
    for (let x = 0; x < S; x++) if (c.alpha(x, y) === 0) c.plot(x, y, hex('#dff4ff', 70));
  // shadow on the deck
  fill(c, 0, 28, S, 2, C.shadowSoft);
};

/* ---------- desks ---------- */

function deskPiece(c: Canvas, left: boolean, right: boolean): void {
  outlined(c, (o) => {
    const x0 = left ? 1 : 0;
    const x1 = right ? 30 : 31;
    const w = x1 - x0 + 1;
    fill(o, x0, 1, w, 21, C.deskTop);
    fill(o, x0, 1, w, 1, C.deskTopLight);
    fill(o, x0, 22, w, 6, C.deskFront);
    fill(o, x0, 27, w, 1, C.deskFrontDark);
    // subtle grain
    for (let x = x0; x <= x1; x++) {
      if (tileNoise(x, 0, 7) < 0.25) o.set(x, 8, C.deskGrain);
      if (tileNoise(x, 1, 7) < 0.2) o.set(x, 15, C.deskGrain);
    }
    // front panel lip highlight
    fill(o, x0, 22, w, 1, C.deskFrontDark);
    // rounded outer corners
    if (left) {
      o.set(x0, 1, [0, 0, 0, 0]);
      o.set(x0, 27, [0, 0, 0, 0]);
      o.vline(x0, 2, 21, C.deskTopLight);
    }
    if (right) {
      o.set(x1, 1, [0, 0, 0, 0]);
      o.set(x1, 27, [0, 0, 0, 0]);
    }
    // drawer handles on the end pieces
    if (left) fill(o, x0 + 4, 24, 5, 1, C.deskFrontDark);
    if (right) fill(o, x1 - 8, 24, 5, 1, C.deskFrontDark);
  });
  fill(c, left ? 1 : 0, 29, (right ? 30 : 31) - (left ? 1 : 0) + 1, 2, C.shadowSoft);
}

const deskBlock: Painter = (c) => {
  // executive wood desk module (the CEO desk is a 2x2 block of this tile): top edge + front face
  // like the other desks, soft wood joints on the sides so neighbouring modules merge into one desk
  for (let y = 1; y < 24; y++) {
    for (let x = 0; x < S; x++) {
      let col = C.ceoTop;
      const n = tileNoise(x >> 3, y, 77);
      if (y % 8 === 3 && tileNoise(x >> 2, y, 78) < 0.5) col = C.ceoGrain;
      else if (n < 0.1) col = C.ceoGrain;
      else if (n > 0.94) col = C.ceoLight;
      c.set(x, y, col);
    }
  }
  fill(c, 0, 0, S, 1, C.ink);
  fill(c, 0, 1, S, 1, C.ceoLight);
  fill(c, 0, 24, S, 5, C.ceoFront);
  fill(c, 0, 24, S, 1, C.ceoSeam);
  fill(c, 0, 28, S, 1, C.ceoSeam);
  fill(c, 0, 29, S, 1, C.ink);
  fill(c, 0, 30, S, 2, C.shadowSoft);
  // drawer pulls on the front face
  fill(c, 6, 26, 5, 1, C.goldDark);
  fill(c, 21, 26, 5, 1, C.goldDark);
};

/* ---------- chairs ---------- */

function chairBase(o: Canvas, cx: number, y: number): void {
  // star base + casters
  o.hline(cx - 5, cx + 4, y, C.metal);
  o.vline(cx - 1, y - 2, y + 1, C.metalDark);
  o.vline(cx, y - 2, y + 1, C.metal);
  o.set(cx - 6, y + 1, C.metalDark);
  o.set(cx + 5, y + 1, C.metalDark);
}

const chairDown: Painter = (c) => {
  shadow(c, 16, 27, 9, 3);
  outlined(c, (o) => {
    chairBase(o, 16, 27);
    // seat (front, towards camera)
    round(o, 8, 15, 16, 10, C.seat, 2);
    fill(o, 9, 16, 14, 1, C.seatLight);
    fill(o, 9, 23, 14, 1, C.seatDark);
    // backrest at the top
    round(o, 9, 3, 14, 12, C.seatDark, 2);
    round(o, 10, 4, 12, 9, C.seat, 2);
    fill(o, 11, 5, 9, 1, C.seatLight);
  });
};

const chairUp: Painter = (c) => {
  shadow(c, 16, 27, 9, 3);
  outlined(c, (o) => {
    chairBase(o, 16, 28);
    // seat (away from camera, at the top)
    round(o, 8, 5, 16, 11, C.seat, 2);
    fill(o, 9, 6, 14, 1, C.seatLight);
    // backrest in front (towards camera)
    round(o, 9, 13, 14, 13, C.seatDark, 2);
    round(o, 10, 14, 12, 10, C.seat, 2);
    fill(o, 11, 15, 10, 1, C.seatLight);
    o.hline(12, 19, 25, C.seatDark);
  });
};

function chairSide(c: Canvas): void {
  // facing left: seat on the left, backrest on the right
  shadow(c, 16, 27, 9, 3);
  outlined(c, (o) => {
    chairBase(o, 15, 27);
    round(o, 6, 13, 17, 11, C.seat, 2);
    fill(o, 7, 14, 15, 1, C.seatLight);
    fill(o, 7, 22, 15, 1, C.seatDark);
    // backrest seen from the side: tall and narrow
    round(o, 20, 3, 6, 20, C.seatDark, 2);
    round(o, 21, 4, 4, 17, C.seat, 1);
    o.vline(21, 5, 18, C.seatLight);
  });
}

const chairLeft: Painter = (c) => chairSide(c);
const chairRight: Painter = (c) => {
  const t = new Canvas(S, S);
  chairSide(t);
  c.blit(t.flipX(), 0, 0);
};

/* ---------- partitions ---------- */

function fabricFill(o: Canvas, x: number, y: number, w: number, h: number, seed: number): void {
  for (let yy = y; yy < y + h; yy++)
    for (let xx = x; xx < x + w; xx++) {
      const n = tileNoise(xx, yy, seed);
      o.set(xx, yy, n < 0.12 ? C.fabricDark : n > 0.93 ? C.fabricLight : C.fabric);
    }
}

function partitionV(o: Canvas, y0: number, y1: number): void {
  // seen from above: a narrow cap with fabric sides
  fabricFill(o, 12, y0, 8, y1 - y0 + 1, 61);
  o.vline(12, y0, y1, C.partFrame);
  o.vline(13, y0, y1, C.partFrame);
  o.vline(19, y0, y1, C.partFrameDark);
}

function partitionH(o: Canvas, x0: number, x1: number): void {
  const w = x1 - x0 + 1;
  fill(o, x0, 9, w, 3, C.partFrame);
  fill(o, x0, 9, w, 1, C.white);
  fabricFill(o, x0, 12, w, 13, 62);
  fill(o, x0, 12, w, 1, C.fabricDark);
  fill(o, x0, 25, w, 2, C.partFrameDark);
}

const partitionVTile: Painter = (c) => {
  outlined(c, (o) => partitionV(o, 0, 31));
  // shadow to the right
  for (let y = 0; y < S; y++) {
    c.plot(21, y, C.shadowSoft);
    c.plot(22, y, C.shadowSoft);
  }
};

const partitionHTile: Painter = (c) => {
  outlined(c, (o) => partitionH(o, 0, 31));
  fill(c, 0, 28, S, 2, C.shadowSoft);
};

const partitionCorner: Painter = (c) => {
  // connects upwards (to partition_v) and to the right (to partition_h)
  outlined(c, (o) => {
    partitionV(o, 0, 11);
    partitionH(o, 12, 31);
    // corner post
    fill(o, 12, 8, 8, 4, C.partFrame);
    fill(o, 12, 8, 8, 1, C.white);
    o.vline(19, 9, 11, C.partFrameDark);
  });
  fill(c, 12, 28, 20, 2, C.shadowSoft);
};

/* ---------- meeting ---------- */

const meetingTable: Painter = (c) => {
  // cream table top modules: a 4x2 block reads as one long table with soft joints
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const n = tileNoise(x >> 3, y, 87);
      c.set(x, y, n < 0.1 ? C.tableGrain : C.table);
    }
  }
  fill(c, 0, 0, S, 1, C.white);
  c.vline(0, 0, 31, C.white);
  fill(c, 0, 31, S, 1, C.tableSeam);
  c.vline(31, 0, 31, C.tableSeam);
  for (let i = 0; i < 10; i++) c.plot(4 + i, 14 - i, hex('#ffffff', 220));
  for (let i = 0; i < 6; i++) c.plot(8 + i, 15 - i, hex('#ffffff', 180));
};

const meetingChair: Painter = (c) => {
  shadow(c, 16, 25, 10, 4);
  outlined(c, (o) => {
    o.ellipse(16, 16, 10, 9, C.cushionDark);
    o.ellipse(16, 15, 9, 7.5, C.cushion);
    o.ellipse(14, 13, 4.5, 3, C.cushionLight);
    // button tuft
    o.set(16, 15, C.cushionDark);
  });
};

/* ---------- pantry ---------- */

const fridge: Painter = (c) => {
  outlined(c, (o) => {
    round(o, 5, 0, 22, 6, C.fridgeTop, 1);
    fill(o, 5, 5, 22, 25, C.fridge);
    o.vline(26, 5, 29, C.fridgeShade);
    o.vline(5, 5, 29, C.fridgeTop);
    fill(o, 5, 5, 22, 1, C.fridgeShade);
    // freezer split
    fill(o, 5, 13, 22, 1, C.fridgeShade);
    // handles
    fill(o, 8, 8, 2, 4, C.metal);
    fill(o, 8, 15, 2, 8, C.metal);
    o.set(8, 8, C.white);
    o.set(8, 15, C.white);
  });
  // heart magnet + note
  c.set(19, 17, C.cushionDark);
  c.set(21, 17, C.cushionDark);
  c.hline(18, 22, 18, C.cushionDark);
  c.hline(19, 21, 19, C.cushionDark);
  c.set(20, 20, C.cushionDark);
  fill(c, 17, 22, 6, 4, hex('#fff6b0'));
  c.hline(18, 21, 23, C.markerBlue);
  fill(c, 6, 30, 20, 2, C.shadowSoft);
};

function counterBody(o: Canvas): void {
  fill(o, 0, 8, S, 6, C.counterTop);
  fill(o, 0, 8, S, 1, C.white);
  fill(o, 0, 13, S, 1, C.counterTopShade);
  fill(o, 0, 14, S, 15, C.counterFront);
  fill(o, 0, 14, S, 1, C.counterFrontDark);
  // cabinet doors with seams at 0/16 (seamless when repeated)
  for (const x of [0, 16]) {
    o.vline(x, 15, 28, C.counterFrontDark);
    o.vline(x + 1, 15, 28, lighten(C.counterFront, 0.35));
  }
  fill(o, 6, 18, 1, 4, C.goldDark);
  fill(o, 25, 18, 1, 4, C.goldDark);
  fill(o, 0, 28, S, 1, C.counterFrontDark);
}

const counter: Painter = (c) => {
  outlined(c, (o) => counterBody(o));
  fill(c, 0, 30, S, 2, C.shadowSoft);
};

const microwave: Painter = (c) => {
  outlined(c, (o) => counterBody(o));
  outlined(c, (o) => {
    round(o, 5, 0, 22, 12, C.micro, 1);
    fill(o, 6, 1, 20, 1, C.white);
    // window
    round(o, 7, 3, 12, 7, C.microGlass, 1);
    fill(o, 8, 4, 4, 1, hex('#8f8bc0'));
    // panel buttons
    o.set(22, 3, C.ledGreen);
    o.set(22, 5, C.microDark);
    o.set(24, 5, C.microDark);
    o.set(22, 7, C.microDark);
    o.set(24, 7, C.microDark);
    fill(o, 5, 11, 22, 1, C.microDark);
  });
  fill(c, 0, 30, S, 2, C.shadowSoft);
};

/* ---------- server room ---------- */

const serverRack: Painter = (c) => {
  outlined(c, (o) => {
    fill(o, 4, 0, 24, 5, C.rackTop);
    fill(o, 4, 0, 24, 1, lighten(C.rackTop, 0.3));
    fill(o, 4, 5, 24, 25, C.rack);
    o.vline(27, 5, 29, C.rackDark);
    for (let i = 0; i < 6; i++) {
      const y = 7 + i * 4;
      fill(o, 6, y, 20, 3, C.rackSlot);
      fill(o, 6, y, 20, 1, C.rackDark);
      // LEDs: a deterministic "blinking" mix of bright and dim lights
      const leds = [C.ledGreen, C.ledBlue, C.ledPink, C.ledAmber];
      for (let k = 0; k < 4; k++) {
        const on = tileNoise(k, i, 91) < 0.6;
        o.set(8 + k * 2, y + 1, on ? leds[(i + k) % 4]! : C.ledDim);
      }
      fill(o, 18, y + 1, 6, 1, C.rackDark);
    }
  });
  // glow around a few LEDs
  c.plot(8, 8, hex('#7dffb4', 90));
  fill(c, 5, 30, 22, 2, C.shadowSoft);
};

const serverDoor: Painter = (c) => {
  wallBase(c);
  fill(c, 4, 3, 24, 29, C.frame);
  fill(c, 6, 5, 20, 27, C.door);
  fill(c, 6, 5, 20, 1, C.doorLight);
  c.vline(6, 5, 31, C.doorLight);
  c.vline(25, 5, 31, C.doorDark);
  // small window
  round(c, 10, 8, 12, 6, C.doorDark, 1);
  glass(c, 11, 9, 10, 4);
  // handle + keypad with a red lock light
  fill(c, 20, 18, 3, 2, C.metal);
  fill(c, 9, 17, 4, 5, C.bezel);
  c.set(10, 18, hex('#ff6f8e'));
  c.set(11, 18, C.ledDim);
  c.hline(10, 11, 20, C.ledDim);
  // hazard-free cute sign: tiny server icon
  fill(c, 13, 24, 6, 4, C.rack);
  c.set(14, 25, C.ledGreen);
  c.set(14, 26, C.ledBlue);
};

/* ---------- misc furniture ---------- */

const cabinet: Painter = (c) => {
  outlined(c, (o) => {
    fill(o, 1, 3, 30, 6, C.cabinetTop);
    fill(o, 1, 3, 30, 1, C.white);
    fill(o, 1, 9, 30, 20, C.cabinet);
    fill(o, 1, 9, 30, 1, C.cabinetDark);
    // two doors
    o.vline(16, 10, 28, C.cabinetDark);
    o.vline(17, 10, 28, lighten(C.cabinet, 0.4));
    fill(o, 13, 16, 1, 5, C.goldDark);
    fill(o, 19, 16, 1, 5, C.goldDark);
    fill(o, 1, 28, 30, 1, C.cabinetDark);
  });
  // a little book + plant on top
  fill(c, 5, 1, 3, 5, C.markerBlue);
  fill(c, 8, 2, 2, 4, C.flower);
  c.set(24, 4, C.leafDark);
  c.set(25, 3, C.leaf);
  c.set(23, 3, C.leaf);
  fill(c, 1, 30, 30, 2, C.shadowSoft);
};

const plant: Painter = (c) => {
  shadow(c, 16, 29, 8, 2.5);
  outlined(c, (o) => {
    // pot
    fill(o, 10, 20, 12, 8, C.pot);
    fill(o, 9, 19, 14, 3, C.potLight);
    fill(o, 9, 21, 14, 1, C.potDark);
    o.vline(21, 22, 27, C.potDark);
    o.hline(11, 20, 28, C.potDark);
    // bushy leaves
    o.ellipse(16, 12, 9, 8, C.leafDark);
    o.ellipse(15, 11, 8, 6.5, C.leaf);
    o.ellipse(11, 15, 4, 3, C.leaf);
    o.ellipse(21, 15, 4, 3, C.leafDark);
    o.ellipse(13, 8, 3, 2, C.leafLight);
    o.ellipse(19, 10, 2, 1.5, C.leafLight);
  });
  // flowers
  for (const [x, y] of [
    [19, 6],
    [10, 11],
  ] as const) {
    c.set(x, y - 1, C.flower);
    c.set(x - 1, y, C.flower);
    c.set(x + 1, y, C.flower);
    c.set(x, y + 1, C.flower);
    c.set(x, y, C.gold);
  }
  // pot heart
  c.set(15, 24, C.potLight);
  c.set(17, 24, C.potLight);
  c.hline(15, 17, 25, C.potLight);
  c.set(16, 26, C.potLight);
};

const whiteboard: Painter = (c) => {
  shadow(c, 16, 30, 11, 2);
  outlined(c, (o) => {
    // legs
    o.vline(6, 22, 30, C.boardFrameDark);
    o.vline(25, 22, 30, C.boardFrameDark);
    o.hline(4, 8, 30, C.boardFrameDark);
    o.hline(23, 27, 30, C.boardFrameDark);
    // board
    fill(o, 2, 2, 28, 20, C.boardFrame);
    fill(o, 3, 3, 26, 17, C.board);
    fill(o, 3, 20, 26, 2, C.boardFrameDark);
  });
  // scribbles: a tiny chart, a heart and lines
  c.hline(5, 14, 6, C.markerBlue);
  c.hline(5, 11, 8, C.markerBlue);
  c.hline(5, 13, 10, C.markerPink);
  fill(c, 18, 13, 2, 5, C.markerMint);
  fill(c, 21, 10, 2, 8, C.markerPink);
  fill(c, 24, 7, 2, 11, C.markerBlue);
  c.set(7, 14, C.markerPink);
  c.set(9, 14, C.markerPink);
  c.hline(6, 10, 15, C.markerPink);
  c.hline(7, 9, 16, C.markerPink);
  c.set(8, 17, C.markerPink);
  // markers on the tray
  fill(c, 6, 20, 3, 1, C.markerPink);
  fill(c, 10, 20, 3, 1, C.markerBlue);
};

/* ---------- monitors (furniture-top layer, drawn on desk tiles) ---------- */

function monitorStand(o: Canvas, cx: number, y: number): void {
  fill(o, cx - 1, y, 2, 3, C.monitorCaseDark);
  round(o, cx - 5, y + 3, 10, 2, C.monitorCase, 1);
}

const monitorBack: Painter = (c) => {
  // person sits north of the desk: we see the back of the screen near the desk's south edge
  outlined(c, (o) => {
    monitorStand(o, 16, 19);
    round(o, 5, 8, 22, 12, C.monitorCase, 2);
    fill(o, 6, 9, 20, 1, C.white);
    fill(o, 5, 18, 22, 1, C.monitorCaseDark);
    // little heart logo
    o.set(15, 13, C.cushionDark);
    o.set(17, 13, C.cushionDark);
    o.hline(15, 17, 14, C.cushionDark);
    o.set(16, 15, C.cushionDark);
  });
};

const monitorFront: Painter = (c) => {
  // person sits south of the desk: the screen faces the camera
  outlined(c, (o) => {
    monitorStand(o, 16, 13);
    round(o, 5, 1, 22, 13, C.bezel, 2);
    fill(o, 6, 2, 20, 10, C.screen);
    // pastel UI: title bar, text lines, a sparkle
    fill(o, 6, 2, 20, 2, C.screenDark);
    o.set(7, 2, C.ledPink);
    o.set(9, 2, C.ledAmber);
    o.set(11, 2, C.ledGreen);
    o.hline(8, 17, 6, C.screenLight);
    o.hline(8, 14, 8, C.screenLight);
    o.hline(8, 19, 10, C.screenLight);
    fill(o, 20, 6, 4, 4, C.cushion);
    o.set(16, 13, C.ledGreen);
  });
};

const monitorSide: Painter = (c) => {
  // monitor turned sideways (seat to the right): the screen is seen in perspective
  outlined(c, (o) => {
    round(o, 9, 22, 12, 3, C.monitorCase, 1);
    fill(o, 13, 15, 3, 7, C.monitorCaseDark);
    for (let x = 10; x <= 20; x++) {
      const t = (x - 10) / 10;
      const top = Math.round(6 - t * 4);
      const bottom = Math.round(16 + t * 2);
      o.vline(x, top, bottom, x <= 11 ? C.monitorCaseDark : x === 12 || x === 20 ? C.bezel : C.screen);
    }
    // a few lines of pastel UI on the screen
    o.line(14, 7, 18, 5, C.screenLight);
    o.line(14, 10, 18, 9, C.screenLight);
    o.line(14, 13, 17, 13, C.cushion);
  });
};

/* ---------- registry ---------- */

export const TILE_PAINTERS: Record<TileName, Painter> = {
  void: () => undefined,
  floor_carpet: floorCarpet,
  floor_runner: floorRunner,
  floor_wood: floorWood,
  floor_tile: floorTile,
  floor_meeting: floorMeeting,
  floor_server: floorServer,
  wall,
  window: windowTile,
  door_glass: doorGlass,
  door_entrance: doorEntrance,
  railing,
  desk_left: (c) => deskPiece(c, true, false),
  desk_mid: (c) => deskPiece(c, false, false),
  desk_right: (c) => deskPiece(c, false, true),
  desk_block: deskBlock,
  chair_up: chairUp,
  chair_down: chairDown,
  chair_left: chairLeft,
  chair_right: chairRight,
  partition_v: partitionVTile,
  partition_h: partitionHTile,
  partition_corner: partitionCorner,
  meeting_table: meetingTable,
  meeting_chair: meetingChair,
  fridge,
  microwave,
  counter,
  server_rack: serverRack,
  server_door: serverDoor,
  cabinet,
  plant,
  whiteboard,
  monitor_back: monitorBack,
  monitor_front: monitorFront,
  monitor_side: monitorSide,
};

/** Paints one 32x32 tile. */
export function paintTile(name: TileName): Canvas {
  const c = new Canvas(S, S);
  TILE_PAINTERS[name](c);
  return c;
}
