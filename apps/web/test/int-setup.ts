import { TEST_DB_URL } from '@enu/testing';

/**
 * Environment for in-process route tests (set before any server module reads it).
 * PUBLIC_URL is the origin every test request uses.
 */
const defaults: Record<string, string> = {
  NODE_ENV: 'test',
  DATABASE_URL: TEST_DB_URL,
  PUBLIC_URL: 'http://localhost:3000',
  BETTER_AUTH_SECRET: 'web-int-test-secret-web-int-test-secret-0001',
  REALTIME_TICKET_SECRET: 'web-int-test-ticket-secret-web-int-test-0002',
  REALTIME_PUBLIC_URL: 'ws://localhost:2567',
  DEV_LOGIN_ENABLED: '1',
  ADMIN_EMAILS: 'boss@enu-tech.co.kr',
  ALLOWED_GOOGLE_HD: 'enu-tech.co.kr',
};
for (const [k, v] of Object.entries(defaults)) {
  if (k === 'DATABASE_URL' || process.env[k] === undefined) process.env[k] = v;
}
