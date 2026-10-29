import type { chatMessages, claudeLinks, petNudges, profiles, todos, workLogs } from '@enu/db';
import { canViewChatSummary, canViewLog, canViewLogTimestamps } from '@enu/domain';
import {
  DEFAULT_AVATAR,
  LINK_STATES,
  NUDGE_KINDS,
  NUDGE_STATUSES,
  TEAM_IDS,
  TODO_STATUSES,
  VISIBILITIES,
  WORK_LOG_SOURCES,
  avatarPresetSchema,
  avatarSpriteKey,
  teamLabel,
  type AvatarPreset,
  type ChatItemDto,
  type ClaudeLinkDto,
  type ClaudeSummaryDto,
  type DeskDto,
  type LinkState,
  type NudgeDto,
  type PersonDto,
  type TeamId,
  type TodoDto,
  type Visibility,
  type WorkLogDto,
  type WorkLogSource,
  type WritableChatKind,
} from '@enu/shared';
import { ko } from '@/i18n/ko';

/** Row -> DTO mappers. Visibility decisions are delegated to @enu/domain (never re-implemented). */

export type ProfileRow = typeof profiles.$inferSelect;
export type WorkLogRow = typeof workLogs.$inferSelect;
export type TodoRow = typeof todos.$inferSelect;
export type NudgeRow = typeof petNudges.$inferSelect;
export type ClaudeLinkRow = typeof claudeLinks.$inferSelect;
export type ChatRow = typeof chatMessages.$inferSelect;

const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);
const isoReq = (d: Date): string => d.toISOString();

function oneOf<T extends string>(values: readonly T[], v: unknown, fallback: T): T {
  return (values as readonly unknown[]).includes(v) ? (v as T) : fallback;
}

export function normalizeAvatar(raw: unknown): AvatarPreset {
  const r = avatarPresetSchema.safeParse(raw);
  return r.success ? r.data : DEFAULT_AVATAR;
}

export function asTeamId(v: string | null | undefined): TeamId | null {
  return v && (TEAM_IDS as readonly string[]).includes(v) ? (v as TeamId) : null;
}

export function asLinkState(v: string | null | undefined): LinkState {
  return oneOf(LINK_STATES, v, 'not_linked');
}

/** "{name}님의 Claude가 작성" (+ " · 본인 수정" when the owner edited the content). */
export function provenanceLabel(authorName: string, editedByUser: boolean): string {
  return ko.provenance.byClaude(authorName) + (editedByUser ? ko.provenance.edited : '');
}

/**
 * A colleague as any member sees them. No 상태 문구 and no timestamps: status and activity reach
 * colleagues only through the realtime state during office hours.
 */
export function toPersonDto(p: ProfileRow, deskId: string | null): PersonDto {
  const avatar = normalizeAvatar(p.avatar);
  const team = asTeamId(p.team);
  return {
    userId: p.userId,
    displayName: p.displayName,
    avatar,
    avatarKey: avatarSpriteKey(avatar),
    pet: { species: p.petSpecies, name: p.petName },
    deskId,
    team,
    teamLabel: teamLabel(team),
    title: p.title ?? null,
    roleNote: p.roleNote ?? null,
    linkState: asLinkState(p.linkState),
  };
}

export interface LogAuthor {
  name: string;
  active: boolean;
}

function logFields(row: WorkLogRow) {
  return {
    ownerId: row.userId,
    visibility: row.visibility as Visibility,
    chatSummaryVisibility: row.chatSummaryVisibility as Visibility,
    deletedAt: row.deletedAt,
  };
}

/** True when `viewer` may see this log at all (owner, or company-visible + active author). */
export function viewerCanSeeLog(viewer: { userId: string }, row: WorkLogRow, author: LogAuthor): boolean {
  return canViewLog(viewer, logFields(row), { active: author.active });
}

/**
 * Maps a log the viewer may see. Returns null when canViewLog says no, so callers can never
 * leak a private log by forgetting a check. The chat summary is included only if
 * canViewChatSummary allows it, and the exact write/edit times only if canViewLogTimestamps does.
 */
