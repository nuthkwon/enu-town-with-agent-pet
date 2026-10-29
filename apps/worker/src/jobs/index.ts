import { cleanupAuth } from './auth-cleanup';
import { refreshLinkStates } from './link-state';
import { expireNudges } from './nudges-expire';
import { purgeRetention } from './retention-purge';
import type { JobDefinition } from './types';

export * from './types';
export * from './nudges-expire';
export * from './link-state';
export * from './retention-purge';
export * from './auth-cleanup';

/** Registration table: one pg-boss queue + schedule + worker per entry (cron in APP_TIMEZONE). */
export const JOBS: readonly JobDefinition[] = [
  {
    name: 'nudges.expire',
    cron: '*/10 * * * *',
    description: 'Expire pet nudges past expires_at or shown max times; end snoozes.',
    expireInSeconds: 5 * 60,
    retryLimit: 1,
    missed: 'skip',
    run: (db, now) => expireNudges(db, now),
  },
  {
    name: 'claude.link-state',
    cron: '*/15 * * * *',
    description: 'Recompute linked/stale/not_linked for active users.',
    expireInSeconds: 5 * 60,
    retryLimit: 1,
    missed: 'skip',
    run: (db, now, env) => refreshLinkStates(db, now, env),
  },
  {
    name: 'retention.purge',
    cron: '17 3 * * *',
    description:
      "Delete chat, work logs, nudges, audit events and closed to-dos past retention, earlier days' activity reports and expired manual statuses.",
    expireInSeconds: 60 * 60,
    retryLimit: 2,
    missed: 'once',
    run: (db, now, env) => purgeRetention(db, now, env),
  },
  {
    name: 'auth.cleanup',
    cron: '47 3 * * *',
    description: 'Delete expired sessions, verifications, OAuth tokens and client assertions.',
    expireInSeconds: 15 * 60,
    retryLimit: 2,
    missed: 'once',
    run: (db, now) => cleanupAuth(db, now),
  },
];
