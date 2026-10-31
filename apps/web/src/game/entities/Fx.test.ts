import { describe, expect, it, vi } from 'vitest';
import type { FxPlayer } from '../fx/FxPlayer';
import type { Stage } from '../stage';
import { Fx } from './Fx';

/** A stage whose scene fails the test on anything drawn or tweened (`effects`: the icon sheet is loaded). */
function stage(effects = true): Stage {
  const drew = () => {
    throw new Error('drew a flight');
  };
  const scene = {
    textures: { exists: () => effects },
    add: { graphics: drew, image: drew, sprite: drew },
    tweens: { add: drew },
    time: { delayedCall: drew },
  };
  return { scene, world: <T>(o: T) => o, overlay: <T>(o: T) => o } as unknown as Stage;
}

const player = (reduced: boolean) => ({ reduced, play: vi.fn() });
const from = { x: 10, y: 20 };
const to = { x: 90, y: 40 };

describe('Fx with reduced motion', () => {
  it('flies no hearts for a wave: only their burst plays at the target', () => {
    const p = player(true);
    expect(new Fx(stage(), p as unknown as FxPlayer).wave(from, to)).toBe(true);
    expect(p.play.mock.calls).toEqual([['town/heart-burst', to]]);
  });

  it('flies no DM paper plane: only the puff plays where it lands', () => {
    const p = player(true);
    expect(new Fx(stage(), p as unknown as FxPlayer).plane(from, to)).toBe(true);
    expect(p.play.mock.calls).toEqual([['town/plane-puff', to]]);
  });
});

describe('Fx', () => {
  it('says when it drew nothing (no effects sheet), so the screen does not count a wave or a plane', () => {
    const p = player(false);
    const fx = new Fx(stage(false), p as unknown as FxPlayer);
    expect(fx.wave(from, to)).toBe(false);
    expect(fx.plane(from, to)).toBe(false);
    expect(p.play).not.toHaveBeenCalled();
  });
});
