import type { PetSpecies } from '@enu/shared';
import { type RGBA, hex } from '../draw/color';
import type { Template } from '../draw/template';

/**
 * Pet templates, facing left, 3/4 view (both eyes visible, face shifted towards the facing side).
 * Shared keys: b base, B shade, l light, c cream (muzzle/belly), p pink, k blush, w eye shine,
 * e eye (top row), E eye (bottom row — stays as the closed-eye line when sleeping), n nose/mouth ink,
 * y yellow/orange (beak, horns, feet), d dark accent.
 * `wingAt` is the wing root (x, y) relative to the template's top-left; `tailRow` is the row where
 * squash/stretch happens.
 */
export interface PetArt {
  body: Template;
  colors: Record<string, RGBA>;
  wingAt: readonly [number, number];
  /** Row used for squash/stretch (inside the body, below the face). */
  bendRow: number;
}

const BLUSH = hex('#ff8fb1', 170);
const WHITE = hex('#ffffff');
const INK = hex('#3b2a52');

const common = { k: BLUSH, w: WHITE, e: INK, E: INK, n: INK };

export const PET_ART: Record<PetSpecies, PetArt> = {
  cat: {
    body: [
      '..b......b......',
      '.bpb....bpb.....',
      '.bppbbbbbpb.....',
      'bbbbbbBbbbbb....',
      'bbbbbBbBbbbb....',
      'bbbbbbbbbbbbb...',
      'bwebbbbwebbbb...',
      'bEEbbbbEEbbbb..b',
      'kbbccpccbkbbb.bb',
      '.bbbcncbbbbbb.b.',
      '..bbbbbbbbbbbbb.',
      '..bccbbbbbbbbb..',
      '..bccbbbbbbbBb..',
      '..cc.cc..bb.bb..',
    ],
    colors: {
      ...common,
      b: hex('#c9c4ee'),
      B: hex('#a39cdb'),
      l: hex('#e6e3fb'),
      c: hex('#fffaff'),
      p: hex('#ffadc8'),
    },
    wingAt: [11, 5],
    bendRow: 10,
  },
  bunny: {
    body: [
      '..bb..bb........',
      '.bpb..bpb.......',
      '.bpb..bpb.......',
      '.bpb..bpb.......',
      '.bbb.bbb........',
      'bbbbbbbbbbb.....',
      'bbbbbbbbbbbb....',
      'bwebbbwebbbb....',
      'bEEbbbEEbbbb....',
      'kbbbnbbbkbbbb.cc',
      '.bbbbbbbbbbbbbcc',
      '..bbbbbbbbbbbb..',
      '..bbbbbbbbbbBb..',
      '..bb.bb..bb.bb..',
    ],
    colors: {
      ...common,
      b: hex('#fff7fc'),
      B: hex('#efd3e6'),
      c: hex('#ffffff'),
      p: hex('#ffb3d0'),
    },
    wingAt: [10, 7],
    bendRow: 11,
  },
  fox: {
    body: [
      '.d.....d.........',
      '.bd...db.........',
      '.bpb.bpbb........',
      'bbbbbbbbbb.......',
      'bbbbbbbbbbb...bb.',
      'bwebbbwebbb..bbbb',
      'bEEbbbEEbbb.bbbbb',
      'cccbcccbbbbbbbbbc',
      '.cccncccbbbbbbbcc',
      '..ccccccbbbbbbcc.',
      '...bccccbbbbbcc..',
      '...bccbbbbbbb....',
      '...dd.dd.dd.dd...',
    ],
    colors: {
      ...common,
      b: hex('#ffa65e'),
      B: hex('#e8823f'),
      c: hex('#fff6ea'),
      d: hex('#8a4f5e'),
      p: hex('#ffc2c8'),
    },
    wingAt: [10, 4],
    bendRow: 10,
  },
  chick: {
    body: [
      '.....bb.........',
      '....b.b.........',
      '...bbbbbbb......',
      '..bbbbbbbbbb....',
      '.blwebbwebbbb...',
      '.bbEEbbEEbbbb...',
      'yyykbbbbkbbbbb..',
      '.yybbbbbbbbbbbb.',
      '.bbbbbbbbBBbbbb.',
      '..bbbbbbbBBbbb..',
      '...bbbbbbbbbb...',
      '....yy....yy....',
    ],
    colors: {
      ...common,
      b: hex('#ffe46f'),
      B: hex('#f2bf3a'),
      l: hex('#fff6bd'),
      y: hex('#ff9f45'),
    },
    wingAt: [11, 4],
    bendRow: 8,
  },
  hamster: {
    body: [
      '..p.......p.....',
      '.bbbbbbbbbbbb...',
      'bbbbbbbbbbbbbb..',
      'bbwebbbbbwebbbb.',
      'bcEEcccccEEcbbbb',
      'cckcccnccckcbbbb',
      'ccccccccccccbbbB',
      '.ccccpsSspcccbbB',
      '.ccccccccccccbB.',
      '..ccccccccccbB..',
      '...pp.....pp....',
    ],
    colors: {
      ...common,
      b: hex('#f7bf86'),
      B: hex('#e0a06a'),
      c: hex('#fff8ee'),
      p: hex('#ffb1bd'),
      s: hex('#6e5a72'),
      S: hex('#efe6dc'),
    },
    wingAt: [12, 3],
    bendRow: 7,
  },
  dragon: {
    body: [
      '....y...y.......',
      '...yy..yy.......',
      '...bbbbbbbbp....',
      '..bbbbbbbbbb....',
      '.bbwebbbwebbp...',
      'llbEEbbbEEbbb...',
      'lnlkbbbbbkbbbp..',
      '.llllbbbbbbbbb..',
      '..bbbbbbbbbbbbp.',
      '..bcccbbbbbbbbb.',
      '..bCCCbbbbbbb.bp',
      '..bcccbbbbbbbbpp',
      '..bb.bb..bb.....',
    ],
    colors: {
      ...common,
      b: hex('#8fe3c4'),
      B: hex('#5fc3a2'),
      l: hex('#c4f5e2'),
      c: hex('#fff2c6'),
      C: hex('#f3d98f'),
      y: hex('#ffcf5e'),
      p: hex('#ff9fd2'),
    },
    wingAt: [11, 4],
    bendRow: 9,
  },
};
