import type { AvatarPreset } from '@enu/shared';
import { sql } from 'drizzle-orm';
import {
  bigserial,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { user } from './auth';

/**
 * ENU Town application tables. Ids are UUIDv7 generated in the app (`newId()`), so the
 * schema stays compatible with Postgres 16+ (compose runs 18). Sets that may still grow
 * are `text` + CHECK instead of pg enums to keep migrations transactional.
 */

const tstz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const createdAt = () => tstz('created_at').defaultNow().notNull();
const updatedAt = () =>
  tstz('updated_at')
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date());

export const visibilityEnum = pgEnum('visibility', ['private', 'company']);
export const chatKindEnum = pgEnum('chat_kind', ['dm', 'room', 'nearby']);

export interface WorkLogTaskRow {
  title: string;
  status: string;
  ref?: string;
}

export const profiles = pgTable(
  'profiles',
  {
    userId: text('user_id')
      .primaryKey()
      .references(() => user.id, { onDelete: 'cascade' }),
    displayName: varchar('display_name', { length: 40 }).notNull(),
    avatar: jsonb('avatar').$type<AvatarPreset>().notNull(),
    petSpecies: text('pet_species').notNull().default('cat'),
    petName: varchar('pet_name', { length: 20 }).notNull().default('펫'),
    title: varchar('title', { length: 60 }),
    /** Team id from TEAMS (shared constants). */
    team: text('team'),
    /** Short role description shown on the profile card, e.g. 'SQA·V&V·형상 감사'. */
    roleNote: varchar('role_note', { length: 80 }),
    statusText: varchar('status_text', { length: 80 }),
    timezone: text('timezone').notNull().default('Asia/Seoul'),
    defaultLogVisibility: visibilityEnum('default_log_visibility').notNull().default('company'),
    /** null = the owner has not chosen yet -> treated as private. */
    defaultChatSummaryVisibility: visibilityEnum('default_chat_summary_visibility'),
    shareDmsWithMyClaude: boolean('share_dms_with_my_claude').notNull().default(false),
    nudgesEnabled: boolean('nudges_enabled').notNull().default(true),
    nudgeMinIntervalMin: smallint('nudge_min_interval_min').notNull().default(25),
    maxBubblesPerDay: smallint('max_bubbles_per_day').notNull().default(8),
    quietStart: text('quiet_start').notNull().default('19:30'),
    quietEnd: text('quiet_end').notNull().default('08:30'),
    linkState: text('link_state').notNull().default('not_linked'),
    linkStateChangedAt: tstz('link_state_changed_at'),
    lastWorkLogAt: tstz('last_work_log_at'),
    onboardingCompletedAt: tstz('onboarding_completed_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('profiles_link_state_chk', sql`${t.linkState} in ('not_linked','linked','stale')`),
    check('profiles_interval_chk', sql`${t.nudgeMinIntervalMin} between 10 and 240`),
  ],
);

/** The 14 seats of 606호. Names/presets come from the gitignored roster via `pnpm seed:seats`. */
export const desks = pgTable('desks', {
  deskId: text('desk_id').primaryKey(),
  labelName: text('label_name'),
  avatar: jsonb('avatar').$type<AvatarPreset>(),
  petSpecies: text('pet_species'),
  petName: text('pet_name'),
  team: text('team'),
  title: text('title'),
  roleNote: text('role_note'),
  userId: text('user_id')
    .unique()
    .references(() => user.id, { onDelete: 'set null' }),
  updatedAt: updatedAt(),
});

export const privacyConsents = pgTable(
  'privacy_consents',
  {
    id: uuid('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    noticeVersion: text('notice_version').notNull(),
    scope: text('scope').notNull(),
    acceptedAt: tstz('accepted_at').defaultNow().notNull(),
    withdrawnAt: tstz('withdrawn_at'),
  },
  (t) => [
    uniqueIndex('privacy_consents_user_version_scope_uidx').on(t.userId, t.noticeVersion, t.scope),
    check('privacy_consents_scope_chk', sql`${t.scope} in ('service','claude_chat_summary')`),
  ],
);

/** One row per (user, OAuth client) Claude connector link; revocation is per row. */
export const claudeLinks = pgTable(
  'claude_links',
  {
    id: uuid('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    clientId: text('client_id').notNull(),
    clientName: text('client_name'),
    clientKind: text('client_kind').notNull().default('other'),
    redirectHost: text('redirect_host'),
    consentedAt: tstz('consented_at').notNull(),
    firstToolCallAt: tstz('first_tool_call_at'),
    lastToolCallAt: tstz('last_tool_call_at'),
    lastToolName: text('last_tool_name'),
    lastWriteAt: tstz('last_write_at'),
    toolCallCount: integer('tool_call_count').notNull().default(0),
    revokedAt: tstz('revoked_at'),
    revokedReason: text('revoked_reason'),
  },
  (t) => [
    uniqueIndex('claude_links_user_client_uidx').on(t.userId, t.clientId),
    check('claude_links_kind_chk', sql`${t.clientKind} in ('claude_ai','claude_code','other')`),
  ],
);

/** One cumulative work log per owner per local day, written by the owner's Claude. */
export const workLogs = pgTable(
  'work_logs',
  {
    id: uuid('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    periodKey: date('period_key', { mode: 'string' }).notNull(),
    periodStart: tstz('period_start').notNull(),
    periodEnd: tstz('period_end').notNull(),
    summary: text('summary'),
    tasks: jsonb('tasks').$type<WorkLogTaskRow[]>().notNull().default([]),
    blockers: jsonb('blockers').$type<string[]>().notNull().default([]),
    claudeChatSummary: text('claude_chat_summary'),
    visibility: visibilityEnum('visibility').notNull(),
    visibilitySetBy: text('visibility_set_by').notNull().default('claude'),
    chatSummaryVisibility: visibilityEnum('chat_summary_visibility').notNull().default('private'),
    chatSummaryVisibilitySetBy: text('chat_summary_visibility_set_by').notNull().default('claude'),
    source: text('source').notNull(),
    oauthClientId: text('oauth_client_id'),
    claudeWrittenAt: tstz('claude_written_at').notNull(),
    claudeRevision: integer('claude_revision').notNull().default(1),
    editedByUser: boolean('edited_by_user').notNull().default(false),
    userEditedAt: tstz('user_edited_at'),
    deletedAt: tstz('deleted_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('work_logs_user_period_uidx').on(t.userId, t.periodKey),
    index('work_logs_feed_idx').on(t.visibility, t.updatedAt).where(sql`${t.deletedAt} is null`),
    check('work_logs_summary_len_chk', sql`${t.summary} is null or char_length(${t.summary}) <= 2000`),
    check('work_logs_chat_summary_len_chk', sql`${t.claudeChatSummary} is null or char_length(${t.claudeChatSummary}) <= 1000`),
    check('work_logs_set_by_chk', sql`${t.visibilitySetBy} in ('claude','user') and ${t.chatSummaryVisibilitySetBy} in ('claude','user')`),
    check('work_logs_source_chk', sql`${t.source} in ('cowork_scheduled','claude_interactive','claude_code')`),
  ],
);

export const todos = pgTable(
  'todos',
  {
    id: uuid('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    externalRef: varchar('external_ref', { length: 200 }).notNull(),
    title: varchar('title', { length: 120 }).notNull(),
    note: varchar('note', { length: 300 }),
    dueAt: tstz('due_at'),
    dueDate: date('due_date', { mode: 'string' }),
    priority: smallint('priority').notNull().default(2),
    status: text('status').notNull().default('open'),
    statusSource: text('status_source').notNull().default('claude'),
    snoozedUntil: tstz('snoozed_until'),
    oauthClientId: text('oauth_client_id'),
    lastSeenByClaudeAt: tstz('last_seen_by_claude_at'),
    completedAt: tstz('completed_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('todos_user_ref_uidx').on(t.userId, t.externalRef),
    index('todos_user_status_due_idx').on(t.userId, t.status, t.dueAt),
    check('todos_status_chk', sql`${t.status} in ('open','done','dismissed','snoozed')`),
    check('todos_status_source_chk', sql`${t.statusSource} in ('claude','user','system')`),
    check('todos_priority_chk', sql`${t.priority} between 1 and 3`),
  ],
);

/** Pet bubble texts written by the owner's Claude; shown only to the owner. */
export const petNudges = pgTable(
  'pet_nudges',
  {
    id: uuid('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    text: text('text').notNull(),
    kind: text('kind').notNull().default('reminder'),
    todoId: uuid('todo_id').references(() => todos.id, { onDelete: 'set null' }),
    priority: smallint('priority').notNull().default(2),
    showAfter: tstz('show_after').notNull(),
    expiresAt: tstz('expires_at').notNull(),
    dedupeKey: varchar('dedupe_key', { length: 64 }),
    status: text('status').notNull().default('pending'),
    showCount: smallint('show_count').notNull().default(0),
    maxShows: smallint('max_shows').notNull().default(2),
    lastShownAt: tstz('last_shown_at'),
    snoozedUntil: tstz('snoozed_until'),
    ackedAt: tstz('acked_at'),
    dismissedAt: tstz('dismissed_at'),
    oauthClientId: text('oauth_client_id'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('pet_nudges_user_dedupe_uidx').on(t.userId, t.dedupeKey).where(sql`${t.dedupeKey} is not null`),
    index('pet_nudges_active_idx')
      .on(t.userId, t.status, t.showAfter)
      .where(sql`${t.status} in ('pending','shown','snoozed')`),
    index('pet_nudges_expires_idx').on(t.expiresAt),
    check('pet_nudges_text_len_chk', sql`char_length(${t.text}) between 1 and 120`),
    check(
      'pet_nudges_status_chk',
      sql`${t.status} in ('pending','shown','snoozed','acked','dismissed','expired','superseded')`,
    ),
    check('pet_nudges_kind_chk', sql`${t.kind} in ('reminder','checkin')`),
    check('pet_nudges_time_chk', sql`${t.expiresAt} > ${t.showAfter}`),
  ],
);

export const nudgeDeliveries = pgTable(
  'nudge_deliveries',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    nudgeId: uuid('nudge_id').references(() => petNudges.id, { onDelete: 'set null' }),
    todoId: uuid('todo_id').references(() => todos.id, { onDelete: 'set null' }),
    trigger: text('trigger').notNull(),
    dueKey: text('due_key'),
    shownAt: tstz('shown_at').notNull(),
    outcome: text('outcome'),
    outcomeAt: tstz('outcome_at'),
  },
  (t) => [index('nudge_deliveries_user_shown_idx').on(t.userId, t.shownAt)],
);

export const chatMessages = pgTable(
  'chat_messages',
  {
    id: uuid('id').primaryKey(),
    kind: chatKindEnum('kind').notNull(),
    zoneId: text('zone_id'),
    senderId: text('sender_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    /** For DMs: the two participant ids in sorted order. */
    dmLow: text('dm_low'),
    dmHigh: text('dm_high'),
    body: text('body').notNull(),
    clientMsgId: varchar('client_msg_id', { length: 64 }).notNull(),
    createdAt: createdAt(),
    deletedAt: tstz('deleted_at'),
  },
  (t) => [
    uniqueIndex('chat_messages_sender_client_uidx').on(t.senderId, t.clientMsgId),
    index('chat_messages_dm_idx').on(t.dmLow, t.dmHigh, t.createdAt).where(sql`${t.kind} = 'dm'`),
    index('chat_messages_room_idx').on(t.createdAt).where(sql`${t.kind} = 'room'`),
    index('chat_messages_sender_idx').on(t.senderId, t.createdAt),
    check('chat_messages_body_len_chk', sql`char_length(${t.body}) between 1 and 500`),
    check(
      'chat_messages_dm_chk',
      sql`(${t.kind} = 'dm') = (${t.dmLow} is not null and ${t.dmHigh} is not null)`,
    ),
  ],
);

/** Who actually received a nearby message (so "chats we heard together" is exact). */
export const chatMessageRecipients = pgTable(
  'chat_message_recipients',
  {
    messageId: uuid('message_id')
      .notNull()
      .references(() => chatMessages.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.messageId, t.userId] }), index('chat_recipients_user_idx').on(t.userId, t.messageId)],
);

export const dmReadState = pgTable(
  'dm_read_state',
  {
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    peerId: text('peer_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    lastReadAt: tstz('last_read_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.peerId] })],
);

export const userPresence = pgTable('user_presence', {
  userId: text('user_id')
    .primaryKey()
    .references(() => user.id, { onDelete: 'cascade' }),
  x: smallint('x').notNull(),
  y: smallint('y').notNull(),
  dir: smallint('dir').notNull().default(0),
  zoneId: text('zone_id'),
  lastSeenAt: tstz('last_seen_at').notNull(),
});

/** Audit trail without content (who did what, when, through which client). */
export const auditEvents = pgTable(
  'audit_events',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    occurredAt: tstz('occurred_at').defaultNow().notNull(),
    actorType: text('actor_type').notNull(),
    actorUserId: text('actor_user_id'),
    oauthClientId: text('oauth_client_id'),
    action: text('action').notNull(),
    targetType: text('target_type'),
    targetId: text('target_id'),
    ip: text('ip'),
    userAgent: text('user_agent'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
  },
  (t) => [
    index('audit_actor_idx').on(t.actorUserId, t.occurredAt),
    index('audit_action_idx').on(t.action, t.occurredAt),
    check('audit_actor_type_chk', sql`${t.actorType} in ('user','claude','admin','system')`),
  ],
);

export const krHolidays = pgTable('kr_holidays', {
  date: date('date', { mode: 'string' }).primaryKey(),
  name: text('name').notNull(),
});
