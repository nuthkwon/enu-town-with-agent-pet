/** Product-wide constants shared by web, realtime, worker and MCP tools. */

export const APP_TIMEZONE_DEFAULT = 'Asia/Seoul';
export const ALLOWED_GOOGLE_HD_DEFAULT = 'enu-tech.co.kr';

/** Current privacy notice version (docs/privacy-notice.ko.md); bump to require re-acceptance. */
export const PRIVACY_NOTICE_VERSION = '2027-01';

/** Product name: UI title, MCP server title and the Better Auth app name. */
export const APP_NAME = 'ENU Den';

/** serverInfo.name of the remote MCP connector (Claude Code names its tools mcp__<server>__<tool>). */
export const MCP_SERVER_NAME = 'enu-den';

/** Version of the check-in instructions; the Claude skill compares this to its own. */
export const INSTRUCTIONS_VERSION = '2026-11-04.1';

export const MCP_TOOL_NAMES = {
  getMyContext: 'get_my_context',
  postWorkLog: 'post_work_log',
  upsertTodos: 'upsert_todos',
  postPetNudges: 'post_pet_nudges',
  postActivity: 'post_activity',
  postPetReply: 'post_pet_reply',
} as const;
export type McpToolName = (typeof MCP_TOOL_NAMES)[keyof typeof MCP_TOOL_NAMES];

export const VISIBILITIES = ['private', 'company'] as const;
export type Visibility = (typeof VISIBILITIES)[number];

/**
 * What the welcome wizard's 펫 대화 공개 step preselects (ADR 0005: company by default). Set it to null if HR
 * asks for an explicit choice: the step then preselects nothing and cannot be skipped.
 */
export const PET_CHAT_SHARING_PRESELECT: Visibility | null = 'company';

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

/** Values of the pg enum `chat_kind` (read side). `nearby` rows no longer exist and a CHECK blocks new ones. */
export const CHAT_KINDS = ['dm', 'room', 'nearby'] as const;
export type ChatKind = (typeof CHAT_KINDS)[number];
/** Chat kinds that can be written and listed. */
export const WRITABLE_CHAT_KINDS = ['dm', 'room'] as const;
export type WritableChatKind = (typeof WRITABLE_CHAT_KINDS)[number];

/** Kinds of work the owner's own Claude reports as `post_activity.now` (label only, never draws an avatar). */
export const NOW_KINDS = ['work', 'docs', 'review', 'collab'] as const;
export type NowKind = (typeof NOW_KINDS)[number];

/** Calendar blocks the owner's own Claude reports as `post_activity.schedule`. */
export const SCHEDULE_KINDS = ['meeting', 'focus', 'away'] as const;
export type ScheduleKind = (typeof SCHEDULE_KINDS)[number];

/** Statuses the owner sets by hand in the town (`status:set`); they beat every Claude signal. */
export const MANUAL_STATUSES = ['available', 'focus', 'meeting', 'break', 'away'] as const;
export type ManualStatus = (typeof MANUAL_STATUSES)[number];

/** How long a manual status lasts; it never outlives the office day (`manualStatusUntil`). */
export const MANUAL_DURATIONS = ['30m', '1h', '2h', 'today'] as const;
export type ManualDuration = (typeof MANUAL_DURATIONS)[number];

/**
 * Work item reference copied verbatim from a connected tool: scheme:id, e.g. gcal:<iCalUID>, jira:ENU-123,
 * github:owner/repo#45, drive:<fileId>. The id part is any printable ASCII except space ([!-~]), so iCalUIDs
 * with + = { } pass. Stored only as a keyed daily hash.
 */
export const WORK_REF_PATTERN = /^[A-Za-z][A-Za-z0-9-]{1,15}:[!-~]{1,180}$/;

/** Server director timing and grouping thresholds (docs/design/town-visualization-spec.md §6.7, D5). */
export const TOWN_TIMING = {
  directorTickMs: 1_000,
  liveGraceMs: 60_000,
  moveStaggerMs: 350,
  meetingGroupMin: 3,
  workGroupGatherMax: 3,
} as const;

