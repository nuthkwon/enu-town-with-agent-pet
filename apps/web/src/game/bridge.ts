import type { MeDto } from '@enu/shared';
import type { RealtimeSession } from '../realtime/RealtimeSession';
import type { TownDirectory } from './directory';
import type { EventBus } from './EventBus';
import type { MapBundle } from './mapBundle';

/** Everything the Phaser scenes need from the React side (stored in the game registry). */
export interface GameBridge {
  me: MeDto;
  session: RealtimeSession;
  bus: EventBus;
  directory: TownDirectory;
  map: MapBundle;
}

export const BRIDGE_REGISTRY_KEY = 'enu-town-bridge';
export const FONT_REGISTRY_KEY = 'enu-town-font';
