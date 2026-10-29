export * from './constants';
export * from './tiled';
export * from './world';
export * from './path';
export * from './proximity';
export * from './generate';
export * from './validate';
export * from './layouts/office-606';

import { parseTmj } from './tiled';
import { buildWorld, type OfficeWorld } from './world';

/** `buildWorld(parseTmj(json))` — e.g. for the result of `fetch(...).json()` or `JSON.parse(text)`. */
export function loadOfficeWorld(json: unknown): OfficeWorld {
  return buildWorld(parseTmj(json));
}
