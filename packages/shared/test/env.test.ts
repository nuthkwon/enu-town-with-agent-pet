import { describe, expect, it } from 'vitest';
import { loadEnv, realtimeEnvSchema } from '../src/env/index';

const realtime = {
  DATABASE_URL: 'postgres://enu:enu@127.0.0.1:5432/enu_town_dev',
  REALTIME_TICKET_SECRET: 'x'.repeat(32),
  MAPS_DIR: 'apps/web/public/assets/maps',
};

describe('realtime env', () => {
  it('treats office hours as real unless a development run overrides them', () => {
    expect(loadEnv(realtimeEnvSchema, realtime).TOWN_IGNORE_OFFICE_HOURS).toBe(false);
    expect(loadEnv(realtimeEnvSchema, { ...realtime, TOWN_IGNORE_OFFICE_HOURS: 'true' }).TOWN_IGNORE_OFFICE_HOURS).toBe(
      true,
    );
  });

  it('refuses the office-hours and quiet-hours overrides in production', () => {
    const prod = { ...realtime, NODE_ENV: 'production' };
    expect(() => loadEnv(realtimeEnvSchema, { ...prod, TOWN_IGNORE_OFFICE_HOURS: 'true' })).toThrow(
      /TOWN_IGNORE_OFFICE_HOURS must never be set in production/,
    );
    expect(() => loadEnv(realtimeEnvSchema, { ...prod, NUDGE_IGNORE_QUIET_HOURS: '1' })).toThrow(
      /NUDGE_IGNORE_QUIET_HOURS/,
    );
    expect(loadEnv(realtimeEnvSchema, prod).TOWN_IGNORE_OFFICE_HOURS).toBe(false);
  });
});
