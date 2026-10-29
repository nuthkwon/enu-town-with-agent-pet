import { TILE_CATALOG, TILESET_COLUMNS } from '@enu/shared';
import { Canvas } from './draw/canvas';
import { paintTile } from './parts/tiles';
import { TILE, TILESET_HEIGHT, TILESET_WIDTH } from './spec';

/** The office tileset as RGBA pixels: TILE_CATALOG order, TILESET_COLUMNS columns of 32x32. */
export function renderTilesetImage(): Canvas {
  const sheet = new Canvas(TILESET_WIDTH, TILESET_HEIGHT);
  TILE_CATALOG.forEach((t, i) => {
    sheet.blit(paintTile(t.name), (i % TILESET_COLUMNS) * TILE, Math.floor(i / TILESET_COLUMNS) * TILE);
  });
  return sheet;
}
