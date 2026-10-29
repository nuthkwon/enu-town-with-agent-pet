import Phaser from 'phaser';
import { BRIDGE_REGISTRY_KEY, type GameBridge } from './bridge';
import { BootScene } from './scenes/BootScene';
import { PreloadScene } from './scenes/PreloadScene';
import { UIScene } from './scenes/UIScene';
import { WorldScene } from './scenes/WorldScene';

/**
 * Phaser 4 game for the office. Only ever imported dynamically from PhaserGame's effect, so the
 * engine (which touches `window` at import time) never runs during SSR.
 */
export function createGame(parent: HTMLElement, bridge: GameBridge): Phaser.Game {
  return new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    pixelArt: true,
    roundPixels: true,
    transparent: true,
    banner: false,
    disableContextMenu: false,
    audio: { noAudio: true },
    // windowEvents: Phaser would otherwise feed every mousedown/touchstart anywhere on the page (a
    // popover, the team rail, the top bar) to the scene, so a click inside a menu that lies over a desk
    // or an avatar also "clicked" that desk or avatar. Only presses on the canvas itself reach the map.
    input: { keyboard: false, gamepad: false, windowEvents: false },
    scale: {
      mode: Phaser.Scale.RESIZE,
      width: Math.max(1, parent.clientWidth),
      height: Math.max(1, parent.clientHeight),
    },
    callbacks: {
      preBoot: (game) => {
        game.registry.set(BRIDGE_REGISTRY_KEY, bridge);
      },
    },
    scene: [BootScene, PreloadScene, WorldScene, UIScene],
  });
}
