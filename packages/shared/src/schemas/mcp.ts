import * as z from 'zod';
import {
  EXTERNAL_REF_PATTERN,
  LIMITS,
  LINK_STATES,
  MANUAL_STATUSES,
  NOW_KINDS,
  NUDGE_KINDS,
  NUDGE_STATUSES,
  SCHEDULE_KINDS,
  SOURCE_HINTS,
  TASK_STATUSES,
  TODO_STATUSES,
  VISIBILITIES,
  WORK_REF_PATTERN,
} from '../constants';

/** Input/output contracts of the five ENU Den MCP tools (snake_case, as Claude sees them). */

export const IsoDateTime = z.iso.datetime({ offset: true });
export const LocalDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD');
export const VisibilitySchema = z.enum(VISIBILITIES);
export const Priority = z.number().int().min(1).max(3);

export const CONTEXT_SECTIONS = [
  'profile',
  'today_log',
  'todos',
  'nudges',
  'town_messages',
  'activity',
] as const;

export const getMyContextInput = z.object({
  include: z
    .array(z.enum(CONTEXT_SECTIONS))
    .optional()
    .describe('Sections to return. Default: all sections you are allowed to read.'),
  since: IsoDateTime.optional().describe(
    'Only town messages after this instant (default: 24h ago, max 7 days).',
  ),
});
export type GetMyContextInput = z.infer<typeof getMyContextInput>;

export const workLogTask = z.object({
  title: z.string().min(1).max(LIMITS.workLogTaskTitleMax),
  status: z.enum(TASK_STATUSES),
  ref: z
    .string()
    .max(LIMITS.workLogTaskRefMax)
    .optional()
    .describe('Optional plain label or https URL such as a ticket key (ENU-123).'),
});

export const postWorkLogInput = z.object({
  summary: z
    .string()
    .min(1)
    .max(LIMITS.workLogSummaryMax)
    .describe("Factual 3-6 sentence summary of today's work so far (cumulative for the day)."),
  tasks: z.array(workLogTask).max(LIMITS.workLogTasksMax).default([]),
  blockers: z
    .array(z.string().min(1).max(LIMITS.workLogBlockerMax))
    .max(LIMITS.workLogBlockersMax)
    .default([]),
  claude_chat_summary: z
    .string()
    .max(LIMITS.claudeChatSummaryMax)
    .optional()
    .describe(
      '2-3 sentences on the topics of work conversations with Claude today. No quotes, no private chats.',
    ),
  visibility: VisibilitySchema.optional().describe(
    'Omit to use the owner default. You may only lower it to private.',
  ),
  chat_summary_visibility: VisibilitySchema.optional(),
  source_hint: z.enum(SOURCE_HINTS).default('scheduled_task'),
});
export type PostWorkLogInput = z.infer<typeof postWorkLogInput>;

export const todoItem = z
  .object({
    external_ref: z
      .string()
      .regex(EXTERNAL_REF_PATTERN)
      .describe('Stable key derived from the source, e.g. gcal:<eventId>, gmail:<threadId>, jira:ENU-123.'),
    title: z.string().min(1).max(LIMITS.todoTitleMax),
    note: z.string().max(LIMITS.todoNoteMax).optional(),
    due_at: IsoDateTime.optional(),
    due_date: LocalDate.optional().describe(
      'All-day due date in the owner timezone (alternative to due_at).',
    ),
    priority: Priority.default(2),
    status: z.enum(['open', 'done']).default('open'),
  })
  .refine((t) => !(t.due_at && t.due_date), { message: 'use either due_at or due_date, not both' });

export const upsertTodosInput = z.object({
  items: z.array(todoItem).min(1).max(LIMITS.todosBatchMax),
});
export type UpsertTodosInput = z.infer<typeof upsertTodosInput>;

