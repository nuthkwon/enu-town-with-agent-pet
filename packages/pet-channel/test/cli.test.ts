import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runCli } from '../src/cli';
import { parseBaseUrl, readConfig, type ChannelConfig } from '../src/config';
import { loadCredentials, saveCredentials } from '../src/credentials';
import { PLUGIN_VERSION } from '../src/version';

const BASE = 'https://den.example';
const TOKEN = `edc_${'A'.repeat(43)}`;
let dir: string;
let config: ChannelConfig;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'enu-den-channel-'));
  config = { baseUrl: BASE, active: false, credentialsPath: join(dir, 'enu-den', 'credentials.json') };
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function io(responses: Record<string, Response | (() => Response)>) {
  const out: string[] = [];
  const err: string[] = [];
  const calls: { url: string; init: RequestInit }[] = [];
  return {
    out,
    err,
    calls,
    io: {
      out: (l: string) => out.push(l),
      err: (l: string) => err.push(l),
      platform: 'darwin',
      now: () => new Date('2026-10-29T12:00:00.000Z'),
      fetch: async (url: string, init: RequestInit) => {
        calls.push({ url, init });
        const r = responses[`${init.method} ${new URL(url).pathname}`];
        if (!r) throw new Error(`unexpected ${init.method} ${url}`);
        return typeof r === 'function' ? r() : r;
      },
    },
  };
}

const paired = {
  token: TOKEN,
  token_id: '11111111-1111-7111-8111-111111111111',
  link_id: '22222222-2222-7222-8222-222222222222',
  expires_at: '2027-01-27T12:00:00.000Z',
  owner_display_name: '김이누',
};

describe('enu-pet pair', () => {
  it('pairs with a code, stores the token owner-only and never prints it', async () => {
    const t = io({ 'POST /api/v1/pet-channel/pair': Response.json(paired, { status: 201 }) });
    expect(await runCli(['pair', 'k7qf-3mxp', '--label', '회사 맥북'], config, t.io)).toBe(0);
    expect(JSON.parse(String(t.calls[0]!.init.body))).toEqual({
      code: 'k7qf-3mxp',
      label: '회사 맥북',
      platform: 'darwin',
      plugin_version: '0.1.0',
    });
    expect(new Headers(t.calls[0]!.init.headers).has('authorization')).toBe(false);
    expect(t.out.join('\n')).toContain('김이누');
    expect([...t.out, ...t.err].join('\n')).not.toContain(TOKEN);
    expect(loadCredentials(config.credentialsPath, BASE)).toMatchObject({ token: TOKEN, base_url: BASE });
    if (process.platform !== 'win32') {
      expect(statSync(config.credentialsPath).mode & 0o777).toBe(0o600);
      expect(statSync(join(dir, 'enu-den')).mode & 0o777).toBe(0o700);
    }
  });

  it("never replaces someone else's credentials", async () => {
    saveCredentials(config.credentialsPath, {
      v: 1,
      base_url: BASE,
      ...paired,
      paired_at: '2026-10-01T00:00:00.000Z',
    });
    const t = io({});
    expect(await runCli(['pair', 'K7QF3MXP'], config, t.io)).toBe(1);
    expect(t.err.join('\n')).toContain('enu-pet unpair');
    expect(t.calls).toEqual([]);
  });

  it('explains a wrong code', async () => {
    const t = io({
      'POST /api/v1/pet-channel/pair': Response.json({ error: 'invalid_code' }, { status: 400 }),
    });
    expect(await runCli(['pair', 'AAAA-BBBB'], config, t.io)).toBe(1);
    expect(t.err.join('\n')).toContain('새 코드');
    expect(loadCredentials(config.credentialsPath, BASE)).toBeNull();
  });
});

describe('enu-pet unpair and status', () => {
  it('revokes the token on ENU Den and removes the file, also when it was already revoked', async () => {
    for (const status of [204, 401]) {
      saveCredentials(config.credentialsPath, {
        v: 1,
        base_url: BASE,
        ...paired,
        paired_at: '2026-10-01T00:00:00.000Z',
      });
      const t = io({
        'DELETE /api/v1/pet-channel/token': () =>
          status === 204
            ? new Response(null, { status: 204 })
            : Response.json({ error: 'token_revoked' }, { status: 401 }),
      });
      expect(await runCli(['status'], config, t.io)).toBe(0);
      expect(t.out[0]).toContain('김이누');
      expect(await runCli(['unpair'], config, t.io)).toBe(0);
      expect(new Headers(t.calls[0]!.init.headers).get('authorization')).toBe(`Bearer ${TOKEN}`);
      expect(loadCredentials(config.credentialsPath, BASE)).toBeNull();
    }
  });
});

describe('config and credentials', () => {
  it('requires https except for a local ENU Den', () => {
    expect(parseBaseUrl(undefined)).toBe('https://den.enu-tech.co.kr');
    expect(parseBaseUrl('http://localhost:3000/')).toBe('http://localhost:3000');
    expect(() => parseBaseUrl('http://den.example')).toThrow();
    expect(readConfig({ ENU_DEN_PET: '1', ENU_DEN_CHANNEL_HOME: dir })).toMatchObject({
      active: true,
      credentialsPath: join(dir, 'credentials.json'),
    });
    expect(readConfig({ ENU_DEN_PET: 'true' }).active).toBe(false);
  });

  it('ignores credentials of another ENU Den or a damaged file', () => {
    saveCredentials(config.credentialsPath, {
      v: 1,
      base_url: 'http://localhost:3000',
      ...paired,
      paired_at: '2026-10-01T00:00:00.000Z',
    });
    expect(loadCredentials(config.credentialsPath, BASE)).toBeNull();
    writeFileSync(config.credentialsPath, '{not json');
    expect(loadCredentials(config.credentialsPath, BASE)).toBeNull();
    expect(readFileSync(config.credentialsPath, 'utf8')).toBe('{not json');
  });
});

describe('plugin version', () => {
  it('is the same in the source, the package and the plugin manifest', () => {
    const read = (p: string) =>
      JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8')) as { version: string };
    expect(read('../package.json').version).toBe(PLUGIN_VERSION);
    expect(read('../../../claude/plugins/enu-den-channel/.claude-plugin/plugin.json').version).toBe(
      PLUGIN_VERSION,
    );
  });
});
