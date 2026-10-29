import { writeFileSync } from 'node:fs';
import { Canvas } from '../src/draw/canvas';
import { hex } from '../src/draw/color';
import { encodePng } from '../src/png';
import { renderAvatarImage } from '../src/avatar';
import { renderEffectFrame } from '../src/effects';
const presets = [
  { body: 'f', hair: 'ponytail', hairColor: 'pink', outfit: 'lilac', skin: 'light', wings: true },
  { body: 'm', hair: 'swept', hairColor: 'blonde', outfit: 'mint', skin: 'tan', wings: false },
] as const;
const c = new Canvas(320, 128 * presets.length);
c.map((x, y) => ((x >> 5) + (y >> 5)) % 2 ? hex('#f6eefa') : hex('#efe4f6'));
const sh = renderEffectFrame('shadow');
presets.forEach((p, k) => {
  for (let r = 0; r < 4; r++) for (let col = 0; col < 10; col++) c.blit(sh, col * 32 + 8, k * 128 + r * 32 + 31 - 9);
  c.blit(renderAvatarImage(p), 0, k * 128);
});
writeFileSync('/home/user/enu-preview/anim.png', encodePng(c.scale(5)));
