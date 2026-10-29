import type { AvatarPreset, NowKind, ScheduleKind, WorkLogChange } from '@enu/shared';
import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  bigserial,
  boolean,
  char,
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
 * ENU Den application tables. Ids are UUIDv7 generated in the app (`newId()`), so the
 * schema stays compatible with Postgres 16+ (compose runs 18). Exception: `work_logs.id` is a random
 * UUIDv4 (`newOpaqueId()`), because colleagues receive it and a v7 id encodes the owner-only write time.
 * Sets that may still grow are `text` + CHECK instead of pg enums to keep migrations transactional.
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

/** One calendar block of `activity_reports.schedule` (UTC ISO times; the ref is stored only as its keyed hash). */
export interface ScheduleBlockRow {
  start_at: string;
  end_at: string;
  kind: ScheduleKind;
  ref_hash: string | null;
}

export const profiles = pgTable(
  'profiles',
  {
    userId: text('user_id')
      .primaryKey()
      .references(() => user.id, { onDelete: 'cascade' }),
    displayName: varchar('display_name', { length: 40 }).notNull(),
    avatar: jsonb('avatar').$type<AvatarPreset>().notNull(),
    title: varchar('title', { length: 60 }),
    /** Team id from TEAMS (shared constants). */
    team: text('team'),
    /** Short role description shown on the profile card, e.g. 'SQA·V&V·형상 감사'. */
    roleNote: varchar('role_note', { length: 80 }),
    /** 상태 문구 (human-typed). Colleagues see it only in the realtime state while the owner is shown or away. */
    statusText: varchar('status_text', { length: 80 }),
    /** 활동 공유: null = not chosen yet = off; only `true` lets Claude-derived activity be shown. */
    shareActivity: boolean('share_activity'),
    /** 접속 표시: having the town open may draw the owner and their online dot. */
    showLive: boolean('show_live').notNull().default(true),
    /** The owner's own status (MANUAL_STATUSES) and its expiry; set and cleared together. */
    manualStatus: text('manual_status'),
    manualStatusUntil: tstz('manual_status_until'),
    timezone: text('timezone').notNull().default('Asia/Seoul'),
    defaultLogVisibility: visibilityEnum('default_log_visibility').notNull().default('company'),
    /** null = the owner has not chosen yet -> treated as private. */
    defaultChatSummaryVisibility: visibilityEnum('default_chat_summary_visibility'),
    shareDmsWithMyClaude: boolean('share_dms_with_my_claude').notNull().default(false),
    /** Default visibility of my pet conversations (ADR 0005): company unless I lower it; a pet may override it. */
    petChatDefaultVisibility: visibilityEnum('pet_chat_default_visibility').notNull().default('company'),
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
    check(
      'profiles_manual_status_chk',
      sql`${t.manualStatus} is null or ${t.manualStatus} in ('available','focus','meeting','break','away')`,
    ),
    check(
      'profiles_manual_status_pair_chk',
      sql`(${t.manualStatus} is null) = (${t.manualStatusUntil} is null)`,
    ),
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

/**
 * A person's pets (ADR 0005): the default pet (created at provisioning; base look, a species no other active member's
 * default pet has) and up to four more the owner creates. Ids are random UUIDv4 (`newOpaqueId()`): colleagues receive
 * them, and a v7 id would encode the owner-only creation time.
 */
export const pets = pgTable(
  'pets',
  {
    id: uuid('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 20 }).notNull(),
    /** PET_SPECIES (zod); append-only like the sprite set, so no CHECK. */
    species: text('species').notNull(),
    /** PET_TINTS; `base` only for the default pet. */
    tint: text('tint').notNull().default('base'),
    /** The owner's own words to their own Claude; owner-only. */
    roleInstructions: text('role_instructions'),
    replyRoute: text('reply_route').notNull().default('both'),
    /** null = follow `profiles.pet_chat_default_visibility`. */
    defaultVisibility: visibilityEnum('default_visibility'),
    isDefault: boolean('is_default').notNull().default(false),
    sortOrder: smallint('sort_order').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('pets_one_default_uidx')
      .on(t.userId)
      .where(sql`${t.isDefault}`),
    uniqueIndex('pets_owner_look_uidx').on(t.userId, t.species, t.tint),
    index('pets_user_idx').on(t.userId, t.sortOrder),
    check('pets_reply_route_chk', sql`${t.replyRoute} in ('channel','checkin','both')`),
    check('pets_default_tint_chk', sql`(${t.tint} = 'base') = ${t.isDefault}`),
    check(
      'pets_role_len_chk',
      sql`${t.roleInstructions} is null or char_length(${t.roleInstructions}) between 1 and 1000`,
    ),
    check('pets_sort_chk', sql`${t.sortOrder} between 0 and 99`),
  ],
);

/**
 * Pet conversations (ADR 0005): what the owner types to a pet and the replies their own Claude sends back (never a
 * claude.ai transcript). Ids are random UUIDv4: colleagues receive them, and they must not carry the time. The
 * owner-only answer bookkeeping lets the Claude Code channel and the connector never both answer.
 */
export const petMessages = pgTable(
  'pet_messages',
  {
    id: uuid('id').primaryKey(),
    petId: uuid('pet_id')
      .notNull()
      .references(() => pets.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    author: text('author').notNull(),
    body: text('body').notNull(),
    /** The owner's local date (`localDateKey`), what colleagues see instead of a time. */
    dayKey: date('day_key', { mode: 'string' }).notNull(),
    visibility: visibilityEnum('visibility').notNull(),
    visibilitySetBy: text('visibility_set_by').notNull(),
    /** Pet replies: how Claude answered (PET_REPLY_SOURCES). Null for owner messages. */
    source: text('source'),
    clientMsgId: varchar('client_msg_id', { length: 64 }),
    inReplyTo: uuid('in_reply_to').references((): AnyPgColumn => petMessages.id, { onDelete: 'cascade' }),
    replyPart: smallint('reply_part'),
    answerState: text('answer_state'),
    answeredLane: text('answered_lane'),
    replyCount: smallint('reply_count').notNull().default(0),
    /** The pet channel token holding the message (no FK: a revoked token's claim simply expires). */
    claimedBy: uuid('claimed_by'),
    claimUntil: tstz('claim_until'),
    /** A pet reply the owner has not read yet. */
    unread: boolean('unread').notNull().default(false),
    oauthClientId: text('oauth_client_id'),
    createdAt: tstz('created_at').notNull(),
  },
  (t) => [
    uniqueIndex('pet_messages_owner_client_uidx')
      .on(t.userId, t.clientMsgId)
      .where(sql`${t.clientMsgId} is not null`),
    uniqueIndex('pet_messages_reply_part_uidx')
      .on(t.inReplyTo, t.replyPart)
      .where(sql`${t.inReplyTo} is not null`),
    index('pet_messages_thread_idx').on(t.petId, t.createdAt, t.id),
    index('pet_messages_colleague_idx')
      .on(t.petId, t.createdAt, t.id)
      .where(sql`${t.visibility} = 'company'`),
    index('pet_messages_inbox_idx')
      .on(t.userId, t.createdAt)
      .where(sql`${t.answerState} in ('pending','claimed')`),
    index('pet_messages_unread_idx')
      .on(t.userId, t.petId)
      .where(sql`${t.unread}`),
    index('pet_messages_day_idx').on(t.dayKey),
    check('pet_messages_author_chk', sql`${t.author} in ('owner','pet')`),
    check('pet_messages_body_len_chk', sql`char_length(${t.body}) between 1 and 1000`),
    check('pet_messages_set_by_chk', sql`${t.visibilitySetBy} in ('owner','claude')`),
    check(
      'pet_messages_source_chk',
      sql`(${t.author} = 'pet') = (${t.source} is not null) and (${t.source} is null or ${t.source} in ('claude_code_channel','cowork_scheduled','claude_interactive','claude_code'))`,
    ),
    check(
      'pet_messages_owner_fields_chk',
      sql`(${t.author} = 'owner') = (${t.clientMsgId} is not null) and (${t.author} = 'owner') = (${t.answerState} is not null)`,
    ),
    check(
      'pet_messages_pet_fields_chk',
      sql`(${t.author} = 'pet') = (${t.inReplyTo} is not null) and (${t.author} = 'pet') = (${t.replyPart} is not null) and (${t.replyPart} is null or ${t.replyPart} between 1 and 3)`,
    ),
    check(
      'pet_messages_answer_chk',
      sql`${t.answerState} is null or ${t.answerState} in ('pending','claimed','answered')`,
    ),
    check(
      'pet_messages_lane_chk',
      sql`${t.answeredLane} is null or ${t.answeredLane} in ('channel','connector')`,
    ),
    check(
      'pet_messages_claim_chk',
      sql`(${t.claimedBy} is null) = (${t.claimUntil} is null) and (${t.claimUntil} is null or ${t.answerState} = 'claimed')`,
    ),
    check('pet_messages_unread_chk', sql`not (${t.author} = 'owner' and ${t.unread})`),
  ],
);

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
    check(
      'privacy_consents_scope_chk',
      sql`${t.scope} in ('service','claude_chat_summary','activity_sharing','pet_chat_sharing')`,
    ),
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
    check(
      'claude_links_kind_chk',
      sql`${t.clientKind} in ('claude_ai','claude_code','claude_code_channel','other')`,
    ),
  ],
);

/**
 * Claude Code pet channel credentials (ADR 0006): one per paired machine, tied to its own `claude_links` row so the
 * link list, revoke and deactivation cover it. Only the sha256 of the `edc_` token is stored. No last-seen column:
 * whether a channel is listening lives only in the web process memory.
 */
export const petChannelTokens = pgTable(
  'pet_channel_tokens',
  {
    id: uuid('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    linkId: uuid('link_id')
      .notNull()
      .references(() => claudeLinks.id, { onDelete: 'cascade' }),
    tokenHash: char('token_hash', { length: 64 }).notNull(),
    label: varchar('label', { length: 40 }).notNull(),
    platform: text('platform').notNull(),
    pluginVersion: varchar('plugin_version', { length: 20 }).notNull(),
    createdAt: tstz('created_at').notNull().defaultNow(),
    expiresAt: tstz('expires_at').notNull(),
  },
  (t) => [
    uniqueIndex('pet_channel_tokens_link_uidx').on(t.linkId),
    uniqueIndex('pet_channel_tokens_hash_uidx').on(t.tokenHash),
    index('pet_channel_tokens_user_idx').on(t.userId),
    check('pet_channel_tokens_platform_chk', sql`${t.platform} in ('darwin','linux','win32','other')`),
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
    index('work_logs_feed_idx')
      .on(t.visibility, t.updatedAt)
      .where(sql`${t.deletedAt} is null`),
    check('work_logs_summary_len_chk', sql`${t.summary} is null or char_length(${t.summary}) <= 2000`),
    check(
      'work_logs_chat_summary_len_chk',
      sql`${t.claudeChatSummary} is null or char_length(${t.claudeChatSummary}) <= 1000`,
    ),
    check(
      'work_logs_set_by_chk',
      sql`${t.visibilitySetBy} in ('claude','user') and ${t.chatSummaryVisibilitySetBy} in ('claude','user')`,
    ),
    check(
      'work_logs_source_chk',
      sql`${t.source} in ('cowork_scheduled','claude_interactive','claude_code')`,
    ),
  ],
);

/**
 * The work overview's feed (ADR 0007): one row per Claude write of a company work log that changed something
 * visible. `day_key` is the office day (APP_TIMEZONE). `written_at` is kept for the current office day only: the
 * nightly purge merges past days into one `day` row per log without a time. Ids are UUIDv4 (no time); `seq` orders a
 * log's rows and never leaves the server. The owner's edit or delete of the log removes its rows.
 */
export const workLogEntries = pgTable(
  'work_log_entries',
  {
    id: uuid('id').primaryKey(),
    logId: uuid('log_id')
      .notNull()
      .references(() => workLogs.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    dayKey: date('day_key', { mode: 'string' }).notNull(),
    seq: integer('seq').notNull(),
    writtenAt: tstz('written_at'),
    inOfficeHours: boolean('in_office_hours').notNull(),
    kind: text('kind').notNull(),
    changes: jsonb('changes').$type<WorkLogChange[]>().notNull(),
  },
  (t) => [
    uniqueIndex('work_log_entries_log_seq_uidx').on(t.logId, t.seq),
    index('work_log_entries_day_idx').on(t.dayKey),
    check('work_log_entries_kind_chk', sql`${t.kind} in ('created','updated','day')`),
    check(
      'work_log_entries_changes_chk',
      sql`jsonb_typeof(${t.changes}) = 'array' and jsonb_array_length(${t.changes}) between 1 and 64`,
    ),
    check('work_log_entries_day_time_chk', sql`${t.kind} <> 'day' or ${t.writtenAt} is null`),
  ],
);

/**
 * Today's activity report from the owner's own Claude (post_activity): what they are doing now and today's
 * calendar blocks. Current office day (APP_TIMEZONE) only: older rows are purged and never read, so no
 * presence or activity history exists. Refs are stored only as 32-hex keyed daily hashes.
 */
export const activityReports = pgTable(
  'activity_reports',
  {
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    /** Office date (APP_TIMEZONE). */
    periodKey: date('period_key', { mode: 'string' }).notNull(),
    nowKind: text('now_kind').$type<NowKind>(),
    nowRefHash: char('now_ref_hash', { length: 32 }),
    nowUntil: tstz('now_until'),
    schedule: jsonb('schedule').$type<ScheduleBlockRow[]>().notNull().default([]),
    source: text('source').notNull(),
    oauthClientId: text('oauth_client_id'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ name: 'activity_reports_pk', columns: [t.userId, t.periodKey] }),
    index('activity_reports_period_idx').on(t.periodKey),
    check(
      'activity_now_kind_chk',
      sql`${t.nowKind} is null or ${t.nowKind} in ('work','docs','review','collab')`,
    ),
    check('activity_now_pair_chk', sql`(${t.nowKind} is null) = (${t.nowUntil} is null)`),
    check('activity_now_ref_chk', sql`${t.nowRefHash} is null or ${t.nowKind} is not null`),
    check(
      'activity_schedule_chk',
      sql`jsonb_typeof(${t.schedule}) = 'array' and jsonb_array_length(${t.schedule}) <= 16`,
    ),
    check('activity_source_chk', sql`${t.source} in ('cowork_scheduled','claude_interactive','claude_code')`),
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
    /** The pet that says it; null = the owner's default pet. */
    petId: uuid('pet_id').references(() => pets.id, { onDelete: 'set null' }),
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
    uniqueIndex('pet_nudges_user_dedupe_uidx')
      .on(t.userId, t.dedupeKey)
      .where(sql`${t.dedupeKey} is not null`),
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
    index('chat_messages_dm_idx')
      .on(t.dmLow, t.dmHigh, t.createdAt)
      .where(sql`${t.kind} = 'dm'`),
    index('chat_messages_room_idx')
      .on(t.createdAt)
      .where(sql`${t.kind} = 'room'`),
    index('chat_messages_sender_idx').on(t.senderId, t.createdAt),
    check('chat_messages_body_len_chk', sql`char_length(${t.body}) between 1 and 500`),
    check(
      'chat_messages_dm_chk',
      sql`(${t.kind} = 'dm') = (${t.dmLow} is not null and ${t.dmHigh} is not null)`,
    ),
    // The pg enum keeps 'nearby' (dropping enum values is not transactional); nearby chat no longer exists.
    check('chat_messages_no_nearby_chk', sql`${t.kind} <> 'nearby'`),
  ],
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