export function toWorkLogDto(
  row: WorkLogRow,
  author: LogAuthor,
  viewer: { userId: string },
): WorkLogDto | null {
  const fields = logFields(row);
  if (!canViewLog(viewer, fields, { active: author.active })) return null;
  const showChat = canViewChatSummary(viewer, fields, { active: author.active });
  const showTimes = canViewLogTimestamps(viewer, row.userId);
  return {
    id: row.id,
    userId: row.userId,
    authorName: author.name,
    periodKey: row.periodKey,
    // first and last write of the day: exact times, so owner-only like the other timestamps
    periodStart: showTimes ? isoReq(row.periodStart) : null,
    periodEnd: showTimes ? isoReq(row.periodEnd) : null,
    summary: row.summary,
    tasks: (row.tasks ?? []).map((t) =>
      t.ref ? { title: t.title, status: t.status, ref: t.ref } : { title: t.title, status: t.status },
    ),
    blockers: [...(row.blockers ?? [])],
    claudeChatSummary: showChat ? row.claudeChatSummary : null,
    visibility: oneOf(VISIBILITIES, row.visibility, 'private'),
    chatSummaryVisibility: oneOf(VISIBILITIES, row.chatSummaryVisibility, 'private'),
    source: oneOf<WorkLogSource>(WORK_LOG_SOURCES, row.source, 'claude_interactive'),
    claudeWrittenAt: showTimes ? isoReq(row.claudeWrittenAt) : null,
    updatedAt: showTimes ? isoReq(row.updatedAt) : null,
    editedByUser: row.editedByUser,
    userEditedAt: showTimes ? iso(row.userEditedAt) : null,
    provenanceLabel: provenanceLabel(author.name, row.editedByUser),
  };
}

/** Chat summary entry, or null when the viewer may not see it (or there is none). */
export function toClaudeSummaryDto(
  row: WorkLogRow,
  author: LogAuthor,
  viewer: { userId: string },
): ClaudeSummaryDto | null {
  if (!row.claudeChatSummary) return null;
  if (!canViewChatSummary(viewer, logFields(row), { active: author.active })) return null;
  return {
    logId: row.id,
    periodKey: row.periodKey,
    summary: row.claudeChatSummary,
    updatedAt: canViewLogTimestamps(viewer, row.userId) ? isoReq(row.updatedAt) : null,
  };
}

export function toTodoDto(t: TodoRow): TodoDto {
  return {
    id: t.id,
    externalRef: t.externalRef,
    title: t.title,
    note: t.note ?? null,
    dueAt: iso(t.dueAt),
    dueDate: t.dueDate ?? null,
    priority: t.priority,
    status: oneOf(TODO_STATUSES, t.status, 'open'),
    statusSource: oneOf(['claude', 'user', 'system'] as const, t.statusSource, 'claude'),
    snoozedUntil: iso(t.snoozedUntil),
  };
}

export function toNudgeDto(n: NudgeRow): NudgeDto {
  return {
    id: n.id,
    text: n.text,
    kind: oneOf(NUDGE_KINDS, n.kind, 'reminder'),
    priority: n.priority,
    status: oneOf(NUDGE_STATUSES, n.status, 'pending'),
    showAfter: isoReq(n.showAfter),
    expiresAt: isoReq(n.expiresAt),
    showCount: n.showCount,
    todoId: n.todoId ?? null,
    createdAt: isoReq(n.createdAt),
  };
}

export function toClaudeLinkDto(l: ClaudeLinkRow): ClaudeLinkDto {
  return {
    id: l.id,
    clientName: l.clientName ?? null,
    clientKind: oneOf(['claude_ai', 'claude_code', 'other'] as const, l.clientKind, 'other'),
    redirectHost: l.redirectHost ?? null,
    consentedAt: isoReq(l.consentedAt),
    lastToolCallAt: iso(l.lastToolCallAt),
    lastWriteAt: iso(l.lastWriteAt),
    toolCallCount: l.toolCallCount,
    revokedAt: iso(l.revokedAt),
  };
}

/** Only DMs and room messages exist (a CHECK blocks the legacy 'nearby' enum value). */
export function toChatItemDto(
  m: Pick<ChatRow, 'id' | 'kind' | 'senderId' | 'body' | 'createdAt'>,
  senderName: string,
): ChatItemDto {
  return {
    id: m.id,
    kind: m.kind as WritableChatKind,
    senderId: m.senderId,
    senderName,
    text: m.body,
    createdAt: isoReq(m.createdAt),
  };
}

export function toDeskDto(
  desk: { deskId: string; userId: string | null; labelName: string | null; team: string | null },
  occupant: { displayName: string; team: string | null } | null,
): DeskDto {
  return {
    deskId: desk.deskId,
    userId: desk.userId,
    displayName: occupant?.displayName ?? desk.labelName ?? null,
    team: asTeamId(occupant?.team ?? desk.team),
  };
}
