import { Canvas } from './draw/canvas';
import { type RGBA, hex } from './draw/color';
import { type Template, stamp } from './draw/template';
import { INK } from './palette';
import {
  EFFECT_COLUMNS,
  EFFECT_FRAME,
  EFFECT_FRAMES,
  EFFECT_SHEET_HEIGHT,
  EFFECT_SHEET_WIDTH,
  type EffectName,
} from './spec';

/**
 * 16x16 effect icons. Keys: o ink outline, w white, y gold, Y gold shade, p pink, P pink shade,
 * b blue, B blue shade, l lilac, L lilac shade, m mint, M mint shade, r red/coral.
 */
const K = {
  o: INK,
  w: hex('#ffffff'),
  y: hex('#ffe170'),
  Y: hex('#f2b53c'),
  p: hex('#ff8fbf'),
  P: hex('#e8609b'),
  q: hex('#ffc7de'),
  b: hex('#9fdcff'),
  B: hex('#5aa8e6'),
  l: hex('#cbb8ff'),
  L: hex('#9a82e6'),
  m: hex('#8be8c0'),
  M: hex('#43c08f'),
  r: hex('#ff8a80'),
  g: hex('#ece8f7'),
  G: hex('#c9c1e2'),
} satisfies Record<string, RGBA>;

const SPARKLES: Template[] = [
  [
    '................',
    '................',
    '................',
    '................',
    '................',
    '.......y........',
    '......ywy.......',
    '.......y........',
    '................',
    '................',
  ],
  [
    '................',
    '................',
    '................',
    '.......y........',
    '.......y........',
    '......yyy.......',
    '...yyyywyyyy....',
    '......yyy.......',
    '.......y........',
    '.......y........',
  ],
  [
    '.......y........',
    '.......y........',
    '.......y........',
    '......yyy.......',
    '......ywy.......',
    '.....ywwwy......',
    'yyyyywwwwwyyyyy.',
    '.....ywwwy......',
    '......ywy.......',
    '......yyy.......',
    '.......y........',
    '.......y........',
    '.......y........',
  ],
  [
    '................',
    '................',
    '................',
    '....q..y..q.....',
    '.....q.y.q......',
    '......yyy.......',
    '...yyyywyyyy....',
    '......yyy.......',
    '.....q.y.q......',
    '....q..y..q.....',
  ],
];

const STAR: Template = [
  '................',
  '.......oo.......',
  '......oyyo......',
  '......oyyo......',
  '.....oywyyo.....',
  '.ooooywyyyyoooo.',
  'oyyyyyyyyyyyyyYo',
  '.oyyyyyyyyyyyYo.',
  '..oyyyyyyyyyYo..',
  '...oyyyyyyyYo...',
  '...oyyyyyyyYo...',
  '..oyyyyooyyyYo..',
  '..oyyYo..oyyYo..',
  '.oyYoo....ooYYo.',
  '.ooo........ooo.',
  '................',
];

const HEART: Template = [
  '................',
  '................',
  '..ooo....ooo....',
  '.oqqpo..oppPo...',
  'oqwqppooppppPo..',
  'oqwpppppppppPo..',
  'oqppppppppppPo..',
  'oppppppppppPPo..',
  '.oppppppppPPo...',
  '..oppppppPPo....',
  '...opppPPPo.....',
  '....opPPPo......',
  '.....oPPo.......',
  '......oo........',
  '................',
  '................',
];

/* zzz: lilac letters with an ink drop shadow (an outline would fill the small Zs in). */
const ZZZ: Template = [
  '............LLL.',
  '..............L.',
  '.............L..',
  '............LLL.',
  '.......LLLLL....',
  '..........LL....',
  '.........LL.....',
  '........LL......',
  '.......LLLLL....',
  '.LLLLLL.........',
  '.....LL.........',
  '....LL..........',
  '...LL...........',
  '..LL............',
  '.LLLLLL.........',
];

const CLOCK: Template = [
  '................',
  '.....oooooo.....',
  '...oogggggGoo...',
  '..ogggggogggGo..',
  '.oggggggogggggo.',
  '.oggggggoggggGo.',
  'oggggggoogggggGo',
  'oggggggooooggGGo',
  'oggggggggggggGGo',
  'oggggggggggggGGo',
  '.ogggggggggggGo.',
  '.oGgggggggggGGo.',
  '..oGGgggggGGGo..',
  '...ooGGGGGGoo...',
  '.....oooooo.....',
  '................',
];

/* dots: fill-only, outlined automatically (2px dots + 3px gaps keep them apart). */
const DOTS: Template = [
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '..wl...wp...wb..',
  '..lL...pP...bB..',
  '................',
];

const ALARM: Template = [
  '................',
  '.oo........oo...',
  'oppo..oo..oppo..',
  'oPpoooyyooopPo..',
  '.ooywwwwwwyoo...',
  '..oywwowwwwYo...',
  '.oywwwowwwwwYo..',
  '.oywwwowwwwwYo..',
  '.oywwwoooowwYo..',
  '.oywwwwwwwwwYo..',
  '..oywwwwwwwYo...',
  '...oYYwwwYYo....',
  '..oo.ooooo.oo...',
  '.oo.........oo..',
  '................',
  '................',
];