export const nudgeItem = z.object({
  text: z
    .string()
    .min(1)
    .max(LIMITS.nudgeTextMax)
    .describe('One friendly sentence (<=60 Korean characters recommended). No links, no personal data.'),
  kind: z.enum(NUDGE_KINDS).default('reminder'),
  show_after: IsoDateTime.optional().describe('Earliest time to show (default now, max now+7d).'),
  expires_at: IsoDateTime.optional().describe('Default 19:00 local on the show day.'),
  priority: Priority.default(2).describe('1 = urgent, 3 = gentle.'),
  todo_external_ref: z.string().regex(EXTERNAL_REF_PATTERN).optional(),
  dedupe_key: z.string().min(1).max(LIMITS.dedupeKeyMax).optional(),
});

export const postPetNudgesInput = z.object({
  nudges: z.array(nudgeItem).min(1).max(LIMITS.nudgesBatchMax),
  replace_pending: z.boolean().default(true).describe('Supersede nudges that have not been shown yet.'),
});
export type PostPetNudgesInput = z.infer<typeof postPetNudgesInput>;

export const WorkRef = z
  .string()
  .regex(WORK_REF_PATTERN)
  .describe(
    'Stable id copied verbatim from a connected tool, never invented: gcal:<iCalUID>, jira:ENU-123, ' +
      'github:<owner>/<repo>#<n>, drive:<fileId>. Never shown to anyone; ENU Den stores only a keyed daily value and ' +
      "uses it to draw people together when colleagues' own Claudes report the same id.",
  );

export const activityNow = z.object({
  kind: z
    .enum(NOW_KINDS)
    .describe(
      'work = 개인 업무(구현·분석·디자인) | docs = 문서·설계서 작성 | ' +
        'review = 검토·V&V·코드 리뷰 | collab = 동료와 함께 진행 중인 작업',
    ),
  ref: WorkRef.optional().describe('The one primary work item (ticket, PR, document) of this activity.'),
  until: IsoDateTime.optional().describe(
    'When this stops being current. Default now+90 min; capped at now+120 min.',
  ),
});

export const scheduleBlock = z.object({
  start_at: IsoDateTime,
  end_at: IsoDateTime.describe(
    "After start_at; the block must lie within today's office day (Asia/Seoul): " +
      'end_at may be exactly the next midnight (24:00). Cut longer blocks there.',
  ),
  kind: z
    .enum(SCHEDULE_KINDS)
    .describe(
      'meeting = accepted work meeting with other people | ' +
        'focus = calendar focus time | away = out of office (외근·출장·휴가·반차·부재중); shown only as 부재, never a reason',
    ),
  ref: WorkRef.optional().describe(
    "meeting only: gcal:<iCalUID> (identical on every attendee's calendar). " +
      'Omit for 1:1 meetings and anything sensitive.',
  ),
});

export const postActivityInput = z.object({
  now: activityNow
    .nullable()
    .describe(
      'What the owner is doing right now according to their own tools (last 60 min); ' +
        "null = nothing clear (clears the previous report). It only labels the owner's avatar or desk plate; " +
        'it never makes the owner appear.',
    ),
  schedule: z
    .array(scheduleBlock)
    .max(LIMITS.scheduleBlocksMax)
    .optional()
    .describe(
      "ALL of today's work blocks (office date, Asia/Seoul). Replaces the previous list; [] clears it; omit to keep it.",
    ),
  source_hint: z.enum(SOURCE_HINTS).default('scheduled_task'),
});
export type PostActivityInput = z.infer<typeof postActivityInput>;

/* ---------- outputs (structuredContent) ---------- */

export const rejectionReason = z.enum([
  'pii',
  'url',
  'too_long',
  'empty',
  'invalid_time',
  'daily_limit',
  'unknown_todo',
  'unsupported',
]);
export type RejectionReason = z.infer<typeof rejectionReason>;

/** A status the owner set by hand in the town; it is shown instead of Claude's report until `until`. */
const OwnerStatus = z.object({ status: z.enum(MANUAL_STATUSES), until: IsoDateTime });

