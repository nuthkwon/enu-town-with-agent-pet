import { homedir } from 'node:os';
import { join } from 'node:path';

export const DEFAULT_BASE_URL = 'https://den.enu-tech.co.kr';

export interface ChannelConfig {
  /** ENU Den origin, e.g. https://den.enu-tech.co.kr (no trailing slash). */
  baseUrl: string;
  /** `ENU_DEN_PET=1`: this Claude Code session was started for the pets (`enu-pet`). */
  active: boolean;
  credentialsPath: string;
}

/** Plain http only for a local ENU Den; anything else must be https. */
export function parseBaseUrl(raw: string | undefined): string {
  const url = new URL(raw?.trim() || DEFAULT_BASE_URL);
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) {
    throw new Error('ENU_DEN_URL must be https (http only for localhost)');
  }
  return url.origin;
}

export function readConfig(env: NodeJS.ProcessEnv = process.env): ChannelConfig {
  const home = env.ENU_DEN_CHANNEL_HOME?.trim()
    ? env.ENU_DEN_CHANNEL_HOME
    : join(
        env.CLAUDE_CONFIG_DIR?.trim() ? env.CLAUDE_CONFIG_DIR : join(homedir(), '.claude'),
        'channels',
        'enu-den',
      );
  return {
    baseUrl: parseBaseUrl(env.ENU_DEN_URL),
    active: env.ENU_DEN_PET === '1',
    credentialsPath: join(home, 'credentials.json'),
  };
}
