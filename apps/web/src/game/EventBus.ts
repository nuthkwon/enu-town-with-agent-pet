import { TypedEmitter } from './emitter';
import type { Insets } from './logic/camera';

/** Screen position (CSS px, relative to the game canvas' top-left) where something was clicked. */
export interface ScreenPoint {
  screenX: number;
  screenY: number;
}

/**
 * Events between the Phaser world and the React overlays. One bus per TownClient instance
 * (never a module singleton, so StrictMode remounts and tests stay isolated).
 * Nothing here moves an avatar: the server director places everyone; the viewer only looks around.
 */
export interface TownEvents {
  /** Phaser -> React: someone's avatar, or a desk plate/desk (resolved desk -> roster member), was clicked. */
  'entity:clicked': ScreenPoint & { userId: string; source: 'avatar' | 'desk' };
  /** Phaser -> React: a second click on the same avatar within 300 ms ran `이 사람 보기` (close the menu). */
  'entity:view': { userId: string };
  /** Phaser -> React: the pointer is over someone's avatar or desk plate (userId null = nothing). */
  'entity:hover': ScreenPoint & { userId: string | null };
  /** Phaser -> React: a meeting chip or a group link was clicked. */
  'group:clicked': ScreenPoint & { groupId: string };
  /** Phaser -> React: the viewer's own pet was clicked. */
  'pet:clicked': ScreenPoint;
  /** Phaser -> React: the viewer's own pet bubble was clicked. */
  'pet:bubble-clicked': ScreenPoint & { bubbleId: string };
  /** React -> Phaser: hide the owner's pet bubble now (after an action; the server confirms later). */
  'pet:bubble-hide': { bubbleId: string };
  /** Phaser -> React: the game scene is ready (assets loaded, world built). */
  'game:ready': void;
  /** React -> Phaser: `이 사람 보기` (zoom max(2, fit) on the person, 2 s pulse ring; no follow). */
  'camera:view-user': { userId: string };
  /** React -> Phaser: step through the zoom list (+1 / -1); 0 = back to the overview fit. */
  'camera:zoom': { delta: number };
  /** React -> Phaser: screen space the chrome covers (top bar band, docked team rail). */
  'camera:insets': Insets;
  /** Phaser -> React: the camera changed (zoom, and whether it shows the overview fit). */
  'camera:changed': { zoom: number; fit: number; atFit: boolean };
  /** React -> Phaser: briefly highlight someone (team-rail hover); null stops it. */
  'person:pulse': { userId: string | null };
}

export class EventBus extends TypedEmitter<TownEvents> {}
