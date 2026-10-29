import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';
import { BASE_URL, E2E_DB, ROOT, RT_PORT, TICKET_SECRET, WEB_PORT } from './env';

/**
 * Fresh, deterministic e2e database: migrate, the pseudonymous example roster (never the local real one),
 * demo users and data. It runs as the first step of the realtime web server, not in a global setup:
 * Playwright starts web servers before global setup, and the director loads the whole roster when the
 * room is created (every roster member is an actor, connected or not).
 */
const PREPARE_DB = ['migrate', 'seed:seats', 'seed:dev']
  .map((script) => `pnpm --filter @enu/db ${script}`)
  .join(' && ');

/**
 * End-to-end tests against real servers: Next dev (dev login enabled) + Colyseus + Postgres (enu_town_e2e).
 * The realtime server ignores office hours and pet quiet hours so the town is "open" whenever e2e runs.
 */
export default defineConfig({
  testDir: 'tests',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  // The HTML report goes to the repo root (gitignored and outside the lint globs), not into apps/e2e.
  reporter: [['list'], ['html', { open: 'never', outputFolder: path.join(ROOT, 'playwright-report') }]],
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    ...devices['Desktop Chrome'],
    viewport: { width: 1440, height: 900 },
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
  },
  webServer: [
    {
      command: `${PREPARE_DB} && pnpm --filter @enu/realtime exec tsx src/index.ts`,
      cwd: ROOT,
      url: `http://127.0.0.1:${RT_PORT}/healthz`,
      timeout: 180_000,
      reuseExistingServer: false,
      env: {
        NODE_ENV: 'development',
        DATABASE_URL: E2E_DB,
        SEATS_FILE: path.join(ROOT, 'config/seats.example.json'),
        REALTIME_PORT: String(RT_PORT),
        REALTIME_TICKET_SECRET: TICKET_SECRET,
        MAPS_DIR: path.join(ROOT, 'apps/web/public/assets/maps'),
        ALLOWED_ORIGINS: BASE_URL,
        NUDGE_JOIN_DELAY_MS: '1500',
        NUDGE_MIN_INTERVAL_MIN: '0',
        NUDGE_TICK_MS: '500',
        NUDGE_IGNORE_QUIET_HOURS: '1',
        // The town shows colleagues only during office hours; e2e runs at any hour (dev/e2e only).
        TOWN_IGNORE_OFFICE_HOURS: '1',
        LOG_LEVEL: 'warn',
      },
    },
    {
      command: `pnpm --filter @enu/web exec next dev --port ${WEB_PORT}`,
      cwd: ROOT,
      url: `${BASE_URL}/api/healthz`,
      timeout: 240_000,
      reuseExistingServer: false,
      env: {
        NODE_ENV: 'development',
        DATABASE_URL: E2E_DB,
        PUBLIC_URL: BASE_URL,
        BETTER_AUTH_SECRET: 'e2e-auth-secret-0123456789abcdef0123456789',
        DEV_LOGIN_ENABLED: '1',
        ALLOWED_GOOGLE_HD: 'enu-tech.co.kr',
        ADMIN_EMAILS: 'dev.r1@enu-tech.co.kr',
        REALTIME_TICKET_SECRET: TICKET_SECRET,
        REALTIME_PUBLIC_URL: `ws://localhost:${RT_PORT}`,
        INTERNAL_BASE_URL: `http://127.0.0.1:${WEB_PORT}`,
        PORT: String(WEB_PORT),
      },
    },
  ],
});
