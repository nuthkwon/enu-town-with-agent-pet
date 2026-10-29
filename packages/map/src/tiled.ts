/**
 * Minimal Tiled JSON (`.tmj`) model and a validating parser.
 *
 * Supported subset (everything else is rejected with a descriptive `TmjError`):
 * - orthogonal, finite maps (`infinite: false`);
 * - tile layers with uncompressed CSV data (a JSON array of gids);
 * - object layers, group layers (walked recursively) and image layers (kept, ignored by the world);
 * - embedded single-image tilesets (no external `.tsx`/`.tsj`, no image collections).
 *
 * Pure TypeScript: runs in the browser, in the realtime server and in scripts.
 */

/** Clears the horizontal / vertical / diagonal flip bits of a raw gid. */
export const TILED_GID_MASK = 0x1fffffff;
const MAX_RAW_GID = 0xffffffff;

export type TiledRenderOrder = 'right-down' | 'right-up' | 'left-down' | 'left-up';
export type TiledPropertyType = 'string' | 'int' | 'float' | 'bool' | 'color' | 'file' | 'object' | 'class';
export type TiledPropertyValue = string | number | boolean | { readonly [key: string]: unknown };

export interface TiledProperty {
  name: string;
  type: TiledPropertyType;
  value: TiledPropertyValue;
  propertytype?: string;
}

export interface TiledPoint {
  x: number;
  y: number;
}

export interface TiledLayerBase {
  id: number;
  name: string;
  opacity: number;
  visible: boolean;
  x: number;
  y: number;
  offsetx?: number;
  offsety?: number;
  class?: string;
  properties?: TiledProperty[];
}

export interface TiledTileLayer extends TiledLayerBase {
  type: 'tilelayer';
  width: number;
  height: number;
  /** Row-major raw gids (flip bits included); 0 = empty. */
  data: number[];
}

export interface TiledObject {
  id: number;
  name: string;
  /** Tiled 1.10 writes the object class as `type` (1.9 wrote `class`; both are accepted). */
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  visible: boolean;
  properties?: TiledProperty[];
  gid?: number;
  point?: boolean;
  ellipse?: boolean;
  polygon?: TiledPoint[];
  polyline?: TiledPoint[];
}

export interface TiledObjectLayer extends TiledLayerBase {
  type: 'objectgroup';
  draworder: 'topdown' | 'index';
  objects: TiledObject[];
}

export interface TiledGroupLayer extends TiledLayerBase {
  type: 'group';
  layers: TiledLayer[];
}

export interface TiledImageLayer extends TiledLayerBase {
  type: 'imagelayer';
  image: string;
}

export type TiledLayer = TiledTileLayer | TiledObjectLayer | TiledGroupLayer | TiledImageLayer;

export interface TiledTilesetTile {
  id: number;
  type?: string;
  properties?: TiledProperty[];
}

export interface TiledTileset {
  firstgid: number;
  name: string;
  image: string;
  imagewidth: number;
  imageheight: number;
  tilewidth: number;
  tileheight: number;
  tilecount: number;
  columns: number;
  margin: number;
  spacing: number;
  tiles?: TiledTilesetTile[];
  class?: string;
  properties?: TiledProperty[];
}

export interface TiledMap {
  type: 'map';
  version: string;
  tiledversion: string;
  orientation: 'orthogonal';
  renderorder: TiledRenderOrder;
  width: number;
  height: number;
  tilewidth: number;
  tileheight: number;
  infinite: false;
  compressionlevel: number;
  nextlayerid: number;
  nextobjectid: number;
  layers: TiledLayer[];
  tilesets: TiledTileset[];
  class?: string;
  properties?: TiledProperty[];
}

/** Thrown by `parseTmj` for unsupported or malformed maps; `path` points at the offending JSON node. */
export class TmjError extends Error {
  readonly path: string;

  constructor(path: string, message: string) {
    super(`invalid Tiled map at ${path}: ${message}`);
    this.name = 'TmjError';
    this.path = path;
  }
}

// ---------------------------------------------------------------------------------------------
// helpers

type Rec = Record<string, unknown>;

const RENDER_ORDERS: readonly TiledRenderOrder[] = ['right-down', 'right-up', 'left-down', 'left-up'];
const PROPERTY_TYPES: readonly TiledPropertyType[] = [
  'string',
  'int',
  'float',
  'bool',
  'color',
  'file',
  'object',
  'class',
];

