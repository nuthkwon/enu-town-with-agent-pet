/** Layer / tileset names shared by the generator, the world builder and the client renderer. */
export const MAP_LAYERS = {
  floor: 'floor',
  walls: 'walls',
  furniture: 'furniture',
  furnitureTop: 'furniture-top',
  desks: 'desks',
  zones: 'zones',
  spawn: 'spawn',
} as const;

/** Tile layers whose tiles can block movement (`furniture-top` is decoration only). */
export const COLLISION_LAYER_NAMES: readonly string[] = [
  MAP_LAYERS.floor,
  MAP_LAYERS.walls,
  MAP_LAYERS.furniture,
];

/** The embedded tileset drawn by `@enu/sprites` (`office-tiles.png`, ordered like `TILE_CATALOG`). */
export const OFFICE_TILESET_NAME = 'office-tiles';
export const OFFICE_TILESET_IMAGE = 'office-tiles.png';

/** Tiled versions written by the generator. */
export const TILED_FORMAT_VERSION = '1.10';
export const TILED_EDITOR_VERSION = '1.10.2';
