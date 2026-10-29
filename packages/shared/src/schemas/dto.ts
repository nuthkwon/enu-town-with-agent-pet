import type {
  AvatarPreset,
  LinkState,
  ManualStatus,
  NowKind,
  NudgeKind,
  NudgeStatus,
  PetAnswerState,
  PetMessageAuthor,
  PetReplyRoute,
  PetReplySource,
  PetSpecies,
  PetTint,
  ScheduleKind,
  TeamId,
  TodoStatus,
  Visibility,
  WorkLogSource,
  WritableChatKind,
} from '../constants';

/**
 * JSON response shapes of the web REST API (`/api/v1/*`), shared by the Next.js route
 * handlers and the browser client. Timestamps are ISO-8601 strings, dates are YYYY-MM-DD.
 *
 * Routes (all require a session cookie; writes also require Origin === PUBLIC_URL):
 *   GET    /api/v1/me                                   -> MeDto
 *   PATCH  /api/v1/me/profile            (profilePatch)  -> MeDto
 *   POST   /api/v1/me/onboarding         (onboardingSubmit) -> MeDto
 *   GET    /api/v1/me/pet                               -> MyPetDto
 *   GET    /api/v1/me/work-logs?cursor                  -> Paginated<WorkLogDto>
 *   PATCH  /api/v1/me/work-logs/:id      (workLogPatch)  -> WorkLogDto   (POST on the collection -> 405)
 *   DELETE /api/v1/me/work-logs/:id                     -> 204
 *   GET    /api/v1/me/todos                             -> TodoDto[]
 *   PATCH  /api/v1/me/todos/:id          (todoPatch)     -> TodoDto
 *   POST   /api/v1/me/nudges/:id/actions (nudgeAction)   -> NudgeDto
 *   GET    /api/v1/me/claude-links                      -> ClaudeLinkDto[]
 *   POST   /api/v1/me/claude-links/revoke (claudeLinkRevoke) -> { revoked: number }
 *   GET    /api/v1/me/export                            -> attachment (all of my data)
 *   GET    /api/v1/people                               -> PersonDto[]
 *   GET    /api/v1/desks                                -> DeskDto[]
 *   GET    /api/v1/users/:id/card                       -> ProfileCardDto (404 when unknown)
 *   GET    /api/v1/users/:id/work-logs?cursor           -> Paginated<WorkLogDto> (only logs the viewer may see)
 *   GET    /api/v1/users/:id/chat-history?kind&before   -> Paginated<ChatItemDto>
 *                                     kind=dm     : DMs between the viewer and :id
 *                                     kind=room   : public room messages sent by :id
 *   GET    /api/v1/users/:id/claude-summaries?cursor    -> Paginated<ClaudeSummaryDto>
 *   GET    /api/v1/chat/room?before                     -> Paginated<ChatItemDto>
 *   GET    /api/v1/dm/threads                           -> DmThreadDto[]
 *   GET    /api/v1/dm/:peerId?before                    -> Paginated<ChatItemDto>
 *   GET    /api/v1/me/pets                              -> OwnerPetDto[]
 *   POST   /api/v1/me/pets               (petCreate)     -> OwnerPetDto (201)
 *   PATCH  /api/v1/me/pets/:petId        (petPatch)      -> OwnerPetDto
 *   DELETE /api/v1/me/pets/:petId                       -> 204 (409 default_pet)
 *   GET    /api/v1/me/pets/:petId/thread?cursor         -> PetThreadPageDto<OwnerPetMessageDto>
 *   POST   /api/v1/me/pets/:petId/messages (petMessageSend) -> OwnerPetMessageDto (201; 200 when repeated)
 *   PATCH  /api/v1/me/pets/:petId/messages/:id (petMessagePatch) -> OwnerPetMessageDto
 *   DELETE /api/v1/me/pets/:petId/messages/:id          -> 204
 *   POST   /api/v1/me/pets/:petId/hide-history          -> { updated: number }
 *   POST   /api/v1/me/pets/:petId/read   (petRead)       -> { unread: number }
 *   GET    /api/v1/users/:id/pets                       -> PetInfoDto[]
 *   GET    /api/v1/users/:id/pets/:petId/thread?cursor  -> PetThreadPageDto<ColleaguePetMessageDto>
 *   GET    /api/v1/admin/seats                          -> AdminSeatsDto (admins only)
 *   POST   /api/v1/admin/seats           (seatAssign)    -> AdminSeatsDto
 *   POST   /api/v1/admin/users/:id/deactivate           -> { ok: true }
 *   GET    /api/realtime-ticket                         -> RealtimeTicketDto (Cache-Control: no-store)
 *   GET    /api/sprites/avatar/:key                     -> image/png (renderAvatarSheet for an avatar key)
 * Errors: { error: string, message?: string, fields?: { field: string; reason: string }[] } with 4xx/5xx.
 */

