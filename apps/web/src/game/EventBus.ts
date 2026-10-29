import { TypedEmitter } from './emitter';

/** Screen position (CSS px, relative to the game canvas' top-left) where something was clicked. */
export interface ScreenPoint {
  screenX: number;
  screenY: number;
}

/**
 * Events between the Phaser world and the React overlays. One bus per TownClient instance
 * (never a module singleton, so StrictMode remounts and tests stay isolated).
 */
export interface TownEvents {
  /** Phaser -> React: someone's avatar (or their desk while they are offline) was clicked. */
  'entity:clicked': ScreenPoint & { userId: string; source: 'avatar' | 'desk' };
  /** Phaser -> React: the viewer's own pet was clicked. */
  'pet:clicked': ScreenPoint;
  /** Phaser -> React: the viewer's own pet bubble was clicked. */
  'pet:bubble-clicked': ScreenPoint & { bubbleId: string };
  /** React -> Phaser: hide the owner's pet bubble now (after an action; the server confirms later). */
  'pet:bubble-hide': { bubbleId: string };
  /** Phaser -> React: the game scene is ready (assets loaded, world built). */
  'game:ready': void;
  /** Phaser -> React: a click target was not reachable (e.g. inside the server room). */
  'move:unreachable': void;
  /** React -> Phaser: a text input gained/lost focus (keyboard movement pauses while typing). */
  'ui:text-focus': { focused: boolean };
  /** React -> Phaser: walk next to someone (ping '이동', people directory). */
  'move:to-user': { userId: string };
  /** React -> Phaser: centre the camera on someone briefly. */
  'camera:focus-user': { userId: string };
  /** React -> Phaser: zoom in/out by integer steps (0 = automatic). */
  'camera:zoom': { delta: number };
}

export class EventBus extends TypedEmitter<TownEvents> {}