function isRec(v: unknown): v is Rec {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function describe(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'an array';
  if (typeof v === 'string') return JSON.stringify(v.length > 40 ? `${v.slice(0, 40)}...` : v);
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return typeof v === 'undefined' ? 'nothing' : `a ${typeof v}`;
}

function asRec(v: unknown, path: string): Rec {
  if (!isRec(v)) throw new TmjError(path, `expected an object, got ${describe(v)}`);
  return v;
}

function asArray(v: unknown, path: string): unknown[] {
  if (!Array.isArray(v)) throw new TmjError(path, `expected an array, got ${describe(v)}`);
  return v;
}

interface NumOpts {
  int?: boolean;
  min?: number;
  def?: number;
}

function num(o: Rec, key: string, path: string, opts: NumOpts = {}): number {
  const v = o[key];
  if (v === undefined && opts.def !== undefined) return opts.def;
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new TmjError(
      `${path}.${key}`,
      `expected a${opts.int ? 'n integer' : ' number'}, got ${describe(v)}`,
    );
  }
  if (opts.int && !Number.isInteger(v)) throw new TmjError(`${path}.${key}`, `expected an integer, got ${v}`);
  if (opts.min !== undefined && v < opts.min)
    throw new TmjError(`${path}.${key}`, `must be >= ${opts.min}, got ${v}`);
  return v;
}

function str(o: Rec, key: string, path: string, def?: string): string {
  const v = o[key];
  if (v === undefined && def !== undefined) return def;
  if (typeof v !== 'string') throw new TmjError(`${path}.${key}`, `expected a string, got ${describe(v)}`);
  return v;
}

function bool(o: Rec, key: string, path: string, def: boolean): boolean {
  const v = o[key];
  if (v === undefined) return def;
  if (typeof v !== 'boolean') throw new TmjError(`${path}.${key}`, `expected a boolean, got ${describe(v)}`);
  return v;
}

function optNum(o: Rec, key: string, path: string): number | undefined {
  return o[key] === undefined ? undefined : num(o, key, path);
}

function optStr(o: Rec, key: string, path: string): string | undefined {
  return o[key] === undefined ? undefined : str(o, key, path);
}

// ---------------------------------------------------------------------------------------------
// properties

function parseProperty(v: unknown, path: string): TiledProperty {
  const o = asRec(v, path);
  const name = str(o, 'name', path);
  const type = str(o, 'type', path, 'string') as TiledPropertyType;
  if (!PROPERTY_TYPES.includes(type)) {
    throw new TmjError(`${path}.type`, `unknown property type ${describe(type)} (property '${name}')`);
  }
  const value = o.value;
  const bad = (expected: string): never => {
    throw new TmjError(
      `${path}.value`,
      `property '${name}' of type '${type}' expects ${expected}, got ${describe(value)}`,
    );
  };
  let parsed: TiledPropertyValue;
  switch (type) {
    case 'string':
    case 'color':
    case 'file':
      parsed = typeof value === 'string' ? value : bad('a string');
      break;
    case 'int':
    case 'object':
      parsed = typeof value === 'number' && Number.isInteger(value) ? value : bad('an integer');
      break;
    case 'float':
      parsed = typeof value === 'number' && Number.isFinite(value) ? value : bad('a number');
      break;
    case 'bool':
      parsed = typeof value === 'boolean' ? value : bad('a boolean');
      break;
    case 'class':
      parsed = isRec(value) ? value : bad('an object');
      break;
  }
  const prop: TiledProperty = { name, type, value: parsed };
  const propertytype = optStr(o, 'propertytype', path);
  if (propertytype !== undefined) prop.propertytype = propertytype;
  return prop;
}

function parseProperties(o: Rec, path: string): TiledProperty[] | undefined {
  if (o.properties === undefined) return undefined;
  return asArray(o.properties, `${path}.properties`).map((p, i) =>
    parseProperty(p, `${path}.properties[${i}]`),
  );
}

// ---------------------------------------------------------------------------------------------
// tilesets

