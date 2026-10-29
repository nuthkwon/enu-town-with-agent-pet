/** Product-wide constants shared by web, realtime, worker and MCP tools. */

export const APP_TIMEZONE_DEFAULT = 'Asia/Seoul';
export const ALLOWED_GOOGLE_HD_DEFAULT = 'enu-tech.co.kr';

/** Version of the check-in instructions; the Claude skill compares this to its own. */
export const INSTRUCTIONS_VERSION = '2026-10-29.1';

export const MCP_TOOL_NAMES = {
  getMyContext: 'get_my_context',
  postWorkLog: 'post_work_log',
  upsertTodos: 'upsert_todos',
  postPetNudges: 'post_pet_nudges',
} as const;
export type McpToolName = (typeof MCP_TOOL_NAMES)[keyof typeof MCP_TOOL_NAMES];

export const VISIBILITIES = ['private', 'company'] as const;
export type Visibility = (typeof VISIBILITIES)[number];

export const LINK_STATES = ['not_linked', 'linked', 'stale'] as const;
export type LinkState = (typeof LINK_STATES)[number];

export const WORK_LOG_SOURCES = ['cowork_scheduled', 'claude_interactive', 'claude_code'] as const;
export type WorkLogSource = (typeof WORK_LOG_SOURCES)[number];

export const SOURCE_HINTS = ['scheduled_task', 'interactive', 'claude_code'] as const;
export type SourceHint = (typeof SOURCE_HINTS)[number];

export const SOURCE_HINT_TO_SOURCE: Record<SourceHint, WorkLogSource> = {
  scheduled_task: 'cowork_scheduled',
  interactive: 'claude_interactive',
  claude_code: 'claude_code',
};

