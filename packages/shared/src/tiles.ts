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
] as const;

export type TileName = (typeof TILE_CATALOG)[number]['name'];

export const TILE_INDEX: Record<TileName, number> = Object.fromEntries(
  TILE_CATALOG.map((t, i) => [t.name, i]),
) as Record<TileName, number>;