function parseTileset(v: unknown, path: string): TiledTileset {
  const o = asRec(v, path);
  if (o.source !== undefined) {
    throw new TmjError(
      `${path}.source`,
      `external tileset ${describe(o.source)} is not supported; embed it in the map (Tiled: Map > Embed Tileset)`,
    );
  }
  const name = str(o, 'name', path, '');
  if (typeof o.image !== 'string') {
    throw new TmjError(
      `${path}.image`,
      `tileset '${name}' has no single image; image-collection tilesets are not supported`,
    );
  }
  const tilecount = num(o, 'tilecount', path, { int: true, min: 1 });
  const ts: TiledTileset = {
    firstgid: num(o, 'firstgid', path, { int: true, min: 1 }),
    name,
    image: o.image,
    imagewidth: num(o, 'imagewidth', path, { int: true, min: 1 }),
    imageheight: num(o, 'imageheight', path, { int: true, min: 1 }),
    tilewidth: num(o, 'tilewidth', path, { int: true, min: 1 }),
    tileheight: num(o, 'tileheight', path, { int: true, min: 1 }),
    tilecount,
    columns: num(o, 'columns', path, { int: true, min: 1 }),
    margin: num(o, 'margin', path, { int: true, min: 0, def: 0 }),
    spacing: num(o, 'spacing', path, { int: true, min: 0, def: 0 }),
  };
  if (o.tiles !== undefined) {
    const seen = new Set<number>();
    ts.tiles = asArray(o.tiles, `${path}.tiles`).map((t, i) => {
      const tp = `${path}.tiles[${i}]`;
      const to = asRec(t, tp);
      const id = num(to, 'id', tp, { int: true, min: 0 });
      if (id >= tilecount)
        throw new TmjError(`${tp}.id`, `tile id ${id} is outside the tileset (tilecount ${tilecount})`);
      if (seen.has(id)) throw new TmjError(`${tp}.id`, `duplicate tile id ${id}`);
      seen.add(id);
      const tile: TiledTilesetTile = { id };
      const type = optStr(to, 'type', tp) ?? optStr(to, 'class', tp);
      if (type !== undefined) tile.type = type;
      const properties = parseProperties(to, tp);
      if (properties) tile.properties = properties;
      return tile;
    });
  }
  const cls = optStr(o, 'class', path);
  if (cls !== undefined) ts.class = cls;
  const properties = parseProperties(o, path);
  if (properties) ts.properties = properties;
  return ts;
}

// ---------------------------------------------------------------------------------------------
// layers

interface LayerCtx {
  width: number;
  height: number;
  tilesets: readonly TiledTileset[];
}

function gidBelongsToTileset(gid: number, tilesets: readonly TiledTileset[]): boolean {
  for (const ts of tilesets) {
    if (gid >= ts.firstgid && gid < ts.firstgid + ts.tilecount) return true;
  }
  return false;
}

function parseLayerBase(o: Rec, path: string): TiledLayerBase {
  const base: TiledLayerBase = {
    id: num(o, 'id', path, { int: true, min: 0, def: 0 }),
    name: str(o, 'name', path, ''),
    opacity: num(o, 'opacity', path, { min: 0, def: 1 }),
    visible: bool(o, 'visible', path, true),
    x: num(o, 'x', path, { def: 0 }),
    y: num(o, 'y', path, { def: 0 }),
  };
  const offsetx = optNum(o, 'offsetx', path);
  if (offsetx !== undefined) base.offsetx = offsetx;
  const offsety = optNum(o, 'offsety', path);
  if (offsety !== undefined) base.offsety = offsety;
  const cls = optStr(o, 'class', path);
  if (cls !== undefined) base.class = cls;
  const properties = parseProperties(o, path);
  if (properties) base.properties = properties;
  return base;
}

function parseTileLayer(o: Rec, base: TiledLayerBase, path: string, ctx: LayerCtx): TiledTileLayer {
  const label = `tile layer '${base.name}'`;
  if (o.chunks !== undefined)
    throw new TmjError(`${path}.chunks`, `${label} uses chunks (infinite map); not supported`);
  if (o.compression !== undefined && o.compression !== '') {
    throw new TmjError(
      `${path}.compression`,
      `${label} is compressed (${describe(o.compression)}); set Tile Layer Format to CSV in Map Properties`,
    );
  }
  if (o.encoding !== undefined && o.encoding !== 'csv') {
    throw new TmjError(
      `${path}.encoding`,
      `${label} uses ${describe(o.encoding)} encoding; set Tile Layer Format to CSV in Map Properties`,
    );
  }
  if (typeof o.data === 'string') {
    throw new TmjError(
      `${path}.data`,
      `${label} data is a string (base64); set Tile Layer Format to CSV in Map Properties`,
    );
  }
  const width = num(o, 'width', path, { int: true, min: 1 });
  const height = num(o, 'height', path, { int: true, min: 1 });
  if (width !== ctx.width || height !== ctx.height) {
    throw new TmjError(path, `${label} is ${width}x${height} but the map is ${ctx.width}x${ctx.height}`);
  }
  const raw = asArray(o.data, `${path}.data`);
  if (raw.length !== width * height) {
    throw new TmjError(
      `${path}.data`,
      `${label} has ${raw.length} cells, expected ${width * height} (${width}x${height})`,
    );
  }
  const data = new Array<number>(raw.length);
  for (let i = 0; i < raw.length; i++) {
    const v = raw[i];
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > MAX_RAW_GID) {
      throw new TmjError(
        `${path}.data[${i}]`,
        `expected a gid (unsigned 32-bit integer), got ${describe(v)}`,
      );
    }
    const gid = (v & TILED_GID_MASK) >>> 0;
    if (gid !== 0 && !gidBelongsToTileset(gid, ctx.tilesets)) {
      throw new TmjError(
        `${path}.data[${i}]`,
        `${label} cell (x=${i % width}, y=${Math.floor(i / width)}) uses gid ${gid}, which belongs to no tileset`,
      );
    }
    data[i] = v;
  }
  return { ...base, type: 'tilelayer', width, height, data };
}