export const TASK_STATUSES = ['done', 'in_progress', 'planned', 'blocked'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TODO_STATUSES = ['open', 'done', 'dismissed', 'snoozed'] as const;
export type TodoStatus = (typeof TODO_STATUSES)[number];

export const NUDGE_KINDS = ['reminder', 'checkin'] as const;
export type NudgeKind = (typeof NUDGE_KINDS)[number];

export const NUDGE_STATUSES = [
  'pending',
  'shown',
  'snoozed',
  'acked',
  'dismissed',
  'expired',
  'superseded',
] as const;
export type NudgeStatus = (typeof NUDGE_STATUSES)[number];

export const CHAT_KINDS = ['dm', 'room', 'nearby'] as const;
export type ChatKind = (typeof CHAT_KINDS)[number];

/** Limits enforced identically by zod schemas, DB CHECKs and UI counters. */
export const LIMITS = {
  chatMaxLen: 500,
  nearbyRadiusTiles: 5,
  workLogSummaryMax: 1500,
  workLogTasksMax: 20,
  workLogTaskTitleMax: 120,
  workLogTaskRefMax: 200,
  workLogBlockersMax: 10,
  workLogBlockerMax: 200,
  claudeChatSummaryMax: 800,
  todosBatchMax: 30,
  todoTitleMax: 120,
  todoNoteMax: 300,
  todoExternalRefMax: 200,
  todosOpenMax: 200,
  nudgesBatchMax: 5,
  nudgeTextMax: 120,
  nudgesPerDayMax: 30,
  dedupeKeyMax: 64,
  displayNameMax: 40,
  statusTextMax: 80,
  petNameMax: 20,
  toolResultMaxChars: 20_000,
  mcpBodyMaxBytes: 65_536,
} as const;

export const EXTERNAL_REF_PATTERN = /^[\w:.\-/#@]{1,200}$/;

/** Pet bubble scheduling (defaults; per-profile overrides live in `profiles`). */
export const NUDGE_POLICY = {
  joinDelayMs: 8_000,
  idleMs: 180_000,
  dueWindowsMin: [30, 5] as readonly number[],
  minIntervalMin: 25,
  urgentMinIntervalMin: 10,
  maxPerDay: 8,
  quietStart: '19:30',
  quietEnd: '08:30',
  maxShows: 2,
  candidateHorizonMs: 12 * 60 * 60 * 1000,
  displayMinMs: 6_000,
  displayMaxMs: 15_000,
} as const;

/** Local work hours used to skip scheduled check-ins outside of office time. */
export const WORK_HOURS = { start: '08:30', end: '19:30' } as const;

export const PET_SPECIES = ['cat', 'bunny', 'fox', 'chick', 'hamster', 'dragon'] as const;
export type PetSpecies = (typeof PET_SPECIES)[number];

export const PET_SPECIES_LABEL_KO: Record<PetSpecies, string> = {
  cat: '고양이',
  bunny: '토끼',
  fox: '여우',
  chick: '병아리',
  hamster: '햄스터',
  dragon: '아기용',
};

export const BODY_TYPES = ['f', 'm'] as const;
export type BodyType = (typeof BODY_TYPES)[number];

export const HAIR_STYLES = ['short', 'swept', 'curly', 'bob', 'ponytail', 'long', 'buzz', 'bun'] as const;
export type HairStyle = (typeof HAIR_STYLES)[number];

/** Palette keys understood by the sprite generator. */
export const HAIR_COLORS = ['black', 'brown', 'chestnut', 'blonde', 'pink', 'lavender', 'teal', 'silver'] as const;
export type HairColor = (typeof HAIR_COLORS)[number];

export const OUTFIT_COLORS = ['rose', 'sky', 'mint', 'lemon', 'lilac', 'coral', 'navy', 'peach'] as const;
export type OutfitColor = (typeof OUTFIT_COLORS)[number];

export const SKIN_TONES = ['light', 'warm', 'tan'] as const;
export type SkinTone = (typeof SKIN_TONES)[number];

export interface AvatarPreset {
  body: BodyType;
  hair: HairStyle;
  hairColor: HairColor;
  outfit: OutfitColor;
  skin: SkinTone;
  /** Fairy wings accessory; pets always have wings, people default to false. */
  wings: boolean;
}

export const DEFAULT_AVATAR: AvatarPreset = {
  body: 'm',
  hair: 'short',
  hairColor: 'black',
  outfit: 'sky',
  skin: 'warm',
  wings: false,
};

/** Sprite sheet key for an avatar preset (one generated sheet per combination actually used). */
export function avatarSpriteKey(a: AvatarPreset): string {
  return `av-${a.body}-${a.hair}-${a.hairColor}-${a.outfit}-${a.skin}${a.wings ? '-w' : ''}`;
}

/** Room / map identifiers. */
export const OFFICE_ROOM_NAME = 'office-606';
export const OFFICE_MAP_ID = 'office-606';
export const TILE_SIZE = 32;

/** Desk ids of A동 606호 (see docs/architecture.md for the floor plan). */
export const DESK_IDS = [
  'L1a',
  'L1b',
  'L2a',
  'L2b',
  'L3a',
  'L3b',
  'L4a',
  'L4b',
  'L5a',
  'L5b',
  'R1',
  'R2a',
  'R2b',
  'R3b',
] as const;
export type DeskId = (typeof DESK_IDS)[number];

export const ZONE_IDS = ['balcony', 'ceo', 'pantry', 'server', 'meeting'] as const;
export type ZoneId = (typeof ZONE_IDS)[number];

export const ZONE_LABEL_KO: Record<ZoneId, string> = {
  balcony: '발코니',
  ceo: '대표석',
  pantry: '탕비실',
  server: '서버실',
  meeting: '회의실',
};

/** Realtime ticket audience (HS256 JWT minted by web, verified by realtime). */
export const REALTIME_TICKET_AUDIENCE = 'enu-town-realtime';
export const REALTIME_TICKET_TTL_SECONDS = 60;

/** Postgres NOTIFY channel shared by web/worker (publishers) and realtime (listener). */
export const TOWN_EVENTS_CHANNEL = 'enu_town_events';
