import * as z from 'zod';
import { ALLOWED_GOOGLE_HD_DEFAULT, APP_TIMEZONE_DEFAULT } from '../constants';

/** Environment contracts per service. Each service only receives its own env file. */

const bool = z
  .union([z.boolean(), z.string()])
  .transform((v) => (typeof v === 'boolean' ? v : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase())));

const csvOf = (fallback: string) =>
  z
    .string()
    .default(fallback)
    .transform((v) =>
    v
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    );
const csv = csvOf('');

const common = {
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().min(1),
  APP_TIMEZONE: z.string().default(APP_TIMEZONE_DEFAULT),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
};

export const webEnvSchema = z
  .object({
    ...common,
    PUBLIC_URL: z.url(),
    BETTER_AUTH_SECRET: z.string().min(32),
    GOOGLE_CLIENT_ID: z.string().default(''),
    GOOGLE_CLIENT_SECRET: z.string().default(''),
    ALLOWED_GOOGLE_HD: z.string().default(ALLOWED_GOOGLE_HD_DEFAULT),
    ADMIN_EMAILS: csv,
    /** Optional pilot allow-list (staging); empty = everyone in the domain. */
    ALLOWED_EMAILS: csv,
    CIMD_ALLOWED_HOSTS: csvOf('claude.ai,claude.com,anthropic.com'),
    MCP_ALLOW_DCR: bool.default(false),
    OAUTH_ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(3600),
    OAUTH_REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
    REALTIME_TICKET_SECRET: z.string().min(32),
    REALTIME_PUBLIC_URL: z.string().min(1),
    DEV_LOGIN_ENABLED: bool.default(false),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production' && env.DEV_LOGIN_ENABLED) {
      ctx.addIssue({ code: 'custom', message: 'DEV_LOGIN_ENABLED must never be set in production' });
    }
    const url = new URL(env.PUBLIC_URL);
    const local = ['localhost', '127.0.0.1'].includes(url.hostname);
    if (env.NODE_ENV === 'production' && !local && url.protocol !== 'https:') {
      ctx.addIssue({ code: 'custom', message: 'PUBLIC_URL must be https in production' });
    }
    if (!env.DEV_LOGIN_ENABLED && (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET)) {
      ctx.addIssue({ code: 'custom', message: 'GOOGLE_CLIENT_ID/SECRET are required unless DEV_LOGIN_ENABLED' });
    }
  });
export type WebEnv = z.infer<typeof webEnvSchema>;

export const realtimeEnvSchema = z
  .object({
  ...common,
  REALTIME_PORT: z.coerce.number().int().default(2567),
  REALTIME_TICKET_SECRET: z.string().min(32),
  ALLOWED_ORIGINS: csv,
  MAPS_DIR: z.string().min(1),
  ALLOWED_GOOGLE_HD: z.string().default(ALLOWED_GOOGLE_HD_DEFAULT),
  NUDGE_TICK_MS: z.coerce.number().int().positive().default(1000),
  NUDGE_JOIN_DELAY_MS: z.coerce.number().int().nonnegative().optional(),
  NUDGE_MIN_INTERVAL_MIN: z.coerce.number().nonnegative().optional(),
  /** Development/e2e only: pet bubbles ignore quiet hours, weekends and holidays. */
  NUDGE_IGNORE_QUIET_HOURS: bool.default(false),
})
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production' && env.NUDGE_IGNORE_QUIET_HOURS) {
      ctx.addIssue({ code: 'custom', message: 'NUDGE_IGNORE_QUIET_HOURS must never be set in production' });
    }
  });
export type RealtimeEnv = z.infer<typeof realtimeEnvSchema>;

export const workerEnvSchema = z.object({
  ...common,
  PGBOSS_SCHEMA: z.string().default('pgboss'),
  RETENTION_DM_DAYS: z.coerce.number().int().positive().default(90),
  RETENTION_ROOM_CHAT_DAYS: z.coerce.number().int().positive().default(30),
  RETENTION_WORKLOG_DAYS: z.coerce.number().int().positive().default(90),
  RETENTION_NUDGE_DAYS: z.coerce.number().int().positive().default(14),
  RETENTION_AUDIT_DAYS: z.coerce.number().int().positive().default(365),
});
export type WorkerEnv = z.infer<typeof workerEnvSchema>;

/** Parses env with a readable error; throws so the process refuses to boot on bad config. */
export function loadEnv<S extends z.ZodType>(schema: S, source: Record<string, string | undefined> = process.env): z.infer<S> {
  const result = schema.safeParse(source);
  if (!result.success) {
    const lines = result.error.issues.map((i) => `  - ${i.path.join('.') || '(env)'}: ${i.message}`);
    throw new Error(`Invalid environment:\n${lines.join('\n')}`);
  }
  return result.data;
}
