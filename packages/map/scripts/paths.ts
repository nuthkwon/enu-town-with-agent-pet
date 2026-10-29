import { fileURLToPath } from 'node:url';

/** Generated map files served by the web app (`/assets/maps/office-606/...`). */
export const OFFICE_606_DIR = fileURLToPath(
  new URL('../../../apps/web/public/assets/maps/office-606/', import.meta.url),
);
export const OFFICE_606_TMJ_PATH = `${OFFICE_606_DIR}office-606.tmj`;
export const OFFICE_606_META_PATH = `${OFFICE_606_DIR}office-606.meta.json`;
/** Produced by `@enu/sprites` (`pnpm sprites:build`), referenced by the embedded tileset. */
export const OFFICE_606_TILESET_PNG_PATH = `${OFFICE_606_DIR}office-tiles.png`;