function parsePoints(v: unknown, path: string): TiledPoint[] {
  return asArray(v, path).map((p, i) => {
    const o = asRec(p, `${path}[${i}]`);
    return { x: num(o, 'x', `${path}[${i}]`), y: num(o, 'y', `${path}[${i}]`) };
  });
}

function parseObject(v: unknown, path: string): TiledObject {
  const o = asRec(v, path);
  const obj: TiledObject = {
    id: num(o, 'id', path, { int: true, min: 0, def: 0 }),
    name: str(o, 'name', path, ''),
    type: optStr(o, 'type', path) ?? optStr(o, 'class', path) ?? '',
    x: num(o, 'x', path),
    y: num(o, 'y', path),
    width: num(o, 'width', path, { min: 0, def: 0 }),
    height: num(o, 'height', path, { min: 0, def: 0 }),
    rotation: num(o, 'rotation', path, { def: 0 }),
    visible: bool(o, 'visible', path, true),
  };
  const properties = parseProperties(o, path);
  if (properties) obj.properties = properties;
  if (o.gid !== undefined) obj.gid = num(o, 'gid', path, { int: true, min: 0 });
  if (o.point !== undefined) obj.point = bool(o, 'point', path, false);
  if (o.ellipse !== undefined) obj.ellipse = bool(o, 'ellipse', path, false);
  if (o.polygon !== undefined) obj.polygon = parsePoints(o.polygon, `${path}.polygon`);
  if (o.polyline !== undefined) obj.polyline = parsePoints(o.polyline, `${path}.polyline`);
  return obj;
}

function parseLayer(v: unknown, path: string, ctx: LayerCtx): TiledLayer {
  const o = asRec(v, path);
  const base = parseLayerBase(o, path);
  switch (o.type) {
    case 'tilelayer':
      return parseTileLayer(o, base, path, ctx);
    case 'objectgroup': {
      const draworder = o.draworder === 'index' ? 'index' : 'topdown';
      const objects = asArray(o.objects ?? [], `${path}.objects`).map((ob, i) =>
        parseObject(ob, `${path}.objects[${i}]`),
      );
      return { ...base, type: 'objectgroup', draworder, objects };
    }
    case 'group':
      return { ...base, type: 'group', layers: parseLayers(o.layers ?? [], `${path}.layers`, ctx) };
    case 'imagelayer':
      return { ...base, type: 'imagelayer', image: str(o, 'image', path, '') };
    default:
      throw new TmjError(`${path}.type`, `unsupported layer type ${describe(o.type)} (layer '${base.name}')`);
  }
}

function parseLayers(v: unknown, path: string, ctx: LayerCtx): TiledLayer[] {
  return asArray(v, path).map((l, i) => parseLayer(l, `${path}[${i}]`, ctx));
}

// ---------------------------------------------------------------------------------------------
// map

/**
 * Validates a parsed `.tmj` document and returns a normalized `TiledMap` (defaults filled in,
 * unknown fields dropped). Throws `TmjError` for anything outside the supported subset.
 */