export interface Paginated<T> {
  items: T[];
  nextCursor: string | null;
}

export interface ApiError {
  error: string;
  message?: string;
  fields?: { field: string; reason: string }[];
}

export interface PetDto {
  species: string;
  name: string;
}

export interface NudgePrefsDto {
  defaultLogVisibility: Visibility;
  /** null = not chosen yet (treated as private). */
  defaultChatSummaryVisibility: Visibility | null;
  shareDmsWithMyClaude: boolean;
  nudgesEnabled: boolean;
  nudgeMinIntervalMin: number;
  maxBubblesPerDay: number;
  quietStart: string;
  quietEnd: string;
}

/** A status the owner set by hand in the town (expired values are never returned). */
export interface ManualStatusDto {
  status: ManualStatus;
  until: string;
}

/** Today's (office date) activity report from the owner's own Claude. Refs are never echoed. */
export interface ActivityTodayDto {
  now: { kind: NowKind; until: string } | null;
  schedule: { startAt: string; endAt: string; kind: ScheduleKind; hasRef: boolean }[];
}

export interface MeDto {
  userId: string;
  email: string;
  displayName: string;
  avatar: AvatarPreset;
  avatarKey: string;
  pet: PetDto;
  deskId: string | null;
  team: TeamId | null;
  teamLabel: string;
  title: string | null;
  roleNote: string | null;
  statusText: string | null;
  timezone: string;
  linkState: LinkState;
  lastWorkLogAt: string | null;
  isAdmin: boolean;
  onboardingCompleted: boolean;
  prefs: NudgePrefsDto;
  /** 활동 공유. null = not chosen yet (treated as off). */
  shareActivity: boolean | null;
  /** 접속 표시: having the town open may draw me and my online dot. */
  showLive: boolean;
  /** APP_TIMEZONE: the office day of every town rule; the client formats `~HH:MM` with it. */
  officeTimeZone: string;
  manualStatus: ManualStatusDto | null;
  activityToday: ActivityTodayDto | null;
  /**
   * Species other active members already have, in PET_SPECIES order: every member has a different pet,
   * so pickers grey these out (onboarding and PATCH /me/profile answer 409 pet_taken for them).
   */
  takenPetSpecies: PetSpecies[];
  /** Current privacy notice version the user must accept (onboarding). */
  noticeVersion: string;
  noticeAccepted: boolean;
  /** Public MCP connector URL to paste into Claude (shown in LinkGuide). */
  mcpUrl: string;
}

/**
 * A colleague as any signed-in member sees them. It carries no status or activity timestamps:
 * 상태 문구 and activity reach colleagues only through the realtime state during office hours.
 */
export interface PersonDto {
  userId: string;
  displayName: string;
  avatar: AvatarPreset;
  avatarKey: string;
  pet: PetDto;
  deskId: string | null;
  team: TeamId | null;
  teamLabel: string;
  title: string | null;
  roleNote: string | null;
  linkState: LinkState;
}

export interface DeskDto {
  deskId: string;
  userId: string | null;
  displayName: string | null;
  team: TeamId | null;
}

export interface WorkLogTaskDto {
  title: string;
  status: string;
  ref?: string;
}

export interface WorkLogDto {
  id: string;
  userId: string;
  authorName: string;
  periodKey: string;
  /** First and last write of the day: owner-only like the other exact timestamps (null for colleagues). */
  periodStart: string | null;
  periodEnd: string | null;
  summary: string | null;
  tasks: WorkLogTaskDto[];
  blockers: string[];
  /** Present only when the viewer may see it (owner, or company-visible summary). */
  claudeChatSummary: string | null;
  visibility: Visibility;
  chatSummaryVisibility: Visibility;
  source: WorkLogSource;
  /** Exact timestamps are for the owner only (canViewLogTimestamps); colleagues get null. */
  claudeWrittenAt: string | null;
  updatedAt: string | null;
  editedByUser: boolean;
  userEditedAt: string | null;
  /** e.g. "김OO님의 Claude가 작성" (+ " · 본인 수정"). */
  provenanceLabel: string;
}

export interface ProfileCardDto {
  person: PersonDto;
  latestLog: WorkLogDto | null;
  /** True when linked but Claude has not written since the previous business day. */
  stale: boolean;
}