export const getMyContextOutput = z.object({
  skip: z.boolean(),
  skip_reason: z.string().optional(),
  instructions_version: z.string(),
  now_local: z.string(),
  today: LocalDate,
  me: z
    .object({
      display_name: z.string(),
      email: z.string(),
      timezone: z.string(),
      desk_id: z.string().nullable(),
      default_log_visibility: VisibilitySchema,
      /** Team label, 직위 and role so Claude can write role-appropriate logs (e.g. SQA reviews). */
      team: z.string().nullable().optional(),
      title: z.string().nullable().optional(),
      role: z.string().nullable().optional(),
    })
    .optional(),
  link: z.object({ state: z.enum(LINK_STATES), last_work_log_at: IsoDateTime.nullable() }),
  today_log: z
    .object({
      summary: z.string(),
      tasks: z.array(workLogTask),
      blockers: z.array(z.string()),
      visibility: VisibilitySchema,
      edited_by_user: z.boolean(),
      updated_at: IsoDateTime,
    })
    .nullable()
    .optional(),
  open_todos: z
    .array(
      z.object({
        external_ref: z.string(),
        title: z.string(),
        due_at: IsoDateTime.nullable(),
        due_date: LocalDate.nullable(),
        priority: z.number(),
        status: z.enum(TODO_STATUSES),
        status_source: z.enum(['claude', 'user']),
      }),
    )
    .optional(),
  pending_nudges: z
    .array(z.object({ text: z.string(), status: z.enum(NUDGE_STATUSES), show_after: IsoDateTime }))
    .optional(),
  town_messages: z
    .object({
      shared: z.boolean(),
      unread_count: z.number(),
      items: z.array(
        z.object({
          message_id: z.string(),
          from_display_name: z.string(),
          sent_at: IsoDateTime,
          untrusted_text: z.string(),
        }),
      ),
    })
    .optional(),
  activity: z
    .object({
      sharing: z.boolean().describe('false (off or not chosen yet): do not call post_activity.'),
      now: z.object({ kind: z.enum(NOW_KINDS), has_ref: z.boolean(), until: IsoDateTime }).nullable(),
      /** Today's stored list; refs are never echoed. */
      schedule: z.array(
        z.object({
          start_at: IsoDateTime,
          end_at: IsoDateTime,
          kind: z.enum(SCHEDULE_KINDS),
          has_ref: z.boolean(),
        }),
      ),
      owner_status: OwnerStatus.nullable(),
    })
    .optional(),
});
export type GetMyContextOutput = z.infer<typeof getMyContextOutput>;

export const postWorkLogOutput = z.object({
  log_id: z.string(),
  result: z.enum(['created', 'updated', 'unchanged', 'skipped_user_edited', 'skipped_user_deleted']),
  period_key: LocalDate,
  visibility: VisibilitySchema,
  chat_summary_visibility: VisibilitySchema,
  view_url: z.string(),
});
export type PostWorkLogOutput = z.infer<typeof postWorkLogOutput>;

export const upsertTodosOutput = z.object({
  created: z.number(),
  updated: z.number(),
  unchanged: z.number(),
  skipped_user_controlled: z.number(),
  items: z.array(z.object({ external_ref: z.string(), todo_id: z.string(), status: z.enum(TODO_STATUSES) })),
});
export type UpsertTodosOutput = z.infer<typeof upsertTodosOutput>;

export const postPetNudgesOutput = z.object({
  accepted: z.number(),
  superseded: z.number(),
  rejected: z.array(z.object({ index: z.number(), reason: rejectionReason, detail: z.string().optional() })),
  delivery_note: z.string(),
});
export type PostPetNudgesOutput = z.infer<typeof postPetNudgesOutput>;

export const postActivityOutput = z.object({
  result: z.enum(['stored', 'skipped_sharing_off']),
  period_key: LocalDate,
  /** Effective (defaulted and clamped) `now.until`; null when `now` is null or nothing was stored. */
  now_until: IsoDateTime.nullable(),
  /** Blocks stored for today after this call. */
  schedule_blocks: z.number().int(),
  owner_status: OwnerStatus.nullable().describe(
    'A status the owner set by hand; it is shown instead of your report until `until`.',
  ),
});
export type PostActivityOutput = z.infer<typeof postActivityOutput>;
