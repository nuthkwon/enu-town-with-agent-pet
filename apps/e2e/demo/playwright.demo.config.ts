import { defineConfig, devices } from '@playwright/test';
import { BASE_URL } from '../env';

/**
 * The demo video (demo/csms.demo.ts), recorded against an already running demo stack (demo/stack.sh):
 * no web servers are started here and nothing of this runs in CI.
 */
export default defineConfig({
  testDir: '.',
  testMatch: '*.demo.ts',
  timeout: 30 * 60_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    ...devices['Desktop Chrome'],
    baseURL: BASE_URL,
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
    // A stuck step fails within a minute instead of recording until the test times out.
    actionTimeout: 30_000,
    navigationTimeout: 120_000,
  },
});
