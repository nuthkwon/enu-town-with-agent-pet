import * as z from 'zod';
import {
  EXTERNAL_REF_PATTERN,
  LIMITS,
  LINK_STATES,
  NUDGE_KINDS,
  NUDGE_STATUSES,
  SOURCE_HINTS,
  TASK_STATUSES,
  TODO_STATUSES,
  VISIBILITIES,
} from '../constants';

/** Input/output contracts of the four ENU Town MCP tools (snake_case, as Claude sees them). */

export const IsoDateTime = z.iso.datetime({ offset: true });
export const LocalDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD');
export const VisibilitySchema = z.enum(VISIBILITIES);
export const Priority = z.number().int().min(1).max(3);

export const CONTEXT_SECTIONS = ['profile', 'today_log', 'todos', 'nudges', 'town_messages'] as const;

export const getMyContextInput = z.object({
  include: z
    .array(z.enum(CONTEXT_SECTIONS))
    .optional()
    .describe('Sections to return. Default: all sections you are allowed to read.'),
  since: IsoDateTime.optional().describe('Only town messages after this instant (default: 24h ago, max 7 days).'),
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
  blockers: z.array(z.string().min(1).max(LIMITS.workLogBlockerMax)).max(LIMITS.workLogBlockersMax).default([]),
  claude_chat_summary: z
    .string()
    .max(LIMITS.claudeChatSummaryMax)
    .optional()
    .describe('2-3 sentences on the topics of work conversations with Claude today. No quotes, no private chats.'),
  visibility: VisibilitySchema.optional().describe('Omit to use the owner default. You may only lower it to private.'),
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
    due_date: LocalDate.optional().describe('All-day due date in the owner timezone (alternative to due_at).'),
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
  replace_pending: z
    .boolean()
    .default(true)
    .describe('Supersede nudges that have not been shown yet.'),
});
export type PostPetNudgesInput = z.infer<typeof postPetNudgesInput>;

/* ---------- outputs (structuredContent) ---------- */

export const rejectionReason = z.enum(['pii', 'url', 'too_long', 'empty', 'invalid_time', 'daily_limit', 'unknown_todo']);
export type RejectionReason = z.infer<typeof rejectionReason>;

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
