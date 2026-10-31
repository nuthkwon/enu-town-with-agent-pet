import { describe, expect, it, vi } from 'vitest';
import type { Stage } from '../stage';
import { FxPlayer } from './FxPlayer';

// The engine touches `window` when imported; these tests need only the scene's clock and the tab.
vi.mock('phaser', () => ({ default: {} }));

/** A player on a scene clock that runs only when told to (Phaser's stops while the tab is hidden). */
function setup(tab: { hidden: boolean }) {
  const queued: Array<() => void> = [];
  const scene = {
    load: { on: () => undefined },
    time: { delayedCall: (_ms: number, fn: () => void) => queued.push(fn) },
  };
  const player = new FxPlayer({ scene } as unknown as Stage, {
    reduced: () => false,
    hidden: () => tab.hidden,
  });
  const tick = () => {
    for (const fn of queued.splice(0)) fn();
  };
  return { player, queued, tick };
}

describe('FxPlayer.after', () => {
  it('runs on the scene clock while the tab is visible', () => {
    const { player, tick } = setup({ hidden: false });
    const fn = vi.fn();
    player.after(300, fn);
    expect(fn).not.toHaveBeenCalled();
    tick();
    expect(fn).toHaveBeenCalledOnce();
  });

  it('drops what is asked for while the tab is hidden, so nothing replays on its return', () => {
    const tab = { hidden: true };
    const { player, queued, tick } = setup(tab);
    const fn = vi.fn();
    expect(player.hidden).toBe(true);
    player.after(300, fn);
    expect(queued).toHaveLength(0);
    tab.hidden = false;
    tick();
    expect(fn).not.toHaveBeenCalled();
  });

  it('drops what falls due while the tab is hidden', () => {
    const tab = { hidden: false };
    const { player, tick } = setup(tab);
    const fn = vi.fn();
    player.after(300, fn);
    tab.hidden = true;
    tick();
    expect(fn).not.toHaveBeenCalled();
  });
});