export function parseTmj(json: unknown): TiledMap {
  const m = asRec(json, 'map');
  if (m.type !== undefined && m.type !== 'map') {
    throw new TmjError('map.type', `expected 'map', got ${describe(m.type)} (is this a tileset file?)`);
  }
  if (m.orientation !== 'orthogonal') {
    throw new TmjError(
      'map.orientation',
      `only orthogonal maps are supported, got ${describe(m.orientation)}`,
    );
  }
  if (m.infinite === true) {
    throw new TmjError(
      'map.infinite',
      'infinite maps are not supported; uncheck "Infinite" in Map Properties',
    );
  }
  if (m.infinite !== undefined && m.infinite !== false) {
    throw new TmjError('map.infinite', `expected a boolean, got ${describe(m.infinite)}`);
  }
  const renderorder = str(m, 'renderorder', 'map', 'right-down') as TiledRenderOrder;
  if (!RENDER_ORDERS.includes(renderorder)) {
    throw new TmjError('map.renderorder', `unknown render order ${describe(renderorder)}`);
  }
  const width = num(m, 'width', 'map', { int: true, min: 1 });
  const height = num(m, 'height', 'map', { int: true, min: 1 });
  const tilewidth = num(m, 'tilewidth', 'map', { int: true, min: 1 });
  const tileheight = num(m, 'tileheight', 'map', { int: true, min: 1 });

  const tilesets = asArray(m.tilesets ?? [], 'map.tilesets').map((t, i) =>
    parseTileset(t, `map.tilesets[${i}]`),
  );
  const sorted = [...tilesets].sort((a, b) => a.firstgid - b.firstgid);
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const cur = sorted[i];
    if (prev && cur && cur.firstgid < prev.firstgid + prev.tilecount) {
      throw new TmjError(
        'map.tilesets',
        `tileset '${cur.name}' (firstgid ${cur.firstgid}) overlaps '${prev.name}' (gids ${prev.firstgid}..${prev.firstgid + prev.tilecount - 1})`,
      );
    }
  }

  const layers = parseLayers(m.layers ?? [], 'map.layers', { width, height, tilesets });
  const map: TiledMap = {
    type: 'map',
    version: typeof m.version === 'string' || typeof m.version === 'number' ? String(m.version) : '',
    tiledversion: str(m, 'tiledversion', 'map', ''),
    orientation: 'orthogonal',
    renderorder,
    width,
    height,
    tilewidth,
    tileheight,
    infinite: false,
    compressionlevel: num(m, 'compressionlevel', 'map', { int: true, def: -1 }),
    nextlayerid: num(m, 'nextlayerid', 'map', { int: true, min: 0, def: 0 }),
    nextobjectid: num(m, 'nextobjectid', 'map', { int: true, min: 0, def: 0 }),
    layers,
    tilesets,
  };
  const cls = optStr(m, 'class', 'map');
  if (cls !== undefined) map.class = cls;
  const properties = parseProperties(m, 'map');
  if (properties) map.properties = properties;
  return map;
}

// ---------------------------------------------------------------------------------------------
// queries

/** Raw gid without flip bits. */
export function tileGid(raw: number): number {
  return (raw & TILED_GID_MASK) >>> 0;
}

/** All layers in document order, descending into group layers. */
export function* walkLayers(layers: readonly TiledLayer[]): Generator<TiledLayer> {
  for (const layer of layers) {
    yield layer;
    if (layer.type === 'group') yield* walkLayers(layer.layers);
  }
}

/** Tile layers (optionally only those with `name`), including those nested in groups. */
export function findTileLayers(map: Pick<TiledMap, 'layers'>, name?: string): TiledTileLayer[] {
  const out: TiledTileLayer[] = [];
  for (const l of walkLayers(map.layers))
    if (l.type === 'tilelayer' && (name === undefined || l.name === name)) out.push(l);
  return out;
}

/** First object layer called `name` (document order, groups included). */
export function findObjectLayer(map: Pick<TiledMap, 'layers'>, name: string): TiledObjectLayer | undefined {
  for (const l of walkLayers(map.layers)) if (l.type === 'objectgroup' && l.name === name) return l;
  return undefined;
}

/** The tileset a (masked) gid belongs to. */
export function tilesetForGid(map: Pick<TiledMap, 'tilesets'>, gid: number): TiledTileset | undefined {
  const g = tileGid(gid);
  if (g === 0) return undefined;
  return map.tilesets.find((ts) => g >= ts.firstgid && g < ts.firstgid + ts.tilecount);
}

/** Value of a custom property, or `undefined`. */
export function getProperty(
  source: { readonly properties?: readonly TiledProperty[] } | undefined,
  name: string,
): TiledPropertyValue | undefined {
  return source?.properties?.find((p) => p.name === name)?.value;
}