export interface ChatItemDto {
  id: string;
  kind: WritableChatKind;
  senderId: string;
  senderName: string;
  text: string;
  createdAt: string;
}

export interface ClaudeSummaryDto {
  logId: string;
  periodKey: string;
  summary: string;
  /** Owner-only (canViewLogTimestamps); colleagues get null and see the day (periodKey). */
  updatedAt: string | null;
}

export interface TodoDto {
  id: string;
  externalRef: string;
  title: string;
  note: string | null;
  dueAt: string | null;
  dueDate: string | null;
  priority: number;
  status: TodoStatus;
  statusSource: 'claude' | 'user' | 'system';
  snoozedUntil: string | null;
}

export interface NudgeDto {
  id: string;
  text: string;
  kind: NudgeKind;
  priority: number;
  status: NudgeStatus;
  showAfter: string;
  expiresAt: string;
  showCount: number;
  todoId: string | null;
  createdAt: string;
}

export interface ClaudeLinkDto {
  id: string;
  clientName: string | null;
  clientKind: 'claude_ai' | 'claude_code' | 'other';
  redirectHost: string | null;
  consentedAt: string;
  lastToolCallAt: string | null;
  lastWriteAt: string | null;
  toolCallCount: number;
  revokedAt: string | null;
}

export interface MyPetDto {
  pet: PetDto;
  linkState: LinkState;
  lastWorkLogAt: string | null;
  todos: TodoDto[];
  nudges: NudgeDto[];
  links: ClaudeLinkDto[];
  mcpUrl: string;
}

/** A pet as anyone may see it (names and looks are drawn in the town). */
export interface PetInfoDto {
  id: string;
  ownerId: string;
  name: string;
  species: PetSpecies;
  tint: PetTint;
  isDefault: boolean;
  sortOrder: number;
}

/** A pet as its owner sees it. Role instructions and the reply route are owner-only. */
export interface OwnerPetDto extends PetInfoDto {
  roleInstructions: string | null;
  replyRoute: PetReplyRoute;
  /** null: follows `prefs.petChatDefaultVisibility`. */
  defaultVisibility: Visibility | null;
  effectiveDefaultVisibility: Visibility;
  /** Pet replies the owner has not read. */
  unread: number;
  /** Owner messages still waiting for an answer. */
  pendingCount: number;
  last: { author: PetMessageAuthor; text: string; createdAt: string } | null;
}

/** A message in my own pet room. */
export interface OwnerPetMessageDto {
  view: 'owner';
  id: string;
  petId: string;
  author: PetMessageAuthor;
  text: string;
  createdAt: string;
  /** The owner's local date of the message. */
  dayKey: string;
  visibility: Visibility;
  visibilitySetBy: 'owner' | 'claude';
  /** How a pet reply arrived; null for my own messages. */
  source: PetReplySource | null;
  clientMsgId: string | null;
  inReplyTo: string | null;
  replyPart: number | null;
  /** For my messages: waiting, held by a Claude Code channel, or answered. */
  answerState: PetAnswerState | null;
  unread: boolean;
}

/** A message in a colleague's pet room: the date only, no time and no owner-only fields. */
export interface ColleaguePetMessageDto {
  view: 'colleague';
  id: string;
  petId: string;
  author: PetMessageAuthor;
  text: string;
  dayKey: string;
}

/** One page of a pet room, oldest first. Work-log day cards (default pet only) cover the page's dates. */
export interface PetThreadPageDto<M> {
  items: M[];
  workLogs: WorkLogDto[];
  nextCursor: string | null;
}

export interface PetChannelPairingCodeDto {
  code: string;
  expiresAt: string;
  /** What to type in a terminal, e.g. `enu-pet pair K7QF-3MXP`. */
  command: string;
}

/** Owner-only: whether a paired Claude Code is listening right now (memory only, never stored). */
export interface PetChannelStatusDto {
  paired: boolean;
  live: boolean;
  machines: { linkId: string; label: string; platform: string; expiresAt: string }[];
}

export interface DmThreadDto {
  peerId: string;
  peerName: string;
  lastText: string;
  lastAt: string;
  unread: number;
}

export interface AdminSeatsDto {
  desks: DeskDto[];
  users: { userId: string; displayName: string; email: string; deskId: string | null; status: string }[];
}

export interface RealtimeTicketDto {
  token: string;
  expiresAt: string;
  /** Browser WebSocket endpoint, e.g. wss://den.enu-tech.co.kr/colyseus */
  wsUrl: string;
}
