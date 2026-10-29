/**
 * Office tileset contract shared by the sprite generator (draws `office-tiles.png`
 * in this order, 8 columns x 32px) and the map generator (gid = index + 1).
 * Never reorder existing entries: Tiled maps reference tiles by index.
 */
export const TILESET_COLUMNS = 8;

export const TILE_CATALOG = [
  { name: 'void', collides: true },
  { name: 'floor_carpet', collides: false },
  { name: 'floor_runner', collides: false },
  { name: 'floor_wood', collides: false },
  { name: 'floor_tile', collides: false },
  { name: 'floor_meeting', collides: false },
  { name: 'floor_server', collides: false },
  { name: 'wall', collides: true },
  { name: 'window', collides: true },
  { name: 'door_glass', collides: false },
  { name: 'door_entrance', collides: false },
  { name: 'railing', collides: true },
  { name: 'desk_left', collides: true },
  { name: 'desk_mid', collides: true },
  { name: 'desk_right', collides: true },
  { name: 'desk_block', collides: true },
  { name: 'chair_up', collides: false },
  { name: 'chair_down', collides: false },
  { name: 'chair_left', collides: false },
  { name: 'chair_right', collides: false },
  { name: 'partition_v', collides: true },
  { name: 'partition_h', collides: true },
  { name: 'partition_corner', collides: true },
  { name: 'meeting_table', collides: true },
  { name: 'meeting_chair', collides: false },
  { name: 'fridge', collides: true },
  { name: 'microwave', collides: true },
  { name: 'counter', collides: true },
  { name: 'server_rack', collides: true },
  { name: 'server_door', collides: true },
  { name: 'cabinet', collides: true },
  { name: 'plant', collides: true },
  { name: 'whiteboard', collides: true },
  { name: 'monitor_back', collides: false },
  { name: 'monitor_front', collides: false },
  { name: 'monitor_side', collides: false },
  // Connected desk pieces (team desks and the executive desk): `<palette>_j_<links>[_<diagonals>]`.
  // Links name the same-desk neighbours (n, e, s, w); `_se`/`_sw` mark a south-east/south-west
  // desk cell next to a piece without a south link, so front faces meet cleanly. See deskJoinTile().
  { name: 'desk_j_o', collides: true },
  { name: 'desk_j_n', collides: true },
  { name: 'desk_j_e', collides: true },
  { name: 'desk_j_ne', collides: true },
  { name: 'desk_j_s', collides: true },
  { name: 'desk_j_ns', collides: true },
  { name: 'desk_j_es', collides: true },
  { name: 'desk_j_nes', collides: true },
  { name: 'desk_j_w', collides: true },
  { name: 'desk_j_nw', collides: true },
  { name: 'desk_j_ew', collides: true },
  { name: 'desk_j_new', collides: true },
  { name: 'desk_j_sw', collides: true },
  { name: 'desk_j_nsw', collides: true },
  { name: 'desk_j_esw', collides: true },
  { name: 'desk_j_nesw', collides: true },
  { name: 'desk_j_w_sw', collides: true },
  { name: 'desk_j_nw_sw', collides: true },
  { name: 'desk_j_ew_sw', collides: true },
  { name: 'desk_j_new_sw', collides: true },
  { name: 'desk_j_e_se', collides: true },
  { name: 'desk_j_ne_se', collides: true },
  { name: 'desk_j_ew_se', collides: true },
  { name: 'desk_j_new_se', collides: true },
  { name: 'desk_j_ew_sesw', collides: true },
  { name: 'desk_j_new_sesw', collides: true },
  { name: 'exec_j_o', collides: true },
  { name: 'exec_j_n', collides: true },
  { name: 'exec_j_e', collides: true },
  { name: 'exec_j_ne', collides: true },
  { name: 'exec_j_s', collides: true },
  { name: 'exec_j_ns', collides: true },
  { name: 'exec_j_es', collides: true },
  { name: 'exec_j_nes', collides: true },
  { name: 'exec_j_w', collides: true },
  { name: 'exec_j_nw', collides: true },
  { name: 'exec_j_ew', collides: true },
  { name: 'exec_j_new', collides: true },
  { name: 'exec_j_sw', collides: true },
  { name: 'exec_j_nsw', collides: true },
  { name: 'exec_j_esw', collides: true },
  { name: 'exec_j_nesw', collides: true },
  { name: 'exec_j_w_sw', collides: true },
  { name: 'exec_j_nw_sw', collides: true },
  { name: 'exec_j_ew_sw', collides: true },
  { name: 'exec_j_new_sw', collides: true },
  { name: 'exec_j_e_se', collides: true },
  { name: 'exec_j_ne_se', collides: true },
  { name: 'exec_j_ew_se', collides: true },
  { name: 'exec_j_new_se', collides: true },
  { name: 'exec_j_ew_sesw', collides: true },
  { name: 'exec_j_new_sesw', collides: true },
] as const;

export type TileName = (typeof TILE_CATALOG)[number]['name'];

export const TILE_INDEX: Record<TileName, number> = Object.fromEntries(
  TILE_CATALOG.map((t, i) => [t.name, i]),
) as Record<TileName, number>;

export type DeskPalette = 'desk' | 'exec';

/** Same-desk neighbours of one desk cell (diagonals only matter next to a piece without a south link). */
export interface DeskLinks {
  n: boolean;
  e: boolean;
  s: boolean;
  w: boolean;
  se: boolean;
  sw: boolean;
}

/** Tile for one cell of a desk of any shape (bars, L-shaped desks, the executive desk). */
export function deskJoinTile(palette: DeskPalette, l: DeskLinks): TileName {
  const links = (['n', 'e', 's', 'w'] as const).filter((k) => l[k]).join('') || 'o';
  const diag = l.s ? '' : `${l.e && l.se ? 'se' : ''}${l.w && l.sw ? 'sw' : ''}`;
  return `${palette}_j_${links}${diag ? `_${diag}` : ''}` as TileName;
}

/** Inverse of deskJoinTile for the painter; null for any other tile. */
export function parseDeskJoinTile(name: string): ({ palette: DeskPalette } & DeskLinks) | null {
  const m = /^(desk|exec)_j_([nesw]+|o)(?:_(se|sw|sesw))?$/.exec(name);
  if (!m) return null;
  const links = m[2] ?? '';
  const diag = m[3] ?? '';
  return {
    palette: m[1] as DeskPalette,
    n: links.includes('n'),
    e: links.includes('e'),
    s: links.includes('s'),
    w: links.includes('w'),
    se: diag.includes('se'),
    sw: diag.includes('sw'),
  };
}