/** Limits enforced identically by zod schemas, DB CHECKs and UI counters. */
export const LIMITS = {
  chatMaxLen: 500,
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
  scheduleBlocksMax: 16,
  scheduleBlockMaxHours: 10,
  nowDefaultMin: 90,
  nowMaxMin: 120,
  toolResultMaxChars: 20_000,
  mcpBodyMaxBytes: 65_536,
  /** Pets per person, the default pet included (docs/design/messenger-spec.md). */
  petsPerOwnerMax: 5,
  petRoleInstructionsMax: 1000,
  /** An owner message to a pet. */
  petMessageMax: 1000,
  /** One part of a pet reply (Claude-authored); a reply has at most `petRepliesPerMessageMax` parts. */
  petReplyMax: 1000,
  petRepliesPerMessageMax: 3,
  petRepliesBatchMax: 5,
  petRepliesPerDayMax: 300,
  petInboxMax: 10,
  petInboxRecentMax: 6,
  petInboxRecentTextMax: 300,
  petThreadPageMax: 50,
} as const;

export const EXTERNAL_REF_PATTERN = /^[\w:.\-/#@]{1,200}$/;

/** Pet bubble scheduling (defaults; per-profile overrides live in `profiles`). */
export const NUDGE_POLICY = {
  joinDelayMs: 8_000,
  /** The tab must have been hidden at least this long for its return to count as a `glance`. */
  glanceHiddenMs: 600_000,
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

/** Local work hours: scheduled check-ins are skipped and colleagues' state is hidden outside of them. */
export const WORK_HOURS = { start: '08:30', end: '19:30' } as const;

/**
 * Fairy pet species. Append only (ids are stored per user). There are at least as many species as
 * seats so every employee can have a different-looking pet; each one has its own silhouette and
 * dominant colour (see `packages/sprites/src/parts/pets.ts`).
 */
export const PET_SPECIES = [
  'cat',
  'bunny',
  'fox',
  'chick',
  'hamster',
  'dragon',
  'puppy',
  'panda',
  'penguin',
  'owl',
  'hedgehog',
  'koala',
  'frog',
  'unicorn',
  'whale',
  'lamb',
] as const;
export type PetSpecies = (typeof PET_SPECIES)[number];

export const PET_SPECIES_LABEL_KO: Record<PetSpecies, string> = {
  cat: '고양이',
  bunny: '토끼',
  fox: '여우',
  chick: '병아리',
  hamster: '햄스터',
  dragon: '아기용',
  puppy: '강아지',
  panda: '판다',
  penguin: '펭귄',
  owl: '부엉이',
  hedgehog: '고슴도치',
  koala: '코알라',
  frog: '개구리',
  unicorn: '유니콘',
  whale: '고래',
  lamb: '아기양',
};

/**
 * Pet looks: a species plus a tint. `base` is reserved for each person's default pet (unique species among active
 * members); further pets use another tint. Append-only (stored in `pets.tint`).
 */
export const PET_TINTS = ['base', 'rose', 'mint', 'sky', 'lemon', 'lilac'] as const;
export type PetTint = (typeof PET_TINTS)[number];
export const PET_EXTRA_TINTS = PET_TINTS.filter((t) => t !== 'base') as Exclude<PetTint, 'base'>[];

export const PET_TINT_LABEL_KO: Record<PetTint, string> = {
  base: '기본',
  rose: '장밋빛',
  mint: '민트',
  sky: '하늘',
  lemon: '레몬',
  lilac: '라일락',
};

/** Which of the owner's Claude paths may answer a pet: the Claude Code channel, the connector check-in, or both. */
export const PET_REPLY_ROUTES = ['channel', 'checkin', 'both'] as const;
export type PetReplyRoute = (typeof PET_REPLY_ROUTES)[number];

export const PET_MESSAGE_AUTHORS = ['owner', 'pet'] as const;
export type PetMessageAuthor = (typeof PET_MESSAGE_AUTHORS)[number];

/** How a pet reply arrived: the local Claude Code channel, or a connector run (same values as work logs). */
export const PET_REPLY_SOURCES = ['claude_code_channel', ...WORK_LOG_SOURCES] as const;
export type PetReplySource = (typeof PET_REPLY_SOURCES)[number];

/** Answer state of an owner message (owner-only). */
export const PET_ANSWER_STATES = ['pending', 'claimed', 'answered'] as const;
export type PetAnswerState = (typeof PET_ANSWER_STATES)[number];

/** Why a pet reply was not stored (in addition to the text reasons pii/url/too_long/empty). */
export const PET_REPLY_REJECTIONS = [
  'unknown_pet',
  'unknown_message',
  'already_answered',
  'route_not_allowed',
  'outside_office_hours',
  'daily_limit',
] as const;
export type PetReplyRejection = (typeof PET_REPLY_REJECTIONS)[number];

/** Opt-in scopes recorded in `privacy_consents` (one row per notice version). */
export const CONSENT_SCOPES = [
  'service',
  'claude_chat_summary',
  'activity_sharing',
  'pet_chat_sharing',
] as const;
export type ConsentScope = (typeof CONSENT_SCOPES)[number];

/** The Claude Code pet channel (ADR 0006): pairing, tokens, long-poll and claims. */
export const PET_CHANNEL = {
  tokenPrefix: 'edc_',
  tokenTtlDays: 90,
  maxTokensPerUser: 3,
  pairCodeTtlMin: 10,
  pollWaitMaxS: 25,
  pollBatchMax: 10,
  /** A polled message is held for this long; then the connector or another machine may answer it. */
  claimTtlMin: 10,
  /** A channel counts as listening this long after its last poll (owner-only, memory only). */
  liveWindowS: 60,
  /** Older unanswered messages are no longer pushed into a Claude Code session. */
  deliverMaxAgeHours: 24,
} as const;

export const BODY_TYPES = ['f', 'm'] as const;
export type BodyType = (typeof BODY_TYPES)[number];

export const HAIR_STYLES = ['short', 'swept', 'curly', 'bob', 'ponytail', 'long', 'buzz', 'bun'] as const;
export type HairStyle = (typeof HAIR_STYLES)[number];

/** Palette keys understood by the sprite generator. */
export const HAIR_COLORS = [
  'black',
  'brown',
  'chestnut',
  'blonde',
  'pink',
  'lavender',
  'teal',
  'silver',
] as const;
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

/**
 * Teams of ENU-Tech (generic labels only; who belongs where lives in the gitignored roster).
 * Name tags and the people directory use these colors.
 */
export const TEAMS = [
  { id: 'mgmt', label: '경영', color: '#b48ead' },
  { id: 'design', label: 'HMI 요건·설계팀', color: '#5e81ac' },
  { id: 'dev', label: '개발팀', color: '#a3be8c' },
  { id: 'qa', label: '품질보증팀', color: '#d08770' },
  { id: 'support', label: '사업지원', color: '#88c0d0' },
] as const;
export type TeamId = (typeof TEAMS)[number]['id'];
export const TEAM_IDS = TEAMS.map((t) => t.id) as unknown as readonly [TeamId, ...TeamId[]];

export function teamLabel(id: string | null | undefined): string {
  return TEAMS.find((t) => t.id === id)?.label ?? '';
}

/**
 * Role-aware work requests offered when clicking a colleague. They open a DM draft with a
 * template; nothing is sent automatically.
 */
export const WORK_REQUEST_KINDS = [
  { id: 'question', label: '질문하기', template: '[질문] ', teams: null },
  { id: 'meeting', label: '회의 요청', template: '[회의 요청] 일시: \n안건: ', teams: null },
  {
    id: 'review',
    label: '검토 요청 (SQA)',
    template: '[검토 요청] 대상 산출물: \n요청 내용: ',
    teams: ['qa'],
  },
  {
    id: 'config',
    label: '형상 변경 요청',
    template: '[형상 변경 요청] 대상: \n변경 사유: ',
    teams: ['design'],
  },
  {
    id: 'build',
    label: '구현·디자인 요청',
    template: '[구현 요청] 화면/기능: \n요청 사항: ',
    teams: ['dev'],
  },
  { id: 'report', label: '진행 보고', template: '[진행 보고] ', teams: ['mgmt'] },
] as const;

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
export const REALTIME_TICKET_AUDIENCE = 'enu-den-realtime';
export const REALTIME_TICKET_TTL_SECONDS = 60;

/** Postgres NOTIFY channel shared by web/worker (publishers) and realtime (listener). */
export const TOWN_EVENTS_CHANNEL = 'enu_den_events';