const EXCLAIM: Template = [
  '................',
  '......oooo......',
  '.....oppppo.....',
  '.....opwppo.....',
  '.....opwppo.....',
  '.....oppppo.....',
  '.....oppPpo.....',
  '......oppo......',
  '......oPPo......',
  '.......oo.......',
  '......oooo......',
  '.....oppppo.....',
  '.....opPPPo.....',
  '......oooo......',
  '................',
  '................',
];

const CHECK: Template = [
  '................',
  '.....oooooo.....',
  '...oommmmmmoo...',
  '..ommmmmmmmmMo..',
  '.ommmmmmmmmowMo.',
  '.ommmmmmmmowwMo.',
  'ommmmmmmmowwoMMo',
  'ommowommowwommMo',
  'ommowwowwwommmMo',
  'ommmowwwwommmMMo',
  '.ommmowwommmmMo.',
  '.oMmmmoommmmMMo.',
  '..oMMmmmmmMMMo..',
  '...ooMMMMMMoo...',
  '.....oooooo.....',
  '................',
];

const NOTE: Template = [
  '................',
  '.......oooooo...',
  '......oblllllo..',
  '......olooooLo..',
  '......olo..olo..',
  '......olo..olo..',
  '......olo..olo..',
  '...oooolo.oolo..',
  '..olllllooolllo.',
  '.ollwllLoollLLo.',
  '.olllllLoolLLo..',
  '..oLLLLo..ooo...',
  '...oooo.........',
  '................',
  '................',
  '................',
];

const QUESTION: Template = [
  '................',
  '.....oooooo.....',
  '....obbbbbbo....',
  '...obwbooobBo...',
  '...obbo..obBo...',
  '....oo..obBo....',
  '.......obBo.....',
  '......obBo......',
  '......obBo......',
  '.......oo.......',
  '......oooo......',
  '.....obbbBo.....',
  '.....obBBBo.....',
  '......oooo......',
  '................',
  '................',
];

function shadowFrame(rx: number, ry: number): Canvas {
  const c = new Canvas(EFFECT_FRAME, EFFECT_FRAME);
  c.ellipse(8, 8, rx, ry, hex('#3b2a52', 40));
  c.ellipse(8, 8, rx - 1.5, ry - 0.8, hex('#3b2a52', 40));
  return c;
}

const PAINT: Record<EffectName, () => Canvas> = {
  sparkle0: () => tpl(SPARKLES[0]!, 3),
  sparkle1: () => tpl(SPARKLES[1]!, 3),
  sparkle2: () => tpl(SPARKLES[2]!, 1),
  sparkle3: () => tpl(SPARKLES[3]!, 3),
  star: () => tpl(STAR),
  heart: () => tpl(HEART, 0, 1),
  shadow: () => shadowFrame(7, 2.6),
  shadowSmall: () => shadowFrame(5, 2),
  zzz: zzz,
  clock: () => tpl(CLOCK),
  dots: () => tpl(DOTS, 0, 0, true),
  alarm: () => tpl(ALARM, 0, 1),
  exclaim: () => tpl(EXCLAIM, 1),
  check: () => tpl(CHECK),
  note: () => tpl(NOTE, 0, 1),
  question: () => tpl(QUESTION, 1),
};

function zzz(): Canvas {
  const c = new Canvas(EFFECT_FRAME, EFFECT_FRAME);
  stamp(c, ZZZ, 1, 1, { L: INK });
  stamp(c, ZZZ, 0, 0, { L: K.L });
  // light top edge on each letter
  c.hline(12, 14, 0, K.l);
  c.hline(7, 11, 4, K.l);
  c.hline(1, 6, 9, K.l);
  return c;
}

function tpl(t: Template, dy = 0, dx = 0, outline = false): Canvas {
  const c = new Canvas(EFFECT_FRAME, EFFECT_FRAME);
  stamp(c, t, dx, dy, K);
  if (outline) c.outline(INK);
  return c;
}

/** One 16x16 effect frame. */
export function renderEffectFrame(name: EffectName): Canvas {
  return PAINT[name]();
}

/** The effects sheet as RGBA pixels (EFFECT_COLUMNS x 2 frames of 16x16). */
export function renderEffectsImage(): Canvas {
  const sheet = new Canvas(EFFECT_SHEET_WIDTH, EFFECT_SHEET_HEIGHT);
  for (const [name, idx] of Object.entries(EFFECT_FRAMES) as [EffectName, number][]) {
    sheet.blit(
      renderEffectFrame(name),
      (idx % EFFECT_COLUMNS) * EFFECT_FRAME,
      Math.floor(idx / EFFECT_COLUMNS) * EFFECT_FRAME,
    );
  }
  return sheet;
}
